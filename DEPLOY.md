# 部署到手机 / 三端使用手册

这套东西由 3 部分组成：

| 部分 | 位置 | 用途 |
|---|---|---|
| PWA 网页 | `https://jadegovernor.github.io/task-sync-app/` | 电脑浏览器、手机都能用 |
| 私有数据仓库 | GitHub `JadeGovernor/task-sync`（私有） | 存放你的任务/打卡/闹钟设置 |
| Token | 你自己 GitHub 账号生成 | 每台设备各设一次，让应用读写上面的私有仓库 |

---

## 第 1 步：在你的 GitHub 建 Token（一次性，每台设备各建一个更安全）

1. 打开 https://github.com/settings/tokens?type=beta （Fine-grained personal access tokens）。
2. 「Generate new token」。
3. 填名字（如 `task-sync-mac-a`），有效期自选。
4. **Repository access** 选 **Only select repositories** → 勾选 `JadeGovernor/task-sync`。
5. **Permissions → Repository permissions** 里把 **Contents** 设为 **Read and write**。
6. 生成后复制（形如 `github_pat_xxx`），**只显示这一次**。

> 提示：建议每台设备单独建一个 Token（`task-sync-iphone`、`task-sync-macb`…），哪台不用了单独删，互不影响。

## 第 2 步：每台设备打开网页并连接

- 打开 `https://jadegovernor.github.io/task-sync-app/`，点右上角「设置」。
- 粘贴 Token → 「保存并测试 Token」。状态变成「已同步」即成功。
- 三台设备（Mac A / Mac B / iPhone）都做一遍。之后加任务、打勾会自动互相同步（约 20 秒内，也可点右上角 ⟳ 立即同步）。

## 第 3 步：把网页装成 App

### iPhone（Safari）
1. 用 Safari 打开上面的网址（其他浏览器不行，iOS 只支持 Safari 添加主屏）。
2. 点底部「分享」按钮 → 往下找「**添加到主屏幕**」。
3. 名字可改成「效率任务」，点「添加」。主屏上会出现图标，之后点开就是全屏 App 体验。

### Mac
- Chrome：地址栏右侧出现安装图标，或菜单「⋯ → 安装效率任务…」。
- Safari：可与 iPhone 一样「文件 → 添加到程序坞」。

## 第 4 步：B 站语音闹钟（早 6:30 自动播放 / 晚 22:30 提醒）

### 4a. 下载 B 站视频成 mp3（在任意一台 Mac 上）
```bash
cd task-sync-app
./scripts/download_bilibili.sh "BV1xxxxxxxxx" "https://www.bilibili.com/video/BV1yyyyyyyyy"
```
- 默认输出到 `~/Desktop/任务音频`；脚本会自动用 Homebrew 装 `yt-dlp` 和 `ffmpeg`。
- 会员/付费/风控视频可能下载失败 → 换个视频，或用脚本注释里的降级思路。

### 4b. 导入 Apple Music（同一 Apple ID 会自动同步到 iPhone）
1. Mac 打开「音乐」App，把下载好的 mp3 拖进「资料库」（或运行脚本末尾提示的 `osascript` 命令）。
2. iPhone 上确认「设置 → 音乐 → 同步资料库」已开，等歌曲出现。

### 4c. iPhone 设置自动播放（最稳方案：系统闹钟）
1. iPhone「时钟 → 闹钟 → ＋」。
2. 时间设 **6:30**（或你喜欢的点），重复选「每天」。
3. 「声音与触感 → 选取歌曲」，选刚才那首 B 站音频（可当睡前演讲、晨间演讲）。
4. 想要熄屏自动响、无需任何授权，系统闹钟就是最可靠的实现。

### 4d.（进阶，可选）快捷指令：到点先“朗读今日计划”再播音频
1. iPhone 装「快捷指令」App，新建个人自动化 →「特定时间」→ 设 6:30 → 重复每天。
2. 添加操作：
   - 「获取 URL 内容」URL 填 `https://api.github.com/repos/JadeGovernor/task-sync/contents/tasks.json`，
     请求头加 `Authorization: Bearer <你的 Token>`（进阶玩法，也可不做，纯闹钟已够用）。
   - 「朗读文本」：粘贴当天安排（或让上面的请求内容把任务读出来，需配合脚本）。
   - 「播放音乐」：选第 4b 步导入的音频。
3. 运行时询问关掉后首次仍可能弹一次允许，属正常。

### 早睡提醒 22:30
- 最简单：iOS「提醒事项」里建每天 22:30 的重复提醒，写「该睡了」；或系统闹钟再设一个 22:30 的轻柔铃声。
- App 内的「设置 → 早睡早起」把 6:30 / 22:30 和各设备开关记到私有仓库，方便你三端统一核对，但实际发声由系统闹钟/快捷指令负责。

## 日常验收清单（改完一次就过一遍）
- [ ] Mac A 加任务 → 20 秒内 Mac B / iPhone 能看到
- [ ] iPhone 打勾 → 两台 Mac 同步显示
- [ ] 飞行模式断网勾选 → 恢复联网后自动补传（右上角 ⟳ 可手动）
- [ ] iPhone 主屏图标全屏打开、断网仍能打开页面（Service Worker 缓存）
- [ ] 闹钟设 2 分钟后实测到点自动响

## 常见问题
- **电脑上 `git push` 卡住/连不上 github.com**：国内网络常只挡 git 通道。可用脚本直传（走 api.github.com，不依赖 git）：
  `python3 scripts/sync_to_github.py --owner JadeGovernor --repo task-sync-app -m "更新说明"`
- **连不上/403**：Token 过期了或没勾 `JadeGovernor/task-sync` 仓库的 Contents 读写 → 重新生成并粘贴。
- **两边同时改同一文件很罕见地丢一条**：单人使用基本不会；真遇到就「重新拉取云端」，把新改动再输入一次。
- **想换数据仓库**：改 `js/config.js` 里的 `owner` / `repo` 两处并重新部署即可。
- **网页打不开/国内网络慢**：github.io 国内一般可访问；不行就换网络或等一会重试。
