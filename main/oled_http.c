#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "oled_http.h"
#include "roboeyes_display.h"

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_log.h"

#define MAX_OLED_JSON_SIZE_BYTES 512

static const char *TAG = "oled_http";


static esp_err_t send_json_success(
    httpd_req_t *request,
    const char *message
)
{
    if (
        request == NULL ||
        message == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *response =
        cJSON_CreateObject();

    if (response == NULL) {
        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not create JSON response"
        );
    }

    if (
        cJSON_AddBoolToObject(
            response,
            "success",
            true
        ) == NULL ||
        cJSON_AddStringToObject(
            response,
            "message",
            message
        ) == NULL
    ) {
        cJSON_Delete(response);

        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not create JSON response"
        );
    }

    char *response_text =
        cJSON_PrintUnformatted(response);

    cJSON_Delete(response);

    if (response_text == NULL) {
        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not serialize JSON response"
        );
    }

    httpd_resp_set_type(
        request,
        "application/json"
    );

    esp_err_t result =
        httpd_resp_sendstr(
            request,
            response_text
        );

    free(response_text);

    return result;
}


static esp_err_t receive_complete_body(
    httpd_req_t *request,
    uint8_t *buffer,
    size_t expected_size
)
{
    if (
        request == NULL ||
        buffer == NULL ||
        expected_size == 0
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t total_received = 0;

    while (total_received < expected_size) {
        int received = httpd_req_recv(
            request,
            (char *)buffer + total_received,
            expected_size - total_received
        );

        if (received == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }

        if (received <= 0) {
            ESP_LOGE(
                TAG,
                "HTTP receive failed after %u bytes",
                (unsigned int)total_received
            );

            return ESP_FAIL;
        }

        total_received +=
            (size_t)received;
    }

    return ESP_OK;
}


static esp_err_t receive_json_object(
    httpd_req_t *request,
    cJSON **output
)
{
    if (
        request == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        request->content_len <= 0 ||
        request->content_len >
            MAX_OLED_JSON_SIZE_BYTES
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "JSON body must contain between 1 and 512 bytes"
        );

        return ESP_FAIL;
    }

    size_t body_size =
        (size_t)request->content_len;

    char *body =
        malloc(body_size + 1);

    if (body == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Not enough memory"
        );

        return ESP_ERR_NO_MEM;
    }

    esp_err_t result =
        receive_complete_body(
            request,
            (uint8_t *)body,
            body_size
        );

    if (result != ESP_OK) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to receive JSON body"
        );

        return result;
    }

    body[body_size] = '\0';

    cJSON *root =
        cJSON_ParseWithLength(
            body,
            body_size
        );

    free(body);

    if (root == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Request body is not valid JSON"
        );

        return ESP_FAIL;
    }

    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "JSON body must be an object"
        );

        return ESP_FAIL;
    }

    *output = root;

    return ESP_OK;
}


static esp_err_t oled_expression_handler(
    httpd_req_t *request
)
{
    cJSON *root = NULL;

    esp_err_t result =
        receive_json_object(
            request,
            &root
        );

    if (result != ESP_OK) {
        return result;
    }

    const cJSON *expression_item =
        cJSON_GetObjectItemCaseSensitive(
            root,
            "expression"
        );

    if (
        !cJSON_IsString(expression_item) ||
        expression_item->valuestring == NULL ||
        expression_item->valuestring[0] == '\0'
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "The expression field must be a string"
        );

        return ESP_FAIL;
    }

    result = roboeyes_show_expression(
        expression_item->valuestring
    );

    if (result == ESP_ERR_NOT_FOUND) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Unknown expression"
        );

        return ESP_FAIL;
    }

    if (result != ESP_OK) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not update expression"
        );

        return result;
    }

    ESP_LOGI(
        TAG,
        "Expression changed to %s",
        expression_item->valuestring
    );

    cJSON_Delete(root);

    return send_json_success(
        request,
        "OLED expression updated"
    );
}


static esp_err_t oled_look_handler(
    httpd_req_t *request
)
{
    cJSON *root = NULL;

    esp_err_t result =
        receive_json_object(
            request,
            &root
        );

    if (result != ESP_OK) {
        return result;
    }

    const cJSON *direction_item =
        cJSON_GetObjectItemCaseSensitive(
            root,
            "direction"
        );

    if (
        !cJSON_IsString(direction_item) ||
        direction_item->valuestring == NULL ||
        direction_item->valuestring[0] == '\0'
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "The direction field must be a string"
        );

        return ESP_FAIL;
    }

    result = roboeyes_set_look_direction(
        direction_item->valuestring
    );

    if (result == ESP_ERR_NOT_FOUND) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Unknown look direction"
        );

        return ESP_FAIL;
    }

    if (result != ESP_OK) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not change look direction"
        );

        return result;
    }

    ESP_LOGI(
        TAG,
        "Look direction changed to %s",
        direction_item->valuestring
    );

    cJSON_Delete(root);

    return send_json_success(
        request,
        "OLED look direction updated"
    );
}


static esp_err_t oled_test_handler(
    httpd_req_t *request
)
{
    esp_err_t result =
        roboeyes_show_expression("laugh");

    if (result != ESP_OK) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "OLED test failed"
        );

        return result;
    }

    return send_json_success(
        request,
        "OLED test animation started"
    );
}


esp_err_t oled_http_register_handlers(
    httpd_handle_t server
)
{
    if (server == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    static const httpd_uri_t expression_uri = {
        .uri = "/oled/expression",
        .method = HTTP_POST,
        .handler = oled_expression_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t look_uri = {
        .uri = "/oled/look",
        .method = HTTP_POST,
        .handler = oled_look_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t test_uri = {
        .uri = "/oled/test",
        .method = HTTP_GET,
        .handler = oled_test_handler,
        .user_ctx = NULL
    };

    const httpd_uri_t *handlers[] = {
        &expression_uri,
        &look_uri,
        &test_uri
    };

    const char *handler_names[] = {
        "/oled/expression",
        "/oled/look",
        "/oled/test"
    };

    const size_t handler_count =
        sizeof(handlers) /
        sizeof(handlers[0]);

    for (
        size_t i = 0;
        i < handler_count;
        i++
    ) {
        esp_err_t result =
            httpd_register_uri_handler(
                server,
                handlers[i]
            );

        if (result != ESP_OK) {
            ESP_LOGE(
                TAG,
                "Could not register %s: %s",
                handler_names[i],
                esp_err_to_name(result)
            );

            return result;
        }
    }

    ESP_LOGI(
        TAG,
        "Registered OLED HTTP handlers"
    );

    return ESP_OK;
}