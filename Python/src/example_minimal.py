from CsvBinBroadcaster import CsvBinTCPBroadcaster
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

    try:
        broadcaster = CsvBinTCPBroadcaster(
            serialport='COM19',  # Serial Port Example: 'COM19'
            baudrate=115200,      # Baudrate Example: 115200
            databits=8,      # databits Example: 8
            parity='N',          # parity Example: 'N'
            stopbits=1,      # stop bits Example: 1
            ip='127.0.0.1',                  # IP Example (localhost): '127.0.0.1'
            tcpport=50023,        # Port Example: 50023
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