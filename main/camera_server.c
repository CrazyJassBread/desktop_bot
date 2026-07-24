#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>

#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "camera_client.h"
// Streaming jpeg boundary
#define PART_BOUNDARY "123456789000000000000987654321"

// streaming function
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %zu\r\n\r\n";

static const char *TAG = "example:take_picture";

esp_err_t jpg_stream_httpd_handler(httpd_req_t *req)
{
    esp_err_t res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);

    if (res != ESP_OK) {
        return res;
    }

    int64_t last_frame = esp_timer_get_time();

    while (true) {
        camera_fb_t *fb = esp_camera_fb_get();

        if (fb == NULL) {
            ESP_LOGE(TAG, "Camera capture failed");
            return ESP_FAIL;
        }

        uint8_t *jpg_buf = NULL;
        size_t jpg_buf_len = 0;
        bool converted = false;

        if (fb->format == PIXFORMAT_JPEG) {
            jpg_buf = fb->buf;
            jpg_buf_len = fb->len;
        } else {
            converted = frame2jpg(
                fb,
                80,
                &jpg_buf,
                &jpg_buf_len
            );

            if (!converted) {
                ESP_LOGE(TAG, "JPEG compression failed");
                esp_camera_fb_return(fb);
                return ESP_FAIL;
            }
        }

        char part_buf[64];

        int header_len = snprintf(
            part_buf,
            sizeof(part_buf),
            _STREAM_PART,
            jpg_buf_len
        );

        if (header_len < 0 ||
            (size_t)header_len >= sizeof(part_buf)) {
            ESP_LOGE(TAG, "Stream header buffer too small");
            res = ESP_FAIL;
        }

        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(
                req,
                _STREAM_BOUNDARY,
                strlen(_STREAM_BOUNDARY)
            );
        }

        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(
                req,
                part_buf,
                (size_t)header_len
            );
        }

        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(
                req,
                (const char *)jpg_buf,
                jpg_buf_len
            );
        }

        if (converted) {
            free(jpg_buf);
        }

        esp_camera_fb_return(fb);

        if (res != ESP_OK) {
            ESP_LOGI(TAG, "Stream client disconnected");
            break;
        }

        int64_t now = esp_timer_get_time();
        int64_t frame_time_ms = (now - last_frame) / 1000;
        last_frame = now;

        float fps = frame_time_ms > 0
            ? 1000.0f / (float)frame_time_ms
            : 0.0f;

        ESP_LOGI(
            TAG,
            "MJPEG: %u KB, %lld ms, %.1f fps",
            (unsigned)(jpg_buf_len / 1024),
            (long long)frame_time_ms,
            fps
        );
    }

    return res;
}

httpd_handle_t start_camera_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    httpd_handle_t server = NULL;

    httpd_uri_t stream_uri = {
        .uri = "/stream",
        .method = HTTP_GET,
        .handler = jpg_stream_httpd_handler,
        .user_ctx = NULL
    };

    esp_err_t err = httpd_start(&server, &config);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s",
                 esp_err_to_name(err));
        return NULL;
    }

    err = httpd_register_uri_handler(server, &stream_uri);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to register /stream: %s",
                 esp_err_to_name(err));
        httpd_stop(server);
        return NULL;
    }

    ESP_LOGI(TAG, "Camera stream available at /stream");
    return server;
}