#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "printer_http.h"
#include "printer.h"

#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"

#define MAX_PRINTER_WIDTH_PIXELS   384
#define MAX_PRINTER_HEIGHT_PIXELS  1200

#define MAX_TEXT_SIZE_BYTES        4096
#define MAX_TEXT_JSON_SIZE_BYTES   8192
#define MAX_FEED_LINES             100

#define MAX_BITMAP_SIZE_BYTES \
    (((MAX_PRINTER_WIDTH_PIXELS + 7) / 8) * \
     MAX_PRINTER_HEIGHT_PIXELS)

static const char *TAG = "printer_http";

static esp_err_t send_json_success(
    httpd_req_t *request,
    const char *message
)
{
    if (
        request == NULL ||
        message == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *response = cJSON_CreateObject();

    if (response == NULL) {
        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not create JSON response"
        );
    }

    if (
        cJSON_AddBoolToObject(
            response,
            "success",
            true
        ) == NULL ||
        cJSON_AddStringToObject(
            response,
            "message",
            message
        ) == NULL
    ) {
        cJSON_Delete(response);

        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not create JSON response"
        );
    }

    char *response_text =
        cJSON_PrintUnformatted(response);

    cJSON_Delete(response);

    if (response_text == NULL) {
        return httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Could not serialize JSON response"
        );
    }

    httpd_resp_set_type(
        request,
        "application/json"
    );

    esp_err_t result = httpd_resp_sendstr(
        request,
        response_text
    );

    free(response_text);

    return result;
}

static esp_err_t get_query_integer(
    httpd_req_t *request,
    const char *key,
    int *output
)
{
    if (
        request == NULL ||
        key == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t query_length =
        httpd_req_get_url_query_len(request);

    if (query_length == 0) {
        return ESP_ERR_NOT_FOUND;
    }

    char *query = malloc(query_length + 1);

    if (query == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t result =
        httpd_req_get_url_query_str(
            request,
            query,
            query_length + 1
        );

    if (result != ESP_OK) {
        free(query);
        return result;
    }

    char value_buffer[16];

    result = httpd_query_key_value(
        query,
        key,
        value_buffer,
        sizeof(value_buffer)
    );

    free(query);

    if (result != ESP_OK) {
        return result;
    }

    errno = 0;

    char *end_pointer = NULL;

    long parsed_value = strtol(
        value_buffer,
        &end_pointer,
        10
    );

    if (
        errno != 0 ||
        end_pointer == value_buffer ||
        *end_pointer != '\0' ||
        parsed_value < INT_MIN ||
        parsed_value > INT_MAX
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    *output = (int)parsed_value;

    return ESP_OK;
}

static esp_err_t receive_complete_body(
    httpd_req_t *request,
    uint8_t *buffer,
    size_t expected_size
)
{
    if (
        request == NULL ||
        buffer == NULL ||
        expected_size == 0
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t total_received = 0;

    while (total_received < expected_size) {
        int received = httpd_req_recv(
            request,
            (char *)buffer + total_received,
            expected_size - total_received
        );

        if (received == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }

        if (received <= 0) {
            ESP_LOGE(
                TAG,
                "HTTP receive failed after %u bytes",
                (unsigned int)total_received
            );

            return ESP_FAIL;
        }

        total_received += (size_t)received;
    }

    return ESP_OK;
}

static esp_err_t get_optional_boolean(
    const cJSON *root,
    const char *key,
    bool default_value,
    bool *output
)
{
    if (
        root == NULL ||
        key == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *item =
        cJSON_GetObjectItemCaseSensitive(root, key);

    if (item == NULL) {
        *output = default_value;
        return ESP_OK;
    }

    if (!cJSON_IsBool(item)) {
        return ESP_ERR_INVALID_ARG;
    }

    *output = cJSON_IsTrue(item);

    return ESP_OK;
}

static esp_err_t get_optional_integer(
    const cJSON *root,
    const char *key,
    int default_value,
    int minimum,
    int maximum,
    int *output
)
{
    if (
        root == NULL ||
        key == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *item =
        cJSON_GetObjectItemCaseSensitive(root, key);

    if (item == NULL) {
        *output = default_value;
        return ESP_OK;
    }

    if (!cJSON_IsNumber(item)) {
        return ESP_ERR_INVALID_ARG;
    }

    double number = item->valuedouble;

    if (
        number < (double)minimum ||
        number > (double)maximum ||
        number != (double)item->valueint
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    *output = item->valueint;

    return ESP_OK;
}

static esp_err_t get_optional_query_integer(
    httpd_req_t *request,
    const char *key,
    int default_value,
    int minimum,
    int maximum,
    int *output
)
{
    if (
        request == NULL ||
        key == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    int value = 0;

    esp_err_t result = get_query_integer(
        request,
        key,
        &value
    );

    if (result == ESP_ERR_NOT_FOUND) {
        *output = default_value;
        return ESP_OK;
    }

    if (result != ESP_OK) {
        return result;
    }

    if (
        value < minimum ||
        value > maximum
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    *output = value;

    return ESP_OK;
}

static esp_err_t get_optional_query_string(
    httpd_req_t *request,
    const char *key,
    const char *default_value,
    char *output,
    size_t output_size
)
{
    if (
        request == NULL ||
        key == NULL ||
        default_value == NULL ||
        output == NULL ||
        output_size == 0
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t query_length =
        httpd_req_get_url_query_len(request);

    if (query_length == 0) {
        strlcpy(
            output,
            default_value,
            output_size
        );

        return ESP_OK;
    }

    char *query = malloc(query_length + 1);

    if (query == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t result =
        httpd_req_get_url_query_str(
            request,
            query,
            query_length + 1
        );

    if (result != ESP_OK) {
        free(query);
        return result;
    }

    result = httpd_query_key_value(
        query,
        key,
        output,
        output_size
    );

    free(query);

    if (result == ESP_ERR_NOT_FOUND) {
        strlcpy(
            output,
            default_value,
            output_size
        );

        return ESP_OK;
    }

    return result;
}

static esp_err_t parse_alignment(
    const cJSON *root,
    printer_alignment_t *output
)
{
    if (
        root == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *item =
        cJSON_GetObjectItemCaseSensitive(
            root,
            "align"
        );

    if (item == NULL) {
        *output = PRINTER_ALIGN_LEFT;
        return ESP_OK;
    }

    if (
        !cJSON_IsString(item) ||
        item->valuestring == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (strcmp(item->valuestring, "left") == 0) {
        *output = PRINTER_ALIGN_LEFT;
        return ESP_OK;
    }

    if (strcmp(item->valuestring, "center") == 0) {
        *output = PRINTER_ALIGN_CENTER;
        return ESP_OK;
    }

    if (strcmp(item->valuestring, "right") == 0) {
        *output = PRINTER_ALIGN_RIGHT;
        return ESP_OK;
    }

    return ESP_ERR_INVALID_ARG;
}

static esp_err_t parse_font(
    const cJSON *root,
    printer_font_t *output
)
{
    if (
        root == NULL ||
        output == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    const cJSON *item =
        cJSON_GetObjectItemCaseSensitive(
            root,
            "font"
        );

    if (item == NULL) {
        *output = PRINTER_FONT_A;
        return ESP_OK;
    }

    if (
        !cJSON_IsString(item) ||
        item->valuestring == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        strcmp(item->valuestring, "A") == 0 ||
        strcmp(item->valuestring, "a") == 0
    ) {
        *output = PRINTER_FONT_A;
        return ESP_OK;
    }

    if (
        strcmp(item->valuestring, "B") == 0 ||
        strcmp(item->valuestring, "b") == 0
    ) {
        *output = PRINTER_FONT_B;
        return ESP_OK;
    }

    return ESP_ERR_INVALID_ARG;
}

static esp_err_t print_image_handler(
    httpd_req_t *request
)
{
    int width_pixels = 0;
    int height_pixels = 0;

    if (
        get_query_integer(
            request,
            "width",
            &width_pixels
        ) != ESP_OK
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Missing or invalid width"
        );

        return ESP_FAIL;
    }

    if (
        get_query_integer(
            request,
            "height",
            &height_pixels
        ) != ESP_OK
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Missing or invalid height"
        );

        return ESP_FAIL;
    }

    if (
        width_pixels <= 0 ||
        width_pixels > MAX_PRINTER_WIDTH_PIXELS
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Width must be between 1 and 384"
        );

        return ESP_FAIL;
    }

    if (
        height_pixels <= 0 ||
        height_pixels > MAX_PRINTER_HEIGHT_PIXELS
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Height must be between 1 and 1200"
        );

        return ESP_FAIL;
    }

    size_t width_bytes =
        ((size_t)width_pixels + 7U) / 8U;

    size_t expected_size =
        width_bytes * (size_t)height_pixels;

    if (
        expected_size == 0 ||
        expected_size > MAX_BITMAP_SIZE_BYTES
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Image is too large"
        );

        return ESP_FAIL;
    }

    if ((size_t)request->content_len != expected_size) {
        ESP_LOGE(
            TAG,
            "Wrong body length: received=%d expected=%u",
            request->content_len,
            (unsigned int)expected_size
        );

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Body size does not match width and height"
        );

        return ESP_FAIL;
    }

    uint8_t *bitmap = heap_caps_malloc(
        expected_size,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    );

    if (bitmap == NULL) {
        bitmap = malloc(expected_size);
    }

    if (bitmap == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Not enough memory"
        );

        return ESP_ERR_NO_MEM;
    }

    esp_err_t result = receive_complete_body(
        request,
        bitmap,
        expected_size
    );

    if (result != ESP_OK) {
        free(bitmap);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to receive image"
        );

        return result;
    }

    result = printer_print_bitmap(
        bitmap,
        (uint16_t)width_pixels,
        (uint16_t)height_pixels
    );

    free(bitmap);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to print bitmap: %s",
            esp_err_to_name(result)
        );

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to send image to printer"
        );

        return result;
    }

    return send_json_success(
        request,
        "Image sent to printer"
    );
}

static esp_err_t print_json_text_handler(
    httpd_req_t *request
)
{
    if (
        request->content_len <= 0 ||
        request->content_len > MAX_TEXT_JSON_SIZE_BYTES
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "JSON body must contain between 1 and 8192 bytes"
        );

        return ESP_FAIL;
    }

    size_t body_size =
        (size_t)request->content_len;

    char *body = malloc(body_size + 1);

    if (body == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Not enough memory"
        );

        return ESP_ERR_NO_MEM;
    }

    esp_err_t result = receive_complete_body(
        request,
        (uint8_t *)body,
        body_size
    );

    if (result != ESP_OK) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to receive JSON body"
        );

        return result;
    }

    body[body_size] = '\0';

    cJSON *root = cJSON_ParseWithLength(
        body,
        body_size
    );

    free(body);

    if (root == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Request body is not valid JSON"
        );

        return ESP_FAIL;
    }

    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "JSON body must be an object"
        );

        return ESP_FAIL;
    }

    const cJSON *text_item =
        cJSON_GetObjectItemCaseSensitive(
            root,
            "text"
        );

    if (
        !cJSON_IsString(text_item) ||
        text_item->valuestring == NULL
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "The text field must be a string"
        );

        return ESP_FAIL;
    }

    size_t text_length =
        strlen(text_item->valuestring);

    if (
        text_length == 0 ||
        text_length > MAX_TEXT_SIZE_BYTES
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Text must contain between 1 and 4096 bytes"
        );

        return ESP_FAIL;
    }

    printer_text_options_t options = {
        .font = PRINTER_FONT_A,
        .alignment = PRINTER_ALIGN_LEFT,
        .bold = false,
        .underline = false,
        .invert = false,
        .width_multiplier = 1,
        .height_multiplier = 1,
        .feed_after = 0
    };

    if (
        parse_font(
            root,
            &options.font
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Font must be A or B"
        );

        return ESP_FAIL;
    }

    if (
        parse_alignment(
            root,
            &options.alignment
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Align must be left, center, or right"
        );

        return ESP_FAIL;
    }

    if (
        get_optional_boolean(
            root,
            "bold",
            false,
            &options.bold
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Bold must be true or false"
        );

        return ESP_FAIL;
    }

    if (
        get_optional_boolean(
            root,
            "underline",
            false,
            &options.underline
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Underline must be true or false"
        );

        return ESP_FAIL;
    }

    if (
        get_optional_boolean(
            root,
            "invert",
            false,
            &options.invert
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invert must be true or false"
        );

        return ESP_FAIL;
    }

    int width_multiplier = 1;
    int height_multiplier = 1;
    int feed_after = 0;

    if (
        get_optional_integer(
            root,
            "width",
            1,
            1,
            8,
            &width_multiplier
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Width must be an integer between 1 and 8"
        );

        return ESP_FAIL;
    }

    if (
        get_optional_integer(
            root,
            "height",
            1,
            1,
            8,
            &height_multiplier
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Height must be an integer between 1 and 8"
        );

        return ESP_FAIL;
    }

    if (
        get_optional_integer(
            root,
            "feedAfter",
            0,
            0,
            MAX_FEED_LINES,
            &feed_after
        ) != ESP_OK
    ) {
        cJSON_Delete(root);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "FeedAfter must be an integer between 0 and 100"
        );

        return ESP_FAIL;
    }

    options.width_multiplier =
        (uint8_t)width_multiplier;

    options.height_multiplier =
        (uint8_t)height_multiplier;

    options.feed_after =
        (uint8_t)feed_after;

    ESP_LOGI(
        TAG,
        "Printing text: bytes=%u font=%d align=%d bold=%d "
        "underline=%d invert=%d width=%u height=%u feed=%u",
        (unsigned int)text_length,
        options.font,
        options.alignment,
        options.bold,
        options.underline,
        options.invert,
        options.width_multiplier,
        options.height_multiplier,
        options.feed_after
    );

    result = printer_print_formatted_text(
        text_item->valuestring,
        &options
    );

    cJSON_Delete(root);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to print text: %s",
            esp_err_to_name(result)
        );

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to send text to printer"
        );

        return result;
    }

    return send_json_success(
        request,
        "Formatted text sent to printer"
    );
}

static esp_err_t print_binary_text_handler(
    httpd_req_t *request
)
{
    if (
        request->content_len <= 0 ||
        request->content_len > MAX_TEXT_SIZE_BYTES
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Binary text body must contain between 1 and 4096 bytes"
        );

        return ESP_FAIL;
    }

    size_t body_size =
        (size_t)request->content_len;

    uint8_t *body = malloc(body_size);

    if (body == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Not enough memory"
        );

        return ESP_ERR_NO_MEM;
    }

    esp_err_t result = receive_complete_body(
        request,
        body,
        body_size
    );

    if (result != ESP_OK) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to receive text bytes"
        );

        return result;
    }

    int bold = 0;
    int underline = 0;
    int invert = 0;
    int chinese = 1;
    int width = 1;
    int height = 1;
    int feed_after = 0;

    if (
        get_optional_query_integer(
            request,
            "bold",
            0,
            0,
            1,
            &bold
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "underline",
            0,
            0,
            1,
            &underline
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "invert",
            0,
            0,
            1,
            &invert
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "chinese",
            1,
            0,
            1,
            &chinese
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "width",
            1,
            1,
            8,
            &width
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "height",
            1,
            1,
            8,
            &height
        ) != ESP_OK ||
        get_optional_query_integer(
            request,
            "feedAfter",
            0,
            0,
            MAX_FEED_LINES,
            &feed_after
        ) != ESP_OK
    ) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid formatting query parameter"
        );

        return ESP_FAIL;
    }

    char font[8];

    if (
        get_optional_query_string(
            request,
            "font",
            "A",
            font,
            sizeof(font)
        ) != ESP_OK
    ) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid font"
        );

        return ESP_FAIL;
    }

    char align[16];

    if (
        get_optional_query_string(
            request,
            "align",
            "left",
            align,
            sizeof(align)
        ) != ESP_OK
    ) {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Invalid alignment"
        );

        return ESP_FAIL;
    }

    printer_text_options_t options = {
        .font = PRINTER_FONT_A,
        .alignment = PRINTER_ALIGN_LEFT,
        .bold = bold != 0,
        .underline = underline != 0,
        .invert = invert != 0,
        .chinese_mode = chinese != 0,
        .width_multiplier = (uint8_t)width,
        .height_multiplier = (uint8_t)height,
        .feed_after = (uint8_t)feed_after
    };

    if (
        strcmp(font, "A") == 0 ||
        strcmp(font, "a") == 0
    ) {
        options.font = PRINTER_FONT_A;
    } else if (
        strcmp(font, "B") == 0 ||
        strcmp(font, "b") == 0
    ) {
        options.font = PRINTER_FONT_B;
    } else {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Font must be A or B"
        );

        return ESP_FAIL;
    }

    if (strcmp(align, "left") == 0) {
        options.alignment = PRINTER_ALIGN_LEFT;
    } else if (strcmp(align, "center") == 0) {
        options.alignment = PRINTER_ALIGN_CENTER;
    } else if (strcmp(align, "right") == 0) {
        options.alignment = PRINTER_ALIGN_RIGHT;
    } else {
        free(body);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Align must be left, center, or right"
        );

        return ESP_FAIL;
    }

    result = printer_print_formatted_bytes(
        body,
        body_size,
        &options
    );

    free(body);

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to print binary text: %s",
            esp_err_to_name(result)
        );

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to send text to printer"
        );

        return result;
    }

    return send_json_success(
        request,
        "Encoded text sent to printer"
    );
}

static esp_err_t printer_feed_handler(
    httpd_req_t *request
)
{
    int line_count = 0;

    if (
        get_query_integer(
            request,
            "lines",
            &line_count
        ) != ESP_OK
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Missing or invalid lines parameter"
        );

        return ESP_FAIL;
    }

    if (
        line_count <= 0 ||
        line_count > MAX_FEED_LINES
    ) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Lines must be between 1 and 100"
        );

        return ESP_FAIL;
    }

    esp_err_t result = printer_feed(
        (uint16_t)line_count
    );

    if (result != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to feed paper: %s",
            esp_err_to_name(result)
        );

        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Failed to feed printer paper"
        );

        return result;
    }

    return send_json_success(
        request,
        "Paper feed sent to printer"
    );
}

static esp_err_t printer_test_handler(
    httpd_req_t *request
)
{
    const printer_text_options_t title_options = {
        .font = PRINTER_FONT_A,
        .alignment = PRINTER_ALIGN_CENTER,
        .bold = true,
        .underline = false,
        .invert = false,
        .width_multiplier = 2,
        .height_multiplier = 2,
        .feed_after = 1
    };

    esp_err_t result = printer_print_formatted_text(
        "ESP32 Printer\n",
        &title_options
    );

    if (result != ESP_OK) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Printer test failed"
        );

        return result;
    }

    const printer_text_options_t body_options = {
        .font = PRINTER_FONT_B,
        .alignment = PRINTER_ALIGN_LEFT,
        .bold = false,
        .underline = false,
        .invert = false,
        .width_multiplier = 1,
        .height_multiplier = 1,
        .feed_after = 3
    };

    result = printer_print_formatted_text(
        "Printer HTTP test successful\n",
        &body_options
    );

    if (result != ESP_OK) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Printer test failed"
        );

        return result;
    }

    return send_json_success(
        request,
        "Test sent to printer"
    );
}

static esp_err_t print_text_handler(
    httpd_req_t *request
)
{
    size_t content_type_length =
        httpd_req_get_hdr_value_len(
            request,
            "Content-Type"
        );

    if (content_type_length == 0) {
        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Content-Type is required"
        );

        return ESP_FAIL;
    }

    char *content_type_buffer =
        malloc(content_type_length + 1);

    if (content_type_buffer == NULL) {
        httpd_resp_send_err(
            request,
            HTTPD_500_INTERNAL_SERVER_ERROR,
            "Not enough memory"
        );

        return ESP_ERR_NO_MEM;
    }

    esp_err_t result =
        httpd_req_get_hdr_value_str(
            request,
            "Content-Type",
            content_type_buffer,
            content_type_length + 1
        );

    if (result != ESP_OK) {
        free(content_type_buffer);

        httpd_resp_send_err(
            request,
            HTTPD_400_BAD_REQUEST,
            "Could not read Content-Type"
        );

        return result;
    }

    bool is_json =
        strncmp(
            content_type_buffer,
            "application/json",
            strlen("application/json")
        ) == 0;

    bool is_binary =
        strncmp(
            content_type_buffer,
            "application/octet-stream",
            strlen("application/octet-stream")
        ) == 0;

    free(content_type_buffer);

    if (is_json) {
        return print_json_text_handler(request);
    }

    if (is_binary) {
        return print_binary_text_handler(request);
    }

    httpd_resp_send_err(
        request,
        HTTPD_400_BAD_REQUEST,
        "Use application/json or application/octet-stream"
    );

    return ESP_FAIL;
}

esp_err_t printer_http_register_handlers(
    httpd_handle_t server
)
{
    if (server == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    static const httpd_uri_t print_image_uri = {
        .uri = "/printer/image",
        .method = HTTP_POST,
        .handler = print_image_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t print_text_uri = {
        .uri = "/printer/text",
        .method = HTTP_POST,
        .handler = print_text_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t printer_feed_uri = {
        .uri = "/printer/feed",
        .method = HTTP_POST,
        .handler = printer_feed_handler,
        .user_ctx = NULL
    };

    static const httpd_uri_t printer_test_uri = {
        .uri = "/printer/test",
        .method = HTTP_GET,
        .handler = printer_test_handler,
        .user_ctx = NULL
    };

    const httpd_uri_t *handlers[] = {
        &print_image_uri,
        &print_text_uri,
        &printer_feed_uri,
        &printer_test_uri
    };

    const char *handler_names[] = {
        "/printer/image",
        "/printer/text",
        "/printer/feed",
        "/printer/test"
    };

    const size_t handler_count =
        sizeof(handlers) / sizeof(handlers[0]);

    for (size_t i = 0; i < handler_count; i++) {
        esp_err_t result = httpd_register_uri_handler(
            server,
            handlers[i]
        );

        if (result != ESP_OK) {
            ESP_LOGE(
                TAG,
                "Could not register %s: %s",
                handler_names[i],
                esp_err_to_name(result)
            );

            return result;
        }
    }

    ESP_LOGI(
        TAG,
        "Registered printer HTTP handlers"
    );

    return ESP_OK;
}