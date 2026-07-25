import argparse


DEFAULT_ESP_IP = "10.76.11.223"
DEFAULT_TEXT = "Hello from my laptop!\nSecond line.\n"


def post_text(esp_ip: str, text: str, language: str, timeout: int) -> None:
    import requests

    url = f"http://{esp_ip}/printer/text"
    options = {
        "font": "B" if language == "zh" else "A",
        "bold": 1,
        "underline": 0,
        "invert": 0,
        "width": 1,
        "height": 1,
        "align": "center",
        "feedAfter": 2,
    }
    if language == "zh":
        response = requests.post(
            url,
            params={**options, "chinese": 1},
            data=text.encode("gb2312", errors="replace"),
            headers={"Content-Type": "application/octet-stream"},
            timeout=timeout,
        )
    else:
        response = requests.post(
            url,
            json={
                "text": text,
                "font": options["font"],
                "bold": True,
                "underline": False,
                "invert": False,
                "width": options["width"],
                "height": options["height"],
                "align": options["align"],
                "feedAfter": options["feedAfter"],
            },
            timeout=timeout,
        )
    print("status", response.status_code)
    print("chars", len(text))
    print("language", language)
    print(response.text)
    response.raise_for_status()


def feed_paper(esp_ip: str, lines: int, timeout: int) -> None:
    import requests

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
    parser.add_argument("--feed", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("target", f"http://{args.esp_ip}")
    print("text_chars", len(args.text))
    print("text_utf8_bytes", len(args.text.encode("utf-8")))

    if args.dry_run:
        return

    if args.text:
        post_text(args.esp_ip, args.text, args.language, args.timeout)

    if args.feed > 0:
        feed_paper(args.esp_ip, args.feed, args.timeout)


if __name__ == "__main__":
    main()
