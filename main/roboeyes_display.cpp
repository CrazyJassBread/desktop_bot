#include "roboeyes_display.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <utility>

#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern "C" {
#include "oled.h"
#include "ssd1306.h"
}

/*
 * Arduino compatibility definitions required by RoboEyes.
 */
using byte = uint8_t;

static unsigned long millis()
{
    return static_cast<unsigned long>(
        esp_timer_get_time() / 1000ULL
    );
}

static long random(long maximum)
{
    if (maximum <= 0) {
        return 0;
    }

    return static_cast<long>(
        esp_random() %
        static_cast<uint32_t>(maximum)
    );
}

/*
 * Include this after the Arduino compatibility definitions.
 */
#include "FluxGarage_RoboEyes.h"

static const char *TAG = "roboeyes";

static RoboEyesDisplay display;
static RoboEyes<RoboEyesDisplay> eyes(display);

static TaskHandle_t roboeyes_task_handle = nullptr;
static bool roboeyes_running = false;


esp_err_t RoboEyesDisplay::begin()
{
    clearDisplay();
    display();

    return ESP_OK;
}


void RoboEyesDisplay::clearDisplay()
{
    std::memset(
        framebuffer_,
        0,
        sizeof(framebuffer_)
    );
}


void RoboEyesDisplay::drawPixel(
    int16_t x,
    int16_t y,
    uint8_t color
)
{
    if (
        x < 0 ||
        x >= WIDTH ||
        y < 0 ||
        y >= HEIGHT
    ) {
        return;
    }

    /*
     * SSD1306 page-oriented framebuffer:
     *
     * byte index = x + (y / 8) * width
     * bit        = y % 8
     */
    size_t index =
        static_cast<size_t>(x) +
        static_cast<size_t>(y / 8) * WIDTH;

    uint8_t mask =
        static_cast<uint8_t>(
            1U << (y & 7)
        );

    if (color != 0) {
        framebuffer_[index] |= mask;
    } else {
        framebuffer_[index] &= ~mask;
    }
}


void RoboEyesDisplay::drawHorizontalLine(
    int16_t x,
    int16_t y,
    int16_t width,
    uint8_t color
)
{
    if (width <= 0) {
        return;
    }

    for (int16_t i = 0; i < width; i++) {
        drawPixel(
            x + i,
            y,
            color
        );
    }
}


void RoboEyesDisplay::fillRect(
    int16_t x,
    int16_t y,
    int16_t width,
    int16_t height,
    uint8_t color
)
{
    if (
        width <= 0 ||
        height <= 0
    ) {
        return;
    }

    for (int16_t row = 0; row < height; row++) {
        drawHorizontalLine(
            x,
            y + row,
            width,
            color
        );
    }
}


void RoboEyesDisplay::fillCircleHelper(
    int16_t x0,
    int16_t y0,
    int16_t radius,
    uint8_t corners,
    int16_t delta,
    uint8_t color
)
{
    int16_t f = 1 - radius;
    int16_t ddF_x = 1;
    int16_t ddF_y = -2 * radius;
    int16_t x = 0;
    int16_t y = radius;

    while (x < y) {
        if (f >= 0) {
            y--;
            ddF_y += 2;
            f += ddF_y;
        }

        x++;
        ddF_x += 2;
        f += ddF_x;

        if (corners & 0x01) {
            drawHorizontalLine(
                x0 + x,
                y0 - y,
                delta + 1,
                color
            );

            drawHorizontalLine(
                x0 + y,
                y0 - x,
                delta + 1,
                color
            );
        }

        if (corners & 0x02) {
            drawHorizontalLine(
                x0 - x - delta,
                y0 - y,
                delta + 1,
                color
            );

            drawHorizontalLine(
                x0 - y - delta,
                y0 - x,
                delta + 1,
                color
            );
        }

        if (corners & 0x04) {
            drawHorizontalLine(
                x0 + x,
                y0 + y,
                delta + 1,
                color
            );

            drawHorizontalLine(
                x0 + y,
                y0 + x,
                delta + 1,
                color
            );
        }

        if (corners & 0x08) {
            drawHorizontalLine(
                x0 - x - delta,
                y0 + y,
                delta + 1,
                color
            );

            drawHorizontalLine(
                x0 - y - delta,
                y0 + x,
                delta + 1,
                color
            );
        }
    }
}


void RoboEyesDisplay::fillRoundRect(
    int16_t x,
    int16_t y,
    int16_t width,
    int16_t height,
    int16_t radius,
    uint8_t color
)
{
    if (width <= 0 || height <= 0) {
        return;
    }

    radius = std::max<int16_t>(radius, 0);
    radius = std::min<int16_t>(radius, width / 2);
    radius = std::min<int16_t>(radius, height / 2);

    if (radius == 0) {
        fillRect(x, y, width, height, color);
        return;
    }

    const int32_t radius_squared =
        static_cast<int32_t>(radius) * radius;

    /*
     * Centre of the top-left and bottom-left corner circles.
     *
     * Using radius - 1 keeps the circle within the rectangle's
     * inclusive pixel coordinates.
     */
    const int16_t corner_center_x = radius - 1;
    const int16_t top_center_y = radius - 1;
    const int16_t bottom_center_y = height - radius;

    for (int16_t row = 0; row < height; row++) {
        int16_t inset = 0;

        if (row < radius) {
            const int16_t dy =
                top_center_y - row;

            /*
             * Find the leftmost X coordinate contained in the
             * rounded corner circle.
             */
            for (int16_t candidate = 0;
                 candidate < radius;
                 candidate++) {

                const int16_t dx =
                    corner_center_x - candidate;

                if (
                    static_cast<int32_t>(dx) * dx +
                    static_cast<int32_t>(dy) * dy
                    <= radius_squared
                ) {
                    inset = candidate;
                    break;
                }
            }
        } else if (row >= height - radius) {
            const int16_t dy =
                row - bottom_center_y;

            for (int16_t candidate = 0;
                 candidate < radius;
                 candidate++) {

                const int16_t dx =
                    corner_center_x - candidate;

                if (
                    static_cast<int32_t>(dx) * dx +
                    static_cast<int32_t>(dy) * dy
                    <= radius_squared
                ) {
                    inset = candidate;
                    break;
                }
            }
        }

        const int16_t line_width =
            width - 2 * inset;

        if (line_width > 0) {
            drawHorizontalLine(
                x + inset,
                y + row,
                line_width,
                color
            );
        }
    }
}


static int16_t interpolate_x(
    int16_t y,
    int16_t x0,
    int16_t y0,
    int16_t x1,
    int16_t y1
)
{
    if (y1 == y0) {
        return x0;
    }

    return static_cast<int16_t>(
        x0 +
        static_cast<int32_t>(x1 - x0) *
        (y - y0) /
        (y1 - y0)
    );
}


void RoboEyesDisplay::fillTriangle(
    int16_t x0,
    int16_t y0,
    int16_t x1,
    int16_t y1,
    int16_t x2,
    int16_t y2,
    uint8_t color
)
{
    /*
     * Sort vertices by Y coordinate.
     */
    if (y0 > y1) {
        std::swap(y0, y1);
        std::swap(x0, x1);
    }

    if (y1 > y2) {
        std::swap(y1, y2);
        std::swap(x1, x2);
    }

    if (y0 > y1) {
        std::swap(y0, y1);
        std::swap(x0, x1);
    }

    if (y0 == y2) {
        int16_t minimum_x =
            std::min(
                x0,
                std::min(x1, x2)
            );

        int16_t maximum_x =
            std::max(
                x0,
                std::max(x1, x2)
            );

        drawHorizontalLine(
            minimum_x,
            y0,
            maximum_x - minimum_x + 1,
            color
        );

        return;
    }

    for (int16_t y = y0; y <= y2; y++) {
        int16_t edge_a;

        if (y < y1) {
            edge_a = interpolate_x(
                y,
                x0,
                y0,
                x1,
                y1
            );
        } else {
            edge_a = interpolate_x(
                y,
                x1,
                y1,
                x2,
                y2
            );
        }

        int16_t edge_b = interpolate_x(
            y,
            x0,
            y0,
            x2,
            y2
        );

        if (edge_a > edge_b) {
            std::swap(edge_a, edge_b);
        }

        drawHorizontalLine(
            edge_a,
            y,
            edge_b - edge_a + 1,
            color
        );
    }
}


void RoboEyesDisplay::display()
{
    /*
     * Send one complete page at a time.
     *
     * Your oled.c needs to expose the SSD1306 device through
     * oled_draw_page_buffer().
     */
    oled_draw_page_buffer(
        framebuffer_,
        sizeof(framebuffer_)
    );
}

static void roboeyes_task(void *parameter)
{
    (void)parameter;

    while (roboeyes_running) {
        /*
         * RoboEyes limits its own updates according to the
         * frame rate passed to begin().
         */
        eyes.update();

        /*
         * Run frequently enough that update() can enforce
         * the actual animation frame rate.
         */
        vTaskDelay(pdMS_TO_TICKS(5));
    }

    roboeyes_task_handle = nullptr;
    vTaskDelete(nullptr);
}


void roboeyes_init()
{
    if (roboeyes_running) {
        return;
    }

    ESP_ERROR_CHECK(display.begin());

    /*
     * 128x64 OLED, maximum 30 FPS.
     *
     * Start at 20-30 FPS for I2C.
     */
    eyes.begin(128, 64, 25);

    eyes.setWidth(36, 36);
    eyes.setHeight(36, 36);
    eyes.setBorderradius(12, 12);
    eyes.setSpacebetween(16);

    eyes.setAutoblinker(
        ON,
        3,
        2
    );

    eyes.setIdleMode(
        ON,
        2,
        2
    );

    eyes.open();

    roboeyes_running = true;

    BaseType_t result = xTaskCreate(
        roboeyes_task,
        "roboeyes",
        4096,
        nullptr,
        4,
        &roboeyes_task_handle
    );

    if (result != pdPASS) {
        roboeyes_running = false;
        ESP_LOGE(TAG, "Failed to create RoboEyes task");
    }
}

void roboeyes_set_happy()
{
    eyes.setMood(HAPPY);
}


void roboeyes_set_angry()
{
    eyes.setMood(ANGRY);
}


void roboeyes_set_tired()
{
    eyes.setMood(TIRED);
}


void roboeyes_set_default()
{
    eyes.setMood(DEFAULT);
}


void roboeyes_set_position(uint8_t position)
{
    eyes.setPosition(position);
}


void roboeyes_blink()
{
    eyes.blink();
}


void roboeyes_laugh()
{
    eyes.anim_laugh();
}


void roboeyes_confused()
{
    eyes.anim_confused();
}

esp_err_t roboeyes_show_expression(
    const char *expression
)
{
    if (expression == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }

    if (std::strcmp(expression, "default") == 0) {
        eyes.setMood(DEFAULT);
        eyes.setPosition(DEFAULT);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "happy") == 0) {
        eyes.setMood(HAPPY);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "sad") == 0) {
        /*
         * RoboEyes does not have a native SAD mood.
         * Tired is the closest built-in expression.
         */
        eyes.setMood(TIRED);
        eyes.setPosition(S);

        return ESP_OK;
    }

    if (std::strcmp(expression, "angry") == 0) {
        eyes.setMood(ANGRY);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "tired") == 0) {
        eyes.setMood(TIRED);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "laugh") == 0) {
        eyes.setMood(HAPPY);
        eyes.anim_laugh();

        return ESP_OK;
    }

    if (std::strcmp(expression, "confused") == 0) {
        eyes.setMood(DEFAULT);
        eyes.anim_confused();

        return ESP_OK;
    }

    if (std::strcmp(expression, "thinking") == 0) {
        eyes.setMood(DEFAULT);
        eyes.setPosition(NE);

        return ESP_OK;
    }

    if (std::strcmp(expression, "listening") == 0) {
        eyes.setMood(DEFAULT);
        eyes.setPosition(DEFAULT);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "speaking") == 0) {
        eyes.setMood(HAPPY);
        eyes.setPosition(DEFAULT);
        eyes.open();

        return ESP_OK;
    }

    if (std::strcmp(expression, "blink") == 0) {
        eyes.blink();

        return ESP_OK;
    }

    return ESP_ERR_NOT_FOUND;
}

esp_err_t roboeyes_set_look_direction(
    const char *direction
)
{
    if (direction == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }

    if (std::strcmp(direction, "center") == 0) {
        eyes.setPosition(DEFAULT);
    } else if (std::strcmp(direction, "left") == 0) {
        eyes.setPosition(W);
    } else if (std::strcmp(direction, "right") == 0) {
        eyes.setPosition(E);
    } else if (std::strcmp(direction, "up") == 0) {
        eyes.setPosition(N);
    } else if (std::strcmp(direction, "down") == 0) {
        eyes.setPosition(S);
    } else if (
        std::strcmp(direction, "up-left") == 0
    ) {
        eyes.setPosition(NW);
    } else if (
        std::strcmp(direction, "up-right") == 0
    ) {
        eyes.setPosition(NE);
    } else if (
        std::strcmp(direction, "down-left") == 0
    ) {
        eyes.setPosition(SW);
    } else if (
        std::strcmp(direction, "down-right") == 0
    ) {
        eyes.setPosition(SE);
    } else {
        return ESP_ERR_NOT_FOUND;
    }

    return ESP_OK;
}