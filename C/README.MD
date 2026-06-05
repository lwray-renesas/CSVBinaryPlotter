# CSV Binary Plotter (C Code)

---

## Overview

This directory contains a reference implementation of the CSV Binary (CSVBin) encoder for embedded systems.
The library provides a lightweight, efficient mechanism for encoding structured binary data into a stream-safe CSV format, suitable for transmission over serial interfaces such as UART or USB CDC.
It is designed for resource-constrained environments, where:

- CPU cycles are limited
- Memory must be statically allocated
- Real-time data streaming is required

---

## Table of Contents

- [Architecture](#architecture)
- [Core Component](#core-component)
- [Usage](#usage)
- [Porting](#porting)
- [Additional Information](#additional-information)
- [License](#license)


---
## Architecture
The encoder is built around a circular (ring) buffer.
```
        ┌────────────────────────────┐
        │   BUFFER                   │
        │                            │
        │  data → → → → → → → → data │
        │      ↑           ↑         │
        │    Tail        Head        │
        └────────────────────────────┘
```
Key Concepts

- Head = write position
- Tail = transmit position
- One byte is always reserved to distinguish full vs empty

---
## Core Component
```
csvbin_t
```
Primary encoder structure:

- buffer pointer
- capacity
- head/tail indices
- field state tracking
- metadata pointers

---
## Usage

```C
#include "csvbin.h"

float voltage = 230.5f;
float current = 5.2f;
uint8_t uart_rx_byte;

uint8_t buffer[512];
csvbin_t encoder;

void main(void)
{
  /* 1. Initialisation*/
  Csvbin_init(&encoder, buffer, sizeof(buffer));

  /* 2. Meta data*/
  Csvbin_set_meta(
      &encoder,
      "#Nvoltage,current\n",
      "#Tf32,f32\n",
      "#Elittle\n"
  );

  while(1)
  {
    /* 3. Handle meta data request by transmitting the meta data*/
    if('M' == uart_rx_byte)
    {
      Csvbin_transmit_meta(&encoder);
    }
    
    /* 4. Add data fields*/
    Csvbin_add_field(&encoder, (uint8_t*)&voltage, sizeof(voltage));
    Csvbin_add_field(&encoder, (uint8_t*)&current, sizeof(current));

    /* 5. Finalise row*/
    Csvbin_end_row(&encoder);

    /* 6. Transmit buffer*/
    Csvbin_transmit(&encoder);
  }
}

```

---
## Porting
The csvbin porting file is all that is required:
```C
/**
 * @file csvbin_port.c
 */

/**
 * @brief Blocking write to output of buffer contents.
 * @param data - data to transmit.
 * @param len - length of data to transmit.
 */
void Csvbin_writebuffer_port(uint8_t *data, uint16_t len);

void Csvbin_writebuffer_port(uint8_t *data, uint16_t len)
{
  /* TODO: blocking function to write data to output*/
}
```

It is assumed the transmission is blocking - if it is not, please ensure there are no race conditions.

An example of a port on the Renesas RA0E1 is here:

```C
/**
 * @file csvbin_port.c
 */

#include "hal_data.h"

static bool uart_write_complete = true;
bool transmit_meta = false;

/**
 * @brief Blocking write to output of buffer contents.
 * @param data - data to transmit.
 * @param len - length of data to transmit.
 */
void Csvbin_writebuffer_port(uint8_t *data, uint16_t len);

void Csvbin_writebuffer_port(uint8_t *data, uint16_t len)
{
    uart_write_complete = false;

    fsp_err_t err = R_UARTA_Write(&g_uart0_ctrl, data, len);
    if(FSP_SUCCESS != err)
    {
        __BKPT(0);
    }

    while(!uart_write_complete)
    {
        __NOP();
    }
}

void g_uart0_callback(uart_callback_args_t *p_args)
{
  if (UART_EVENT_TX_COMPLETE == p_args->event)
  {
    uart_write_complete = true;
  }
  else if(UART_EVENT_RX_CHAR == p_args->event)
  {
      if('M' == p_args->data)
      {
          transmit_meta = true; /* Requested to transmit meta data*/
      }
  }
  else
  {
    /* Do nothing*/
  }
}

```

Note how in the example we are using the receive byte callback to detect the meta data request from the host, then using a boolean flag to handle the transmission.

---
## Additional Information
For more information about the protocol, see the top level project README.MD.

---

## License

This project is licensed under the following [terms](https://www.renesas.com/en/document/oth/disclaimer015?srsltid=AfmBOorceqdmsAs42rxoYYHQwnXI3aHFoXRORrRm2e6OUmqg12zxtsEM).

