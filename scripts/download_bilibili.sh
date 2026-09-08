#!/usr/bin/env bash
# 下载 B 站视频为 mp3（供 iPhone 闹钟 / Apple Music 使用）
#
# 用法：
#   ./scripts/download_bilibili.sh "BV1xx411c7mD" ["BVxxxxxxxxx"...]
#   ./scripts/download_bilibili.sh "https://www.bilibili.com/video/BV1xx411c7mD"
#   --out /path/to/dir   指定输出目录（默认 ~/Desktop/任务音频）
#
# 前置：需要 yt-dlp 与 ffmpeg（本脚本会自动用 Homebrew 安装）。
# 会员/付费视频可能下载失败：换视频，或降低清晰度参数再试。
set -euo pipefail

OUT_DIR="$HOME/Desktop/任务音频"
URLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) URLS+=("$1"); shift ;;
  esac
done

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "❌ 请至少给一个 B 站链接或 BV 号"
  sed -n '2,12p' "$0"
  exit 1
fi

for cmd in yt-dlp ffmpeg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "🔧 正在安装 $cmd（brew install $cmd）…"
    brew install "$cmd"
  fi
done

mkdir -p "$OUT_DIR"
echo "🎧 输出目录：$OUT_DIR"

for u in "${URLS[@]}"; do
  echo "⏬ 下载：$u"
  yt-dlp --no-playlist --no-overwrites -f "bestaudio/best" \
    --extract-audio --audio-format mp3 --audio-quality 0 \
    -o "$OUT_DIR/%(title)s.%(ext)s" "$u" \
    || echo "⚠️  下载失败：$u（可能是会员视频或风控，换一个再试）"
done

echo ""
echo "✅ 完成。下一步把 mp3 导入 Apple Music："
echo "   1) 打开「音乐」App 把 mp3 拖进资料库（或用下面的命令）"
echo "   2) iPhone 上的「时钟 → 闹钟 → 声音 → 选取歌曲」选它，即可每天定时响铃"
echo ""
echo "   想用命令直接导入："
echo "   osascript -e 'tell application \"Music\" to add POSIX file \"$OUT_DIR/<文件名>.mp3\" to library playlist 1'"
