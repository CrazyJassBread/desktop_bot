#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
docker compose -f compose.local.yaml down
echo "本地服务已停止；Docker 数据卷仍保留。"
