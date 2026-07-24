from app.config import LLMModeConfig, LLMModesConfig, load_config
from app.llm.mode_detector import LLMModeDetector


def test_mode_detector_recognizes_letter_qa_and_recipient_template():
    detector = LLMModeDetector(load_config().llm.modes)

    letter = detector.detect("小 A，我要写信")
    recipient = detector.detect("小A，我要给小明写信")
    qa = detector.detect("我有一个问题")

    assert letter is not None
    assert letter.event_type == "llm.letter.start"
    assert recipient is not None
    assert recipient.event_type == "llm.letter.start"
    assert recipient.payload_text == "小明"
    assert qa is not None
    assert qa.event_type == "llm.qa.start"
    assert detector.detect("今天不写信") is None


def test_mode_detector_uses_configured_order_for_templates():
    detector = LLMModeDetector(
        LLMModesConfig(
            letter=LLMModeConfig(
                start_phrases=["开始写信"],
                recipient_templates=[
                    "请给{recipient}写信",
                    "给{recipient}写信",
                ],
                finish_phrases=["完成"],
                cancel_phrases=["取消"],
            ),
            qa=LLMModeConfig(
                start_phrases=["开始问答"],
                finish_phrases=["回答"],
                cancel_phrases=["取消问答"],
            ),
        )
    )

    match = detector.detect("请给小红写信")

    assert match is not None
    assert match.keyword == "请给{recipient}写信"
    assert match.payload_text == "小红"
    assert detector.detect("请给写信") is None
