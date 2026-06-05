/**
 * @file csvbin.h
 */

#ifndef CSVBIN_H_
#define CSVBIN_H_

#include "stdint.h"

/** @brief Escape character (backslash ascii)*/
#define ESC (0x5C)

/** @brief Mask applied to escaped characters*/
#define MASK (0x20)

/**@ brief error type for csv bianry encoder API*/
typedef enum
{
  CSVBIN_SUCCESS = 0U, /**< Success*/
  CSVBIN_BUFFER_FULL,  /**< Buffer full*/
} csvbin_err_t;

/**
 * @brief CSV binary encoded ring-buffer
 *
 * Provides a binary-safe CSV buffer builder using a circular buffer.
 *
 * The buffer operates as a ring (circular) buffer:
 *  - head = write index
 *  - tail = read index
 *
 * One byte is always reserved to distinguish full vs empty.
 */
typedef struct
{
  uint8_t *buffer;        /**< Pointer to underlying storage buffer */
  uint16_t capacity;      /**< Total buffer size (bytes) */
  uint16_t head;          /**< Write index (advanced on write) */
  uint16_t tail;          /**< Read index (advanced on read) */
  uint8_t first_field;    /**< Indicates next field is first in row (no comma) */
  const char *p_m_names;  /**< pointer to string containing meta data field names*/
  const char *p_m_types;  /**< pointer to string containing meta data field types*/
  const char *p_m_endian; /**< pointer to string containing meta data endian*/
} csvbin_t;

/**
 * @brief Initialise CSV binary writer
 *
 * Prepares a writer instance to begin constructing CSV rows.
 *
 * @param w Pointer to writer instance
 * @param buf Output buffer to write into
 * @param cap Capacity of the output buffer in bytes
 */
void Csvbin_init(csvbin_t *w, uint8_t *buf, uint16_t cap);

/**
 * @brief sets the meta data for the csv binary parser object
 *
 * types can be any of the following:
 * u8,
 * i8,
 * u16,
 * i16,
 * u32,
 * i32,
 * u64,
 * i64,
 * f32,
 * f64
 *
 * @param w Pointer to writer instance
 * @param p_names pointer to name meta string, format "#Nn0,n1,n2,nx\n"
 * @param p_types pointer to type meta string, format "#Tt0,t1,t2,nx\n"
 * @param p_endian pointer to endian meta string, format "#Elittle\n"
 */
void Csvbin_set_meta(csvbin_t *w, const char *p_names, const char *p_types, const char *p_endian);

/**
 * @brief Add a field to the current CSV row
 *
 * Encodes the provided binary data and appends it as a CSV field.
 * Inserts a comma separator if this is not the first field in the row.
 *
 * @param w Pointer to writer instance
 * @param data Pointer to raw input data
 * @param len Length of input data in bytes
 *
 * @return CSVBIN_SUCCESS on success
 * CSVBIN_BUFFER_FULL if buffer capacity exceeded
 */
csvbin_err_t Csvbin_add_field(csvbin_t *w, uint8_t const *data, uint16_t len);

/**
 * @brief Add multiple fields to the current CSV row
 *
 * Encodes and appends multiple fields in sequence. Commas are automatically
 * inserted between fields as required.
 *
 * @param w Pointer to writer instance
 * @param data pointer to array of bytes for encoding.
 * @param length length of each field (constant)
 * @param count Number of fields to add
 *
 * @return CSVBIN_SUCCESS on success
 * CSVBIN_BUFFER_FULL if buffer capacity exceeded
 */
csvbin_err_t Csvbin_add_fields(csvbin_t *w, uint8_t const *const data, uint16_t const length, uint16_t count);

/**
 * @brief Finalise the current CSV row
 *
 * Appends a newline character to terminate the row
 * and resets field state for the next row.
 *
 * @param w Pointer to writer instance
 *
 * @return CSVBIN_SUCCESS on success
 * CSVBIN_BUFFER_FULL if buffer capacity exceeded
 */
csvbin_err_t Csvbin_end_row(csvbin_t *w);

/**
 * @brief Transmit the meta data
 * @param w Pointer to csvbin instance
 */
void Csvbin_transmit_meta(csvbin_t *w);

/**
 * @brief Transmit all buffered data over UART
 *
 * Sends all currently queued data in the ring buffer using the
 * platform-specific Csvbin_writebuffer_port() function.
 *
 * Handles buffer wrap-around by splitting the transmission into
 * up to two contiguous blocks.
 *
 * After transmission, the buffer is emptied (tail moves to head).
 *
 * @param w Pointer to csvbin instance
 */
void Csvbin_transmit(csvbin_t *w);

#endif /* CSVBIN_H_ */
