"""Built-in desktop assistant command catalog."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CommandDefinition:
    command_id: str
    phrases: tuple[str, ...]
    response: str
    action: str | None = None
    emotion: str = "neutral"
    is_global: bool = False


COMMANDS: tuple[CommandDefinition, ...] = (
    CommandDefinition(
        "stop",
        ("停止", "停下来", "别说了", "停止播放"),
        "好的，已停止。",
        "audio.stop",
        is_global=True,
    ),
    CommandDefinition(
        "cancel",
        ("取消", "算了", "不用了"),
        "好的，已取消。",
        "request.cancel",
        is_global=True,
    ),
    CommandDefinition(
        "exit_llm",
        ("退出聊天模式", "退出智能模式", "回到普通模式"),
        "已退出聊天模式。",
        "mode.exit_llm",
        is_global=True,
    ),
    CommandDefinition(
        "enter_llm",
        ("进入聊天模式", "进入智能模式", "开始智能问答", "和大模型聊天"),
        "已进入聊天模式。",
        "mode.enter_llm",
    ),
    CommandDefinition(
        "home",
        ("返回主页", "回到主页", "回主界面", "打开主界面"),
        "正在返回主页。",
        "ui.home",
    ),
    CommandDefinition(
        "print_last_response",
        ("打印回答", "打印刚才的内容", "把刚才的回答打印出来"),
        "正在打印刚才的回答。",
        "printer.print_last_response",
    ),
    CommandDefinition(
        "volume_up",
        ("调高音量", "声音大一点", "增大音量"),
        "已调高音量。",
        "audio.volume_up",
    ),
    CommandDefinition(
        "volume_down",
        ("调低音量", "声音小一点", "降低音量"),
        "已调低音量。",
        "audio.volume_down",
    ),
)

