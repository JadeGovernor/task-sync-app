# 效率任务 · 三端同步器（PWA）

V2：今日聚合首页 + 公司 / 计划 / 自律 / 效率 四模块；大条目带「进展备注流水」；
在 2 台 Mac + 1 台 iPhone 间通过 GitHub 私有仓库同步。产品定稿见 **[PRODUCT-V2.md](./PRODUCT-V2.md)**。

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

或者直接双击仓库里的 **`启动本地服务.command`**，然后打开 `http://127.0.0.1:8123/`（手机同 Wi-Fi 也可用 `http://<Mac的IP>:8123/`）。

## 公司页操作

- 公司页按**到期日**分成「今日 / 明日 / 更晚」三桶，逾期自动顺延到今天。
- 整条卡片任意位置（标题那一行）**拖动即改顺序**，顺序写进云端，三端一致。
- 把一条拖进另一个桶就顺带改到期日：拖进「明日」= 改到明天，拖进「更晚」= 改到一周后；拖进「今日」= 提前到今天。
- 右上「＋新建」建完会自动滚到那一条并高亮，不会「建了看不见」。
- 卡片中间是进展区，为了让进展文字能正常选中/复制，那一块不参与拖动；要拖就按标题那一行。

## 同步与数据安全

- 每条改动都是一条操作进队列，推送时先拉云端最新内容、叠上本条、再整份写回。
- 断言/竞态处理：GET 带 `cache:'no-store'`（GitHub Contents API 有 60 秒缓存，旧快照曾被当成最新）；
  写入撞车（409/412/422）会自动重拉重试；**一条操作失败不会堵住后面的操作**，失败的那条带退避重试。
- 每次被云端新数据覆盖前，本机都会把上一版存一份（每个文件 20 份）。设置页 →「数据恢复」可以把任意一份整份推回云端，三端一起回滚。

## 测试

```bash
node tests/core.test.js
node tests/sync-conflict.test.js   # 409 重试 / 失败不堵队 / 快照恢复
```

浏览器端用例（需要 Chrome + 本地 8123 服务）：`tests/e2e-*.mjs`，例如
`node tests/e2e-workdrag.mjs`（公司页拖动排序、跨桶改到期日、数据恢复）。

## 生成图标（可选）

```bash
python3 scripts/gen_icons.py
```

## 部署与 iPhone 安装、B 站语音闹钟

见 **[DEPLOY.md](./DEPLOY.md)**。

> 若本地 `git push` 连不上 github.com，可用 `python3 scripts/sync_to_github.py --owner JadeGovernor --repo task-sync-app -m "说明"` 直传（走 API，无需 git 通道）。
