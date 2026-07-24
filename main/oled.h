#ifndef OLED_H
#define OLED_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define OLED_WIDTH             128
#define OLED_HEIGHT            64
#define OLED_PAGE_HEIGHT       8
#define OLED_PAGE_COUNT        (OLED_HEIGHT / OLED_PAGE_HEIGHT)
#define OLED_CHAR_WIDTH        8
#define OLED_CHARS_PER_LINE    (OLED_WIDTH / OLED_CHAR_WIDTH)

typedef enum {
    OLED_EMOJI_IDLE = 0,
    OLED_EMOJI_HAPPY,
    OLED_EMOJI_SAD,
    OLED_EMOJI_THINKING,
    OLED_EMOJI_SPEAKING,
    OLED_EMOJI_SLEEPING
} oled_emoji_t;

/*
 * Initialise the OLED.
 */
esp_err_t oled_init(void);

/*
 * Basic screen operations.
 */
void oled_clear(void);
void oled_fill(bool white);
void oled_set_contrast(uint8_t contrast);
void oled_set_inverted(bool inverted);

/*
 * Text functions.
 *
 * row is 0 to 7 on a 128x64 display.
 * column is 0 to 15.
 */
esp_err_t oled_show_text(const char *text);
esp_err_t oled_write_line(uint8_t row, const char *text, bool inverted);
esp_err_t oled_write_text(
    uint8_t row,
    uint8_t column,
    const char *text,
    bool inverted
);
esp_err_t oled_show_multiline(const char *text);
esp_err_t oled_show_large_text(
    uint8_t row,
    const char *text,
    bool inverted
);

/*
 * Page-formatted image.
 *
 * Data format:
 *
 *     page 0: width bytes
 *     page 1: width bytes
 *     ...
 *
 * Each byte represents one vertical group of 8 pixels.
 *
 * Height must be a multiple of 8.
 */
esp_err_t oled_draw_page_bitmap(
    uint8_t x,
    uint8_t y,
    uint16_t width,
    uint16_t height,
    const uint8_t *bitmap
);

/*
 * Normal row-oriented monochrome bitmap.
 *
 * Each row uses ceil(width / 8) bytes.
 * Bit 7 is the leftmost pixel.
 *
 * This is generally easier for clients to generate.
 */
esp_err_t oled_draw_bitmap(
    uint8_t x,
    uint8_t y,
    uint16_t width,
    uint16_t height,
    const uint8_t *bitmap,
    bool inverted
);

/*
 * Draw one built-in emoji frame.
 */
esp_err_t oled_show_emoji(oled_emoji_t emoji);

/*
 * Start and stop a built-in animated emoji.
 */
esp_err_t oled_start_emoji_animation(oled_emoji_t emoji);
void oled_stop_animation(void);
esp_err_t oled_draw_page_buffer(
    const uint8_t *buffer,
    size_t buffer_size
);

#endif