# CSV Binary Broadcaster (Python)

---

## Overview

This directory contains a Python utility that allows CSV Binary (CSVBin) data streams to be forwarded from a serial connection to a TCP connection while optionally injecting additional data fields into the stream.

The broadcaster acts as a protocol-aware bridge between an embedded target producing CSVBin data and an external application such as the CSV Binary Plotter.

Unlike a simple serial-to-TCP relay, the broadcaster:

- Understands CSVBin metadata
- Automatically modifies metadata to include additional fields
- Injects user-defined values into each data row
- Preserves CSVBin escaping rules
- Supports bidirectional communication between TCP and serial interfaces

This allows existing firmware to be extended with additional measurements, calculations, or host-side generated values without modifying the embedded implementation.

---

## Table of Contents

- Architecture
- Data Flow
- Core Component
- Metadata Processing
- Row Injection
- Usage
- Command Line Tool
- Example Injection
- Shutdown Behaviour
- Additional Information
- License

---

# Architecture

The broadcaster sits between a serial device and the CSV Binary Plotter.

```text
 ┌─────────────┐
 │  Embedded   │
 │  Device     │
 └──────┬──────┘
        │ UART
        ▼
 ┌────────────────────┐
 │ CSVBin Broadcaster │
 └──────┬──────┬──────┘
        │      │
        │      └───────────────┐
        │                      │
        ▼                      ▼
 Metadata Modification   Field Injection
        │                      │
        └──────────┬───────────┘
                   ▼
            TCP Connection
                   ▼
       CSV Binary Plotter
```

The broadcaster continuously:

1. Receives CSVBin data from the serial port.
2. Processes metadata packets.
3. Injects additional user-defined fields.
4. Forwards modified data to a TCP client.
5. Forwards TCP commands back to the serial device.

---

# Data Flow

A typical session proceeds as follows:

```text
CSV Plotter           Broadcaster          Embedded Device

     |                     |                     |
     |------ Connect ----->|                     |
     |                     |                     |
     |------ 'M' --------->|------ 'M' --------->|
     |                     |                     |
     |<--- Metadata -------|<--- Metadata -------|
     |                     |                     |
     |<----- Data Rows ----|<----- Data Rows ----|
     |                     |                     |
```

The metadata can be modified before being relayed to the TCP client.

Each data row can be extended with additional host-side fields.

---

# Core Component

```python
CsvBinTCPBroadcaster
```

The broadcaster class is responsible for:

- Creating a TCP server
- Opening the serial port
- Monitoring connection state
- Forwarding traffic in both directions
- Processing metadata
- Injecting additional fields
- Maintaining CSVBin protocol compliance

Constructor:

```python
CsvBinTCPBroadcaster(
    serialport,
    baudrate,
    databits,
    parity,
    stopbits,
    ip,
    tcpport,
    on_exit,
    injected_fields
)
```

---

# Metadata Processing

CSVBin metadata packets are identified by the leading `#` character.

Example:

```text
#Nvoltage,current
#Tf32,f32
#Elittle
```

The broadcaster intercepts metadata and modifies the following records:

### Names

Original:

```text
#Nvoltage,current
```

Injected field:

```python
{
    "name": "frequency",
    "type": "u32"
}
```

Forwarded metadata:

```text
#Nvoltage,current,frequency
```

---

### Types

Original:

```text
#Tf32,f32
```

Forwarded metadata:

```text
#Tf32,f32,u32
```

---

### Endian Metadata

Endian metadata is forwarded unchanged:

```text
#Elittle
```

---

# Row Injection

Additional values can be appended to every transmitted row.

Example configuration:

```python
injected_fields=[
    {
        "name": "frequency",
        "type": "u32",
        "getter": get_frequency
    }
]
```

For every completed CSVBin row:

1. Original row is received.
2. Getter callback is executed.
3. Returned value is packed according to its declared type.
4. CSVBin escaping is applied.
5. Data is appended to the row.
6. Modified row is transmitted.

---

Example:

Original row:

```text
voltage,current
230.5,5.2
```

Injected value:

```text
frequency=100
```

Forwarded row:

```text
voltage,current,frequency
230.5,5.2,100
```


# Usage

Minimal example:

```python
from CsvBinBroadcaster import CsvBinTCPBroadcaster
import time

frequency = 0
is_running = True

def get_frequency():
    global frequency
    frequency += 1
    return frequency

def broadcaster_exitted(reason):
    global is_running
    print(
        f"TCP Broadcaster Quit, reason: {reason}"
    )
    is_running = False

broadcaster = CsvBinTCPBroadcaster(
    serialport="COM19",
    baudrate=115200,
    databits=8,
    parity="N",
    stopbits=1,
    ip="127.0.0.1",
    tcpport=50023,
    on_exit=broadcaster_exitted,
    injected_fields=[
        {
            "name": "frequency",
            "type": "u32",
            "getter": get_frequency
        }
    ]
)

while is_running:
    time.sleep(1)
```

# Command Line Tool

A command-line utility is provided.

Example:

```bash
python broadcaster.py COM19 115200
```

With additional options:

```bash
python broadcaster.py COM19 115200 \
    --databits 8 \
    --parity N \
    --stopbits 1 \
    --ip 127.0.0.1 \
    --tcpport 50023
```

# Example Injection

The provided examples inject a host-generated counter:

```python
frequency = 0

def get_frequency():
    global frequency
    frequency += 1
    return frequency
```

Every row transmitted by the broadcaster receives the current counter value.

This demonstrates how host-side information can be merged into a CSVBin stream.

Typical use cases include:

- Packet counters
- Timestamps
- Derived calculations
- Test script outputs
- External sensor values
- System monitoring information


# Shutdown Behaviour

The broadcaster automatically detects:

## Serial Disconnection

If the configured COM port disappears:

```text
COM_DISCONNECTED
```

is reported through the exit callback.


## TCP Disconnection

If the TCP client disconnects:

```text
Connection closed
```

The broadcaster returns to a listening state and waits for a new client connection.


## Application Shutdown

```python
broadcaster.close()
```

performs a controlled shutdown by:

- Closing the serial port
- Closing the TCP socket
- Closing the server socket
- Stopping worker threads
- Firing the configured exit callback


# Additional Information

This broadcaster is intended as a companion utility for the CSV Binary Plotter.

It allows:

- Remote streaming over TCP
- Serial-to-network bridging
- Protocol-aware metadata modification
- Host-side data augmentation

without requiring any changes to the embedded firmware generating the original CSVBin stream.

For protocol details, see the top-level project `README.md`.


# License

This project is licensed under the following [terms](https://www.renesas.com/en/document/oth/disclaimer015?srsltid=AfmBOorceqdmsAs42rxoYYHQwnXI3aHFoXRORrRm2e6OUmqg12zxtsEM).
