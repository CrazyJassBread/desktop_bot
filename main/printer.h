#ifndef PRINTER_H
#define PRINTER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef enum {
    PRINTER_ALIGN_LEFT = 0,
    PRINTER_ALIGN_CENTER = 1,
    PRINTER_ALIGN_RIGHT = 2
} printer_alignment_t;

typedef enum {
    PRINTER_FONT_A = 0,
    PRINTER_FONT_B = 1
} printer_font_t;

typedef struct {
    printer_font_t font;
    printer_alignment_t alignment;

    bool bold;
    bool underline;
    bool invert;
    bool chinese_mode;

    uint8_t width_multiplier;
    uint8_t height_multiplier;
    uint8_t feed_after;
} printer_text_options_t;

esp_err_t printer_init(void);

esp_err_t printer_write(
    const uint8_t *data,
    size_t length
);

esp_err_t printer_reset(void);

esp_err_t printer_print_text(
    const char *text
);

esp_err_t printer_print_formatted_text(
    const char *text,
    const printer_text_options_t *options
);

esp_err_t printer_print_formatted_bytes(
    const uint8_t *data,
    size_t length,
    const printer_text_options_t *options
);

esp_err_t printer_feed(
    uint16_t lines
);

esp_err_t printer_print_bitmap(
    const uint8_t *bitmap,
    uint16_t width_pixels,
    uint16_t height_pixels
);

#endif