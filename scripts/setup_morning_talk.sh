#!/usr/bin/env bash
# 准备「早安演讲」：下载 B 站音频到 iCloud，并放入已签名的快捷指令。
#
# 用法：
#   ./scripts/setup_morning_talk.sh "BV1fzVHzGE74" "BV1tj411p72Y"
#   ./scripts/setup_morning_talk.sh "https://www.bilibili.com/video/BV..."
#   ./scripts/setup_morning_talk.sh --no-video "BV..."
#   ./scripts/setup_morning_talk.sh --out /path/to/audio "BV..."
#
# 默认目录：
#   iCloud Drive/Shortcuts/MorningTalk          只放 m4a 音频
#   iCloud Drive/Shortcuts/MorningTalk-Source   放 mp4 原视频
#   iCloud Drive/Shortcuts/Shortcut-Import      放待导入的 .shortcut
set -euo pipefail

ICLOUD_BASE="${MORNING_TALK_ICLOUD_BASE:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Shortcuts}"
AUDIO_DIR="$ICLOUD_BASE/MorningTalk"
VIDEO_DIR="$ICLOUD_BASE/MorningTalk-Source"
SHORTCUT_DIR="$ICLOUD_BASE/Shortcut-Import"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHORTCUT_FILE="$REPO_DIR/shortcuts/早安演讲-随机播放.shortcut"

KEEP_VIDEO=1
OPEN_FINDER=0
URLS=()

usage() {
  sed -n '2,16p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-video) KEEP_VIDEO=0; shift ;;
    --open) OPEN_FINDER=1; shift ;;
    --out)
      [[ $# -ge 2 ]] || { echo "❌ --out 后面缺少目录" >&2; exit 2; }
      AUDIO_DIR="$2"
      VIDEO_DIR="$2/Video-Source"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "❌ 未知参数：$1" >&2; usage; exit 2 ;;
    *) URLS+=("$1"); shift ;;
  esac
done

if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "❌ 请至少给一个 B 站链接或 BV 号" >&2
  usage
  exit 1
fi

for cmd in yt-dlp ffmpeg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "🔧 正在安装 $cmd（brew install $cmd）…"
    brew install "$cmd"
  fi
done

mkdir -p "$AUDIO_DIR" "$VIDEO_DIR" "$SHORTCUT_DIR"
echo "🎧 音频目录：$AUDIO_DIR"
echo "🎬 视频目录：$VIDEO_DIR"

for input in "${URLS[@]}"; do
  if [[ "$input" == http* ]]; then
    url="$input"
  else
    url="https://www.bilibili.com/video/$input/"
  fi

  echo "⏬ 处理：$url"
  if [[ "$KEEP_VIDEO" -eq 1 ]]; then
    video_path="$(yt-dlp --no-playlist --no-overwrites \
      -f "bv*+ba/b" --merge-output-format mp4 \
      --print after_move:filepath \
      -o "$VIDEO_DIR/%(title)s.%(ext)s" "$url")" \
      || { echo "⚠️  下载失败：$url（可能是会员视频或风控，换一个再试）"; continue; }

    if [[ -n "$video_path" && -f "$video_path" ]]; then
      audio_name="$(basename "${video_path%.*}").m4a"
      ffmpeg -hide_banner -loglevel error -y -i "$video_path" \
        -vn -c:a aac -b:a 192k "$AUDIO_DIR/$audio_name"
      echo "🎧 已提取音频：$AUDIO_DIR/$audio_name"
    else
      echo "⚠️  没有拿到视频文件路径：$url"
    fi
  else
    yt-dlp --no-playlist --no-overwrites \
      -f "bestaudio/best" --extract-audio --audio-format m4a --audio-quality 0 \
      -o "$AUDIO_DIR/%(title)s.%(ext)s" "$url" \
      || { echo "⚠️  下载失败：$url（可能是会员视频或风控，换一个再试）"; continue; }
  fi
done

if [[ -f "$SHORTCUT_FILE" ]]; then
  cp -f "$SHORTCUT_FILE" "$SHORTCUT_DIR/"
  echo "📱 快捷指令已放入：$SHORTCUT_DIR/$(basename "$SHORTCUT_FILE")"
else
  echo "⚠️  仓库里没找到快捷指令：$SHORTCUT_FILE"
fi

cat <<EOF

✅ 完成。接下来在 iPhone 上：
  1. 打开「文件」→ iCloud Drive → Shortcuts → Shortcut-Import
  2. 点「早安演讲-随机播放.shortcut」→ 添加快捷指令
  3. 首次运行时选择 iCloud Drive/Shortcuts/MorningTalk 文件夹
  4. 在「时钟」建闹钟，再用「快捷指令 → 自动化 → 闹钟」绑定它

完整步骤见：$REPO_DIR/SHORTCUTS.md
EOF

if [[ "$OPEN_FINDER" -eq 1 ]]; then
  open "$ICLOUD_BASE"
fi
