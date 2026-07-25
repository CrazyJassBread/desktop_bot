idf_component_register(
    SRCS
        "station_example_main.c"
        "camera_server.c"
        "camera_client.c"
        "mic_stream.c" 
        "oled.c"
        "printer.c"
        "printer_http.c"
        "web_server.c"
        "roboeyes_display.cpp"
        "oled_http.c"
        "server_config.c"
        "server_http.c"

    INCLUDE_DIRS "."

    PRIV_REQUIRES
        esp_wifi
        esp_event
        esp_netif
        nvs_flash
        esp_psram
        esp_http_server
        esp_timer
        esp_http_client
        esp32-camera
        esp_driver_i2s
        ssd1306
        driver
        esp_driver_uart
        json
        esp-tls
        mbedtls
        roboeyes
        lwip
)