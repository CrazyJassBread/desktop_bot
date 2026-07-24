#include "distance_sensor.h"

#include "driver/i2c_master.h"
#include "esp_log.h"

#include "vl53l0x.h"

#define VL53_I2C_PORT       I2C_NUM_0
#define VL53_SDA_PIN        GPIO_NUM_1
#define VL53_SCL_PIN        GPIO_NUM_2
#define VL53_XSHUT_PIN      (-1)
#define VL53_GPIO1_PIN      (-1)
#define VL53_I2C_FREQUENCY  400000

static const char *TAG = "DISTANCE_SENSOR";

static vl53l0x_conf_t sensor_config;
static bool sensor_initialized = false;

bool distance_sensor_init(void)
{
    if (sensor_initialized) {
        return true;
    }

    sensor_config = (vl53l0x_conf_t) {
        .i2c_port = VL53_I2C_PORT,
        .sda_pin = VL53_SDA_PIN,
        .scl_pin = VL53_SCL_PIN,
        .i2c_freq = VL53_I2C_FREQUENCY,
        .xshut_pin = VL53_XSHUT_PIN,
        .gpio1_pin = VL53_GPIO1_PIN,
    };

    ESP_LOGI(TAG, "Initializing VL53L0X...");

    vl53l0x_init(sensor_config);

    sensor_initialized = true;

    ESP_LOGI(TAG, "VL53L0X initialization finished");

    return true;
}

bool distance_sensor_read(uint16_t *distance_mm)
{
    if (!sensor_initialized) {
        ESP_LOGE(TAG, "Sensor has not been initialized");
        return false;
    }

    if (distance_mm == NULL) {
        ESP_LOGE(TAG, "distance_mm is NULL");
        return false;
    }

    return vl53l0x_read(sensor_config, distance_mm);
}