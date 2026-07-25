#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_DIR/compose.local.yaml"
PYTHON="$PROJECT_DIR/.venv/bin/python"
ENV_FILE="$PROJECT_DIR/.env.local"

cd "$PROJECT_DIR"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

usage() {
  cat <<'EOF'
用法：
  ./run-local.sh                 启动全部服务，并使用系统默认麦克风
  ./run-local.sh --input-device 2
  ./run-local.sh --camera-device 0
  ./run-local.sh --bot           使用 Bot TCP 音频，不使用电脑麦克风
  ./run-local.sh --no-camera     不使用电脑摄像头，改为监听 8081 图片上传
  ./run-local.sh --services-only 只启动 Docker 服务并退出
  ./run-local.sh --list-mics     查看可用麦克风
  ./run-local.sh --no-build      跳过 Docker 镜像构建

可在 .env.local 中设置：
  MICROPHONE_DEVICE、CAMERA_DEVICE、GATEWAY_DRY_RUN、BOT_GATEWAY_ID、
  AUTO_STOP_ON_EXIT、BOT_GATEWAY_TOKEN、BOT_CLOUD_URL、
  WEB_HOST_PORT、CLOUD_HOST_PORT
EOF
}

INPUT_MODE="microphone"
INPUT_DEVICE="${MICROPHONE_DEVICE:-}"
USE_CAMERA="${CAMERA_ENABLED:-1}"
CAMERA_DEVICE="${CAMERA_DEVICE:-0}"
SERVICES_ONLY=0
BUILD_IMAGES=1

while (($#)); do
  case "$1" in
    --input-device)
      [[ $# -ge 2 ]] || { echo "--input-device 需要设备编号或名称"; exit 2; }
      INPUT_DEVICE="$2"
      shift 2
      ;;
    --bot)
      INPUT_MODE="bot"
      USE_CAMERA=0
      shift
      ;;
    --camera-device)
      [[ $# -ge 2 ]] || { echo "--camera-device 需要设备编号"; exit 2; }
      CAMERA_DEVICE="$2"
      USE_CAMERA=1
      shift 2
      ;;
    --no-camera)
      USE_CAMERA=0
      shift
      ;;
    --services-only)
      SERVICES_ONLY=1
      shift
      ;;
    --list-mics)
      [[ -x "$PYTHON" ]] || { echo "缺少 $PYTHON，请先安装 Python 依赖"; exit 1; }
      exec "$PYTHON" -m app.gateway_main --list-input-devices
      ;;
    --no-build)
      BUILD_IMAGES=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1"
      usage
      exit 2
      ;;
  esac
done

command -v docker >/dev/null || { echo "未找到 Docker"; exit 1; }
if ! docker_info_error="$(docker info 2>&1 >/dev/null)"; then
  echo "无法连接 Docker Desktop：${docker_info_error:-未知错误}"
  echo "请确认 Docker Desktop 已启动，并且当前终端有权访问 Docker。"
  exit 1
fi
[[ -x "$PYTHON" ]] || { echo "缺少 .venv，请先按 README 安装 Python 依赖"; exit 1; }
[[ -f config/llm.yaml ]] || { echo "缺少 config/llm.yaml，请从示例复制并填写"; exit 1; }
[[ -d models/faster-whisper-small ]] || { echo "缺少本地 ASR 模型 models/faster-whisper-small"; exit 1; }
[[ -f models/gesture_recognizer.task ]] || { echo "缺少手势模型 models/gesture_recognizer.task"; exit 1; }

export BOT_GATEWAY_TOKEN="${BOT_GATEWAY_TOKEN:-local-gateway-token-change-me}"
export GATEWAY_DRY_RUN="${GATEWAY_DRY_RUN:-1}"
export AUTO_STOP_ON_EXIT="${AUTO_STOP_ON_EXIT:-1}"

# Remove this project's previous containers before checking host ports. Named
# volumes are intentionally kept, so users and generated files remain.
docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true

choose_available_port() {
  local requested="$1"
  "$PYTHON" - "$requested" <<'PY'
import socket
import sys

requested = int(sys.argv[1])
for port in range(requested, requested + 50):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            continue
    print(port)
    raise SystemExit
raise SystemExit(f"端口 {requested}-{requested + 49} 均不可用")
PY
}

REQUESTED_WEB_PORT="${WEB_HOST_PORT:-18000}"
REQUESTED_CLOUD_PORT="${CLOUD_HOST_PORT:-8090}"
WEB_HOST_PORT="$(choose_available_port "$REQUESTED_WEB_PORT")"
CLOUD_HOST_PORT="$(choose_available_port "$REQUESTED_CLOUD_PORT")"
if [[ "$CLOUD_HOST_PORT" == "$WEB_HOST_PORT" ]]; then
  CLOUD_HOST_PORT="$(choose_available_port "$((CLOUD_HOST_PORT + 1))")"
fi
export WEB_HOST_PORT CLOUD_HOST_PORT
if [[ -z "${BOT_CLOUD_URL:-}" || "$BOT_CLOUD_URL" == "ws://127.0.0.1:8090/api/gateway" ]]; then
  BOT_CLOUD_URL="ws://127.0.0.1:${CLOUD_HOST_PORT}/api/gateway"
fi
export BOT_CLOUD_URL
export BOT_EVENTS_URL="${BOT_EVENTS_URL:-ws://127.0.0.1:${CLOUD_HOST_PORT}/api/events}"

if [[ "$WEB_HOST_PORT" != "$REQUESTED_WEB_PORT" ]]; then
  echo "端口 ${REQUESTED_WEB_PORT} 已被占用，网页自动改用 ${WEB_HOST_PORT}。"
fi
if [[ "$CLOUD_HOST_PORT" != "$REQUESTED_CLOUD_PORT" ]]; then
  echo "端口 ${REQUESTED_CLOUD_PORT} 已被占用，App 自动改用 ${CLOUD_HOST_PORT}。"
fi

echo "正在启动网页、数据库和云端 App（首次构建会较慢）..."
if ((BUILD_IMAGES)); then
  docker compose -f "$COMPOSE_FILE" up -d --build
else
  docker compose -f "$COMPOSE_FILE" up -d
fi

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts=90
  while ((attempts > 0)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      echo "$name 已就绪"
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "$name 启动超时，最近日志如下："
  docker compose -f "$COMPOSE_FILE" logs --tail=80
  return 1
}

wait_for_url "网页服务" "http://127.0.0.1:${WEB_HOST_PORT}/health"
wait_for_url "App 服务" "http://127.0.0.1:${CLOUD_HOST_PORT}/api/health"

seed_demo_user() {
  local display_name="$1"
  local email="$2"
  local status
  status="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      --data "{\"displayName\":\"$display_name\",\"email\":\"$email\",\"password\":\"demo-password-123\"}" \
      "http://127.0.0.1:${WEB_HOST_PORT}/api/v1/auth/register"
  )"
  if [[ "$status" != "201" && "$status" != "409" ]]; then
    echo "创建演示账号失败：$email（HTTP $status）"
    return 1
  fi
}

if [[ "${DEMO_MODE:-0}" == "1" ]]; then
  seed_demo_user "演示发件人" "demo-sender@local.test"
  seed_demo_user "演示小明" "demo-recipient@local.test"
  echo "演示账号已准备："
  echo "  发件人 demo-sender@local.test"
  echo "  收件人 demo-recipient@local.test"
  echo "  密码    demo-password-123"
fi

echo
echo "全部服务已启动："
echo "  网页：http://127.0.0.1:${WEB_HOST_PORT}"
echo "  App API：http://127.0.0.1:${CLOUD_HOST_PORT}/api/health"

if ((SERVICES_ONLY)); then
  echo "本地网关未启动。需要停止 Docker 服务时运行 ./stop-local.sh"
  exit 0
fi

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${EVENT_MONITOR_PID:-}" ]]; then
    kill "$EVENT_MONITOR_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$AUTO_STOP_ON_EXIT" == "1" ]]; then
    echo
    echo "正在停止本地服务（数据库和生成文件仍会保留）..."
    docker compose -f "$COMPOSE_FILE" down
  else
    echo "Docker 服务继续运行；可用 ./stop-local.sh 停止"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

EVENT_MONITOR_PID=""
if [[ "${DEMO_MODE:-0}" == "1" ]]; then
  "$PYTHON" scripts/watch_demo_events.py &
  EVENT_MONITOR_PID=$!
fi

GATEWAY_ARGS=(
  -m app.gateway_main
  --config config/app.yaml
)
if [[ "$INPUT_MODE" == "microphone" ]]; then
  GATEWAY_ARGS+=(--microphone)
  if [[ -n "$INPUT_DEVICE" ]]; then
    GATEWAY_ARGS+=(--input-device "$INPUT_DEVICE")
  fi
fi
if [[ "$USE_CAMERA" == "1" ]]; then
  GATEWAY_ARGS+=(--camera --camera-device "$CAMERA_DEVICE")
fi
if [[ "$GATEWAY_DRY_RUN" == "1" ]]; then
  GATEWAY_ARGS+=(--dry-run)
fi

echo
if [[ "$INPUT_MODE" == "microphone" ]]; then
  echo "本地网关开始监听电脑麦克风；请允许终端访问麦克风。"
else
  echo "本地网关开始监听 Bot：音频 8080，图片上传 8081/upload。"
fi
if [[ "$USE_CAMERA" == "1" ]]; then
  echo "电脑摄像头已作为 Bot 视觉输入；请允许终端访问摄像头。"
else
  echo "图片输入地址：http://127.0.0.1:8081/upload"
fi
if [[ "$GATEWAY_DRY_RUN" == "1" ]]; then
  echo "当前为安全演示模式：打印和 OLED 指令只记录日志，不操作真实硬件。"
fi
if [[ "${DEMO_MODE:-0}" == "1" ]]; then
  echo
  echo "演示顺序："
  echo "  1. 问答：说“帮我回答什么是人工智能”"
  echo "  2. 网页登录发件人账号，输入终端随后显示的电脑配对码"
  echo "  3. 写信：说“我要给演示小明写信”，再说正文和“完成写信”"
  echo "  4. 拍照：面对摄像头稳定举出 Victory 手势"
  echo "  5. 网页：用收件人账号登录，检查收到的信件"
fi
echo "按 Ctrl+C 停止全部服务。"

"$PYTHON" "${GATEWAY_ARGS[@]}"
