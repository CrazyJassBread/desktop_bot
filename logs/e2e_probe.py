"""Temporary E2E probe helpers for the real-model smoke test.

Subcommands:
  listen   – record every /api/events WebSocket event into a JSONL file
  audio    – stream a WAV file as raw PCM s16le/16k/mono over TCP, then silence
  image    – POST a JPEG to the vision upload endpoint N times
"""

from __future__ import annotations

import asyncio
import json
import sys
import wave
from pathlib import Path


async def listen(output: Path) -> None:
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.ws_connect("ws://127.0.0.1:8090/api/events") as ws:
            with output.open("a", encoding="utf-8") as sink:
                sink.write(json.dumps({"probe": "connected"}) + "\n")
                sink.flush()
                async for message in ws:
                    if message.type != aiohttp.WSMsgType.TEXT:
                        break
                    sink.write(message.data + "\n")
                    sink.flush()


async def stream_audio(wav_path: Path, port: int, tail_silence_s: float) -> None:
    with wave.open(str(wav_path), "rb") as handle:
        assert handle.getframerate() == 16_000, handle.getframerate()
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2
        pcm = handle.readframes(handle.getnframes())

    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    chunk = 512 * 2  # 512 samples of s16le
    frame_seconds = 512 / 16_000
    for offset in range(0, len(pcm), chunk):
        writer.write(pcm[offset : offset + chunk])
        await writer.drain()
        await asyncio.sleep(frame_seconds)
    silence = b"\x00" * chunk
    for _ in range(int(tail_silence_s / frame_seconds)):
        writer.write(silence)
        await writer.drain()
        await asyncio.sleep(frame_seconds)
    writer.close()
    await writer.wait_closed()
    print(f"streamed {len(pcm)} bytes + {tail_silence_s}s silence")


async def post_image(jpeg_path: Path, port: int, repeat: int, interval_s: float) -> None:
    import aiohttp

    data = jpeg_path.read_bytes()
    url = f"http://127.0.0.1:{port}/upload"
    async with aiohttp.ClientSession() as session:
        for index in range(repeat):
            async with session.post(
                url,
                data=data,
                headers={"Content-Type": "image/jpeg"},
            ) as response:
                body = await response.text()
                print(f"[{index}] {response.status} {body[:120]}")
            await asyncio.sleep(interval_s)


def main() -> None:
    command = sys.argv[1]
    if command == "listen":
        asyncio.run(listen(Path(sys.argv[2])))
    elif command == "audio":
        asyncio.run(
            stream_audio(
                Path(sys.argv[2]),
                int(sys.argv[3]),
                float(sys.argv[4]) if len(sys.argv) > 4 else 1.5,
            )
        )
    elif command == "image":
        asyncio.run(
            post_image(
                Path(sys.argv[2]),
                int(sys.argv[3]),
                int(sys.argv[4]) if len(sys.argv) > 4 else 6,
                float(sys.argv[5]) if len(sys.argv) > 5 else 0.35,
            )
        )
    else:
        raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    main()
