#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "printer.h"

#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"

#define PRINTER_UART       UART_NUM_1
#define PRINTER_TX_GPIO    14
#define PRINTER_BAUD_RATE  9600

#define PRINTER_TX_TIMEOUT_MS 60000

static const char *TAG = "printer";

static bool printer_initialized = false;

static esp_err_t printer_write_command(
    const uint8_t *command,
    size_t length
)
{
    return printer_write(command, length);
}

esp_err_t printer_init(void)
{
    if (printer_initialized) {
        ESP_LOGW(TAG, "Printer UART already initialized");
        return ESP_OK;
    }

    const uart_config_t uart_config = {
        .baud_rate = PRINTER_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT
    };

    esp_err_t result = uart_driver_install(
        PRINTER_UART,
        1024,
        0,
        0,
        NULL,
        0
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "uart_driver_install failed: %s",
            esp_err_to_name(result)
        );

        return result;
    }

    result = uart_param_config(
        PRINTER_UART,
        &uart_config
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "uart_param_config failed: %s",
            esp_err_to_name(result)
        );

        uart_driver_delete(PRINTER_UART);
        return result;
    }

    result = uart_set_pin(
        PRINTER_UART,
        PRINTER_TX_GPIO,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "uart_set_pin failed: %s",
            esp_err_to_name(result)
        );

        uart_driver_delete(PRINTER_UART);
        return result;
    }

    printer_initialized = true;

    ESP_LOGI(
        TAG,
        "Printer UART initialized on GPIO %d",
        PRINTER_TX_GPIO
    );

    /*
     * Reset the printer to its default formatting.
     */
    result = printer_reset();

    if (result != ESP_OK) {
        printer_initialized = false;
        uart_driver_delete(PRINTER_UART);
        return result;
    }

    return ESP_OK;
}

esp_err_t printer_write(
    const uint8_t *data,
    size_t length
)
{
    if (
        data == NULL ||
        length == 0
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!printer_initialized) {
        ESP_LOGE(TAG, "Printer is not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    int written = uart_write_bytes(
        PRINTER_UART,
        data,
        length
    );

    if (written < 0) {
        ESP_LOGE(TAG, "uart_write_bytes failed");
        return ESP_FAIL;
    }

    if ((size_t)written != length) {
        ESP_LOGE(
            TAG,
            "Incomplete UART write: %d of %u bytes",
            written,
            (unsigned int)length
        );

        return ESP_FAIL;
    }

    esp_err_t result = uart_wait_tx_done(
        PRINTER_UART,
        pdMS_TO_TICKS(PRINTER_TX_TIMEOUT_MS)
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "uart_wait_tx_done failed: %s",
            esp_err_to_name(result)
        );

        return result;
    }

    ESP_LOGD(
        TAG,
        "Sent %u bytes",
        (unsigned int)length
    );

    return ESP_OK;
}

esp_err_t printer_reset(void)
{
    /*
     * ESC @
     *
     * Initialize/reset printer formatting.
     */
    const uint8_t command[] = {
        0x1B,
        0x40
    };

    return printer_write_command(
        command,
        sizeof(command)
    );
}

esp_err_t printer_print_text(
    const char *text
)
{
    if (text == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t length = strlen(text);

    if (length == 0) {
        return ESP_OK;
    }

    return printer_write(
        (const uint8_t *)text,
        length
    );
}

esp_err_t printer_print_formatted_bytes(
    const uint8_t *data,
    size_t length,
    const printer_text_options_t *options
)
{
    if (
        data == NULL ||
        length == 0 ||
        options == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        options->font != PRINTER_FONT_A &&
        options->font != PRINTER_FONT_B
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        options->alignment != PRINTER_ALIGN_LEFT &&
        options->alignment != PRINTER_ALIGN_CENTER &&
        options->alignment != PRINTER_ALIGN_RIGHT
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        options->width_multiplier < 1 ||
        options->width_multiplier > 8 ||
        options->height_multiplier < 1 ||
        options->height_multiplier > 8
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t result = printer_reset();

    if (result != ESP_OK) {
        return result;
    }

    /*
     * Enable Chinese character mode.
     *
     * FS &
     *
     * Many ESC/POS-compatible Chinese printers use this command.
     * Whether it is required depends on the printer firmware.
     */
    if (options->chinese_mode) {
        const uint8_t chinese_mode_on[] = {
            0x1C,
            0x26
        };

        result = printer_write(
            chinese_mode_on,
            sizeof(chinese_mode_on)
        );

        if (result != ESP_OK) {
            goto restore_formatting;
        }
    }

    /*
     * ESC M n
     *
     * Font A or Font B.
     *
     * This usually affects Latin characters. Chinese glyph size may be
     * controlled separately by the printer firmware.
     */
    const uint8_t font_command[] = {
        0x1B,
        0x4D,
        (uint8_t)options->font
    };

    result = printer_write(
        font_command,
        sizeof(font_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * ESC a n
     *
     * 0 = left
     * 1 = center
     * 2 = right
     */
    const uint8_t alignment_command[] = {
        0x1B,
        0x61,
        (uint8_t)options->alignment
    };

    result = printer_write(
        alignment_command,
        sizeof(alignment_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * ESC E n
     *
     * Bold.
     */
    const uint8_t bold_command[] = {
        0x1B,
        0x45,
        options->bold ? 0x01 : 0x00
    };

    result = printer_write(
        bold_command,
        sizeof(bold_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * ESC - n
     *
     * Underline.
     */
    const uint8_t underline_command[] = {
        0x1B,
        0x2D,
        options->underline ? 0x01 : 0x00
    };

    result = printer_write(
        underline_command,
        sizeof(underline_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * GS B n
     *
     * Inverted printing.
     */
    const uint8_t invert_command[] = {
        0x1D,
        0x42,
        options->invert ? 0x01 : 0x00
    };

    result = printer_write(
        invert_command,
        sizeof(invert_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * GS ! n
     *
     * Width is stored in bits 4-6.
     * Height is stored in bits 0-2.
     */
    uint8_t size_value =
        (uint8_t)(
            ((options->width_multiplier - 1U) << 4U) |
            (options->height_multiplier - 1U)
        );

    const uint8_t size_command[] = {
        0x1D,
        0x21,
        size_value
    };

    result = printer_write(
        size_command,
        sizeof(size_command)
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    /*
     * Important:
     *
     * Write the exact number of bytes. Do not use strlen() here because
     * this function also accepts encoded or binary text.
     */
    result = printer_write(
        data,
        length
    );

    if (result != ESP_OK) {
        goto restore_formatting;
    }

    if (options->feed_after > 0) {
        result = printer_feed(
            options->feed_after
        );
    }

restore_formatting:

    esp_err_t original_result = result;

    /*
     * Exit Chinese character mode.
     *
     * FS .
     */
    if (options->chinese_mode) {
        const uint8_t chinese_mode_off[] = {
            0x1C,
            0x2E
        };

        esp_err_t chinese_off_result = printer_write(
            chinese_mode_off,
            sizeof(chinese_mode_off)
        );

        if (
            original_result == ESP_OK &&
            chinese_off_result != ESP_OK
        ) {
            original_result = chinese_off_result;
        }
    }

    esp_err_t reset_result = printer_reset();

    if (original_result != ESP_OK) {
        return original_result;
    }

    return reset_result;
}

esp_err_t printer_print_formatted_text(
    const char *text,
    const printer_text_options_t *options
)
{
    if (
        text == NULL ||
        options == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t length = strlen(text);

    if (length == 0) {
        return ESP_OK;
    }

    return printer_print_formatted_bytes(
        (const uint8_t *)text,
        length,
        options
    );
}

esp_err_t printer_feed(
    uint16_t lines
)
{
    if (lines == 0) {
        return ESP_OK;
    }

    /*
     * ESC d n only supports up to 255 lines per command.
     */
    uint16_t remaining = lines;

    while (remaining > 0) {
        uint8_t current_lines =
            remaining > 255
                ? 255
                : (uint8_t)remaining;

        const uint8_t command[] = {
            0x1B,
            0x64,
            current_lines
        };

        esp_err_t result = printer_write_command(
            command,
            sizeof(command)
        );

        if (result != ESP_OK) {
            return result;
        }

        remaining -= current_lines;
    }

    return ESP_OK;
}

esp_err_t printer_print_bitmap(
    const uint8_t *bitmap,
    uint16_t width_pixels,
    uint16_t height_pixels
)
{
    if (
        bitmap == NULL ||
        width_pixels == 0 ||
        height_pixels == 0
    ) {
        ESP_LOGE(TAG, "Invalid bitmap");
        return ESP_ERR_INVALID_ARG;
    }

    uint16_t width_bytes =
        (uint16_t)((width_pixels + 7U) / 8U);

    size_t bitmap_size =
        (size_t)width_bytes * height_pixels;

    /*
     * Reset alignment and scaling before printing the bitmap.
     */
    esp_err_t result = printer_reset();

    if (result != ESP_OK) {
        return result;
    }

    /*
     * GS v 0 m xL xH yL yH
     *
     * m = 0 means normal image size.
     */
    const uint8_t header[] = {
        0x1D,
        0x76,
        0x30,
        0x00,

        (uint8_t)(width_bytes & 0xFFU),
        (uint8_t)((width_bytes >> 8U) & 0xFFU),

        (uint8_t)(height_pixels & 0xFFU),
        (uint8_t)((height_pixels >> 8U) & 0xFFU)
    };

    ESP_LOGI(
        TAG,
        "Printing bitmap: %u x %u, %u bytes",
        width_pixels,
        height_pixels,
        (unsigned int)bitmap_size
    );

    result = printer_write(
        header,
        sizeof(header)
    );

    if (result != ESP_OK) {
        return result;
    }

    result = printer_write(
        bitmap,
        bitmap_size
    );

    if (result != ESP_OK) {
        return result;
    }

    return printer_feed(3);
}