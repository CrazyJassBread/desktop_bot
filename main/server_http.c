#include "server_http.h"
#include "server_config.h"

#include <inttypes.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"

#define MAX_CONFIG_BODY_SIZE 512

#define CAMERA_INTERVAL_MIN_MS 100
#define CAMERA_INTERVAL_MAX_MS 60000

static const char *TAG = "server_http";


static esp_err_t config_post_handler(
    httpd_req_t *request
)
{
    if (
        request->content_len <= 0 ||
        request->content_len >= MAX_CONFIG_BODY_SIZE
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid request body size"
        );

        return ESP_FAIL;
    }

    char *body = calloc(
        1,
        request->content_len + 1
    );

    if (body == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Out of memory"
        );

        return ESP_ERR_NO_MEM;
    }

    size_t total_received = 0;

    while (
        total_received <
        request->content_len
    ) {
        int received = httpd_req_recv(
            request,
            body + total_received,
            request->content_len -
                total_received
        );

        if (
            received ==
            HTTPD_SOCK_ERR_TIMEOUT
        ) {
            continue;
        }

        if (received <= 0) {
            free(body);

            httpd_resp_send_err(
                request,
                HTTPD_500_INTERNAL_SERVER_ERROR,
                "Could not receive request body"
            );

            return ESP_FAIL;
        }

        total_received += received;
    }

    body[total_received] = '\0';

    cJSON *json = cJSON_Parse(body);
    free(body);

    if (json == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid JSON"
        );

        return ESP_FAIL;
    }

    cJSON *ip =
        cJSON_GetObjectItemCaseSensitive(
            json,
            "ip"
        );

    cJSON *camera_port =
        cJSON_GetObjectItemCaseSensitive(
            json,
            "camera_port"
        );

    cJSON *microphone_port =
        cJSON_GetObjectItemCaseSensitive(
            json,
            "microphone_port"
        );

    cJSON *camera_interval_ms =
        cJSON_GetObjectItemCaseSensitive(
            json,
            "camera_interval_ms"
        );

    if (
        !cJSON_IsString(ip) ||
        ip->valuestring == NULL ||
        !cJSON_IsNumber(camera_port) ||
        !cJSON_IsNumber(microphone_port) ||
        !cJSON_IsNumber(camera_interval_ms)
    ) {
        cJSON_Delete(json);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Missing or invalid fields"
        );

        return ESP_ERR_INVALID_ARG;
    }

    if (
        camera_port->valueint < 1 ||
        camera_port->valueint > 65535 ||
        microphone_port->valueint < 1 ||
        microphone_port->valueint > 65535
    ) {
        cJSON_Delete(json);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Ports must be between 1 and 65535"
        );

        return ESP_ERR_INVALID_ARG;
    }

    if (
        camera_interval_ms->valuedouble <
            CAMERA_INTERVAL_MIN_MS ||
        camera_interval_ms->valuedouble >
            CAMERA_INTERVAL_MAX_MS
    ) {
        cJSON_Delete(json);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "camera_interval_ms must be between "
            "100 and 60000"
        );

        return ESP_ERR_INVALID_ARG;
    }

    server_config_t new_config = {0};

    strlcpy(
        new_config.server_ip,
        ip->valuestring,
        sizeof(new_config.server_ip)
    );

    new_config.camera_port =
        (uint16_t)camera_port->valueint;

    new_config.microphone_port =
        (uint16_t)microphone_port->valueint;

    new_config.camera_interval_ms =
        (uint32_t)
            camera_interval_ms->valuedouble;

    cJSON_Delete(json);

    esp_err_t result =
        server_config_set(&new_config);

    if (result != ESP_OK) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid configuration"
        );

        return result;
    }

    ESP_LOGI(
        TAG,
        "Server config updated: "
        "ip=%s, camera=%u, mic=%u, "
        "camera interval=%" PRIu32 " ms",
        new_config.server_ip,
        (unsigned)new_config.camera_port,
        (unsigned)new_config.microphone_port,
        new_config.camera_interval_ms
    );

    httpd_resp_set_type(
        request,
        "application/json"
    );

    return httpd_resp_sendstr(
        request,
        "{\"updated\":true}"
    );
}


static esp_err_t config_get_handler(
    httpd_req_t *request
)
{
    server_config_t config;

    esp_err_t result =
        server_config_get(&config);

    if (result != ESP_OK) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not read configuration"
        );

        return result;
    }

    cJSON *json = cJSON_CreateObject();

    if (json == NULL) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(
        json,
        "ip",
        config.server_ip
    );

    cJSON_AddNumberToObject(
        json,
        "camera_port",
        config.camera_port
    );

    cJSON_AddNumberToObject(
        json,
        "microphone_port",
        config.microphone_port
    );

    cJSON_AddNumberToObject(
        json,
        "camera_interval_ms",
        config.camera_interval_ms
    );

    char *response =
        cJSON_PrintUnformatted(json);

    cJSON_Delete(json);

    if (response == NULL) {
        return ESP_ERR_NO_MEM;
    }

    httpd_resp_set_type(
        request,
        "application/json"
    );

    result = httpd_resp_sendstr(
        request,
        response
    );

    free(response);

    return result;
}


esp_err_t server_http_register_handlers(
    httpd_handle_t server
)
{
    if (server == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    static const httpd_uri_t config_post_uri = {
        .uri = "/server/config",
        .method = HTTP_POST,
        .handler = config_post_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t config_get_uri = {
        .uri = "/server/config",
        .method = HTTP_GET,
        .handler = config_get_handler,
        .user_ctx = NULL
    };

    esp_err_t result =
        httpd_register_uri_handler(
            server,
            &config_post_uri
        );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register "
            "POST /server/config: %s",
            esp_err_to_name(result)
        );

        return result;
    }

    result = httpd_register_uri_handler(
        server,
        &config_get_uri
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register "
            "GET /server/config: %s",
            esp_err_to_name(result)
        );

        return result;
    }

    ESP_LOGI(
        TAG,
        "Server HTTP handlers registered"
    );

    return ESP_OK;
}