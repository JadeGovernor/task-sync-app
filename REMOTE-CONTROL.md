# 用 iPhone 直接指挥这台 Mac

目标：iPhone 上的 OpenClaw App 连到 Mac 上的 OpenClaw Gateway，发一句话就能让 Mac 上的 AI 执行命令、改文件、跑测试；需要“像远程桌面一样手点”时，再用屏幕共享。

## 已经配好的部分

- Mac 上的 OpenClaw Gateway：`127.0.0.1:18789`，只监听本机。
- Tailscale 私网地址：在 Mac 的 Tailscale 菜单里查看（形如 `100.x.x.x`）。
- Tailscale Serve 地址：形如 `https://<你的设备名>.<你的 tailnet>.ts.net`，只有同一 tailnet 的设备能访问。
- Gateway 使用 token 鉴权，未开放公网。
- OpenClaw Codex 插件已安装；手机命令默认由 OpenClaw Agent 执行，Agent 可以在 Mac 上运行 `bash`、`codex`、`git` 等命令。
- Mac 已安装 `caffeinate` LaunchAgent，接电源时保持系统唤醒；屏幕仍可休眠。

## 第一次连接（iPhone 上手动做一次）

### 1. 装两个 App

1. App Store 安装 **Tailscale**。
2. App Store 安装 **OpenClaw**：
   https://apps.apple.com/app/openclaw-ai-that-does-things/id6780396132

### 2. 登录同一个 Tailscale 账号

1. 打开 Tailscale，登录 Mac 上同一个账号。
2. 打开开关。
3. 在设备列表里确认能看到 `node`（这台 Mac）在线。

> 如果看不到 `node`，先在 Mac 上打开 Tailscale 菜单，确认 Mac 在线；iPhone 和 Mac 必须在同一个 tailnet。

### 3. 用二维码配对 OpenClaw

1. 在 Mac 上生成配对二维码（二维码里是短期 bootstrap token，等同于临时密码）。
2. iPhone 打开 OpenClaw → 侧边栏 **Settings** → **Gateway**。
3. 点 **Scan QR Code**，扫描 Mac 屏幕上的二维码。
4. 官方 App 会自动连接；如果显示 **Pending approval**，在 Mac 上运行：

   ```bash
   $HOME/.local/bin/openclaw devices list
   $HOME/.local/bin/openclaw devices approve <requestId>
   ```

5. 连接成功后，App 里应该能看到 `main` agent。

### 4. 测试“真的在 Mac 上执行”

在 iPhone 的 OpenClaw 聊天里发：

```text
在这台 Mac 上运行 pwd，然后只回复输出结果。
```

应该返回：

```text
/Users/chewang/.openclaw/workspace
```

再发一条项目命令：

```text
进入 $HOME/Desktop/Ai workshop /codex/tutorial/task-sync-app，
运行 git status --short，然后告诉我结果。
```

如果能返回仓库状态，说明手机已经在真实操作这台 Mac。

## 日常怎么用

- 改代码：直接说“进入 task-sync-app，修复 XXX，跑测试，然后提交到 main”。
- 查状态：说“看一下 OpenClaw Gateway 和 Tailscale 是否正常”。
- 跑 Codex：说“用 codex exec 在这个仓库里做 XXX”，Agent 会调用 Mac 上的 Codex CLI。
- 长任务：OpenClaw 会在 Mac 上持续跑，iPhone 可以锁屏；回来再看结果。

## 想要“远程桌面手点 Mac”

OpenClaw App 是“对话式操作”，不是屏幕镜像。需要手动点 Mac 界面时：

1. Mac：系统设置 → 通用 → 共享 → 打开 **屏幕共享**。
2. iPhone：安装 **Jump Desktop** 或 **Screens**。
3. 新建连接，地址填 Mac 的 Tailscale IP（在 Tailscale 菜单里查看）。
4. 用 Mac 的登录账号连接。

macOS 没有官方 iPhone 屏幕共享客户端，所以这一步需要第三方 App。

## 安全与故障排查

- 不要把配对二维码、setup code、Gateway token 发给别人。
- Gateway 只绑定 `127.0.0.1`，通过 Tailscale Serve 暴露，不在公网监听。
- iPhone 丢失或不用了，在 Mac 上撤销设备：

  ```bash
  $HOME/.local/bin/openclaw devices list
  $HOME/.local/bin/openclaw devices revoke --device <deviceId> --role operator
  ```

- 手机连不上时，依次检查：

  ```bash
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status
  $HOME/.local/bin/openclaw gateway status
  curl -I <你的 Tailscale Serve 地址>
  ```

- Mac 合盖默认会睡眠。要合盖常驻，需要接电源并进入 clamshell 模式（外接显示器/键鼠），或者保持开盖。
- 重启 Mac 后，OpenClaw Gateway 和 caffeinate 会由 LaunchAgent 自动启动；Tailscale 需要在 App 里开启“登录时启动”。
