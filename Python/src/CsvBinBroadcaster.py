import socket
import struct
import threading
import serial
import serial.tools.list_ports

ESC = 0x5C
MASK = 0x20

RESERVED = {
    0x2C,  # ,
    0x0A,  # \n
    0x23,  # #
    0x5C   # \
}

TYPE_FORMATS = {
    "u8": "B",
    "i8": "b",

    "u16": "H",
    "i16": "h",

    "u32": "I",
    "i32": "i",

    "u64": "Q",
    "i64": "q",

    "f32": "f",
    "f64": "d",
}


class CsvBinTCPBroadcaster:

    def __init__(
        self,
        serialport,
        baudrate,
        databits,
        parity,
        stopbits,
        ip,
        tcpport,
        on_exit,
        injected_fields
    ):
        # --------------------------------------------------
        # 1. Store metadata modifications
        # --------------------------------------------------
        self.injected_fields = injected_fields
        self.extra_names = [
            field["name"]
            for field in injected_fields
        ]
        self.extra_types = [
            field["type"]
            for field in injected_fields
        ]

        # --------------------------------------------------
        # Internal state
        # --------------------------------------------------
        self.in_meta = False
        self.meta_buffer = ""
        self.current_row = bytearray()
        self.synched = False
        self.on_exit = on_exit
        self.running = True
        self.shutdown_lock = threading.Lock()

        # --------------------------------------------------
        # 2. TCP server
        # --------------------------------------------------
        self.server_socket = socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM
        )
        self.server_socket.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_REUSEADDR,
            1
        )
        self.server_socket.bind(
            (ip, tcpport)
        )
        self.server_socket.listen(1)
        self.client_socket = None
        self.client_connected = threading.Event()
        self.client_lock = threading.Lock()

        # --------------------------------------------------
        # 3 + 6. COM Port
        # --------------------------------------------------
        self.serial = serial.Serial(
            port=serialport,
            baudrate=baudrate,
            bytesize=databits,
            parity=parity,
            stopbits=stopbits,
            timeout=0.1
        )
        myports = [tuple(p) for p in list(serial.tools.list_ports.comports())]
        self.target_port = [port for port in myports if serialport in port ][0]

        # --------------------------------------------------
        # 4. Internal handlers
        # --------------------------------------------------
        self.meta_handlers = {
            "N": self._patch_names,
            "T": self._patch_types
        }

        # --------------------------------------------------
        # 5. TCP -> COM forwarding
        # --------------------------------------------------
        self.tcp_thread = threading.Thread(
            target=self._tcp_receive_loop,
            daemon=True
        )
        self.tcp_thread.start()
        self.serial_thread = threading.Thread(
            target=self._serial_receive_loop,
            daemon=True
        )
        self.serial_thread.start()

    # ======================================================
    # Public
    # ======================================================
    def close(self):
        self._shutdown("APPLICATION_CLOSED")

    # ======================================================
    # Serial RX
    # ======================================================
    def _serial_receive_loop(self):
        try:
            while self.running:
                data = self.serial.read(1024)
                if data:
                    self._handle_com_data(data)
                else:
                    myports = [tuple(p) for p in list(serial.tools.list_ports.comports())]
                    if self.target_port not in myports:
                        raise RuntimeError('COM Disappeared')
        except:
            self._shutdown('COM_DISCONNECTED')

    # ======================================================
    # TCP RX
    # ======================================================
    def _tcp_receive_loop(self):
        while self.running:
            try:
                # TODO: Handle failed TCP connections
                print("Waiting for TCP connection...")
                self.client_socket, addr = (self.server_socket.accept())
                self.client_connected.set()
                print(f"Connected: {addr}")

                # Try receive data
                try:
                    while True:
                        data = self.client_socket.recv(1024)
                        if not data:
                            break
                            # Try write data to the serial port
                        try:
                            self.serial.write(data)
                        except serial.SerialException as ex:
                            self._shutdown('COM_DISCONNECTED')
                # Clean up
                finally:
                    with self.client_lock:
                        self.client_connected.clear()
                        self.client_socket.close()
                        self.client_socket = None
            except:
                pass
        
    # ======================================================
    # Handle COM Data
    # ======================================================
    def _handle_com_data(self, data):
        for byte in data:
            #
            # Metadata processing
            #
            if self.in_meta:
                if byte == 0x0A:
                    line = self.meta_buffer
                    line_type = line[0]
                    handler = self.meta_handlers.get(
                        line_type
                    )
                    if handler:
                        modified = handler(line)
                    else:
                        modified = line
                    payload = (
                        b"#" +
                        modified.encode("ascii") +
                        b"\n"
                    )
                    self._tcp_send(payload)
                    self.meta_buffer = ""
                    self.in_meta = False
                else:
                    self.meta_buffer += chr(byte)
                continue
            #
            # Metadata start
            #
            if byte == 0x23:
                self.in_meta = True
                self.meta_buffer = ""
                continue
            #
            # Initial sync
            #
            if not self.synched:
                if byte == 0x0A:
                    self.synched = True
                continue
            #
            # Data rows
            #
            self.current_row.append(byte)
            if byte == 0x0A:
                self._emit_modified_row(
                    bytes(self.current_row)
                )
                self.current_row.clear()

    def _patch_names(self, line):
        payload = line[1:]
        names = [
            x
            for x in payload.split(",")
            if x
        ]
        names.extend(
            self.extra_names
        )
        return "N" + ",".join(names)

    def _patch_types(self, line):
        payload = line[1:]
        types = [
            x
            for x in payload.split(",")
            if x
        ]
        types.extend(
            self.extra_types
        )
        return "T" + ",".join(types)

    # ======================================================
    # Row injection
    # ======================================================
    def _emit_modified_row(self, row):
        row = row[:-1]
        extension = bytearray()
        for field in self.injected_fields:
            extension.append(0x2C)
            value = field["getter"]()
            raw = self._pack_value(
                field["type"],
                value)
            extension.extend(
                self._escape_field(raw)
            )
        output = (
            row +
            extension +
            b"\n"
        )
        self._tcp_send(output)

    # ======================================================
    # Packing
    # ======================================================
    def _pack_value(self, field_type, value):
        fmt = TYPE_FORMATS.get(
            field_type
        )
        if fmt is None:
            raise ValueError(
                f"Unsupported type: {field_type}"
            )
        return struct.pack(
            "<" + fmt,
            value
        )

    # ======================================================
    # Escaping
    # ======================================================
    def _escape_field(self, data):
        out = bytearray()
        for b in data:
            if b in RESERVED:
                out.append(ESC)
                out.append(b ^ MASK)
            else:
                out.append(b)
        return bytes(out)

    # ======================================================
    # TCP TX
    # ======================================================
    def _tcp_send(self, payload):
        with self.client_lock:
            if self.client_connected.is_set() and self.client_socket is not None:
                try:
                    self.client_socket.sendall(payload)
                except OSError:
                    pass

    # ======================================================
    # Shutdown
    # ======================================================
    def _shutdown(self, reason):
        with self.shutdown_lock:
            if not self.running:
                return

            print(f"TCP Broadcaster Shutting Down: {reason}")
            self.running = False

            try:
                self.serial.close()
            except:
                pass

            try:
                if self.client_socket is not None:
                    self.client_socket.close()
            except:
                pass

            try:
                self.server_socket.close()
            except:
                pass

            self.client_connected.clear()
            self.on_exit(reason)

                    