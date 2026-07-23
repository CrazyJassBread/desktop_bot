"""Receive Bot PCM and save one WAV for firmware diagnostics."""

import socket
import wave

HOST = "0.0.0.0"
PORT = 8080
SAMPLE_RATE = 16_000
CHANNELS = 1
SAMPLE_WIDTH = 2


def main() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_REUSEADDR,
            1,
        )

        server.bind((HOST, PORT))
        server.listen(1)

        print(f"Listening on port {PORT}...")

        connection, address = server.accept()

        print(f"ESP32 connected from {address}")

        with connection:
            with wave.open("microphone.wav", "wb") as wav_file:
                wav_file.setnchannels(CHANNELS)
                wav_file.setsampwidth(SAMPLE_WIDTH)
                wav_file.setframerate(SAMPLE_RATE)

                try:
                    while True:
                        data = connection.recv(4096)

                        if not data:
                            break

                        wav_file.writeframesraw(data)

                except KeyboardInterrupt:
                    print("Recording stopped")

    print("Saved microphone.wav")


if __name__ == "__main__":
    main()
