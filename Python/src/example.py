from CsvBinBroadcaster import CsvBinTCPBroadcaster
import argparse
import time

frequency = 0;
is_running = True

def get_frequency():
    global frequency
    frequency = frequency + 1
    return frequency

def broadcaster_exitted(reason):
    global is_running
    print(f"TCP Broadcaster Quit, reason: {reason}")
    is_running = False

def main():
    parser = argparse.ArgumentParser(
        description="CSVBin UART → TCP funnel"
    )
    parser.add_argument(
        "serialport",
        help="Serial port (e.g. COM4)"
    )
    parser.add_argument(
        "baudrate",
        type=int,
        help="Baud rate"
    )
    parser.add_argument(
        "--databits",
        type=int,
        default=8,
        choices=[5, 6, 7, 8]
    )
    parser.add_argument(
        "--parity",
        default="N",
        choices=["N", "E", "O", "M", "S"]
    )
    parser.add_argument(
        "--stopbits",
        type=float,
        default=1,
        choices=[1, 1.5, 2]
    )
    parser.add_argument(
        "--ip",
        default='127.0.0.1',
    )
    parser.add_argument(
        "--tcpport",
        type=int,
        default=50023,
    )

    args = parser.parse_args()

    try:
        print(f"Serial Settings: {args.serialport} @ {args.baudrate} {args.databits}-{args.parity}-{args.stopbits}")
        print(f"TCP Settings: {args.ip} @ {args.tcpport}")

        broadcaster = CsvBinTCPBroadcaster(
            serialport=args.serialport,  # Serial Port Example: 'COM19'
            baudrate=args.baudrate,      # Baudrate Example: 115200
            databits=args.databits,      # databits Example: 8
            parity=args.parity,          # parity Example: 'N'
            stopbits=args.stopbits,      # stop bits Example: 1
            ip=args.ip,                  # IP Example (localhost): '127.0.0.1'
            tcpport=args.tcpport,        # Port Example: 50023
            on_exit=broadcaster_exitted, # Callback fired when broadcaster connection terminated
            injected_fields=[
                {
                    "name": "frequency",    # Name of field for meta data
                    "type": "u32",          # Type of field for meta data
                    "getter": get_frequency # Callback (getter) called to retrieve the data to insert in the row
                }
            ]
        )

        while is_running:
            time.sleep(1)

    except KeyboardInterrupt:
        print("Closing...")
        broadcaster.close()
    except:
        print("Failed to start!")

if __name__ == "__main__":
    main()