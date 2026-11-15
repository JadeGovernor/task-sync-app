# 早安演讲：iPhone 闹钟停止后自动播放

这套方案用 iPhone 系统「时钟 + 快捷指令自动化」实现，不需要服务器，也不依赖第三方闹钟 App。

## 已经准备好的内容

- 音频（iCloud Drive）：
  - `Shortcuts/MorningTalk/乔布斯_成长赋能vol26.m4a`
  - `Shortcuts/MorningTalk/奥巴马_最令人开眼演讲.m4a`
  - `Shortcuts/MorningTalk/【中英】暗淡蓝点 - 卡尔·萨根.m4a`
  - `Shortcuts/MorningTalk/【大字幕】英语名人演讲 油管搬砖 English Speeches with Big Subtitles 【更新ing】 p03 贝拉克·奥巴马BARACK OBAMA - Yes We Can.m4a`
- 原视频（iCloud Drive）：
  - `Shortcuts/MorningTalk-Source/Video/乔布斯_成长赋能vol26.mp4`
  - `Shortcuts/MorningTalk-Source/Video/奥巴马_最令人开眼演讲.mp4`
  - `Shortcuts/MorningTalk-Source/Video/【中英】暗淡蓝点 - 卡尔·萨根.mp4`
  - `Shortcuts/MorningTalk-Source/Video/【大字幕】英语名人演讲 油管搬砖 English Speeches with Big Subtitles 【更新ing】 p03 贝拉克·奥巴马BARACK OBAMA - Yes We Can.mp4`
- 已签名快捷指令：
  - `Shortcuts/Shortcut-Import/早安演讲-随机播放.shortcut`
  - 仓库副本：`shortcuts/早安演讲-随机播放.shortcut`

快捷指令的逻辑只有三步：

1. 获取 `MorningTalk` 文件夹内容；
2. 从列表中随机取一项；
3. 播放该音频。

所以以后只要往 `MorningTalk` 里加 `.m4a`，不用改快捷指令，就会自动加入随机播放。

## 第一次安装（iPhone 上手动做一次）

### 1. 导入快捷指令

1. 确认 iPhone 已登录同一个 Apple ID，并打开「iCloud Drive」。
2. 打开「文件」App → iCloud Drive → `Shortcuts` → `Shortcut-Import`。
3. 点 `早安演讲-随机播放.shortcut`。
4. 如果出现「添加快捷指令」，点「添加」。
5. 如果提示快捷指令来自未验证来源，选择「仍然添加」或「允许」。

### 2. 先手动运行一次

1. 打开「快捷指令」App，找到 `早安演讲·随机播放`。
2. 点运行。
3. 第一次会问文件夹，选择：

   `iCloud Drive/Shortcuts/MorningTalk`

4. 应该会随机播放乔布斯或奥巴马的一段音频。

> 如果没声音：先把 iPhone 媒体音量调大，再运行一次；确认 `MorningTalk` 里只有 `.m4a` 文件，没有子文件夹。

### 3. 建一个测试闹钟

1. 打开「时钟」→「闹钟」→ 右上角「+」。
2. 名称改成 `早起演讲`。
3. 时间先设成 2 分钟后。
4. 声音选一个温和的铃声即可；真正播放演讲的是快捷指令，不是闹钟铃声。
5. 保存。

### 4. 建个人自动化

1. 打开「快捷指令」→ 底部「自动化」→ 右上角「+」。
2. 触发器选「闹钟」。
3. 闹钟选 `早起演讲`。
4. 动作选「已停止」/「Is Stopped」。
5. 下一步后选择「立即运行」。
6. 关闭「运行前询问」。
7. 打开「锁屏时允许运行」。
8. 保存。

### 5. 锁屏实测

1. 锁屏，等 2 分钟。
2. 闹钟响后按「停止」。
3. 确认手机自动开始播放演讲。

只有这一步实测通过，才算真正部署完成。

## 日常使用

- 每天要改起床时间，只改「时钟」里 `早起演讲` 这个闹钟的时间。
- 不需要每天改快捷指令，也不需要在自动化里重新绑定。
- 想换演讲内容，把新的 `.m4a` 放进 `MorningTalk` 文件夹即可。
- 想固定听某一个，把另一个暂时移出 `MorningTalk`。

## 在 Mac 上追加 B 站音频

```bash
cd "$HOME/Desktop/Ai workshop /codex/tutorial/task-sync-app"
./scripts/setup_morning_talk.sh "https://www.bilibili.com/video/BV1fzVHzGE74/" "https://www.bilibili.com/video/BV1tj411p72Y/"
```

只下载音频、不保留视频：

```bash
./scripts/setup_morning_talk.sh --no-video "BV1fzVHzGE74"
```

脚本会自动安装 `yt-dlp` / `ffmpeg`，下载到 iCloud，并把快捷指令复制到 `Shortcut-Import`。

## 常见问题

| 现象 | 处理 |
|---|---|
| 闹钟停了但没播放 | 检查自动化触发器是否是「闹钟 → 早起演讲 → 已停止」，并确认「运行前询问」已关闭 |
| 锁屏后不播放 | 自动化里打开「锁屏时允许运行」 |
| 播放的是文件夹/没声音 | `MorningTalk` 里不要放子文件夹或视频，只放 `.m4a` |
| 快捷指令导入失败 | 用「快捷指令」App 手动新建：获取文件夹内容 → 随机取一项 → 播放声音；文件夹选 `MorningTalk` |
| 想用 Apple Music 兜底 | 把 `.m4a` 拖进「音乐」App，iPhone 闹钟声音里选它；但完整演讲建议还是用快捷指令 |
| 换了 iPhone | 新手机登录同一 Apple ID，重新导入快捷指令并重新建一次闹钟自动化 |

## 为什么不用第三方 App 读闹钟时间

iOS 不允许普通 App 或网页读取系统闹钟时间。系统「快捷指令」的闹钟自动化是官方提供的桥：

- 你在「时钟」里改时间；
- 系统在闹钟停止时触发自动化；
- 自动化再运行快捷指令播放音频。

所以这套方案的关键不是“读取闹钟”，而是“让闹钟停止事件触发播放”。这也是目前 iPhone 上最稳、最省电的做法。
