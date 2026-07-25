#ifndef ROBOEYES_DISPLAY_H
#define ROBOEYES_DISPLAY_H

#include <stdint.h>

#ifdef __cplusplus

#include <cstdint>
#include "esp_err.h"

class RoboEyesDisplay {
public:
    static constexpr int WIDTH = 128;
    static constexpr int HEIGHT = 64;

    esp_err_t begin();

    void clearDisplay();

    void drawPixel(
        int16_t x,
        int16_t y,
        uint8_t color
    );

    void fillRect(
        int16_t x,
        int16_t y,
        int16_t width,
        int16_t height,
        uint8_t color
    );

    void fillRoundRect(
        int16_t x,
        int16_t y,
        int16_t width,
        int16_t height,
        int16_t radius,
        uint8_t color
    );

    void fillTriangle(
        int16_t x0,
        int16_t y0,
        int16_t x1,
        int16_t y1,
        int16_t x2,
        int16_t y2,
        uint8_t color
    );

    void display();

private:
    uint8_t framebuffer_[WIDTH * HEIGHT / 8] = {};

    void fillCircleHelper(
        int16_t x0,
        int16_t y0,
        int16_t radius,
        uint8_t corners,
        int16_t delta,
        uint8_t color
    );

    void drawHorizontalLine(
        int16_t x,
        int16_t y,
        int16_t width,
        uint8_t color
    );
};

extern "C" {
#endif

void roboeyes_init(void);

void roboeyes_set_happy(void);
void roboeyes_set_angry(void);
void roboeyes_set_tired(void);
void roboeyes_set_default(void);

void roboeyes_set_position(uint8_t position);

void roboeyes_blink(void);
void roboeyes_laugh(void);
void roboeyes_confused(void);

void roboeyes_init(void);

void roboeyes_set_happy(void);
void roboeyes_set_angry(void);
void roboeyes_set_tired(void);
void roboeyes_set_default(void);

void roboeyes_set_position(uint8_t position);

void roboeyes_blink(void);
void roboeyes_laugh(void);
void roboeyes_confused(void);

esp_err_t roboeyes_show_expression(
    const char *expression
);

esp_err_t roboeyes_set_look_direction(
    const char *direction
);

#ifdef __cplusplus
}
#endif

#endif