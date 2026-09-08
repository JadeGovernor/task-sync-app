# 效率任务 · 三端同步器（PWA）

生活 / 公司 / 计划 三模块任务，支持「今日效率打勾」，在 2 台 Mac + 1 台 iPhone 间通过 GitHub 私有仓库同步。

## 架构

- **代码仓库（公开）**：本仓库 `JadeGovernor/task-sync-app`，纯前端 PWA，GitHub Pages 托管，无任何个人数据。
- **数据仓库（私有）**：`JadeGovernor/task-sync`，只存 3 个 JSON：`tasks.json`、`checkins.json`、`settings.json`。
- 每台设备在应用「设置」页粘贴一个**只限该私有仓库的 Fine-grained Token**（只存在本机浏览器里），应用通过 GitHub Contents API 读写数据。
- 离线可用：改动先存本机 + 进待同步队列，联网后自动补传；页面缓存由 Service Worker 管理。

> 为什么分成两个仓库？GitHub 免费套餐不允许私有仓库发布 Pages；若强制在私有仓库开 Pages，数据（你的任务）就会公开。因此把「代码」放公开 Pages、把「数据」留在私有仓库。

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 测试

```bash
node tests/core.test.js
```

## 生成图标（可选）

```bash
python3 scripts/gen_icons.py
```

## 部署与 iPhone 安装、B 站语音闹钟

见 **[DEPLOY.md](./DEPLOY.md)**。

> 若本地 `git push` 连不上 github.com，可用 `python3 scripts/sync_to_github.py --owner JadeGovernor --repo task-sync-app -m "说明"` 直传（走 API，无需 git 通道）。
