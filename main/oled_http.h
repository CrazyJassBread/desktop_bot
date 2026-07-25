#ifndef OLED_HTTP_H
#define OLED_HTTP_H

#include "esp_err.h"
#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t oled_http_register_handlers(
    httpd_handle_t server
);

#ifdef __cplusplus
}
#endif

#endif