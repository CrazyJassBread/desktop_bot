from __future__ import annotations

import csv
import queue
import threading
from pathlib import Path

import sounddevice as sd
import soundfile as sf


# =========================
# 配置
# =========================

SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"

OUTPUT_DIR = Path("records")
METADATA_PATH = OUTPUT_DIR / "metadata.csv"

FILE_PREFIX = "el"
START_INDEX = 1


class WavRecorder:
    def __init__(
        self,
        sample_rate: int = SAMPLE_RATE,
        channels: int = CHANNELS,
        dtype: str = DTYPE,
    ) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self.dtype = dtype

        self.audio_queue: queue.Queue = queue.Queue()
        self.recording = False
        self.frames: list = []
        self.stream: sd.InputStream | None = None

    def _audio_callback(self, indata, frames, time, status) -> None:
        if status:
            print(f"\n[音频警告] {status}")

        if self.recording:
            self.audio_queue.put(indata.copy())

    def _collect_audio(self) -> None:
        while self.recording or not self.audio_queue.empty():
            try:
                frame = self.audio_queue.get(timeout=0.1)
                self.frames.append(frame)
            except queue.Empty:
                continue

    def start(self) -> None:
        self.frames = []
        self.audio_queue = queue.Queue()
        self.recording = True

        self.stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype=self.dtype,
            callback=self._audio_callback,
        )

        self.stream.start()

        self.collect_thread = threading.Thread(
            target=self._collect_audio,
            daemon=True,
        )
        self.collect_thread.start()

    def stop_and_save(self, output_path: Path) -> float:
        self.recording = False

        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None

        self.collect_thread.join()

        if not self.frames:
            raise RuntimeError("没有录制到音频数据。")

        import numpy as np

        audio = np.concatenate(self.frames, axis=0)

        sf.write(
            file=str(output_path),
            data=audio,
            samplerate=self.sample_rate,
            subtype="PCM_16",
        )

        duration = len(audio) / self.sample_rate
        return duration


def initialize_metadata() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not METADATA_PATH.exists():
        with METADATA_PATH.open(
            "w",
            newline="",
            encoding="utf-8-sig",
        ) as csv_file:
            writer = csv.writer(csv_file)
            writer.writerow(
                [
                    "filename",
                    "text",
                    "sample_rate",
                    "channels",
                    "duration_seconds",
                ]
            )


def append_metadata(
    filename: str,
    text: str,
    duration: float,
) -> None:
    with METADATA_PATH.open(
        "a",
        newline="",
        encoding="utf-8-sig",
    ) as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(
            [
                filename,
                text,
                SAMPLE_RATE,
                CHANNELS,
                f"{duration:.3f}",
            ]
        )


def remove_last_metadata_entry(filename: str) -> None:
    if not METADATA_PATH.exists():
        return

    with METADATA_PATH.open(
        "r",
        newline="",
        encoding="utf-8-sig",
    ) as csv_file:
        rows = list(csv.reader(csv_file))

    if len(rows) <= 1:
        return

    header = rows[0]
    data_rows = [
        row
        for row in rows[1:]
        if not row or row[0] != filename
    ]

    with METADATA_PATH.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(header)
        writer.writerows(data_rows)


def find_next_index() -> int:
    existing_indices = []

    for wav_path in OUTPUT_DIR.glob(f"{FILE_PREFIX}_*.wav"):
        stem = wav_path.stem

        try:
            index_text = stem.removeprefix(f"{FILE_PREFIX}_")
            existing_indices.append(int(index_text))
        except ValueError:
            continue

    if not existing_indices:
        return START_INDEX

    return max(existing_indices) + 1


def format_filename(index: int) -> str:
    return f"{FILE_PREFIX}_{index:04d}.wav"


def main() -> None:
    initialize_metadata()

    recorder = WavRecorder()
    current_index = find_next_index()

    print("=" * 60)
    print("快速 WAV 录音工具")
    print("=" * 60)
    print(f"采样率：{SAMPLE_RATE} Hz")
    print(f"通道数：{CHANNELS}")
    print(f"保存目录：{OUTPUT_DIR.resolve()}")
    print()
    print("操作说明：")
    print("  Enter：开始录音")
    print("  再按 Enter：停止并保存")
    print("  r：删除并重新录制上一条")
    print("  q：退出")
    print("=" * 60)

    while True:
        filename = format_filename(current_index)
        output_path = OUTPUT_DIR / filename

        print(f"\n下一条：{filename}")
        command = input("按 Enter 开始，输入 r 重录上一条，输入 q 退出：").strip().lower()

        if command == "q":
            print("录音结束。")
            break

        if command == "r":
            previous_index = current_index - 1

            if previous_index < START_INDEX:
                print("没有可以重新录制的音频。")
                continue

            previous_filename = format_filename(previous_index)
            previous_path = OUTPUT_DIR / previous_filename

            if previous_path.exists():
                previous_path.unlink()
                remove_last_metadata_entry(previous_filename)
                current_index = previous_index
                print(f"已删除：{previous_filename}")
            else:
                print("未找到上一条录音文件。")

            continue

        text = input("请输入本条文本，可直接留空：").strip()

        print("录音中……再次按 Enter 停止。")

        try:
            recorder.start()
            input()
            duration = recorder.stop_and_save(output_path)

        except KeyboardInterrupt:
            print("\n录音被中断。")
            break

        except Exception as error:
            print(f"录音失败：{error}")
            continue

        append_metadata(
            filename=filename,
            text=text,
            duration=duration,
        )

        print(
            f"已保存：{output_path}，"
            f"时长：{duration:.2f} 秒"
        )

        current_index += 1


if __name__ == "__main__":
    main()