from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from app.factories import setup_llm_logging
from app.llm.client import LLMError, OpenAICompatibleClient


@pytest.fixture
def llm_server():
    requests: list[dict[str, object]] = []
    response_status = [200]
    response_body = [
        {
            "choices": [
                {"message": {"content": "clean result"}}
            ]
        }
    ]

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            requests.append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "json": json.loads(self.rfile.read(length)),
                }
            )
            self.send_response(response_status[0])
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            body = response_body[0]
            self.wfile.write(
                body
                if isinstance(body, bytes)
                else json.dumps(body).encode()
            )

        def log_message(self, *_args) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield {
        "url": f"http://127.0.0.1:{server.server_port}",
        "requests": requests,
        "status": response_status,
        "body": response_body,
    }
    server.shutdown()
    thread.join()
    server.server_close()


def make_client(
    base_url: str,
    *,
    api_key: str = "sentinel-secret",
) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        base_url=base_url,
        api_key=api_key,
        model="test-model",
        timeout_seconds=1,
        temperature=0.4,
        max_output_tokens=2_000,
    )


@pytest.mark.asyncio
async def test_client_posts_openai_compatible_request(llm_server):
    client = make_client(llm_server["url"] + "/v1")

    answer = await client.complete(
        system_prompt="system instructions",
        user_prompt="spoken content",
    )

    assert answer == "clean result"
    request = llm_server["requests"][0]
    assert request["path"] == "/v1/chat/completions"
    assert request["authorization"] == "Bearer sentinel-secret"
    assert request["json"] == {
        "model": "test-model",
        "temperature": 0.4,
        "max_tokens": 2_000,
        "stream": False,
        "messages": [
            {"role": "system", "content": "system instructions"},
            {"role": "user", "content": "spoken content"},
        ],
    }


@pytest.mark.asyncio
async def test_client_requires_configured_api_key():
    with pytest.raises(LLMError) as captured:
        await make_client(
            "http://127.0.0.1:1",
            api_key="",
        ).complete(
            system_prompt="system",
            user_prompt="user",
        )

    assert captured.value.reason == "api_key_missing"
    assert "sentinel-secret" not in str(captured.value)


def test_client_representation_does_not_expose_api_key():
    client = make_client("https://example.test/v1")

    assert "sentinel-secret" not in repr(client)


@pytest.mark.asyncio
async def test_client_maps_http_failure(llm_server):
    llm_server["status"][0] = 500

    with pytest.raises(LLMError) as captured:
        await make_client(llm_server["url"]).complete(
            system_prompt="system",
            user_prompt="user",
        )

    assert captured.value.reason == "http_error"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        b"not-json",
        json.dumps({"choices": []}).encode(),
        json.dumps(
            {"choices": [{"message": {"content": "   "}}]}
        ).encode(),
    ],
)
async def test_client_rejects_invalid_responses(
    llm_server,
    body,
):
    llm_server["body"][0] = body

    with pytest.raises(LLMError) as captured:
        await make_client(llm_server["url"]).complete(
            system_prompt="system",
            user_prompt="user",
        )

    assert captured.value.reason == "invalid_response"


def test_llm_logger_writes_only_to_dedicated_rotating_file(tmp_path):
    path = tmp_path / "llm.log"

    logger = setup_llm_logging(path)
    same_logger = setup_llm_logging(path)
    logger.info('{"mode":"letter","content":"hello"}')
    for handler in logger.handlers:
        handler.flush()

    assert same_logger is logger
    assert logger.propagate is False
    assert len(logger.handlers) == 1
    assert '"content":"hello"' in path.read_text(encoding="utf-8")
