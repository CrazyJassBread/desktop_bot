#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include "esp_http_server.h"

/*
 * Starts the shared HTTP server.
 *
 * Later you can register screen handlers on the returned server.
 */
httpd_handle_t web_server_start(void);

/*
 * Stops the server if it is running.
 */
void web_server_stop(httpd_handle_t server);

#endif