#include <stdlib.h>
#include <string.h>

#include "oled.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "ssd1306.h"
#include "font8x8_basic.h"

static SSD1306_t dev;

static TaskHandle_t animation_task_handle = NULL;
static volatile bool animation_running = false;
static volatile oled_emoji_t current_emoji = OLED_EMOJI_IDLE;


/*
 * Example 32x32 page-formatted emoji frames.
 *
 * Each frame requires:
 *
 *     width * height / 8
 *     32 * 32 / 8 = 128 bytes
 *
 * Replace these placeholders with your generated bitmap data.
 */
#define EMOJI_WIDTH       32
#define EMOJI_HEIGHT      32
#define EMOJI_FRAME_SIZE  \
    (EMOJI_WIDTH * EMOJI_HEIGHT / 8)

static const uint8_t happy_frame_0[EMOJI_FRAME_SIZE] = {
    /*
     * Insert 128 bytes here.
     */
};

static const uint8_t happy_frame_1[EMOJI_FRAME_SIZE] = {
    /*
     * Insert 128 bytes here.
     */
};

static const uint8_t sad_frame_0[EMOJI_FRAME_SIZE] = {
    /*
     * Insert 128 bytes here.
     */
};

static const uint8_t thinking_frame_0[EMOJI_FRAME_SIZE] = {
    /*
     * Insert 128 bytes here.
     */
};

static const uint8_t speaking_frame_0[EMOJI_FRAME_SIZE] = {
    /*
     * Mouth closed.
     */
};

static const uint8_t speaking_frame_1[EMOJI_FRAME_SIZE] = {
    /*
     * Mouth open.
     */
};


/*
 * Select frames for a particular animation.
 */
typedef struct {
    const uint8_t *const *frames;
    size_t frame_count;
    uint32_t frame_duration_ms;
} oled_animation_t;

static const uint8_t *const happy_frames[] = {
    happy_frame_0,
    happy_frame_1
};

static const uint8_t *const sad_frames[] = {
    sad_frame_0
};

static const uint8_t *const thinking_frames[] = {
    thinking_frame_0
};

static const uint8_t *const speaking_frames[] = {
    speaking_frame_0,
    speaking_frame_1
};


static oled_animation_t get_animation(oled_emoji_t emoji)
{
    switch (emoji) {
        case OLED_EMOJI_HAPPY:
            return (oled_animation_t) {
                .frames = happy_frames,
                .frame_count =
                    sizeof(happy_frames) /
                    sizeof(happy_frames[0]),
                .frame_duration_ms = 250
            };

        case OLED_EMOJI_SAD:
            return (oled_animation_t) {
                .frames = sad_frames,
                .frame_count =
                    sizeof(sad_frames) /
                    sizeof(sad_frames[0]),
                .frame_duration_ms = 600
            };

        case OLED_EMOJI_THINKING:
            return (oled_animation_t) {
                .frames = thinking_frames,
                .frame_count =
                    sizeof(thinking_frames) /
                    sizeof(thinking_frames[0]),
                .frame_duration_ms = 500
            };

        case OLED_EMOJI_SPEAKING:
            return (oled_animation_t) {
                .frames = speaking_frames,
                .frame_count =
                    sizeof(speaking_frames) /
                    sizeof(speaking_frames[0]),
                .frame_duration_ms = 180
            };

        case OLED_EMOJI_SLEEPING:
        case OLED_EMOJI_IDLE:
        default:
            return (oled_animation_t) {
                .frames = happy_frames,
                .frame_count = 1,
                .frame_duration_ms = 1000
            };
    }
}


esp_err_t oled_init(void)
{
    memset(&dev, 0, sizeof(dev));

    i2c_master_init(
        &dev,
        CONFIG_SDA_GPIO,
        CONFIG_SCL_GPIO,
        CONFIG_RESET_GPIO
    );

    ssd1306_init(
        &dev,
        OLED_WIDTH,
        OLED_HEIGHT
    );

    ssd1306_clear_screen(&dev, false);
    ssd1306_contrast(&dev, 0xFF);

    return ESP_OK;
}


void oled_clear(void)
{
    ssd1306_clear_screen(&dev, false);
}


void oled_fill(bool white)
{
    ssd1306_clear_screen(&dev, white);
}


void oled_set_contrast(uint8_t contrast)
{
    ssd1306_contrast(&dev, contrast);
}


void oled_set_inverted(bool inverted)
{
    /*
     * This changes the entire display RAM to black or white.
     *
     * It is not the same as the SSD1306 hardware invert command,
     * but it gives a simple public API for your current library.
     */
    ssd1306_clear_screen(&dev, inverted);
}


esp_err_t oled_show_text(const char *text)
{
    if (text == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    oled_stop_animation();
    oled_clear();

    return oled_show_multiline(text);
}


esp_err_t oled_write_line(
    uint8_t row,
    const char *text,
    bool inverted
)
{
    if (
        text == NULL ||
        row >= OLED_PAGE_COUNT
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t length = strnlen(
        text,
        OLED_CHARS_PER_LINE
    );

    /*
     * Clear the old contents of this line first.
     */
    ssd1306_clear_line(
        &dev,
        row,
        false
    );

    ssd1306_display_text(
        &dev,
        row,
        text,
        length,
        inverted
    );

    return ESP_OK;
}


esp_err_t oled_write_text(
    uint8_t row,
    uint8_t column,
    const char *text,
    bool inverted
)
{
    if (
        text == NULL ||
        row >= OLED_PAGE_COUNT ||
        column >= OLED_CHARS_PER_LINE
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t maximum_length =
        OLED_CHARS_PER_LINE - column;

    size_t length = strnlen(
        text,
        maximum_length
    );

    /*
     * ssd1306_display_image accepts a pixel x position.
     * Text characters are converted into 8-byte font images.
     */
    for (size_t i = 0; i < length; i++) {
        uint8_t character =
            (uint8_t)text[i];

        uint8_t glyph[8];

        memcpy(
            glyph,
            font8x8_basic_tr[character],
            sizeof(glyph)
        );

        if (inverted) {
            for (size_t j = 0; j < sizeof(glyph); j++) {
                glyph[j] = ~glyph[j];
            }
        }

        if (dev._flip) {
            ssd1306_flip(
                glyph,
                sizeof(glyph)
            );
        }

        uint8_t x =
            (column + i) * OLED_CHAR_WIDTH;

        ssd1306_display_image(
            &dev,
            row,
            x,
            glyph,
            sizeof(glyph)
        );
    }

    return ESP_OK;
}


esp_err_t oled_show_multiline(const char *text)
{
    if (text == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t row = 0;
    char line[OLED_CHARS_PER_LINE + 1];

    while (
        *text != '\0' &&
        row < OLED_PAGE_COUNT
    ) {
        size_t line_length = 0;

        while (
            text[line_length] != '\0' &&
            text[line_length] != '\n' &&
            line_length < OLED_CHARS_PER_LINE
        ) {
            line[line_length] =
                text[line_length];

            line_length++;
        }

        line[line_length] = '\0';

        oled_write_line(
            row,
            line,
            false
        );

        row++;

        text += line_length;

        /*
         * Skip an explicit newline.
         */
        if (*text == '\n') {
            text++;
        }
    }

    return ESP_OK;
}


esp_err_t oled_show_large_text(
    uint8_t row,
    const char *text,
    bool inverted
)
{
    if (
        text == NULL ||
        row + 2 >= OLED_PAGE_COUNT
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t length = strnlen(text, 5);

    ssd1306_display_text_x3(
        &dev,
        row,
        text,
        length,
        inverted
    );

    return ESP_OK;
}


esp_err_t oled_draw_page_bitmap(
    uint8_t x,
    uint8_t y,
    uint16_t width,
    uint16_t height,
    const uint8_t *bitmap
)
{
    if (
        bitmap == NULL ||
        width == 0 ||
        height == 0 ||
        height % OLED_PAGE_HEIGHT != 0 ||
        x + width > OLED_WIDTH ||
        y + height > OLED_HEIGHT
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t first_page =
        y / OLED_PAGE_HEIGHT;

    uint8_t page_count =
        height / OLED_PAGE_HEIGHT;

    for (uint8_t page = 0; page < page_count; page++) {
        const uint8_t *page_data =
            bitmap + ((size_t)page * width);

        ssd1306_display_image(
            &dev,
            first_page + page,
            x,
            page_data,
            width
        );
    }

    return ESP_OK;
}


esp_err_t oled_draw_bitmap(
    uint8_t x,
    uint8_t y,
    uint16_t width,
    uint16_t height,
    const uint8_t *bitmap,
    bool inverted
)
{
    if (
        bitmap == NULL ||
        width == 0 ||
        height == 0 ||
        x + width > OLED_WIDTH ||
        y + height > OLED_HEIGHT
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * ssd1306_bitmaps accepts a normal row-oriented bitmap.
     */
    ssd1306_bitmaps(
        &dev,
        x,
        y,
        bitmap,
        width,
        height,
        inverted
    );

    return ESP_OK;
}


esp_err_t oled_show_emoji(oled_emoji_t emoji)
{
    oled_animation_t animation =
        get_animation(emoji);

    if (
        animation.frames == NULL ||
        animation.frame_count == 0
    ) {
        return ESP_ERR_NOT_FOUND;
    }

    oled_clear();

    /*
     * Centre a 32x32 emoji.
     */
    const uint8_t x =
        (OLED_WIDTH - EMOJI_WIDTH) / 2;

    const uint8_t y =
        (OLED_HEIGHT - EMOJI_HEIGHT) / 2;

    return oled_draw_page_bitmap(
        x,
        y,
        EMOJI_WIDTH,
        EMOJI_HEIGHT,
        animation.frames[0]
    );
}


static void oled_animation_task(void *parameter)
{
    (void)parameter;

    size_t frame_index = 0;

    while (animation_running) {
        oled_animation_t animation =
            get_animation(current_emoji);

        if (
            animation.frames == NULL ||
            animation.frame_count == 0
        ) {
            break;
        }

        oled_clear();

        oled_draw_page_bitmap(
            (OLED_WIDTH - EMOJI_WIDTH) / 2,
            (OLED_HEIGHT - EMOJI_HEIGHT) / 2,
            EMOJI_WIDTH,
            EMOJI_HEIGHT,
            animation.frames[frame_index]
        );

        frame_index =
            (frame_index + 1) %
            animation.frame_count;

        vTaskDelay(
            pdMS_TO_TICKS(
                animation.frame_duration_ms
            )
        );
    }

    animation_running = false;
    animation_task_handle = NULL;

    vTaskDelete(NULL);
}


esp_err_t oled_start_emoji_animation(
    oled_emoji_t emoji
)
{
    /*
     * Updating current_emoji while the task is running changes
     * the animation without deleting and recreating the task.
     */
    current_emoji = emoji;

    if (animation_running) {
        return ESP_OK;
    }

    animation_running = true;

    BaseType_t result = xTaskCreate(
        oled_animation_task,
        "oled_animation",
        3072,
        NULL,
        4,
        &animation_task_handle
    );

    if (result != pdPASS) {
        animation_running = false;
        animation_task_handle = NULL;
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}


void oled_stop_animation(void)
{
    animation_running = false;

    /*
     * Let the task terminate itself. Do not call vTaskDelete()
     * here while it may currently be writing through I2C.
     */
    while (animation_task_handle != NULL) {
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

esp_err_t oled_draw_page_buffer(
    const uint8_t *buffer,
    size_t buffer_size
)
{
    if (
        buffer == NULL ||
        buffer_size != 1024
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    for (uint8_t page = 0; page < 8; page++) {
        ssd1306_display_image(
            &dev,
            page,
            0,
            buffer + ((size_t)page * 128),
            128
        );
    }

    return ESP_OK;
}