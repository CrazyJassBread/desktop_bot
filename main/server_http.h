#pragma once

#include "esp_err.h"
#include "esp_http_server.h"

esp_err_t server_http_register_handlers(
    httpd_handle_t server
);