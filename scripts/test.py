import re
import socket
import struct
import wave
from datetime import datetime
from pathlib import Path

HOST = "0.0.0.0"
PORT = 8080

MIC_PACKET_MAGIC = 0x4D494331

AUDIO_OUTPUT_DIR = Path("./received_audio")

# 必须与 ESP 端采集参数一致
SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH = 2  # 16-bit PCM，每个采样点 2 字节

# uint32 magic
# uint16 username_length
# uint32 audio_length
HEADER_FORMAT = "!IHI"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)


def receive_exact(
    connection: socket.socket,
    length: int,
) -> bytes:
    chunks: list[bytes] = []
    remaining = length

    while remaining > 0:
        chunk = connection.recv(remaining)

        if not chunk:
            raise ConnectionError("ESP disconnected")

        chunks.append(chunk)
        remaining -= len(chunk)

    return b"".join(chunks)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(
        r"[^a-zA-Z0-9_\-\u4e00-\u9fff]",
        "_",
        name,
    )
    cleaned = cleaned.strip("._")

    return cleaned or "unknown_user"


def create_output_path(username: str) -> Path:
    safe_username = sanitize_filename(username)

    user_directory = AUDIO_OUTPUT_DIR / safe_username
    user_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S_%f"
    )

    return user_directory / f"{timestamp}.wav"


def handle_client(
    connection: socket.socket,
    address,
) -> None:
    print(f"ESP connected from {address}")

    wav_file: wave.Wave_write | None = None
    output_path: Path | None = None
    current_username: str | None = None

    total_audio_bytes = 0
    packet_count = 0

    try:
        while True:
            raw_header = receive_exact(
                connection,
                HEADER_SIZE,
            )

            (
                magic,
                username_length,
                audio_length,
            ) = struct.unpack(
                HEADER_FORMAT,
                raw_header,
            )

            if magic != MIC_PACKET_MAGIC:
                raise ValueError(
                    f"Invalid microphone packet magic: {magic:#x}"
                )

            if username_length > 63:
                raise ValueError("Username is too long")

            if audio_length > 64 * 1024:
                raise ValueError("Audio packet is too large")

            username_bytes = receive_exact(
                connection,
                username_length,
            )

            username = username_bytes.decode(
                "utf-8",
                errors="replace",
            )

            pcm_data = receive_exact(
                connection,
                audio_length,
            )

            # 收到第一个音频包时创建 WAV 文件
            if wav_file is None:
                current_username = username
                output_path = create_output_path(username)

                wav_file = wave.open(
                    str(output_path),
                    "wb",
                )
                wav_file.setnchannels(CHANNELS)
                wav_file.setsampwidth(SAMPLE_WIDTH)
                wav_file.setframerate(SAMPLE_RATE)

                print(
                    f"Started recording user "
                    f"{current_username} to {output_path}"
                )

            # 同一个连接中不允许切换用户名
            if username != current_username:
                raise ValueError(
                    "Username changed during recording: "
                    f"{current_username!r} -> {username!r}"
                )

            if audio_length == 0:
                print("Received empty audio packet")
                continue

            # 将当前 PCM 分片追加到同一个 WAV 文件
            wav_file.writeframesraw(pcm_data)

            packet_count += 1
            total_audio_bytes += len(pcm_data)

            print(
                f"Received packet {packet_count}: "
                f"{len(pcm_data)} bytes; "
                f"total={total_audio_bytes} bytes"
            )

            # 可以同时把当前数据包送入实时处理流程
            # process_audio(username, pcm_data)

    except ConnectionError as error:
        print(f"Recording connection ended: {error}")

    except (
        OSError,
        ValueError,
        wave.Error,
    ) as error:
        print(f"Client error: {error}")

    finally:
        if wav_file is not None:
            wav_file.close()

            duration_seconds = (
                total_audio_bytes
                / SAMPLE_WIDTH
                / CHANNELS
                / SAMPLE_RATE
            )

            print(
                f"Recording saved: {output_path}\n"
                f"Packets: {packet_count}\n"
                f"Audio bytes: {total_audio_bytes}\n"
                f"Duration: {duration_seconds:.2f} seconds"
            )
        else:
            print("Connection ended without receiving audio")

        connection.close()


def main() -> None:
    AUDIO_OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    with socket.socket(
        socket.AF_INET,
        socket.SOCK_STREAM,
    ) as server:
        server.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_REUSEADDR,
            1,
        )

        server.bind((HOST, PORT))
        server.listen()

        print(f"Listening on {HOST}:{PORT}")
        print(
            "Audio output directory: "
            f"{AUDIO_OUTPUT_DIR.resolve()}"
        )

        while True:
            connection, address = server.accept()
            handle_client(connection, address)


if __name__ == "__main__":
    main()