#ifndef PRINTER_HTTP_H
#define PRINTER_HTTP_H

#include "esp_err.h"
#include "esp_http_server.h"

esp_err_t printer_http_register_handlers(
    httpd_handle_t server
);

#endif