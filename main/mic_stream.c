#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "driver/i2s_std.h"
#include "esp_log.h"
#include "esp_err.h"


/*
 * ============================================================
 * Configuration
 * ============================================================
 */

/*
 * Replace these with GPIO pins that are free on your board.
 *
 * INMP441:
 * SCK -> MIC_BCLK_GPIO
 * WS  -> MIC_WS_GPIO
 * SD  -> MIC_DATA_GPIO
 * L/R -> GND
 * VDD -> 3.3 V
 * GND -> GND
 */
#define MIC_BCLK_GPIO       42
#define MIC_WS_GPIO         41
#define MIC_DATA_GPIO       21

#define MIC_SAMPLE_RATE     16000
#define MIC_BUFFER_SAMPLES  512

#define MIC_SERVER_PORT     8080
#define MIC_SERVER_IP       "10.76.11.213"

static const char *TAG = "MIC_STREAM";
static i2s_chan_handle_t mic_rx_channel = NULL;
static int32_t i2s_buffer[MIC_BUFFER_SAMPLES];
static int16_t pcm_buffer[MIC_BUFFER_SAMPLES];

static esp_err_t mic_i2s_init(void)
{
    i2s_chan_config_t channel_config =
        I2S_CHANNEL_DEFAULT_CONFIG(
            I2S_NUM_0,
            I2S_ROLE_MASTER
        );

    esp_err_t err = i2s_new_channel(
        &channel_config,
        NULL,
        &mic_rx_channel
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to create I2S RX channel: %s",
            esp_err_to_name(err)
        );
        return err;
    }

    i2s_std_config_t i2s_config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(
            MIC_SAMPLE_RATE
        ),

        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_32BIT,
            I2S_SLOT_MODE_MONO
        ),

        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = MIC_BCLK_GPIO,
            .ws = MIC_WS_GPIO,
            .dout = I2S_GPIO_UNUSED,
            .din = MIC_DATA_GPIO,

            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };

    /*
     * INMP441 L/R connected to GND means left channel.
     */
    i2s_config.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;

    err = i2s_channel_init_std_mode(
        mic_rx_channel,
        &i2s_config
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to initialize I2S: %s",
            esp_err_to_name(err)
        );

        i2s_del_channel(mic_rx_channel);
        mic_rx_channel = NULL;

        return err;
    }

    err = i2s_channel_enable(mic_rx_channel);

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to enable I2S: %s",
            esp_err_to_name(err)
        );

        i2s_del_channel(mic_rx_channel);
        mic_rx_channel = NULL;

        return err;
    }

    ESP_LOGI(
        TAG,
        "INMP441 initialized: %d Hz, mono, GPIO BCLK=%d, WS=%d, DATA=%d",
        MIC_SAMPLE_RATE,
        MIC_BCLK_GPIO,
        MIC_WS_GPIO,
        MIC_DATA_GPIO
    );

    return ESP_OK;
}


/*
 * ============================================================
 * Read and convert audio
 * ============================================================
 */

static esp_err_t mic_read_pcm(
    int16_t *output,
    size_t maximum_samples,
    size_t *samples_read
)
{
    if (
        output == NULL ||
        samples_read == NULL ||
        mic_rx_channel == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t bytes_read = 0;

    esp_err_t err = i2s_channel_read(
        mic_rx_channel,
        i2s_buffer,
        maximum_samples * sizeof(int32_t),
        &bytes_read,
        portMAX_DELAY
    );

    if (err != ESP_OK) {
        return err;
    }

    size_t sample_count =
        bytes_read / sizeof(int32_t);

    for (size_t i = 0; i < sample_count; i++) {
        /*
         * INMP441 provides approximately 24 useful bits inside
         * a 32-bit I2S slot.
         *
         * This shift controls the volume.
         *
         * Smaller shift:
         * louder, but easier to clip.
         *
         * Larger shift:
         * quieter.
         */
        int32_t sample = i2s_buffer[i] >> 14;

        if (sample > INT16_MAX) {
            sample = INT16_MAX;
        } else if (sample < INT16_MIN) {
            sample = INT16_MIN;
        }

        output[i] = (int16_t) sample;
    }

    *samples_read = sample_count;

    return ESP_OK;
}


/*
 * ============================================================
 * TCP connection
 * ============================================================
 */

static int mic_connect_to_laptop(void)
{
    int socket_fd = socket(
        AF_INET,
        SOCK_STREAM,
        IPPROTO_IP
    );

    if (socket_fd < 0) {
        ESP_LOGE(
            TAG,
            "Could not create socket: errno %d",
            errno
        );
        return -1;
    }

    struct sockaddr_in destination = {
        .sin_family = AF_INET,
        .sin_port = htons(MIC_SERVER_PORT),
    };

    int result = inet_pton(
        AF_INET,
        MIC_SERVER_IP,
        &destination.sin_addr
    );

    if (result != 1) {
        ESP_LOGE(
            TAG,
            "Invalid server IP address: %s",
            MIC_SERVER_IP
        );

        close(socket_fd);
        return -1;
    }

    ESP_LOGI(
        TAG,
        "Connecting to laptop at %s:%d",
        MIC_SERVER_IP,
        MIC_SERVER_PORT
    );

    result = connect(
        socket_fd,
        (struct sockaddr *) &destination,
        sizeof(destination)
    );

    if (result != 0) {
        ESP_LOGE(
            TAG,
            "Connection failed: errno %d",
            errno
        );

        close(socket_fd);
        return -1;
    }

    ESP_LOGI(TAG, "Connected to laptop");

    return socket_fd;
}


/*
 * ============================================================
 * Reliable TCP sending
 * ============================================================
 */

static int mic_send_all(
    int socket_fd,
    const void *data,
    size_t length
)
{
    const uint8_t *current =
        (const uint8_t *) data;

    size_t remaining = length;

    while (remaining > 0) {
        int sent = send(
            socket_fd,
            current,
            remaining,
            0
        );

        if (sent < 0) {
            if (errno == EINTR) {
                continue;
            }

            ESP_LOGE(
                TAG,
                "Socket send failed: errno %d",
                errno
            );

            return -1;
        }

        if (sent == 0) {
            ESP_LOGE(TAG, "Socket connection closed");
            return -1;
        }

        current += sent;
        remaining -= sent;
    }

    return 0;
}


/*
 * ============================================================
 * Streaming task
 * ============================================================
 */

static void mic_stream_task(void *parameter)
{
    ESP_LOGI(TAG, "Microphone streaming task started");

    while (true) {
        int socket_fd = mic_connect_to_laptop();

        if (socket_fd < 0) {
            ESP_LOGW(
                TAG,
                "Retrying connection in 2 seconds"
            );

            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }

        while (true) {
            size_t samples_read = 0;

            esp_err_t err = mic_read_pcm(
                pcm_buffer,
                MIC_BUFFER_SAMPLES,
                &samples_read
            );

            if (err != ESP_OK) {
                ESP_LOGE(
                    TAG,
                    "Microphone read failed: %s",
                    esp_err_to_name(err)
                );
                break;
            }

            size_t byte_count =
                samples_read * sizeof(int16_t);

            if (
                mic_send_all(
                    socket_fd,
                    pcm_buffer,
                    byte_count
                ) < 0
            ) {
                break;
            }
        }

        ESP_LOGW(
            TAG,
            "Laptop disconnected; reconnecting"
        );

        shutdown(socket_fd, SHUT_RDWR);
        close(socket_fd);

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}


/*
 * ============================================================
 * Public function called from main.c
 * ============================================================
 */

esp_err_t mic_stream_start(void)
{
    esp_err_t err = mic_i2s_init();

    if (err != ESP_OK) {
        return err;
    }

    BaseType_t task_created = xTaskCreate(
        mic_stream_task,
        "mic_stream_task",
        4096,
        NULL,
        5,
        NULL
    );

    if (task_created != pdPASS) {
        ESP_LOGE(
            TAG,
            "Failed to create microphone task"
        );

        i2s_channel_disable(mic_rx_channel);
        i2s_del_channel(mic_rx_channel);
        mic_rx_channel = NULL;

        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}