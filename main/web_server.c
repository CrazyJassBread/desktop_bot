#include "web_server.h"
#include "printer_http.h"
#include "oled_http.h"
#include "server_http.h"

#include "esp_http_server.h"
#include "esp_log.h"

static const char *TAG = "web_server";

static esp_err_t root_handler(
    httpd_req_t *request
)
{
    const char response[] =
    "{"
    "\"device\":\"LanguageBot\","
    "\"endpoints\":["
        "\"GET /\","
        "\"POST /printer/image?width=...&height=...\","
        "\"POST /printer/text\","
        "\"POST /printer/feed?lines=...\","
        "\"GET /printer/test\","
        "\"POST /oled/eyes\","
        "\"GET /oled/test\","
        "\"GET /server/config\","
        "\"POST /server/config\""
    "]"
    "}";

    httpd_resp_set_type(
        request,
        "application/json"
    );

    return httpd_resp_send(
        request,
        response,
        HTTPD_RESP_USE_STRLEN
    );
}

httpd_handle_t web_server_start(void)
{
    httpd_config_t config =
        HTTPD_DEFAULT_CONFIG();

    config.server_port = 80;

    /*
     * Leave enough space for:
     *
     * /
     * /printer-test
     * /print-image
     * future screen handlers
     * future microphone/camera handlers
     */
    config.max_uri_handlers = 16;

    /*
     * Increase the server task stack because image handling
     * uses more local state than a minimal HTTP handler.
     */
    config.stack_size = 8192;

    /*
     * Time allowed for receiving request data.
     */
    config.recv_wait_timeout = 15;
    config.send_wait_timeout = 15;

    httpd_handle_t server = NULL;

    esp_err_t result = httpd_start(
        &server,
        &config
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "httpd_start failed: %s",
            esp_err_to_name(result)
        );

        return NULL;
    }

    static const httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_handler,
        .user_ctx = NULL
    };

    result = httpd_register_uri_handler(
        server,
        &root_uri
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register root handler: %s",
            esp_err_to_name(result)
        );

        httpd_stop(server);
        return NULL;
    }

    result = printer_http_register_handlers(server);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register printer handlers"
        );

        httpd_stop(server);
        return NULL;
    }

    result = oled_http_register_handlers(server);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register OLED handlers: %s",
            esp_err_to_name(result)
        );

        httpd_stop(server);
        return NULL;
    }

    result = server_http_register_handlers(server);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not register server handlers: %s",
            esp_err_to_name(result)
        );

        httpd_stop(server);
        return NULL;
    }

    ESP_LOGI(
        TAG,
        "HTTP server started on port %u",
        config.server_port
    );

    return server;
}

void web_server_stop(httpd_handle_t server)
{
    if (server == NULL) {
        return;
    }

    esp_err_t result = httpd_stop(server);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "httpd_stop failed: %s",
            esp_err_to_name(result)
        );

        return;
    }

    ESP_LOGI(TAG, "HTTP server stopped");
}