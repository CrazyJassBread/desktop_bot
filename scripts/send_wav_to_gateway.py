"""Replay a 16 kHz mono PCM WAV into the local Bot gateway in real time."""

from __future__ import annotations

import argparse
import socket
import time
import wave
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    with wave.open(str(args.wav), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != 16_000
        ):
            parser.error("WAV must be 16 kHz, mono, signed 16-bit PCM")
        with socket.create_connection((args.host, args.port), timeout=10) as client:
            while chunk := source.readframes(512):
                client.sendall(chunk)
                time.sleep(512 / 16_000)


if __name__ == "__main__":
    main()
