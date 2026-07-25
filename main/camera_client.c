#include <stdio.h>
#include <stdbool.h>
#include <inttypes.h>

#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/*
 * Your ESP32-S3 camera pin configuration
 */
#define CAM_PIN_PWDN   -1
#define CAM_PIN_RESET  -1

#define CAM_PIN_VSYNC  6
#define CAM_PIN_HREF   7
#define CAM_PIN_PCLK   13
#define CAM_PIN_XCLK   15

#define CAM_PIN_SIOD   4
#define CAM_PIN_SIOC   5

#define CAM_PIN_D0     11
#define CAM_PIN_D1     9
#define CAM_PIN_D2     8
#define CAM_PIN_D3     10
#define CAM_PIN_D4     12
#define CAM_PIN_D5     18
#define CAM_PIN_D6     17
#define CAM_PIN_D7     16

/*
 * Replace this with your laptop's IPv4 address.
 *
 * Do not use localhost or 127.0.0.1.
 */
#define CAMERA_SERVER_URL "http://10.76.11.213:8081/upload"

/*
 * Send one picture every 500 ms.
 */
#define UPLOAD_INTERVAL_MS 500

static const char *TAG = "camera_client";

/*
 * Camera configuration
 */
static camera_config_t camera_config = {
    .pin_pwdn = CAM_PIN_PWDN,
    .pin_reset = CAM_PIN_RESET,

    .pin_xclk = CAM_PIN_XCLK,
    .pin_sccb_sda = CAM_PIN_SIOD,
    .pin_sccb_scl = CAM_PIN_SIOC,

    .pin_d7 = CAM_PIN_D7,
    .pin_d6 = CAM_PIN_D6,
    .pin_d5 = CAM_PIN_D5,
    .pin_d4 = CAM_PIN_D4,
    .pin_d3 = CAM_PIN_D3,
    .pin_d2 = CAM_PIN_D2,
    .pin_d1 = CAM_PIN_D1,
    .pin_d0 = CAM_PIN_D0,

    .pin_vsync = CAM_PIN_VSYNC,
    .pin_href = CAM_PIN_HREF,
    .pin_pclk = CAM_PIN_PCLK,

    .xclk_freq_hz = 20000000,

    .ledc_timer = LEDC_TIMER_0,
    .ledc_channel = LEDC_CHANNEL_0,

    /*
     * HTTP upload expects JPEG data.
     */
    .pixel_format = PIXFORMAT_JPEG,

    /*
     * I recommend VGA first.
     *
     * UXGA images may be large and may not upload within 500 ms.
     */
    .frame_size = FRAMESIZE_VGA,

    /*
     * Lower number means higher JPEG quality and usually larger files.
     */
    .jpeg_quality = 12,

    /*
     * Two buffers allow the camera driver to capture more efficiently.
     */
    .fb_count = 2,
    .fb_location = CAMERA_FB_IN_PSRAM,
    .grab_mode = CAMERA_GRAB_LATEST
};


/*
 * Initialize camera.
 *
 * Call this only once.
 */
esp_err_t camera_init(void)
{
    ESP_LOGI(TAG, "Initializing camera");

    esp_err_t err = esp_camera_init(&camera_config);

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Camera initialization failed: %s",
            esp_err_to_name(err)
        );

        return err;
    }

    ESP_LOGI(TAG, "Camera initialized successfully");

    return ESP_OK;
}


/*
 * Send one JPEG frame to the laptop.
 */
static esp_err_t upload_frame(const camera_fb_t *fb)
{
    if (fb == NULL || fb->buf == NULL || fb->len == 0) {
        ESP_LOGE(TAG, "Invalid camera frame");
        return ESP_ERR_INVALID_ARG;
    }

    if (fb->format != PIXFORMAT_JPEG) {
        ESP_LOGE(TAG, "Camera frame is not JPEG");
        return ESP_ERR_INVALID_STATE;
    }

    esp_http_client_config_t http_config = {
        .url = CAMERA_SERVER_URL,
        .method = HTTP_METHOD_POST,

        /*
         * Stop waiting after 5 seconds if the laptop cannot be reached.
         */
        .timeout_ms = 5000,

        /*
         * Disable automatic redirects unless needed.
         */
        .disable_auto_redirect = false,
    };

    esp_http_client_handle_t client =
        esp_http_client_init(&http_config);

    if (client == NULL) {
        ESP_LOGE(TAG, "Failed to initialize HTTP client");
        return ESP_FAIL;
    }

    esp_err_t err;

    err = esp_http_client_set_header(
        client,
        "Content-Type",
        "image/jpeg"
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to set Content-Type header: %s",
            esp_err_to_name(err)
        );

        esp_http_client_cleanup(client);
        return err;
    }

    /*
     * Tell the HTTP client to use the camera framebuffer as
     * the POST request body.
     *
     * Do not return the framebuffer until the request finishes.
     */
    err = esp_http_client_set_post_field(
        client,
        (const char *)fb->buf,
        (int)fb->len
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to set HTTP POST data: %s",
            esp_err_to_name(err)
        );

        esp_http_client_cleanup(client);
        return err;
    }

    int64_t upload_start_us = esp_timer_get_time();

    err = esp_http_client_perform(client);

    int64_t upload_end_us = esp_timer_get_time();
    int64_t upload_time_ms =
        (upload_end_us - upload_start_us) / 1000;

    if (err == ESP_OK) {
        int status_code =
            esp_http_client_get_status_code(client);

        ESP_LOGI(
            TAG,
            "Uploaded %u KB in %" PRId64
            " ms, HTTP status %d",
            (unsigned)(fb->len / 1024),
            upload_time_ms,
            status_code
        );

        if (status_code < 200 || status_code >= 300) {
            ESP_LOGE(
                TAG,
                "Laptop server returned HTTP status %d",
                status_code
            );

            err = ESP_FAIL;
        }
    } else {
        ESP_LOGE(
            TAG,
            "Image upload failed: %s",
            esp_err_to_name(err)
        );
    }

    esp_http_client_cleanup(client);

    return err;
}


/*
 * FreeRTOS task:
 *
 * 1. Capture image.
 * 2. Upload image.
 * 3. Wait until the next 500 ms interval.
 */
static void camera_upload_task(void *argument)
{
    ESP_LOGI(
        TAG,
        "Camera upload task started, server: %s",
        CAMERA_SERVER_URL
    );

    TickType_t last_wake_time = xTaskGetTickCount();

    while (true) {
        int64_t capture_start_us = esp_timer_get_time();

        camera_fb_t *fb = esp_camera_fb_get();

        int64_t capture_end_us = esp_timer_get_time();

        if (fb == NULL) {
            ESP_LOGE(TAG, "Camera capture failed");
        } else {
            int64_t capture_time_ms =
                (capture_end_us - capture_start_us) / 1000;

            ESP_LOGI(
                TAG,
                "Captured %u KB in %" PRId64 " ms",
                (unsigned)(fb->len / 1024),
                capture_time_ms
            );

            /*
             * The HTTP request must finish before returning fb.
             */
            esp_err_t upload_err = upload_frame(fb);

            if (upload_err != ESP_OK) {
                ESP_LOGW(
                    TAG,
                    "Could not upload this frame"
                );
            }

            /*
             * Always return the frame to the camera driver.
             */
            esp_camera_fb_return(fb);
        }

        /*
         * Try to start each cycle every 500 ms.
         *
         * If capture + upload takes longer than 500 ms,
         * the actual rate will be slower.
         */
        xTaskDelayUntil(
            &last_wake_time,
            pdMS_TO_TICKS(UPLOAD_INTERVAL_MS)
        );
    }
}


/*
 * Start the background upload task.
 *
 * Call this after:
 * 1. Wi-Fi is connected.
 * 2. Camera has been initialized.
 */
esp_err_t camera_uploader_start(void)
{
    BaseType_t task_created = xTaskCreate(
        camera_upload_task,
        "camera_upload_task",

        /*
         * HTTP client requires a reasonably large stack.
         */
        8192,

        NULL,
        5,
        NULL
    );

    if (task_created != pdPASS) {
        ESP_LOGE(TAG, "Failed to create camera upload task");
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}