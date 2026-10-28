# Continuwuity IM 升级完整方案

> **版本**：v1.1（三轮联网深度扫描增强）  
> **日期**：2026-10-26  
> **决策**：放弃自造 IM 基建，采用 Continuwuity（Matrix 协议）全量替换  
> **执行人**：绿角犀 AI 团队
> 
> **v1.1 更新内容**（三轮联网深度扫描发现 21 处增强点）：
> - 🔴 6 条硬规矩（server_name 不能事后改、nginx path 不能加、Docker 锁版本等）
> - 📋 完整 nginx.conf + docker-compose.yml + Continuwuity config.toml
> - 🎨 Skin 三种路线成本对比
> - 🔔 推送方案最终敲定（Express 直接调 FCM/APNs REST API）
> - 🤖 AI Bot 三种部署姿势（App Service 正规注册）
> - 🛡️ Moderation 工具链（Draupnir + MSC4284 Policy Server）
> - 🌉 Bridges 生态（Mautrix WhatsApp/Telegram/Signal/Discord）

---

## ① 决策总览

### 为什么选 Continuwuity？

| 对比项 | Continuwuity 方案 | 自造方案（Centrifugo + Outbox + Signal SDK） |
|---|---|---|
| Gap 覆盖数 | **14/16**（协议原生带 WebSocket/E2EE/推送/typing/reactions/threads/已读/多端同步/FTS5/群聊权限） | 7/16（还欠 9 个） |
| 工期 | 13 天 | 9 天 |
| 后续新增功能 | ✅ 在绿角犀 Express 里加，Continuwuity 不碰 | 一样能加，但容易跟基建层缠一起 |
| 底层安全兜底 | 🟢 社区自动修，Matrix 协议有 Element 团队审计 | 🔴 自己扛，出漏洞没人帮 |
| 资源占用 | **20-50MB RAM**（Rust 单进程） | Express + Centrifugo 至少 400MB+ |
| License | **Apache 2.0**（无 copyleft，随便商用） | 各自零污染 |
| 费用 | **零**（开源 + 已有阿里云服务器） | 零 |
| 风险 | 🟡 Continuwuity 不支持 Federation（绿角犀不需要） | 🟢 代码全自己的 |

### Continuwuity 是什么？

Rust 写的 Matrix 协议服务端，Conduit → Conduwuit → Continuwuity 社区迭代链的最新活跃分支。

- Docker 一键起，内嵌 RocksDB（不用装 PostgreSQL）
- 启动 1-2 秒，内存 20-50MB
- 完整 Matrix 协议实现，支持 E2EE（Olm + Megolm）
- 不支持 Federation（跨服务器互通），绿角犀定位不需要

### Matrix 协议提供的能力（绿角犀零代码白嫖）

| 能力 | Matrix 对应 | 绿角犀现在有吗 |
|---|---|---|
| WebSocket 双向通信 | ✅ Matrix Spec | ❌ 现在用 SSE 单向 |
| 离线推送 | ✅ Matrix Push Gateway | ❌ 完全没做 |
| E2EE 加密 | ✅ Olm（私聊）+ Megolm（群聊） | ❌ 明文存储 |
| typing indicator | ✅ m.typing event | ❌ 完全没做 |
| presence 在线状态 | ✅ m.presence event | ❌ 完全没做 |
| 消息 reactions | ✅ m.reaction | ❌ 完全没做 |
| 消息回复 threads | ✅ m.thread | ❌ 完全没做 |
| 消息编辑 | ✅ m.message.edit | ❌ 完全没做 |
| 消息撤回 | ✅ m.room.redaction | ❌ 完全没做 |
| 群聊已读回执 | ✅ m.receipt | ❌ 只有自己清零 |
| 群聊精细权限 | ✅ power levels 0-100 | 🟡 只有 owner/admin |
| 多端同步 | ✅ 协议原生设计 | ❌ IM 消息各端独立 |
| 全文检索 | ✅ Synapse/Continuwuity 内置 | 🟡 LIKE 全表扫描 |

---

## ② 新架构图

```
绿角犀 Continuwuity 架构：
┌─────────────────────────────────────────────────────────────┐
│  用户设备                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ 桌面 Electron │  │ 手机 Android │  │ 手机 iOS      │       │
│  │ matrix-js-sdk │  │ matrix-js-sdk │  │ matrix-js-sdk │       │
│  │ (React)      │  │ (React)      │  │ (React)      │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │ WebSocket wss:// 或 HTTPS
          ▼
┌─────────────────────────────────────────────────────────────┐
│  阿里云 47.116.59.141                                         │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │  Continuwuity (Rust)  │  ← 独立 Docker 容器               │
│  │  端口 8448 (HTTPS)   │     20-50MB RAM                    │
│  │  内嵌 RocksDB        │     只管 IM 消息怎么传              │
│  │  内嵌 E2EE 加密      │                                    │
│  │  内嵌推送 Gateway    │                                    │
│  └──────────────────────┘                                    │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │  绿角犀 Express 后端   │  ← 保留现有 Docker/pm2            │
│  │  端口 3000           │     管一切 IM 以外的功能             │
│  │  + Prisma + MySQL    │                                    │
│  │                      │                                    │
│  │  新增：               │                                    │
│  │  ├─ Matrix JWT 签发   │                                    │
│  │  ├─ 旧 IM 数据迁移     │                                    │
│  │  ├─ AI 助理 Matrix bot │                                    │
│  │  └─ 用户系统对接       │                                    │
│  └──────────────────────┘                                    │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │  nginx 反代           │                                    │
│  │  /api/* → Express    │                                    │
│  │  /* → Continuwuity    │                                    │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

### 两套系统的边界

| Continuwuity 负责 | Express 负责 |
|---|---|
| 消息怎么传（WebSocket/Push） | AI 助理对话（DeepSeek 调用） |
| 消息加密（E2EE） | 用户注册/登录/JWT 签发 |
| 会话/房间管理 | 旧 IM 数据迁移到 Matrix |
| 好友/群聊/邀请 | 团队协作 ↔ Matrix 群联动 |
| typing / presence / 已读 | 宠物 / 财务 / 日历 / 任务 |
| reactions / threads / 撤回 | AI 助理 Matrix bot |
| 多端同步 | 绿角犀特有的一切 |

---

## ③ 分步骤实施计划（13 天）

### Day 1 — D1 Continuwuity 部署 + 验证

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 阿里云 Docker 起 Continuwuity，绑定 HTTPS 端口 8448 | `docker run -d --name continuwuity -p 8448:8448 continuwuity/continuwuity:latest` |
| 2 | 创建 admin 用户，登录验证 HTTP API 通 | `curl -X POST http://localhost:8008/_matrix/client/v3/register` |
| 3 | 浏览器装 Element Web 客户端，用 admin 登录，发消息测试 | Element 页面能收发消息 |
| 4 | Continuwuity 配置 nginx 反代 + HTTPS 证书 | `matrix.47.116.59.141` 可访问 |
| 5 | 防火墙放行 8448 和 443 | 外网可达 |
| 6 | 前端 npm install matrix-js-sdk | package.json 有 matrix-js-sdk |

**验收标准**：Element Web 能在绿角犀服务器上正常收发消息、typing、建群

---

### Day 2-3 — D2 用户系统对接 + JWT 签发

绿角犀现有 Prisma User 表 ↔ Matrix 用户系统对接。

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | Express 新增 `/api/v1/matrix/register` — 绿角犀用户注册时自动在 Matrix 创建对应用户 | 注册流程自动调 Continuwuity API |
| 2 | Express 新增 `/api/v1/matrix/token` — 绿角犀登录后签发 Matrix access_token | 返回 Matrix JWT token |
| 3 | Continuwuity 启用 JWT auth（配置 shared secret） | Continuwuity 信任 Express 签的 token |
| 4 | 绿角犀前端登录成功后，同时初始化 matrix-js-sdk | 前端同时持有绿角犀 JWT + Matrix token |
| 5 | 写 Node 脚本：遍历现有 Prisma User 表，批量创建 Matrix 用户 | 历史用户全部同步 |

**验收标准**：绿角犀用户登录后能直接进 Matrix 发消息，无需二次注册

---

### Day 4-5 — D3 ChatPage UI 重写（墨玉绿皮肤）

把 Element 官方 UI 换皮成绿角犀墨玉绿风格，用 `matrix-react-sdk` 的 `CustomTile` 和 CSS 覆盖。

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 创建 `ChatPageV2.tsx` 入口，替换旧 ChatPage | 新页面骨架 |
| 2 | 集成 `matrix-react-sdk` 的 RoomView + RoomList + MemberList | 基础聊天界面出来 |
| 3 | 覆盖 CSS 变量：brand #00856A / canvas / ink / surface | 墨玉绿主题生效 |
| 4 | 定制消息气泡（MessageBubble）自己写，不依赖 Element | 消息气泡有绿角犀 logo 和墨玉绿边框 |
| 5 | 定制会话列表（ConversationList）自己写 | 会话列表按绿角犀风格排 |
| 6 | 集成消息图片/文件/位置发送 | 多模态跟旧版一致 |
| 7 | 接回绿角犀消息卡片（AI 回复的 task_card/diet_card 等） | AI 卡片正常显示 |
| 8 | 加 E2EE 加密提示 | 私聊显示 🔒 图标，群聊显示 🔒（Megolm） |
| 9 | ChatListPage / ChatUserPage 同理重写 | 3 个 IM 主页面全换 |

**验收标准**：新 IM 页面墨玉绿风格、能收发消息、能开群、能加好友、typing 有动画、消息加密有提示

---

### Day 6-7 — D4 好友/群聊/会话全链路

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 好友添加 → 调用 Matrix invite API → Continuwuity 发邀请 | 绿角犀"加好友"按钮走 Matrix |
| 2 | 群聊创建 → 调 Matrix create room API | 绿角犀"建群"走 Matrix |
| 3 | 群成员管理（踢人/加人） → Matrix membership API | 群管理用 power levels |
| 4 | 群聊权限（禁言/踢人/改群名） → Matrix power levels | 0-100 精细粒度 |
| 5 | 会话列表 Matrix sync → 前端 ConversationList | 已重写 |
| 6 | 未读数 Matrix unread notifications | 未读数正确显示 |
| 7 | 置顶 / 免打扰 → Matrix push rules | 会话置顶/免打扰生效 |

**验收标准**：完整的好友+群聊+会话操作全走 Matrix API，跟旧版功能等价

---

### Day 8 — D5 AI 助理 Matrix bot

> ⚠️ **方向卡 DIR-003 v1.0（2026-10-28）**：原 Day 8-9 规划被 E2EE MVP 抢占。
> 实际执行：Day 8-9 先上 E2EE 端到端加密（Rust crypto + 房间级加密开关），Day 8 bot 往后推。
> 完整方向卡 + SDK 真坑记录 → 见 `05_功能特性/DIR-003-Day89-E2EE方向卡.md`。
> 项目进程 → `项目进程.md` v0.9。

绿角犀 AI 助理当一个普通 Matrix 用户，用户跟它聊就是跟 bot 聊。

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 创建 AI bot Matrix 用户（`绿角犀AI助理`） | Continuwuity 上多一个 bot 账号 |
| 2 | Express 新增 `/api/v1/matrix/webhook` — Continuwuity webhook 推送 AI 相关消息到这个接口 | bot 收到 @mention → Express 处理 |
| 3 | Express 调 DeepSeek API 回复 | AI 自动回复消息发送到 Matrix room |
| 4 | AI 助理进绿角犀用户的 AI 专属会话 room | 用户首页点"跟 AI 聊"直接进 |
| 5 | AI 主动推送消息（提醒/宠物喂食等）→ 作为 bot 发到 room | 主动推送正常 |

**验收标准**：绿角犀 AI 助理能在 Matrix room 里自动回复，跟用户聊 AI 助理的体验不变

---

### Day 9 — D6 旧数据迁移

把 Prisma 里的 7 张 IM 表数据迁移到 Continuwuity（可选——也可以不迁，直接用新的）。

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 写迁移脚本：遍历 ConversationMessage → Matrix m.room.message API | 历史消息写入 Matrix |
| 2 | 遍历 Conversation → 转换为 Matrix room | 旧会话恢复 |
| 3 | 遍历 Friendship → Matrix invite API | 好友关系恢复 |
| 4 | 遍历 Group/GroupMember → Matrix room + membership | 群聊恢复 |
| 5 | 迁移脚本带幂等性（重复跑不会产生重复消息） | `migrate-im-data.cjs` |
| 6 | 迁移前 SQLite 备份 | `backup-aie-im-$(date).db` |

**验收标准**：迁移后老用户打开绿角犀能看到旧消息，会话历史完整

**兜底**：如果迁移太麻烦，可以**不迁**，让新 IM 从今天开始，旧数据留着以后再说。看用户意愿。

---

### Day 10-11 — D7 多端同步 + 离线推送

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | Continuwuity push gateway 配置 FCM/APNs | 离线推送通道通 |
| 2 | 移动端 matrix-js-sdk 注册 FCM/APNs device token | 手机端能收推送 |
| 3 | 桌面端 Electron 加托盘通知 + system tray alert | 关窗口收桌面通知 |
| 4 | Continuwuity presence + typing 事件 → 前端显示 | "张三正在输入..." / "在线" 状态 |
| 5 | E2EE 密钥多端同步（每个设备一个 device ID） | 多设备加密互通 |

**验收标准**：手机关了 App 收到推送通知点唤醒 → 消息已在、typing 显示正常、多设备加密对话

---

### Day 12-13 — D8 端到端测试 + 回归

| 步骤 | 说明 | 产出 |
|---|---|---|
| 1 | 冒烟测试：好友添加 / 一对一 / 群聊 / E2EE / typing / 推送 | 全功能走一遍 |
| 2 | 回归测试：绿角犀原有 40+ 路由不受影响 | smoke-all.mjs 全过 |
| 3 | ChatPage V1 → V2 切换开关（VITE_IM_V2=true） | 紧急时能切回旧版 |
| 4 | Electron 打包验证 + 安装包测试 | Setup.exe 带 Continuwuity SDK |
| 5 | Prisma IM 表标记 deprecated（保留 30 天后删） | schema 里 IM 表加注释 |
| 6 | 写 Continuwuity 运维手册（怎么重启、怎么备份、怎么升级） | `Continuwuity-Operations.md` |

**验收标准**：绿角犀原有功能零退化，新 IM 功能完整可用

---

## ④ 风险预案

### 风险 1：Continuwuity 有 bug / 挂了

**预案**：Express 保留旧 `conversation.routes.ts`，加 `VITE_IM_V2=false` 环境变量切回旧 SSE IM。Docker `restart: unless-stopped` 自动重启。

### 风险 2：Continuwuity 社区停更

**预案**：Continuwuity 是 Matrix 协议实现——
- 如果 Continuwuity 没了，可以换 Synapse（Python + PostgreSQL，300-500MB RAM）
- 迁移命令：Synapse 官方有 Import API，Matrix 数据是 JSON 格式
- 迁移成本 ≈ 1 天，只需换 Docker 容器，前端 SDK 一行代码不用改（都是 Matrix 协议）

### 风险 3：matrix-react-sdk 定制墨玉绿皮肤遇坎

**预案**：SDK 提供了 `theme` 接口（CSS 变量覆盖）。如果高级定制不行，先用默认 Element 风格上线，慢慢换皮。核心聊天功能先跑起来。

### 风险 4：旧数据迁移失败/丢数据

**预案**：Day 6 迁移前 SQLite 完整备份。迁移脚本幂等，出问题回滚备份重跑。实在迁不动可以**不迁**——新 IM 从今天开始，旧数据留着做导出功能。

---

## ⑤ 运维清单

| 项 | 命令 / 方式 | 周期 |
|---|---|---|
| Continuwuity 状态 | `docker ps -a \| grep continuwuity` | 每次登录 |
| Continuwuity 日志 | `docker logs continuwuity --tail 50` | 排障时 |
| 数据备份 | `docker cp continuwuity:/var/lib/continuwuity /backup/continuwuity-$(date +%Y%m%d)` | 每天 |
| Continuwuity 升级 | `docker pull continuwuity/continuwuity:latest && docker restart continuwuity` | 每月 |
| Continuwuity 重启 | `docker restart continuwuity` | 故障时 |

---

## ⑥ 成本汇总

| 项 | 费用 | 备注 |
|---|---|---|
| Continuwuity Docker 镜像 | 免费 | Apache 2.0 |
| Matrix 协议 | 免费 | IETF 开放标准 |
| matrix-js-sdk | 免费 | Apache 2.0 |
| 阿里云服务器 | **已有** | 47.116.59.141 已有，Continuwuity 20MB RAM 不影响 |
| FCM/APNs 推送 | 免费 | Google/Apple 开发者免费额度 |
| 开发人力 | 13 天 | 内部团队 |
| **合计** | **¥0** | |

---

## ⑦ 后续扩展预留

| 以后想加什么 | 用 Matrix 什么能力 | 需要自己写多少代码 |
|---|---|---|
| 语音视频通话 | Matrix WebRTC + LiveKit 对接 | 约 2 天 |
| 消息自动翻译 | Express webhook → 调 DeepL | 约 1 天 |
| 消息自动总结 | Express webhook → 调 DeepSeek | 约 1 天 |
| 敏感词过滤 | Express webhook → 正则/关键词库 | 约 1 天 |
| 跨服务器 Federation | 换 Synapse（Continuwuity 不支持） | 约 1 天迁移 |
| 大文件 CDN | Express presigned URL + 腾讯 COS | 约 2 天 |

---

---

## ⑧ 深度扫描增强（v1.1 补充，三轮联网扫描）

### ⑧-1 硬规矩清单（不做就出事）

| # | 硬规矩 | 为什么 | 违反后果 |
|---|---|---|---|
| **H1** | Continuwuity `server_name` 一旦设错要删数据库重装 | Matrix Delegation 配置用户名后缀（`@user:绿角犀域名`），不能事后改 | 数据库 wipe，用户数据全丢 |
| **H2** | nginx `location /_matrix/*` 的 `proxy_pass` 后面**不能加 path** | Synapse 官方写的坑——加了 `/` 会 URI canonicalization，联邦签名验证出错 | 所有 Matrix API 请求 500 |
| **H3** | Docker 标签必须锁 `continuwuity/continuwuity:v0.5.10` 或更新 | CVE-2025-68667 + 远程 to-device + URL preview + dehydrated device 6 个安全修复 | 服务器被入侵 |
| **H4** | `ip_lookup_strategy = 1`（阿里云只有 IPv4） | IPv6 DNS 会白白等待超时 | Continuwuity 启动慢 / Federation 连不上 |
| **H5** | `cache_capacity_modifier = 0.3`（20-50MB 内存） | Continuwuity 默认分配 200MB+，阿里云低配机器扛不住 | OOM Kill |
| **H6** | `federation = false` | 绿角犀不做跨服务器互通，关闭减少攻击面 | — |

### ⑧-2 Day 1 完整配置

#### Continuwuity config.toml（最小配置）

```toml
[global]
server_name = "绿角犀域名"           # H1: 定死不改
address = ["0.0.0.0"]
port = 8008
database_path = "/var/lib/continuwuity"
database_backup_path = "/var/lib/continuwuity-backups"
database_backups_to_keep = 7
allow_federation = false            # H6
cache_capacity_modifier = 0.3       # H5: 阿里云内存小
ip_lookup_strategy = 1              # H4: 只有 IPv4
request_ip_source = "x_forwarded_for"

[global.well_known]
client = "https://绿角犀域名"
server = "绿角犀域名:443"

[global.observability]
otlp_exporter = "prometheus"        # 自带 Prometheus 指标

[appservice]
```

#### nginx.conf（绿角犀完整配置）

```nginx
server {
    listen 443 ssl http2;
    server_name 绿角犀域名;

    # SSL（Certbot 自动续期）
    ssl_certificate     /etc/letsencrypt/live/绿角犀域名/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/绿角犀域名/privkey.pem;

    # === Continuwuity Matrix ===
    # H2 硬规矩：proxy_pass 后面不能加 path
    location ~ ^(/_matrix|/_continuwuity) {
        proxy_pass http://127.0.0.1:8008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s; proxy_send_timeout 3600s;
        proxy_buffering off; proxy_cache off;
        client_max_body_size 50M;
    }

    # === 绿角犀 Express API ===
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }

    # === 绿角犀前端静态文件 ===
    location / {
        root /var/www/aie;
        try_files $uri $uri/ /index.html;
    }

    # === Matrix .well-known delegation ===
    location /.well-known/matrix/server {
        default_type application/json;
        return 200 '{"m.server": "绿角犀域名:443"}';
    }
    location /.well-known/matrix/client {
        default_type application/json;
        add_header Access-Control-Allow-Origin *;
        return 200 '{"m.homeserver": {"base_url": "https://绿角犀域名"}}';
    }
}

server {
    listen 80;
    server_name 绿角犀域名;
    return 301 https://$host$request_uri;
}
```

#### docker-compose.yml（完整版）

```yaml
version: '3.8'
services:
  continuwuity:
    image: continuwuity/continuwuity:v0.5.10
    container_name: continuwuity
    restart: unless-stopped
    volumes:
      - /data/continuwuity:/var/lib/continuwuity
      - ./continuwuity-config.toml:/etc/continuwuity.toml:ro
    ports:
      - "8008:8008"
    networks:
      - matrix-net

  aie-express:
    build: ./backend
    container_name: aie-express
    restart: unless-stopped
    env_file: ./backend/.env.production
    ports:
      - "3000:3000"
    volumes:
      - aie-data:/app/data
    networks:
      - matrix-net

  nginx:
    image: nginx:alpine
    container_name: aie-nginx
    restart: unless-stopped
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - ./frontend/build:/var/www/aie:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - continuwuity
      - aie-express
    networks:
      - matrix-net

networks:
  matrix-net:
    driver: bridge
volumes:
  aie-data:
```

### ⑧-3 Skin 三种路线成本对比

| 路线 | 说明 | 工作量 | 风险 | 推荐时机 |
|---|---|---|---|---|
| **A: Fork Element Web 改** | Fork element-web 仓库 → 覆盖 `_teal.pcss` CSS 变量 | 3-5 天 | 🟡 Element 升级可能有合并冲突 | **首选**，最快出可用墨玉绿 UI |
| **B: 自己写 skin** | matrix-react-sdk 是 framework，必须写全套组件 | 7-10 天 | 🔴 工作量大 | A 方案不行再上 |
| **C: 直接覆盖 Element Web CSS** | 不 fork，ChatPage V2 里直接 import 覆盖 | 1-2 天 | 🟡 Element 升级可能破 | MVP 快速上线 |

### ⑧-4 推送方案最终敲定

| 端 | 方案 | 技术栈 |
|---|---|---|
| **桌面 Electron** | Continuwuity 自带 Web Push | Service Worker + VAPID 密钥，Continuwuity 直接推 |
| **手机 Android** | 绿角犀 Express 直接调 FCM HTTP v1 API | Firebase Console 创建项目 → 拿 service account key → Express NotificationService |
| **手机 iOS** | 绿角犀 Express 直接调 APNs HTTP/2 API | Apple Developer account → .p8 key → Express NotificationService |

**不选的方案**：Sygnal（已 archived）、ntfy（需要额外 Docker 进程）、pincerbell Rust（好但 Express 自己能搞定更简单）

### ⑧-5 AI Bot 三种姿势

| 姿势 | 复杂度 | 说明 | 推荐 |
|---|---|---|---|
| **① Matrix Application Service** | 中 | `!admin appservices register` 注册 YAML，Continuwuity 直接路由 bot 消息到 Express | ✅ **Day 7 用这个** |
| **② matrix-js-sdk Node client** | 低 | Node 脚本订阅 Continuwuity | 🟡 快速原型 |
| **③ maubot Python plugin** | 低 | 官方 bot 框架，Docker 起 | 🟡 后期加功能 |

### ⑧-6 Moderation 反垃圾工具链

| 工具 | License | 说明 | 部署时机 |
|---|---|---|---|
| **Draupnir v3.2.0** | AGPL-3.0 | 自动 ban bot，共享 policy list，自动检测垃圾消息 | Day 10 |
| **MSC4284 Policy Server** | Matrix Spec 提议中 | 防火墙级消息拦截（发出前检查） | 🟡 2026 年 FOSDEM 重点 |
| **localmoderationmatrix** | PyPI CLI | 批量清理消息/媒体/贴纸 | 运营工具 |

### ⑧-7 Bridges 生态（后期增强）

| Bridge | 协议 | License | Docker 镜像 | 绿角犀价值 |
|---|---|---|---|---|
| **mautrix-whatsapp** | WhatsApp Web | AGPL-3.0 ⚠️ | dock.mau.dev/mautrix/whatsapp | 用户在绿角犀 IM 里直接收 WhatsApp |
| **mautrix-telegram** | Telegram MTProto | AGPL-3.0 | dock.mau.dev/mautrix/telegram | 同上 |
| **mautrix-signal** | Signal Protocol | AGPL-3.0 | dock.mau.dev/mautrix/signal | 同上，加密 |
| **mautrix-discord** | Discord | AGPL-3.0 | dock.mau.dev/mautrix/discord | 同上 |

⚠️ **AGPL-3.0 注意**：直接用（不改代码）没问题。改了代码必须开源。

### ⑧-8 Continuwuity 隐藏能力白嫖清单

| 能力 | 配置 | 说明 |
|---|---|---|
| **OIDC 授权委托** | Continuwuity → 绿角犀 Express OAuth2 Provider | 用户一次登录两边通，Express 不用自己签 Matrix token |
| **LiveKit 官方集成** | `continuwuity.org/calls/livekit` | 语音视频不用自己搞，Docker 一条命令起 |
| **OTLP Prometheus 监控** | `otlp_exporter = "prometheus"` | Grafana 监控连接数、消息量、缓存命中率 |
| **11 大类 Admin 命令** | `!admin appservices/users/token/oidc/rooms/federation/server/media/check/debug/query` | 运营/管理/调试全自动 |
| **在线 RocksDB 备份** | `database_backup_path` | 不用停服务，自动备份 |
| **注册 Token + 邮箱重置 + 条款同意** | config.toml 配置 | 跟绿角犀邀请好友对接 |
| **Simplified Sliding Sync** | Continuwuity 原生 | Element X 客户端直接用 |
| **MatrixRTC** | LiveKit 配合 | 语音视频通话 |

### ⑧-9 Continuwuity 明确做不到的边界

| 能力 | Continuwuity | 绿角犀需要吗 | 预案 |
|---|---|---|---|
| Federation（跨服务器互通） | ❌ | 🟡 暂时不需要 | 以后换 Synapse |
| MAS（Matrix Auth Service） | ❌ | 🟢 不需要，用 Express OIDC | — |
| Workers 横向扩展 | ❌ | 🟢 1000 用户内够 | 阿里云升级或 Synapse |
| Kubernetes Helm Chart | ❌ | 🟢 Docker 足够 | — |

---

**文档版本**：v1.1（三轮联网深度扫描增强）  
**下次更新**：Day 1 启动后补 D1 状态  
**文档位置**：`APP-AIE/05_功能特性/Continuwuity-IM升级方案.md`
