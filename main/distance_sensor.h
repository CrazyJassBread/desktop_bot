#ifndef DISTANCE_SENSOR_H
#define DISTANCE_SENSOR_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize the VL53L0X.
 *
 * Returns true if initialization succeeded.
 */
bool distance_sensor_init(void);

/**
 * Read one distance measurement.
 *
 * Returns true if a valid measurement was obtained.
 */
bool distance_sensor_read(uint16_t *distance_mm);

#ifdef __cplusplus
}
#endif

#endif