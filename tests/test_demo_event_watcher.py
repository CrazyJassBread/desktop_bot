from scripts.watch_demo_events import describe


def test_demo_watcher_exposes_asr_and_answer_content():
    assert describe(
        {
            "event_type": "speech.transcribed",
            "payload": {"transcript": "你好"},
        }
    ) == "语音识别：你好"
    assert describe(
        {
            "event_type": "llm.answer_completed",
            "payload": {"content": "这是回答"},
        }
    ) == "AI 回答：\n这是回答"


def test_demo_watcher_ignores_internal_noise():
    assert describe({"event_type": "runtime.frame_received"}) is None
