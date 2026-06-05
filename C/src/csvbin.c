/**
 * @file csvbin.c
 */

#include "csvbin.h"
#include "stddef.h"
#include "string.h"

extern void Csvbin_writebuffer_port(uint8_t *data, uint16_t len);

/**
 * @brief Calculate available free space in the ring buffer
 *
 * Determines how many bytes can still be written before the buffer
 * becomes full. One byte is always reserved to distinguish full/empty.
 *
 * @param w Pointer to csvbin instance
 *
 * @return Number of free bytes available for writing
 */
static inline uint16_t Csvbin_available(const csvbin_t *w)
{
  if (w->head >= w->tail)
  {
    return (uint16_t)(w->capacity - (uint16_t)((w->head - w->tail) - 1U));
  }
  else
  {
    return (uint16_t)((w->tail - w->head) - 1U);
  }
}

/**
 * @brief Encode data directly into the ring buffer
 *
 * @param w Pointer to csvbin instance
 * @param data Pointer to input data
 * @param len Number of bytes to encode
 *
 * @return CSVBIN_SUCCESS on success, error otherwise
 */
static csvbin_err_t Csvbin_encode(csvbin_t *w, uint8_t const *const data, uint16_t len)
{
  for (uint16_t i = 0; i < len; i++)
  {
    uint8_t b = data[i];

    /* Check required space (worst case: 2 bytes) */
    uint16_t needed = ((b == ',') || (b == '\n') || (b == '#') || (b == ESC)) ? 2U : 1U;

    if (Csvbin_available(w) < needed)
    {
      return CSVBIN_BUFFER_FULL;
    }

    if (needed == 2U)
    {
      w->buffer[w->head] = ESC;
      w->head = (uint16_t)((w->head + 1U) % w->capacity);

      w->buffer[w->head] = b ^ MASK;
      w->head = (uint16_t)((w->head + 1U) % w->capacity);
    }
    else
    {
      w->buffer[w->head] = b;
      w->head = (uint16_t)((w->head + 1U) % w->capacity);
    }
  }

  return CSVBIN_SUCCESS;
}

void Csvbin_init(csvbin_t *w, uint8_t *buf, uint16_t cap)
{
  w->buffer = buf;
  w->capacity = cap;
  w->head = 0U;
  w->tail = 0U;
  w->first_field = 1U;

  w->p_m_names = NULL;
  w->p_m_types = NULL;
  w->p_m_endian = NULL;
}

void Csvbin_set_meta(csvbin_t *w, const char *p_names, const char *p_types, const char *p_endian)
{
  w->p_m_names = p_names;
  w->p_m_types = p_types;
  w->p_m_endian = p_endian;
}

csvbin_err_t Csvbin_add_field(csvbin_t *w, uint8_t const *data, uint16_t len)
{
  if (!w->first_field)
  {
    if (Csvbin_available(w) < 1U)
    {
      return CSVBIN_BUFFER_FULL;
    }

    w->buffer[w->head] = ',';
    w->head = (uint16_t)((w->head + 1U) % w->capacity);
  }

  w->first_field = 0U;

  return Csvbin_encode(w, data, len);
}

csvbin_err_t Csvbin_add_fields(csvbin_t *w, uint8_t const *const data, uint16_t const length, uint16_t count)
{
  for (uint16_t i = 0; i < count; i += length)
  {
    if (!w->first_field)
    {
      if (Csvbin_available(w) < 1U)
      {
        return CSVBIN_BUFFER_FULL;
      }

      w->buffer[w->head] = ',';
      w->head = (uint16_t)((w->head + 1U) % w->capacity);
    }

    w->first_field = 0U;

    csvbin_err_t err = Csvbin_encode(w, (uint8_t *)&data[i], length);

    if (err != CSVBIN_SUCCESS)
    {
      return err;
    }
  }

  return CSVBIN_SUCCESS;
}

csvbin_err_t Csvbin_end_row(csvbin_t *w)
{
  if (Csvbin_available(w) < 1U)
  {
    return CSVBIN_BUFFER_FULL;
  }

  w->buffer[w->head] = '\n';
  w->head = (uint16_t)((w->head + 1U) % w->capacity);

  w->first_field = 1U;

  return CSVBIN_SUCCESS;
}

void Csvbin_transmit_meta(csvbin_t *w)
{
  if (NULL != w->p_m_names && NULL != w->p_m_types && NULL != w->p_m_endian)
  {
    Csvbin_writebuffer_port((uint8_t *)w->p_m_names, (uint16_t)strlen(w->p_m_names));
    Csvbin_writebuffer_port((uint8_t *)w->p_m_types, (uint16_t)strlen(w->p_m_types));
    Csvbin_writebuffer_port((uint8_t *)w->p_m_endian, (uint16_t)strlen(w->p_m_endian));
  }
}

void Csvbin_transmit(csvbin_t *w)
{
  if (w->head != w->tail)
  {
    if (w->head > w->tail)
    {
      Csvbin_writebuffer_port(&w->buffer[w->tail], w->head - w->tail);
    }
    else
    {
      /* Wrapped buffer: two blocks */
      /* First chunk: tail -> end */
      Csvbin_writebuffer_port(&w->buffer[w->tail], w->capacity - w->tail);
      /* Second chunk: 0 -> head */
      if (w->head > 0U)
      {
        Csvbin_writebuffer_port(&w->buffer[0], w->head);
      }
    }

    /* Buffer fully consumed */
    w->tail = w->head;
  }
}
