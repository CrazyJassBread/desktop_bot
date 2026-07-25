import argparse

import requests


DEFAULT_ESP_IP = "10.76.14.192"
DEFAULT_TEXT = "A"


def print_response(response: requests.Response, text: str) -> None:
    print("status", response.status_code)
    print("chars", len(text))
    print(response.text)
    response.raise_for_status()


def post_english_text(
    esp_ip: str,
    text: str,
    *,
    font: str,
    align: str,
    bold: bool,
    underline: bool,
    invert: bool,
    width: int,
    height: int,
    feed_after: int,
    timeout: int,
) -> None:
    response = requests.post(
        f"http://{esp_ip}/printer/text",
        json={
            "text": text,
            "font": font,
            "bold": bold,
            "underline": underline,
            "invert": invert,
            "width": width,
            "height": height,
            "align": align,
            "feedAfter": feed_after,
        },
        timeout=timeout,
    )
    print_response(response, text)


def post_chinese_text(
    esp_ip: str,
    text: str,
    *,
    font: str,
    align: str,
    bold: bool,
    underline: bool,
    invert: bool,
    width: int,
    height: int,
    feed_after: int,
    timeout: int,
) -> None:
    data = text.encode("gb2312")
    response = requests.post(
        f"http://{esp_ip}/printer/text",
        params={
            "font": font,
            "bold": 1 if bold else 0,
            "underline": 1 if underline else 0,
            "invert": 1 if invert else 0,
            "width": width,
            "height": height,
            "align": align,
            "feedAfter": feed_after,
            "chinese": 1,
        },
        data=data,
        headers={"Content-Type": "application/octet-stream"},
        timeout=timeout,
    )
    print("gb2312_bytes", len(data))
    print_response(response, text)


def feed_paper(esp_ip: str, lines: int, timeout: int) -> None:
    response = requests.post(
        f"http://{esp_ip}/printer/feed",
        params={"lines": lines},
        timeout=timeout,
    )
    print("status", response.status_code)
    print(response.text)
    response.raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser(description="ESP32 thermal printer test tool")
    parser.add_argument("--esp-ip", default=DEFAULT_ESP_IP)
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--language", choices=("en", "zh"), default="en")
    parser.add_argument("--font", choices=("A", "B"), default="A")
    parser.add_argument("--align", choices=("left", "center", "right"), default="center")
    parser.add_argument("--width", type=int, default=1)
    parser.add_argument("--height", type=int, default=1)
    parser.add_argument("--bold", action="store_true")
    parser.add_argument("--underline", action="store_true")
    parser.add_argument("--invert", action="store_true")
    parser.add_argument("--feed-after", type=int, default=2)
    parser.add_argument("--feed", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("target", f"http://{args.esp_ip}")
    print("text_chars", len(args.text))

    if args.dry_run:
        return

    if args.text:
        options = {
            "font": args.font,
            "align": args.align,
            "bold": args.bold,
            "underline": args.underline,
            "invert": args.invert,
            "width": args.width,
            "height": args.height,
            "feed_after": args.feed_after,
            "timeout": args.timeout,
        }
        if args.language == "zh":
            post_chinese_text(args.esp_ip, args.text, **options)
        else:
            post_english_text(args.esp_ip, args.text, **options)

    if args.feed > 0:
        feed_paper(args.esp_ip, args.feed, args.timeout)


if __name__ == "__main__":
    main()
