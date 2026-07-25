#include "server_config.h"

#include <stdbool.h>
#include <string.h>

#include "lwip/inet.h"
#include "lwip/sockets.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define CAMERA_INTERVAL_MIN_MS 100
#define CAMERA_INTERVAL_MAX_MS 60000

static server_config_t current_config = {
    .server_ip = "192.168.1.100",
    .camera_port = 8081,
    .microphone_port = 8080,
    .camera_interval_ms = 500
};

static SemaphoreHandle_t config_mutex = NULL;


esp_err_t server_config_init(void)
{
    if (config_mutex != NULL) {
        return ESP_OK;
    }

    config_mutex = xSemaphoreCreateMutex();

    if (config_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}


static bool is_valid_ipv4(
    const char *ip_address
)
{
    if (ip_address == NULL) {
        return false;
    }

    struct in_addr address;

    return inet_pton(
        AF_INET,
        ip_address,
        &address
    ) == 1;
}


esp_err_t server_config_set(
    const server_config_t *config
)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (config_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (!is_valid_ipv4(config->server_ip)) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        config->camera_port == 0 ||
        config->microphone_port == 0
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        config->camera_interval_ms <
            CAMERA_INTERVAL_MIN_MS ||
        config->camera_interval_ms >
            CAMERA_INTERVAL_MAX_MS
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    xSemaphoreTake(
        config_mutex,
        portMAX_DELAY
    );

    current_config = *config;

    /*
     * Ensure the copied IP string is terminated.
     */
    current_config.server_ip[
        SERVER_IP_MAX_LENGTH - 1
    ] = '\0';

    xSemaphoreGive(config_mutex);

    return ESP_OK;
}


esp_err_t server_config_get(
    server_config_t *output
)
{
    if (output == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (config_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(
        config_mutex,
        portMAX_DELAY
    );

    *output = current_config;

    xSemaphoreGive(config_mutex);

    return ESP_OK;
}