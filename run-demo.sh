#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_TESTS=1
FORWARD_ARGS=()

while (($#)); do
  case "$1" in
    --skip-tests)
      RUN_TESTS=0
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

if ((RUN_TESTS)); then
  echo "正在运行核心功能自动测试..."
  "$PROJECT_DIR/.venv/bin/python" -m pytest -q "$PROJECT_DIR/tests"
  (
    cd "$PROJECT_DIR/integrations/ai-hub-os-web"
    npm test
  )
  echo "自动测试通过，开始演示环境。"
  echo
fi

export DEMO_MODE=1
export GATEWAY_DRY_RUN=1
export CAMERA_ENABLED="${CAMERA_ENABLED:-1}"

if ((${#FORWARD_ARGS[@]})); then
  exec "$PROJECT_DIR/run-local.sh" "${FORWARD_ARGS[@]}"
else
  exec "$PROJECT_DIR/run-local.sh"
fi
