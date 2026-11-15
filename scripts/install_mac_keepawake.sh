#!/usr/bin/env bash
# 让 Mac 在接电源时保持系统唤醒，方便 iPhone 随时远程指挥。
# 屏幕仍可休眠；远程命令不依赖屏幕常亮。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/ai.openclaw.caffeinate.plist"
PLIST_DST="$HOME/Library/LaunchAgents/ai.openclaw.caffeinate.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents"
cp -f "$PLIST_SRC" "$PLIST_DST"

launchctl bootout "$DOMAIN" "$PLIST_DST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$PLIST_DST"
launchctl enable "$DOMAIN/ai.openclaw.caffeinate"
launchctl kickstart -k "$DOMAIN/ai.openclaw.caffeinate"

echo "✅ 已安装并启动：$PLIST_DST"
echo "   当前状态：launchctl print $DOMAIN/ai.openclaw.caffeinate | head"
