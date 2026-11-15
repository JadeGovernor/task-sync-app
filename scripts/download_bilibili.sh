#!/usr/bin/env bash
# 兼容旧入口：现在统一走 setup_morning_talk.sh。
# 旧参数 --out 仍可用；新流程默认下载到 iCloud Drive/Shortcuts/MorningTalk。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/setup_morning_talk.sh" "$@"
