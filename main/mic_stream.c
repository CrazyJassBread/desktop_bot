#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <inttypes.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/ringbuf.h"

#include "driver/i2s_std.h"

#include "esp_log.h"
#include "esp_err.h"
#include "esp_timer.h"

#include "server_config.h"


/*
 * ============================================================
 * Microphone configuration
 * ============================================================
 */

/*
 * INMP441 wiring:
 *
 * SCK -> MIC_BCLK_GPIO
 * WS  -> MIC_WS_GPIO
 * SD  -> MIC_DATA_GPIO
 * L/R -> GND
 * VDD -> 3.3 V
 * GND -> GND
 */
#define MIC_BCLK_GPIO 42
#define MIC_WS_GPIO   41
#define MIC_DATA_GPIO 21

/*
 * Audio format:
 *
 * 16000 Hz
 * mono
 * signed 16-bit PCM
 * little-endian
 */
#define MIC_SAMPLE_RATE 16000

/*
 * 512 samples at 16 kHz:
 *
 * 512 / 16000 = 32 ms of audio
 */
#define MIC_BUFFER_SAMPLES 512

#define MIC_PCM_BLOCK_SIZE_BYTES \
    (MIC_BUFFER_SAMPLES * sizeof(int16_t))

/*
 * 64 KB stores approximately two seconds of audio:
 *
 * 16000 samples/s × 2 bytes = 32000 bytes/s
 */
#define MIC_RING_BUFFER_SIZE_BYTES \
    (64 * 1024)

#define MIC_CONNECT_RETRY_MS       2000
#define MIC_RECONNECT_DELAY_MS     500
#define MIC_SEND_RETRY_DELAY_MS    2

/*
 * Stop retrying the same blocked audio block after this time.
 *
 * The socket is then closed and reconnected.
 */
#define MIC_SEND_STALL_TIMEOUT_MS  3000


static const char *TAG = "MIC_STREAM";

static i2s_chan_handle_t mic_rx_channel = NULL;

static RingbufHandle_t mic_ring_buffer = NULL;

static TaskHandle_t mic_capture_task_handle = NULL;
static TaskHandle_t mic_network_task_handle = NULL;

/*
 * Only the microphone capture task accesses these buffers.
 */
static int32_t i2s_buffer[MIC_BUFFER_SAMPLES];
static int16_t pcm_buffer[MIC_BUFFER_SAMPLES];

static uint32_t clipped_samples = 0;
static uint32_t dropped_audio_blocks = 0;

static int64_t last_audio_log_us = 0;


/*
 * ============================================================
 * I2S microphone initialization
 * ============================================================
 */

static esp_err_t mic_i2s_init(void)
{
    if (mic_rx_channel != NULL) {
        return ESP_OK;
    }

    i2s_chan_config_t channel_config =
        I2S_CHANNEL_DEFAULT_CONFIG(
            I2S_NUM_0,
            I2S_ROLE_MASTER
        );

    channel_config.dma_desc_num = 8;
    channel_config.dma_frame_num =
        MIC_BUFFER_SAMPLES;

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
        .clk_cfg =
            I2S_STD_CLK_DEFAULT_CONFIG(
                MIC_SAMPLE_RATE
            ),

        .slot_cfg =
            I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
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
    i2s_config.slot_cfg.slot_mask =
        I2S_STD_SLOT_LEFT;

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

    err = i2s_channel_enable(
        mic_rx_channel
    );

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
        "INMP441 initialized: "
        "%d Hz, mono, signed 16-bit PCM, "
        "BCLK=%d, WS=%d, DATA=%d",
        MIC_SAMPLE_RATE,
        MIC_BCLK_GPIO,
        MIC_WS_GPIO,
        MIC_DATA_GPIO
    );

    return ESP_OK;
}


/*
 * ============================================================
 * Read and convert microphone audio
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

    *samples_read = 0;

    size_t bytes_read = 0;

    /*
     * Blocking here is intentional.
     *
     * This function runs in a dedicated capture task, so waiting
     * for I2S data does not block TCP networking or other tasks.
     */
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

    if (sample_count > maximum_samples) {
        sample_count = maximum_samples;
    }

    for (size_t i = 0; i < sample_count; i++) {
        /*
         * INMP441 provides approximately 24 useful bits
         * inside a 32-bit I2S slot.
         *
         * Smaller shift:
         * louder, but easier to clip.
         *
         * Larger shift:
         * quieter.
         */
        int32_t sample =
            i2s_buffer[i] >> 14;

        if (sample > INT16_MAX) {
            sample = INT16_MAX;
            clipped_samples++;
        } else if (sample < INT16_MIN) {
            sample = INT16_MIN;
            clipped_samples++;
        }

        output[i] = (int16_t)sample;
    }

    *samples_read = sample_count;

    return ESP_OK;
}


/*
 * ============================================================
 * Audio statistics
 * ============================================================
 */

static void mic_log_audio_statistics(void)
{
    int64_t now_us = esp_timer_get_time();

    if (
        now_us - last_audio_log_us <
        5000000LL
    ) {
        return;
    }

    if (clipped_samples > 0) {
        ESP_LOGW(
            TAG,
            "Clipped samples in last 5 seconds: %" PRIu32,
            clipped_samples
        );
    }

    if (dropped_audio_blocks > 0) {
        ESP_LOGW(
            TAG,
            "Dropped audio blocks in last 5 seconds: %" PRIu32,
            dropped_audio_blocks
        );
    }

    clipped_samples = 0;
    dropped_audio_blocks = 0;
    last_audio_log_us = now_us;
}


/*
 * ============================================================
 * Microphone capture task
 * ============================================================
 */

static void mic_capture_task(
    void *parameter
)
{
    (void)parameter;

    ESP_LOGI(
        TAG,
        "Microphone capture task started"
    );

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

            vTaskDelay(
                pdMS_TO_TICKS(10)
            );

            continue;
        }

        if (samples_read == 0) {
            continue;
        }

        size_t byte_count =
            samples_read * sizeof(int16_t);

        /*
         * Never wait for space in the ring buffer.
         *
         * If the network cannot keep up, drop this block rather
         * than stopping the I2S capture task.
         */
        BaseType_t stored =
            xRingbufferSend(
                mic_ring_buffer,
                pcm_buffer,
                byte_count,
                0
            );

        if (stored != pdTRUE) {
            dropped_audio_blocks++;
        }

        mic_log_audio_statistics();
    }
}


/*
 * ============================================================
 * Ring-buffer helpers
 * ============================================================
 */

static void mic_clear_ring_buffer(void)
{
    if (mic_ring_buffer == NULL) {
        return;
    }

    while (true) {
        size_t item_size = 0;

        void *item = xRingbufferReceive(
            mic_ring_buffer,
            &item_size,
            0
        );

        if (item == NULL) {
            break;
        }

        vRingbufferReturnItem(
            mic_ring_buffer,
            item
        );
    }
}


/*
 * ============================================================
 * Socket helpers
 * ============================================================
 */

static esp_err_t mic_set_socket_nonblocking(
    int socket_fd
)
{
    int flags = fcntl(
        socket_fd,
        F_GETFL,
        0
    );

    if (flags < 0) {
        ESP_LOGE(
            TAG,
            "Could not read socket flags: errno %d",
            errno
        );

        return ESP_FAIL;
    }

    if (
        fcntl(
            socket_fd,
            F_SETFL,
            flags | O_NONBLOCK
        ) < 0
    ) {
        ESP_LOGE(
            TAG,
            "Could not make socket nonblocking: errno %d",
            errno
        );

        return ESP_FAIL;
    }

    return ESP_OK;
}


static int mic_connect_to_laptop(
    const server_config_t *config
)
{
    if (config == NULL) {
        return -1;
    }

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
        .sin_port = htons(
            config->microphone_port
        ),
    };

    int result = inet_pton(
        AF_INET,
        config->server_ip,
        &destination.sin_addr
    );

    if (result != 1) {
        ESP_LOGE(
            TAG,
            "Invalid microphone server IP: %s",
            config->server_ip
        );

        close(socket_fd);
        return -1;
    }

    ESP_LOGI(
        TAG,
        "Connecting microphone to %s:%u",
        config->server_ip,
        (unsigned)config->microphone_port
    );

    /*
     * connect() is blocking, but it runs only in the network task.
     * The separate capture task continues reading the microphone.
     */
    result = connect(
        socket_fd,
        (struct sockaddr *)&destination,
        sizeof(destination)
    );

    if (result != 0) {
        ESP_LOGE(
            TAG,
            "Microphone connection failed: errno %d",
            errno
        );

        close(socket_fd);
        return -1;
    }

    esp_err_t err =
        mic_set_socket_nonblocking(
            socket_fd
        );

    if (err != ESP_OK) {
        close(socket_fd);
        return -1;
    }

    /*
     * Disable Nagle's algorithm to reduce audio latency.
     */
    int no_delay = 1;

    if (
        setsockopt(
            socket_fd,
            IPPROTO_TCP,
            TCP_NODELAY,
            &no_delay,
            sizeof(no_delay)
        ) != 0
    ) {
        ESP_LOGW(
            TAG,
            "Could not enable TCP_NODELAY: errno %d",
            errno
        );
    }

    ESP_LOGI(
        TAG,
        "Microphone connected to %s:%u",
        config->server_ip,
        (unsigned)config->microphone_port
    );

    return socket_fd;
}


/*
 * ============================================================
 * Nonblocking TCP sending
 * ============================================================
 */

static int mic_send_all_nonblocking(
    int socket_fd,
    const void *data,
    size_t length
)
{
    if (
        socket_fd < 0 ||
        data == NULL ||
        length == 0
    ) {
        return -1;
    }

    const uint8_t *current =
        (const uint8_t *)data;

    size_t remaining = length;

    int64_t stall_start_us =
        esp_timer_get_time();

    while (remaining > 0) {
        ssize_t sent = send(
            socket_fd,
            current,
            remaining,
            MSG_DONTWAIT
        );

        if (sent > 0) {
            current += sent;
            remaining -= (size_t)sent;

            /*
             * Progress was made, so reset the stall timer.
             */
            stall_start_us =
                esp_timer_get_time();

            continue;
        }

        if (sent == 0) {
            ESP_LOGW(
                TAG,
                "Microphone socket closed by server"
            );

            return -1;
        }

        if (errno == EINTR) {
            continue;
        }

        if (
            errno == EAGAIN ||
            errno == EWOULDBLOCK
        ) {
            int64_t now_us =
                esp_timer_get_time();

            if (
                now_us - stall_start_us >=
                (
                    (int64_t)
                    MIC_SEND_STALL_TIMEOUT_MS *
                    1000LL
                )
            ) {
                ESP_LOGE(
                    TAG,
                    "Microphone TCP send stalled for %d ms",
                    MIC_SEND_STALL_TIMEOUT_MS
                );

                return -1;
            }

            /*
             * Only the network task waits here.
             *
             * The microphone capture task continues recording
             * into the ring buffer.
             */
            vTaskDelay(
                pdMS_TO_TICKS(
                    MIC_SEND_RETRY_DELAY_MS
                )
            );

            continue;
        }

        ESP_LOGE(
            TAG,
            "Microphone socket send failed: errno %d",
            errno
        );

        return -1;
    }

    return 0;
}


/*
 * ============================================================
 * Microphone network task
 * ============================================================
 */

static void mic_network_task(
    void *parameter
)
{
    (void)parameter;

    ESP_LOGI(
        TAG,
        "Microphone network task started"
    );

    while (true) {
        /*
         * Read the configured IP and port only before opening
         * a new TCP connection.
         */
        server_config_t connection_config;

        esp_err_t config_err =
            server_config_get(
                &connection_config
            );

        if (config_err != ESP_OK) {
            ESP_LOGE(
                TAG,
                "Could not get microphone server config: %s",
                esp_err_to_name(config_err)
            );

            /*
             * Audio captured during this time is not useful
             * because there is no active receiver.
             */
            mic_clear_ring_buffer();

            vTaskDelay(
                pdMS_TO_TICKS(
                    MIC_CONNECT_RETRY_MS
                )
            );

            continue;
        }

        int socket_fd =
            mic_connect_to_laptop(
                &connection_config
            );

        if (socket_fd < 0) {
            /*
             * Do not keep old audio while repeatedly attempting
             * to establish a connection.
             */
            mic_clear_ring_buffer();

            ESP_LOGW(
                TAG,
                "Retrying microphone connection in %d ms",
                MIC_CONNECT_RETRY_MS
            );

            vTaskDelay(
                pdMS_TO_TICKS(
                    MIC_CONNECT_RETRY_MS
                )
            );

            continue;
        }

        /*
         * Remove audio recorded while connecting so the server
         * begins with current audio rather than delayed speech.
         */
        mic_clear_ring_buffer();

        while (true) {
            size_t item_size = 0;

            /*
             * Waiting here blocks only the network task.
             *
             * The separate microphone capture task continues
             * reading I2S.
             */
            uint8_t *audio_block =
                (uint8_t *)xRingbufferReceive(
                    mic_ring_buffer,
                    &item_size,
                    portMAX_DELAY
                );

            if (audio_block == NULL) {
                ESP_LOGE(
                    TAG,
                    "Could not receive microphone ring-buffer item"
                );

                break;
            }

            int send_result =
                mic_send_all_nonblocking(
                    socket_fd,
                    audio_block,
                    item_size
                );

            /*
             * Every received ring-buffer item must be returned,
             * whether sending succeeds or fails.
             */
            vRingbufferReturnItem(
                mic_ring_buffer,
                audio_block
            );

            if (send_result < 0) {
                break;
            }
        }

        ESP_LOGW(
            TAG,
            "Microphone connection ended; reconnecting"
        );

        shutdown(
            socket_fd,
            SHUT_RDWR
        );

        close(socket_fd);

        /*
         * Discard audio captured for the old connection.
         */
        mic_clear_ring_buffer();

        vTaskDelay(
            pdMS_TO_TICKS(
                MIC_RECONNECT_DELAY_MS
            )
        );
    }
}


/*
 * ============================================================
 * Public startup function
 * ============================================================
 */

esp_err_t mic_stream_start(void)
{
    esp_err_t err = mic_i2s_init();

    if (err != ESP_OK) {
        return err;
    }

    mic_ring_buffer = xRingbufferCreate(
        MIC_RING_BUFFER_SIZE_BYTES,
        RINGBUF_TYPE_NOSPLIT
    );

    if (mic_ring_buffer == NULL) {
        ESP_LOGE(
            TAG,
            "Could not create microphone ring buffer"
        );

        i2s_channel_disable(
            mic_rx_channel
        );

        i2s_del_channel(
            mic_rx_channel
        );

        mic_rx_channel = NULL;

        return ESP_ERR_NO_MEM;
    }

    BaseType_t capture_created =
        xTaskCreate(
            mic_capture_task,
            "mic_capture_task",
            4096,
            NULL,

            /*
             * Capture has higher priority so I2S is drained
             * consistently.
             */
            7,
            &mic_capture_task_handle
        );

    if (capture_created != pdPASS) {
        ESP_LOGE(
            TAG,
            "Could not create microphone capture task"
        );

        vRingbufferDelete(
            mic_ring_buffer
        );

        mic_ring_buffer = NULL;

        i2s_channel_disable(
            mic_rx_channel
        );

        i2s_del_channel(
            mic_rx_channel
        );

        mic_rx_channel = NULL;

        return ESP_ERR_NO_MEM;
    }

    BaseType_t network_created =
        xTaskCreate(
            mic_network_task,
            "mic_network_task",
            4096,
            NULL,
            5,
            &mic_network_task_handle
        );

    if (network_created != pdPASS) {
        ESP_LOGE(
            TAG,
            "Could not create microphone network task"
        );

        vTaskDelete(
            mic_capture_task_handle
        );

        mic_capture_task_handle = NULL;

        vRingbufferDelete(
            mic_ring_buffer
        );

        mic_ring_buffer = NULL;

        i2s_channel_disable(
            mic_rx_channel
        );

        i2s_del_channel(
            mic_rx_channel
        );

        mic_rx_channel = NULL;

        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(
        TAG,
        "Microphone streaming started with "
        "%u KB audio ring buffer",
        (unsigned)(
            MIC_RING_BUFFER_SIZE_BYTES /
            1024
        )
    );

    return ESP_OK;
}