"""Print human-readable live events while the local demo is running."""

from __future__ import annotations

import asyncio
import json
import os

import aiohttp


def describe(event: dict[str, object]) -> str | None:
    event_type = str(event.get("event_type", ""))
    payload = event.get("payload")
    if not isinstance(payload, dict):
        payload = {}

    if event_type == "speech.transcribed":
        return f"语音识别：{payload.get('transcript', '')}"
    if event_type == "llm.session_started":
        mode = "写信" if payload.get("mode") == "letter" else "智能问答"
        return f"{mode}会话已开始"
    if event_type == "llm.recipient_set":
        return f"收件人：{payload.get('recipient', '')}"
    if event_type == "llm.transcript_buffered":
        return "已记录本段语音"
    if event_type == "llm.generation_started":
        return "AI 正在生成内容…"
    if event_type == "llm.answer_completed":
        return f"AI 回答：\n{payload.get('content', '')}"
    if event_type == "llm.letter_completed":
        return (
            f"信件已完成（收件人：{payload.get('recipient', '')}）：\n"
            f"{payload.get('content', '')}"
        )
    if event_type == "gesture.victory":
        return "已识别 Victory 手势，准备拍照"
    if event_type == "photo.captured":
        return "照片已拍摄"
    if event_type == "photo.completed":
        return "照片处理和模拟打印完成"
    if event_type == "letter.printed":
        return "信件模拟打印完成"
    if event_type in {
        "llm.session_failed",
        "llm.session_rejected",
        "runtime.asr_failed",
        "photo.capture_failed",
        "photo.print_failed",
        "letter.render_failed",
        "letter.print_failed",
    }:
        return (
            f"功能失败：{event_type} "
            f"{json.dumps(payload, ensure_ascii=False)}"
        )
    return None


async def main() -> None:
    url = os.environ.get(
        "BOT_EVENTS_URL",
        "ws://127.0.0.1:8090/api/events",
    )
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=10)
    while True:
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.ws_connect(url, heartbeat=20) as socket:
                    print("演示事件监视器已连接。", flush=True)
                    async for message in socket:
                        if message.type == aiohttp.WSMsgType.TEXT:
                            description = describe(message.json())
                            if description:
                                print(f"\n[演示结果] {description}", flush=True)
                        elif message.type in {
                            aiohttp.WSMsgType.CLOSE,
                            aiohttp.WSMsgType.CLOSED,
                            aiohttp.WSMsgType.ERROR,
                        }:
                            break
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
