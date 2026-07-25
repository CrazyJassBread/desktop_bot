#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define SERVER_IP_MAX_LENGTH 64

typedef struct {
    char server_ip[SERVER_IP_MAX_LENGTH];

    uint16_t camera_port;
    uint16_t microphone_port;

    /*
     * Delay between camera uploads.
     *
     * Example:
     * 500 = one image every 500 ms
     * 1000 = one image every second
     */
    uint32_t camera_interval_ms;
} server_config_t;

esp_err_t server_config_init(void);

esp_err_t server_config_set(
    const server_config_t *config
);

esp_err_t server_config_get(
    server_config_t *output
);