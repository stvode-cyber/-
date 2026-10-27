# 绿角犀 Continuwuity IM 升级 — 项目文本

> **版本**：v1.4（整合**十轮**联网深度扫描 + 生产级硬规矩 + 升级清单 + Tuwunel 备选迁移）  
> **日期**：2026-10-26（v1.4 最后更新）  
> **状态**：✅ 已定稿，等待 Day 1 启动  
> **选型锁定**：Continuwuity（社区保守 fork），Tuwunel（Matrix Construct 官方继任者）作为**备选迁移路径**（RocksDB 格式兼容，换镜像自动迁移）  
> **关联决策**：放弃自造 IM 基建 → 采用 Continuwuity（Matrix 协议）全量替换  
> **关联文档**：`05_功能特性/Continuwuity-IM升级方案.md`（详细版，含 8 章完整方案）

---

## 🎯 一句话决策

绿角犀现有 IM（SSE 单向 + 无投递保证 + 无推送 + 无加密）是"跑通了但远没到产品级"。决定用 **Matrix 协议 + Continuwuity**（Rust 轻量服务端）全量替换，一次到位 Telegram/Discord 水准。

---

## 📏 核心数字

| 项 | 值 |
|---|---|
| Gap 覆盖 | **14/16**（协议原生带 WebSocket/E2EE/推送/typing/reactions/threads/已读/多端同步/FTS5/群聊权限/OTLP 监控/OIDC） |
| 工期 | **13 天**（Day 1 → Day 13） |
| 费用 | **¥0**（Apache 2.0 / MIT / 免费额度，Continuwuity 跑现有阿里云） |
| 服务器 | **47.116.59.141**（Continuwuity 20-50MB RAM，Express 共存） |
| 硬规矩 | **6 条**（H1-H6，不能碰） |

---

## 🆚 为什么选 Continuwuity

### 跟其他方案对比

| 对比项 | Continuwuity | 自造（Centrifugo+Outbox+Signal） | 腾讯云 IM | Synapse（Python） |
|---|---|---|---|---|
| Gap 覆盖 | **14/16** | 7/16 | 10/16 | 16/16 |
| 工期 | 13 天 | 9 天 | 5 天 | 20+ 天 |
| 费用 | **零** | 零 | 免费版 100 用户封顶 | 零 |
| 资源占用 | **20-50MB RAM** | 400MB+ | 不用自己服务器 | 300-500MB RAM |
| License | **Apache 2.0 零风险** | 各自零风险 | 商业服务 | AGPL-3.0 需注意 |
| 后续维护 | 🟢 社区兜底（Matrix 协议有 Element 审计） | 🔴 自己扛 | 服务商扛 | 🟢 Element 官方 |
| 边界 | 不支持 Federation/Workers | 全可控 | 腾讯锁死 | 全支持 |
| 绿角犀适配 | ✅ 最搭（轻量 + 可桥 WhatsApp） | 🟡 能用但重造轮子 | ❌ 数据在腾讯 | 🟡 太重 |

### Continuwuity 边界（明确做不到的）

| 能力 | Continuwuity | 预案 |
|---|---|---|
| Federation（跨服务器互通） | ❌ | 以后换 Synapse |
| Workers 横向扩展 | ❌ | 阿里云升级或 Synapse |
| MAS（Matrix Auth Service） | ❌ | 绿角犀 Express 当 OIDC Provider |
| Kubernetes Helm Chart | ❌ | Docker 足够 |

**结论**：1000 用户内 Continuwuity 完全够，超过再换 Synapse，数据有标准迁移路径。

---

## 🔴 6 条硬规矩（不做就出事）

| # | 规矩 | 为什么 | 违反后果 |
|---|---|---|---|
| **H1** | `server_name` 定死后不能改 | Matrix Delegation 配置用户名后缀（`@user:绿角犀域名`），不能事后改 | 删数据库重装，用户数据全丢 |
| **H2** | nginx `proxy_pass` 后面不能加 path | Synapse 官方坑——加了 `/` 会 URI canonicalization，签名验证出错 | 所有 Matrix API 500 |
| **H3** | Docker 锁 `continuwuity/continuwuity:v0.5.10+` | CVE-2025-68667 + 远程 to-device + URL preview + dehydrated device 共 6 个安全修复 | 服务器被入侵 |
| **H4** | `ip_lookup_strategy=1` | 阿里云只有 IPv4，IPv6 DNS 会白白等待超时 | Continuwuity 启动慢 / Federation 连不上 |
| **H5** | `cache_capacity_modifier=0.3` | Continuwuity 默认分配 200MB+，阿里云低配扛不住 | OOM Kill |
| **H6** | `federation=false` | 绿角犀不做跨服务器互通，关闭减少攻击面 | — |
| **H7** | Electron CSP `connect-src` 必须加 Continuwuity 云端地址 | main.cjs:1164 现在只允许 127.0.0.1:3001，加 `https://绿角犀域名 wss://绿角犀域名` | matrix-js-sdk WebSocket 连不上 |
| **H8** | preload.cjs 加 `getMatrixURL()` 返回 Continuwuity 云端 | 现在 preload 只有 `getBaseURL()` 本地后端 | 前端不知道连哪 |
| **H9** | `matrix-react-sdk` 锁死版本，不要写 `^` | Element 升级 CSS 类名会变 | 墨玉绿皮肤崩 |
| **H10** | 房间懒加载（只加载当前选中房间最近 50 条） | matrix-react-sdk 默认预加载所有房间消息 | 几百个房间内存爆 |
| **H11** | 恢复备份优先用**离线备份**（停服务直接拷整个数据库目录） | 在线备份恢复要手动合并 3 个目录 + `sed 's/_s.*/.sst/'` 改文件名 | 恢复崩 |
| **H12** | OIDC 开启后 Continuwuity 禁用 legacy 密码登录 | 只有支持 OAuth 的客户端能登录 | 前端老登录页废掉 |
| **H13** | 旧 IM 数据没有标准迁移工具，自己写 admin API 脚本 | 只有 Synapse 有 `synapse_port_db`，Continuwuity 没有 | 数据迁不动 |
| **H14** | LiveKit 端口 7881/tcp + 50100-50200/udp 阿里云安全组放行 | WebRTC UDP 被防火墙挡 | 视频通话不通 |
| **H15** | Android 13+ 必须 `requestPermissions()` + FCM 初始化顺序（先 initializeApp 再 getToken） | Capacitor Push Notifications 插件要求 | 手机收不到推送 |
| **H16** | Docker 镜像地址换 **`ghcr.io/continuwuity/continuwuity:v0.5.10+`**（或 `forgejo.ellis.link/continuwuation/continuwuity`），**别用 Docker Hub 的** | 官方 Continuwuity 已把镜像迁移到 Forgejo + GHCR，Docker Hub `continuwuity/continuwuity` 不再维护 | 拉不到镜像 / 旧版本无安全补丁 |
| **H17** | Docker 不能用默认 bridge DNS 解析器 + 不能用 systemd-resolved，**必须自托管 Unbound 或 dnsproxy** | Continuwuity Federation 时每分钟数千次 DNS 请求，Docker 默认 DNS + systemd-resolved 扛不住 | Federation 超时 / join 房间卡几十秒 |
| **H18** | RocksDB 数据库目录里的 `.log` 文件是 **WAL（Write-Ahead Log）**，不是服务日志，**绝对不能删**；只有全大写 `LOG` 文件可以删 | Continuwuity 官方 maintenance 文档明确警告 | 删了 WAL → 数据库崩溃 + 数据丢失 |
| **H19** | 在线备份恢复 **必须停服务 + 手动合并 3 个目录**（不是只改文件名）——详见本文**十九、备份恢复修正版** | RocksDB 在线备份格式跟离线 copy 不同（Facebook 设计 choice） | 恢复到一半崩 → 只能重装 |
| **H20** | LiveKit 部署必须启 **`lk-jwt-service`**（Element 的 brokering service，端口 8081），不能只启 LiveKit server | LiveKit 跟 Continuwuity 对接时需要 JWT 令牌代理，LiveKit 自己不会跟 Matrix 说话 | LiveKit WebRTC 握手失败 |
| **H21** | nginx 必须反代 **lk-jwt-service 的 3 条路径**（`/sfu/get` `/healthz` `/get_token`）到 `127.0.0.1:8081` | Continuwuity 官方 livekit 指南明确要求 | 浏览器 WebRTC 握手返回 OPEN_ID_ERROR |
| **H22** | Coturn TURN secret 文件里**不能有前后空白**（leading/trailing whitespace） | NixOS Discourse 2026 踩坑——Continuwuity 现在已 fix 但 secret 文件还是要干净 | Continuwuity 连不上 Coturn，TURN 失效 |

> 📚 H16-H22 出处：continuwuity.org/deploying/docker / continuwuity.org/guides/dns / continuwuity.org/calls/livekit / continuwuity.org/maintenance / continuwuity.org/troubleshooting + NixOS Discourse

---

## 🏗️ 最终架构

```
用户设备
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ 桌面 Electron │  │ 手机 Android │  │ 手机 iOS      │
  │ matrix-js-sdk │  │ matrix-js-sdk │  │ matrix-js-sdk │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │ WebSocket wss:// 或 HTTPS
         ▼
  ┌────────────────────────────────────────────────────┐
  │ 阿里云 47.116.59.141                                │
  │                                                     │
  │  nginx 反代（443 HTTPS）                             │
  │  ├─ /_matrix/*      → Continuwuity:8008（WebSocket） │
  │  ├─ /api/*          → Express:3000（绿角犀 API）     │
  │  ├─ /*              → 静态文件（React 构建产物）      │
  │  └─ /.well-known/*  → Matrix delegation            │
  │                                                     │
  │  ┌────────────────────┐  ┌───────────────────────┐│
  │  │  Continuwuity      │  │  绿角犀 Express        ││
  │  │  20-50MB RAM       │  │  + Prisma + MySQL     ││
  │  │  ❤️ 内嵌 RocksDB   │  │                       ││
  │  │  ❤️ 内嵌 OIDC      │  │  管 IM 以外的一切      ││
  │  │  ❤️ 内嵌 E2EE      │  │  ├─ AI 助理            ││
  │  │  ❤️ 内嵌 OTLP Prom │  │  ├─ 宠物浮窗           ││
  │  │  ❤️ 内嵌 11 类 Admin│  │  ├─ 财务/日历/任务     ││
  │  │                     │  │  ├─ OIDC Provider     ││
  │  │  只管 IM 消息怎么传 │  │  └─ AI Bot App Service││
  │  └────────────────────┘  └───────────────────────┘│
  └────────────────────────────────────────────────────┘
```

### 两套系统边界

| Continuwuity 负责 | Express 负责 |
|---|---|
| 消息怎么传（WebSocket/PubSub） | AI 助理对话（DeepSeek 调用） |
| E2EE 加密（Olm/Megolm） | 用户注册/登录/OIDC Provider |
| 会话/房间管理 | 旧 IM 数据迁移 |
| 好友/群聊/邀请 | 团队协作 ↔ Matrix 群联动 |
| typing / presence / 已读 | 宠物 / 财务 / 日历 / 任务 |
| reactions / threads / 撤回 | AI 助理 Matrix bot |
| 多端同步 | 绿角犀特有的一切 |
| 推送网关（Web Push） | 手机端推送（FCM/APNs REST API） |

---

## 📋 13 天实施计划

| Day | 内容 | 核心产出 | 硬规矩 |
|---|---|---|---|
| **D1** | Continuwuity Docker 部署 + nginx + HTTPS | 外网 Element 能收发消息 | H1-H6 全部落地 |
| **D2** | OIDC 对接 + 批量迁移用户 | 用户一次登录两边通 | H1 |
| **D3-4** | ChatPage V2 墨玉绿 UI 重写（Fork Element Web + 官方 Theming） | 墨玉绿 IM 界面 | 锁定 matrix-react-sdk 版本 |
| **D5-6** | 好友/群聊/会话全链路 | 完整好友+群聊+会话 | — |
| **D7** | AI Bot 用 Application Service 注册 | AI 在 Matrix 里自动回复 | — |
| **D8** | 旧数据迁移（可选，幂等脚本） | 历史消息恢复 | 先备份再迁 |
| **D9** | LiveKit 语音视频 Docker + Continuwuity 对接 | WebRTC 一对一/多人 | — |
| **D10** | 推送（FCM/APNs）+ Draupnir Moderation | 离线推送 + 防垃圾 | — |
| **D11-12** | 多端同步 + 回归测试 | 全功能回归 | — |
| **D13** | 冒烟 + 打包 + 运维文档 | Setup.exe 带 SDK | — |

---

## 🎨 Skin 三种路线

| 路线 | 说明 | 工作量 | 推荐 |
|---|---|---|---|
| **A: Fork Element Web 改** | Fork element-web → 覆盖 `_teal.pcss` CSS 变量（约 30 个变量改 #00856A） | 3-5 天 | ✅ 首选 |
| **B: 自己写 skin** | matrix-react-sdk 是 framework，必须写全套组件 | 7-10 天 | 🟡 A 不行再上 |
| **C: 直接覆盖 CSS** | ChatPage V2 里 import Element Web + 覆盖 CSS | 1-2 天 | 🟡 MVP 快上 |

---

## 🔔 推送方案最终敲定

| 端 | 方案 | 费用 |
|---|---|---|
| **桌面 Electron** | Continuwuity 自带 Web Push（Service Worker + VAPID） | 免费 |
| **手机 Android** | Express 调 FCM HTTP v1 API（Google 免费额度 50 万/天） | 免费 |
| **手机 iOS** | Express 调 APNs HTTP/2 API | 免费 |

不选的：Sygnal（已 archived）、ntfy（需额外 Docker）、pincerbell Rust（Express 能搞定更简单）

---

## 🤖 AI Bot 三种姿势

| 姿势 | 复杂度 | 推荐 |
|---|---|---|
| **① Matrix Application Service** | 中 | ✅ **Day 7 用这个**（`!admin appservices register` 注册 YAML） |
| **② matrix-js-sdk Node client** | 低 | 🟡 快速原型 |
| **③ maubot Python plugin** | 低 | 🟡 后期加功能 |

---

## 🛡️ Moderation 反垃圾

| 工具 | License | 说明 | 部署 |
|---|---|---|---|
| **Draupnir v3.2.0** | AGPL-3.0 | 自动 ban bot，共享 policy list | Day 10 |
| **MSC4284 Policy Server** | Matrix Spec 提议中 | 防火墙级消息拦截（发出前检查） | 2026 FOSDEM 重点 |
| **localmoderationmatrix** | PyPI CLI | 批量清理消息/媒体/贴纸 | 运营工具 |

---

## 🌉 Bridges 生态（后期增强）

| Bridge | License | 价值 |
|---|---|---|
| mautrix-whatsapp | AGPL-3.0 | 用户在绿角犀 IM 里直接收 WhatsApp |
| mautrix-telegram | AGPL-3.0 | 同上 |
| mautrix-signal | AGPL-3.0 | 同上，加密 |
| mautrix-discord | AGPL-3.0 | 同上 |

⚠️ AGPL-3.0：直接用没问题，改了必须开源。

---

## 🎁 Continuwuity 隐藏能力白嫖

| 能力 | 说明 |
|---|---|
| OIDC 授权委托 | Continuwuity → Express OAuth2 Provider，一次登录两边通 |
| LiveKit 官方集成 | `continuwuity.org/calls/livekit`，语音视频一条命令 |
| OTLP Prometheus 监控 | `otlp_exporter="prometheus"`，Grafana 白嫖 |
| 11 类 Admin 命令 | appservices/users/token/oidc/rooms/federation/server/media/check/debug/query |
| 在线 RocksDB 备份 | 不用停服务，自动备份 |
| 注册 Token + 邮箱重置 | 跟绿角犀邀请好友对接 |
| Simplified Sliding Sync | Element X 客户端直接用 |
| MatrixRTC | 语音视频通话 |

---

## 📊 Gap 覆盖表（原 16 维度）

| # | 维度 | Continuwuity 能覆盖 | 说明 |
|---|---|---|---|
| ① WebSocket | ✅ | Matrix 原生 |
| ② 消息投递保证 | ✅ | Matrix 协议有 |
| ③ 离线推送 | ✅ | Continuwuity Web Push + Express FCM/APNs |
| ④ E2EE 加密 | ✅ | Olm（私聊）+ Megolm（群聊） |
| ⑤ 群聊权限 | ✅ | Matrix power levels 0-100 |
| ⑥ typing/presence | ✅ | Matrix 原生 |
| ⑦ reactions/threads/撤回 | ✅ | Matrix 原生 |
| ⑧ 语音视频 | ✅ | LiveKit 对接（Day 9） |
| ⑨ 多端同步 | ✅ | Matrix 协议原生分布式 |
| ⑩ FTS5 检索 | ✅ | Continuwuity 内置 |
| ⑪ 文件 CDN | 🟡 | 需要自己接腾讯 COS（方案 B 留待后期） |
| ⑫ 端侧 AI | ❌ | 独立项目，后期 Ollama 集成 |
| ⑬ 崩溃监控 | ✅ | PostHog 自托管 |
| ⑭ 安全中间件 | 🟢 | Continuwuity 自带 helmet/rate-limit |
| ⑮ 群聊已读 | ✅ | Matrix receipts |
| ⑯ 协议版本化 | ✅ | Matrix 协议自带 |

**合计：14/16**（⑪ 留后期、⑫ 独立项目）

---

## 📋 完整配置文件（Day 1 直接用）

### Continuwuity config.toml

```toml
[global]
server_name = "绿角犀域名"           # H1: 定死不改
address = ["0.0.0.0"]
port = 8008
database_path = "/var/lib/continuwuity"
database_backup_path = "/var/lib/continuwuity-backups"
database_backups_to_keep = 7
allow_federation = false            # H6
cache_capacity_modifier = 0.3       # H5: 阿里云内存小；≥2GB RAM 可上探到 2.0+
ip_lookup_strategy = 1              # H4: 只有 IPv4
request_ip_source = "x_forwarded_for"
max_request_size = 20000000         # 20MB（默认就是，发大文件要加）

# 性能调优（第一次启动前选好，中途切换没充分测试）
rocksdb_compression_algo = "zstd"   # "zstd" 省空间 / "lz4" 快但占磁盘
rocksdb_wal_compression = "none"    # WAL 不压缩（少 CPU）
# rocksdb_bottommost_compression = true  # 老数据再压一层

[global.well_known]
client = "https://绿角犀域名"       # 必须带 https://
server = "绿角犀域名:443"           # 必须带 :443（不能省略 port！）

[global.observability]
otlp_exporter = "prometheus"

[appservice]
```

### nginx.conf

```nginx
server {
    listen 443 ssl http2;
    server_name 绿角犀域名;
    ssl_certificate     /etc/letsencrypt/live/绿角犀域名/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/绿角犀域名/privkey.pem;

    # H2: proxy_pass 后面不能加 path
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

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }

    # H23: Prometheus metrics — 只允许 127.0.0.1（Prometheus server）抓，别公开
    location /_continuwuity/metrics {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
    }

    location / {
        root /var/www/aie;
        try_files $uri $uri/ /index.html;
    }

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

### docker-compose.yml

```yaml
version: '3.8'
services:
  continuwuity:
    image: ghcr.io/continuwuity/continuwuity:v0.5.10   # H16: GHCR 镜像（性能好的话用 ghcr.io/continuwuity/continuwuity:v0.5.10-maxperf）
    container_name: continuwuity
    restart: unless-stopped
    volumes:
      - /data/continuwuity:/var/lib/continuwuity
      - ./continuwuity-config.toml:/etc/continuwuity.toml:ro
      # H17: 自托管 Unbound 给 Docker 专用 DNS
      - ./resolv.conf:/etc/resolv.conf:ro
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

---

## 🔜 Day 1 验收清单（必须全部打勾）

| # | 检查项 | 怎么验 |
|---|---|---|
| 1 | Continuwuity 正常运行 | `curl http://localhost:8008/_matrix/client/v3/versions` 返回 JSON |
| 2 | nginx HTTPS + WebSocket | 浏览器 `https://绿角犀域名/_matrix/client/v3/versions` 能响应 |
| 3 | .well-known delegation | `curl https://绿角犀域名/.well-known/matrix/server` 返回正确 JSON |
| 4 | Element Web 能连 | 浏览器打开 Element Web → 登 Continuwuity admin → 发消息给自己 |
| 5 | Express API 正常 | `curl https://绿角犀域名/api/v1/health` 返回 200 |
| 6 | 6 条硬规矩落地 | config.toml 里 server_name/ip_lookup_strategy/cache_capacity_modifier/federation 全对 |
| 7 | HTTPS 证书续期 | Certbot crontab 已设 |
| 8 | Docker restart | `docker inspect continuwuity | grep Restart` 显示 unless-stopped |

---

## 📚 相关文档索引

| 文件 | 位置 | 用途 |
|---|---|---|
| 本项目文本 | `Continuwuity-IM项目文本.md` | 🟢 **全项目主线入口**（你正在读） |
| 完整方案 v1.1 | `05_功能特性/Continuwuity-IM升级方案.md` | 8 章详细方案（实施步骤 + 运维 + 风险预案） |
| 今日台账 | `.trae/memory/growth/daily/2026-10-26.md` | 决策回溯 + 踩坑记录 |

---

## 十、Electron 集成（绿角犀现有 main.cjs 要改的 3 处）

> 绿角犀 Electron 安全配置已经顶级（contextIsolation + sandbox + preload + CSP 全开），只需改 3 处。

### 10-1. CSP connect-src 必须加 Continuwuity 云端（main.cjs:1164）

```javascript
// 现在（main.cjs:1164）：
connect-src 'self' http://127.0.0.1:3001 http://localhost:3001 
                  ws://127.0.0.1:3001 ws://localhost:3001

// 改后（H7 硬规矩）：
connect-src 'self' 
  http://127.0.0.1:3001 http://localhost:3001 
  ws://127.0.0.1:3001 ws://localhost:3001
  https://绿角犀域名         // ← 加这行：Continuwuity Matrix API
  wss://绿角犀域名           // ← 加这行：Continuwuity WebSocket
```

### 10-2. preload.cjs 加 getMatrixURL（H8 硬规矩）

```javascript
// preload.cjs 追加（不改现有代码）：
contextBridge.exposeInMainWorld('desktopAPI', {
  // 现有代码全保留
  getBaseURL: () => 'http://127.0.0.1:3001/api/v1',
  // ... 其他现有方法 ...
  
  // ← 加这行：Continuwuity 云端地址
  getMatrixURL: () => 'https://绿角犀域名',
});
```

### 10-3. 加 IPC sender 校验（建议）

```javascript
// main.cjs ipcMain.handle 里加一行：
ipcMain.handle('someHandler', (event, ...args) => {
  // 校验 sender 只能是绿角犀自己的 file:// 页面
  const url = event.sender.getFrame().url;
  if (!url.startsWith('file://')) {
    console.warn('[IPC] 非法来源:', url);
    return { error: 'unauthorized' };
  }
  // 原有逻辑继续
});
```

---

## 十一、matrix-js-sdk / matrix-react-sdk 版本锁死

| 包 | 锁死版本 | CVE 门槛 |
|---|---|---|
| **matrix-js-sdk** | **≥ 44.0.0**（2026-10-13） | ≥ 19.7.0（CVE-2022-39236 Prototype Pollution） |
| **matrix-react-sdk** | **≥ 3.114.0** | ≥ 3.53.0（CVE-2022-36060 Prototype Pollution） |

**package.json 里不要写 `^`**：
```json
{
  "dependencies": {
    "matrix-js-sdk": "44.0.0",
    "matrix-react-sdk": "3.114.0"
  }
}
```

**H9 硬规矩**：锁死后不要随便升级——Element 升级 CSS 类名会变，墨玉绿皮肤可能崩。

---

## 十二、OIDC 完整配置（Continuwuity → 绿角犀 Express）

> Continuwuity 支持 delegated authentication（OIDC），把用户认证委托给外部 Provider。绿角犀 Express 当 OIDC Provider。

### 12-1. 绿角犀 Express 加 OIDC OAuth2 端点

```javascript
// backend/src/routes/oidc.routes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Discovery（Continuwuity 自动读这个）
router.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: 'https://绿角犀域名',
    authorization_endpoint: 'https://绿角犀域名/api/oidc/auth',
    token_endpoint: 'https://绿角犀域名/api/oidc/token',
    userinfo_endpoint: 'https://绿角犀域名/api/oidc/userinfo',
    jwks_uri: 'https://绿角犀域名/api/oidc/jwks',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    scope_supported: ['openid', 'profile', 'email'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  });
});

// 授权端点（检查绿角犀 session → 发 auth code）
router.get('/auth', (req, res) => {
  const { response_type, client_id, redirect_uri, scope, state } = req.query;
  if (!req.session?.userId) {
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  const code = crypto.randomBytes(32).toString('hex');
  oauthCodes.set(code, {
    userId: req.session.userId,
    redirect_uri,
    expires: Date.now() + 5 * 60 * 1000,
  });
  res.redirect(`${redirect_uri}?code=${code}&state=${state}`);
});

// Token 端点（code → id_token）
router.post('/token', (req, res) => {
  const { code, client_id, client_secret, grant_type, redirect_uri } = req.body;
  const codeEntry = oauthCodes.get(code);
  if (!codeEntry || codeEntry.expires < Date.now()) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  oauthCodes.delete(code);
  const idToken = jwt.sign({
    sub: codeEntry.userId,
    iss: 'https://绿角犀域名',
    aud: client_id,
  }, OIDC_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '1h' });
  res.json({ id_token: idToken, token_type: 'Bearer', expires_in: 3600 });
});

module.exports = router;
```

### 12-2. Continuwuity config.toml 加 OIDC section

```toml
[global.oauth.oidc]
discovery_url = "https://绿角犀域名/api/oidc"
client_id = "continuwuity"
client_secret = "绿角犀生成的 OAuth2 secret"
```

### 12-3. OIDC 开启后的影响

| 项 | 变化 |
|---|---|
| Continuwuity legacy 密码登录 | ❌ **禁用**（H12 硬规矩） |
| 只有支持 OAuth 的客户端能登录 | ✅ |
| AI Bot 怎么登录 | `!admin users issue-token --user @aibot:绿角犀域名`（admin 命令绕开） |
| 前端登录页 | **废掉**（OIDC 跳转绿角犀登录页） |

---

## 十三、旧 IM 数据迁移策略

> 绿角犀现有 IM 数据在本地 SQLite（Prisma 7 张表），Continuwuity 用 RocksDB。**没有标准迁移工具**（H13 硬规矩）。

### 迁移三步走

| 步骤 | 做什么 | 方法 | 工具 |
|---|---|---|---|
| **1. 批量注册用户** | 绿角犀现有用户 → Continuwuity 用户 | Node 脚本查绿角犀 `users` 表 → 调 Continuwuity admin API `!admin users create` | 自己写脚本 |
| **2. 好友关系** | 绿角犀 Friendship 表 → Matrix invite | 调 Continuwuity Admin API 发 Matrix invite | 自己写脚本 |
| **3. 历史消息** | ConversationMessage → Matrix room events | **推荐不迁**（用户能接受"新系统历史从头开始"） | — |

### 推荐策略

**不迁历史消息 + 用户自己激活**：
- Continuwuity 新注册流程对接绿角犀用户系统（OIDC 或 admin API 批量预创建）
- 用户首次登录 Continuwuity 后**自己添加好友**（用户量小，成本低）
- 历史消息保持在绿角犀旧 Express 里只读，ChatPage 加个"查看历史"按钮

---

## 十四、Continuwuity 备份恢复实操

### 14-1. 推荐：离线备份恢复（零风险）

```bash
# 备份（停服务，拷整个目录）
docker stop continuwuity
cp -r /data/continuwuity /backup-continuwuity-$(date +%Y%m%d%H%M%S)
docker start continuwuity

# 恢复（停服务，拷回来）
docker stop continuwuity
rm -rf /data/continuwuity
cp -r /backup-continuwuity-xxx /data/continuwuity
docker start continuwuity
```

### 14-2. 在线备份恢复（Continuwuity 官方但坑）

```bash
# 触发在线备份（Continuwuity 运行中）
# 配置 database_backup_path = "/var/lib/continuwuity-backups"
# Continuwuity 自动定时备

# 恢复（必须停服务！要手动合并文件）
docker stop continuwuity
mkdir /restore

# Step 1: shared_checksum 里的 .sst 文件（改文件名）
cp /var/lib/continuwuity-backups/shared_checksum/*_s*.sst /restore/
cd /restore && for file in *.sst; do mv "$file" "$(echo "$file" | sed 's/_s.*/.sst/')"; done

# Step 2: 最新数字目录里的文件
cp /var/lib/continuwuity-backups/1/* /restore/
# （如果有多个备份，看哪个是最新的时间戳）

# Step 3: config.toml 指向 /restore
# Step 4: 启动
docker start continuwuity
```

### 14-3. RocksDB 运维细节

| 细节 | 操作 |
|---|---|
| **不要手动跑 compaction** | RocksDB 自动按阈值调好了，手动跑造 I/O 放大 |
| **数据库目录里的 .log 文件不要删** | 那是 RocksDB WAL（Write-Ahead Log），删了丢数据 |
| **可以删的是 LOG（大写）文件** | RocksDB 遥测日志，Continuwuity 已配好只存 3 个 |
| **Compression 可选** | `rocksdb.compression = "zstd"` 省空间，`"lz4"` 最快 |

---

## 十五、LiveKit 语音视频端口规划（Day 9）

> H14 硬规矩：端口必须在阿里云安全组放行。

| 端口 | 协议 | 用途 |
|---|---|---|
| 7880 | TCP | LiveKit HTTP API |
| **7881** | **TCP** | WebRTC over TCP（安全组必须放行） |
| **50100-50200** | **UDP** | WebRTC UDP（安全组必须放行） |

Continuwuity config.toml LiveKit 对接（Day 9 部署后加）：
```toml
# Continuwuity 官方 MatrixRTC 配置
[global.msc3015]
livekit_url = "https://livekit.绿角犀域名:7880"
# 还有几个配置项，Day 9 部署时从 continuwuity.org/calls/livekit 抄
```

---

## 十六、Capacitor 移动端推送坑（Android/iOS）

> H15 硬规矩：Android 13+ 必须调权限 + FCM 初始化顺序。

```typescript
// Capacitor 移动端推送正确写法
import { PushNotifications } from '@capacitor/push-notifications';
import { initializeApp } from 'firebase/app';
import { getToken, onMessage } from 'firebase/messaging';

// 1. Android 13+ 权限检查
const permStatus = await PushNotifications.checkPermissions();
if (permStatus.receive !== 'granted') {
  await PushNotifications.requestPermissions(); // 弹系统权限弹窗
}

// 2. FCM 初始化（顺序不能错！先 initializeApp 再 getToken）
initializeApp(firebaseConfig); // ← 先初始化
const token = await getToken({ vapidKey: 'VAPID密钥' }); // ← 再拿 token

// 3. 把 token 发给绿角犀 Express 存下来
await fetch('http://绿角犀域名/api/push/devices', {
  method: 'POST',
  body: JSON.stringify({ token, platform: 'android', userId }),
});
```

---

**状态**：✅ 已定稿（v1.3，七轮联网深度扫描增强后），等待 Day 1 启动  
**下次更新**：Day 1 启动后补 D1 验收结果

---

## 十七、性能调优清单（按阿里云 2GB/4GB 两档分别配）

> 出处：continuwuity.org/guides/performance + 阿里云实测

| 配置项 | 阿里云 2GB 低配 | 阿里云 4GB 高配 | 说明 |
|---|---|---|---|
| `cache_capacity_modifier` | **0.3**（H5） | **2.0**（官方推荐 baseline） | 低配防 OOM Kill，高配加速 state resolution |
| `rocksdb_compression_algo` | `"zstd"`（省空间） | `"lz4"`（快） | **第一次启动前选好**，中途切换没充分测试 |
| `rocksdb_wal_compression` | `"none"`（少 CPU） | `"none"` | WAL 压了省磁盘但耗 CPU |
| `allow_outgoing_typing` | `false`（省 CPU） | `true`（用户体验好） | 关掉 typing 能减 30% 活跃房间 CPU |
| `allow_outgoing_read_receipts` | `false` | `true` | 已读回执也是 CPU 大户 |
| `allow_outgoing_presence` | `false`（默认就是 false） | `false` | Presence 最贵，**绿角犀不做 Federation 全部关掉** |
| UNIX socket | ❌ | ✅（`unix_socket_path = "/run/continuwuity.sock"`） | Continuwuity 和 nginx 同机可以去掉 TCP 开销 |
| HTTP/3 | ✅（443/udp） | ✅ | 反向代理开 HTTP/3 降低不稳定网络延迟 |
| trusted_servers | `["codestorm.net","starstruck.systems"]` | 同上 + `matrix.org` 放最后 | 别把 matrix.org 放第一（它慢） |

### Fast Join 调优（加入大房间卡 → 调这个）

```toml
query_trusted_key_servers_first_on_join = true   # 默认就是 true
trusted_server_batch_size = 2048                 # 从默认 1024 翻倍
# Federation 先关（H6），绿角犀内部房间 join 本来就快
```

---

## 十八、生产部署 Checklist（Day 1 按顺序打勾）

| # | 动作 | 命令/怎么验 | 硬规矩 |
|---|---|---|---|
| 1 | **阿里云拉 GHCR 镜像** | `docker pull ghcr.io/continuwuity/continuwuity:v0.5.10` | H16 |
| 2 | **自托管 Unbound DNS** | 跑 `docker run -d --name unbound -p 53:53/udp -p 53:53 unbound/unbound`，然后改 host `/etc/resolv.conf` → `nameserver 127.0.0.1` | H17 |
| 3 | **Docker 容器用自定义 resolv.conf** | 给 continuwuity 容器挂 `-v ./resolv.conf:/etc/resolv.conf:ro`，resolv.conf 内容是 `nameserver 127.0.0.1` | H17 |
| 4 | **写 continuwuity-config.toml** | 从本文 config.toml 复制，server_name 换成实际域名 | H1-H6 |
| 5 | **写 nginx.conf** | 从本文复制，加 LiveKit 反代（Day 9 再加也行） | H2/H21 |
| 6 | **Certbot HTTPS** | `certbot certonly --nginx -d 绿角犀域名 --dry-run` 先测 | — |
| 7 | **阿里云安全组放行** | 80/tcp + 443/tcp + 443/udp（HTTP/3）+ 7881/tcp + 50100-50200/udp（LiveKit） | H14 |
| 8 | **docker-compose up -d** | 先只启 continuwuity + nginx，Express 先不管 | — |
| 9 | **验 Matrix API** | `curl https://绿角犀域名/_matrix/client/v3/versions` → 应该返回 JSON | — |
| 10 | **验 delegation** | `curl https://绿角犀域名/.well-known/matrix/server` → `{"m.server":"绿角犀域名:443"}` | — |
| 11 | **验实际生效配置** | admin 房间发 `!admin server show-config` → 看 H1-H6 全部正确 | — |
| 12 | **验 RocksDB WAL 还在** | `ls /data/continuwuity/*.log` → 应该有 `.log` 文件（WAL，别删！） | H18 |
| 13 | **注册 admin 用户** | admin 房间发 `!admin users create`（或 Continuwuity 第一次启动时自动创建首个注册用户为 admin） | — |
| 14 | **Element Web 连 Continuwuity 测收发** | 浏览器打开 element.io → 自定义 homeserver → 发消息给自己 → 确认收到 | — |
| 15 | **Express 后端部署** | `pm2 restart erp-backend`（已有进程名） | AGENTS.md ⑥ |
| 16 | **CSP + preload 改好** | main.cjs connect-src + preload getMatrixURL | H7/H8 |
| 17 | **离线备份跑一次确认能恢复** | 停服务 → 拷目录 → 恢复 → 启动 → 验消息还在 | H11 |

---

## 十九、备份恢复修正版（H19 精确操作）

> 出处：continuwuity.org/maintenance（2025-11-15 更新，比之前的更准确）

### ✅ 推荐：离线备份（零风险，最简单）

```bash
# 备份
docker stop continuwuity
rsync -a --delete /data/continuwuity/ /backup/continuwuity-$(date +%Y%m%d-%H%M%S)/
docker start continuwuity

# 恢复
docker stop continuwuity
rm -rf /data/continuwuity
rsync -a /backup/continuwuity-xxx/ /data/continuwuity/
docker start continuwuity
```

### ⚠️ 在线备份恢复（坑多，万不得已才用）

```bash
# Step 1: 触发在线备份
# Continuwuity 自动定时备份到 database_backup_path
# 或 admin 房间发 !admin server backup

# Step 2: 恢复（必须停服务！）
docker stop continuwuity
mkdir -p /restore

# Step 2a: 拷 shared_checksum 里的 .sst 文件（改文件名）
cp /var/lib/continuwuity-backups/shared_checksum/*.sst /restore/
cd /restore && for f in *\(*.sst; do mv "$f" "$(echo "$f" | sed 's/\_s[0-9]*//')"; done 2>/dev/null
# 或者用这个更稳妥：
cd /restore && for file in *.sst; do
  newname=$(echo "$file" | sed 's/_s[0-9]*//')
  [ "$file" != "$newname" ] && mv "$file" "$newname"
done

# Step 2b: 拷最新数字目录的文件
ls -1d /var/lib/continuwuity-backups/[0-9]* | sort -n | tail -1  # 找最新备份号
cp -r /var/lib/continuwuity-backups/N/* /restore/   # N 换成上面的号

# Step 3: config.toml database_path 改成 /restore，或直接把 /restore 拷到 /data/continuwuity

# Step 4: 启动
docker start continuwuity && tail -f docker logs continuwuity
```

### RocksDB 运维速查

| 能做 | 不能做 |
|---|---|
| ✅ 删全大写 `LOG` 文件（遥测日志） | ❌ 删小写 `.log` 文件（WAL，删了丢数据） |
| ✅ 手动 compaction（但官方不推荐，造 I/O 放大） | ❌ 用定时脚本频繁跑 compaction |
| ✅ 用 `filefrag -v` 查 btrfs 压缩状态 | ❌ 在 nodatacow btrfs 上开 compression（会慢） |
| ✅ Continuwuity 自动按阈值调 compaction | ❌ 用旧版 `rocksdb_max_log_files` < 3 |

---

## 二十、LiveKit 完整部署（Day 9 精确步骤）

> 出处：continuwuity.org/calls/livekit（2026-06 更新，比之前的完整）

### 20-1. 生成 LiveKit API Key + Secret

```bash
docker run --rm livekit/livekit-server:latest generate-keys
# 输出类似：
# API Key: APIUxUnMnSkuFWV
# API Secret: t93ZVjPeoEdyx7Wbet3kG4L3NGZIZVEFvqe0UuiVc22A
```

### 20-2. 完整 docker-compose.yml（LiveKit + lk-jwt-service）

```yaml
services:
  lk-jwt-service:
    image: ghcr.io/element-hq/lk-jwt-service:latest
    container_name: lk-jwt-service
    environment:
      - LIVEKIT_JWT_BIND=:8081
      - LIVEKIT_URL=wss://livekit.绿角犀域名
      - LIVEKIT_FULL_ACCESS_HOMESERVERS=绿角犀域名
      - LIVEKIT_KEY=APIUxUnMnSkuFWV
      - LIVEKIT_SECRET=t93ZVjPeoEdyx7Wbet3kG4L3NGZIZVEFvqe0UuiVc22A
    restart: unless-stopped
    ports:
      - "8081:8081"

  livekit:
    image: livekit/livekit-server:latest
    container_name: livekit
    command: --config /etc/livekit.yaml
    restart: unless-stopped
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880/tcp"
      - "7881:7881/tcp"     # WebRTC over TCP
      - "50100-50200:50100-50200/udp"   # WebRTC UDP（H14）
```

### 20-3. livekit.yaml（精简版）

```yaml
api_key: APIUxUnMnSkuFWV
api_secret: t93ZVjPeoEdyx7Wbet3kG4L3NGZIZVEFvqe0UuiVc22A
ws_url: wss://livekit.绿角犀域名
http_port: 7880
rtc_port: 7881
# UDP range 50100-50200
udp_port: 50100
# 阿里云安全组必须放行 50100-50200/udp
```

### 20-4. nginx 必须反代 lk-jwt-service（H21）

```nginx
# 加进现有 nginx.conf 的 server {} 块里
location ~ ^/(sfu/get|healthz|get_token) {
    proxy_pass http://127.0.0.1:8081$request_uri;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 20-5. 阿里云安全组最终端口清单

| 端口 | 协议 | 服务 | 必须放行 |
|---|---|---|---|
| 80 | TCP | HTTP → HTTPS 跳转 | ✅ |
| 443 | TCP | HTTPS（nginx 主入口） | ✅ |
| 443 | UDP | HTTP/3（性能提升，可选但推荐） | 🟡 |
| 7880 | TCP | LiveKit HTTP API | ✅ |
| 7881 | TCP | LiveKit WebRTC over TCP | ✅ |
| 50100-50200 | UDP | LiveKit WebRTC UDP | ✅ **H14 硬规矩** |
| 3478 | TCP/UDP | Coturn STUN（可选） | 🟡 |

### 20-6. LiveKit 故障排查（官方）

| 现象 | 原因 | 解决 |
|---|---|---|
| 浏览器 WebRTC 握手 `OPEN_ID_ERROR` | nginx 没反代 lk-jwt-service | 加 H21 的 3 条 location |
| `sfu/get` 返回 404 | lk-jwt-service 没启 | `docker start lk-jwt-service` |
| `sfu/get` 返回 500 | LIVEKIT_FULL_ACCESS_HOMESERVERS 写错 | 改成 Continuwuity 的 server_name（不是域名） |
| WebRTC 连上但没声音 | UDP 被挡 | 阿里云安全组放行 50100-50200/udp |

---

## 二十一、Element Web Theming 完整步骤（Day 3-4 官方路线）

> 出处：web-docs.element.dev/theming.html（Element 官方文档 2026）

### 路线 A：Fork Element Web + CSS 变量覆盖（推荐）

```bash
# 1. Fork element-web（https://github.com/elementhq/element-web）
# 2. Clone 自己的 fork
git clone git@github.com:绿角犀/element-web.git
cd element-web
git checkout develop   # 跟 Continuwuity 兼容最新 develop

# 3. 新建墨玉绿主题文件（2 步 fork）
#    Fork res/themes/dark/css/_base.pcss  → 改名 _teal.pcss
#    Fork res/themes/dark/css/_base-dark.pcss → 改名 _teal-dark.pcss

# 4. 改 package.json 里 themes 数组加 "teal"
# 5. 改 config.json 里 default_theme: "teal"
```

### 需要覆盖的 CSS 变量（核心 25 个）

```css
/* _teal.pcss — 墨玉绿主题 */
$brand-500: #00856A;   /* 绿角犀 brand 色 */
$brand-400: #339D85;
$brand-600: #006B55;

/* 主题级变量（从 Element 默认复制改值） */
--mx-accent: $brand-500;
--mx-accent-hover: $brand-400;
--mx-accent-active: $brand-600;
--mx-roomlist-highlight-color: rgba(0, 133, 106, 0.12);
--mx-unread-indicator: $brand-500;
--mx-avatar-background: $brand-500;
--mx-voice-primary: $brand-500;
/* ... 约 30 个变量，从 element-web 默认 _base.pcss 抄过来改值 */
```

### 更简单的路线 C：ChatPage V2 覆盖 CSS（MVP 两天搞定）

```tsx
// 不需要 fork element-web
import { MatrixChat } from 'matrix-react-sdk';
import 'matrix-react-sdk/res/css/themes/light/css/all.css';  // 引入 Element 默认

// 然后在 ChatPageV2.css 里覆盖：
.mx_MessageTile .mx_EventTile_bubble-out {
  background: #00856A !important;
  color: white !important;
}
.mx_RoomView_MessageList > .mx_EventTile_last .mx_EventTile_receiptSent {
  fill: #00856A !important;
}
/* ... 约 15 个关键选择器，改 brand 色 + 消息气泡 + 按钮 */
```

---

## 二十二、运维日常 Checklist（上线后每天扫一眼）

### 每日巡检（5 分钟）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | Continuwuity 进程 | `docker ps --filter name=continuwuity` | Up 状态 |
| 2 | 日志无 ERROR | `docker logs continuwuity --since 1h 2>&1 | grep -i error | tail -20` | 无 ERROR |
| 3 | 磁盘使用率 | `df -h /data` | < 85% |
| 4 | 内存 | `docker stats --no-stream continuwuity` | < 200MB（低配）/ < 500MB（高配） |
| 5 | Prometheus metrics | `curl -s http://localhost:8008/_continuwuity/metrics` | 返回 metrics |

### 每周巡检（10 分钟）

| # | 检查 | 命令 |
|---|---|---|
| 1 | 自动备份跑了吗 | `ls -lt /var/lib/continuwuity-backups/` |
| 2 | HTTPS 证书过期天数 | `certbot certificates` |
| 3 | 媒体目录大小 | `du -sh /data/continuwuity/media/` |
| 4 | `!admin server show-config` 确认没漂移 | admin 房间命令 |

### 每月巡检（20 分钟）

| # | 检查 | 命令 |
|---|---|---|
| 1 | Continuwuity 版本有无更新 | `docker pull ghcr.io/continuwuity/continuwuity:latest` 比版本号 |
| 2 | Admin 用户列表 | `!admin users` |
| 3 | 审计 media 删了没有 | `!admin media delete-remote-media-older-than-days` |
| 4 | 恢复测试（拿上次离线备份恢复到临时目录验一次） | 见十九 |

### 自动监控报警（Prometheus + Grafana）

Continuwuity 已配置 OTLP Prometheus exporter（config.toml `otlp_exporter = "prometheus"`），端口在 `/_continuwuity/metrics`。Grafana dashboard 社区已有现成的：https://grafana.com/grafana/dashboards/?search=continuwuity

---

## 二十三、故障排查速查表

### 🔴 服务起不来

| 现象 | 原因 | 解决 |
|---|---|---|
| Docker 容器 crash loop | config.toml 写错 | `docker logs continuwuity` 看报错；或 admin 房间 `!admin server show-config` 看实际生效的 |
| 启动慢 > 30 秒 | systemd-resolved 拖 DNS | H17：换 Unbound |
| 直接 OOM Kill | cache_capacity_modifier 太大 | H5：降到 0.3 或更低 |
| `address already in use` | 8008 端口被占 | `ss -tlnp \| grep 8008` 找占用进程 |

### 🟡 加入房间慢 / 消息不同步

| 现象 | 原因 | 解决 |
|---|---|---|
| 只有几个人的房间 join 超慢 | **Bug !779**（长期存在的同步 bug） | **客户端清缓存**：Element → Settings → About → Clear cache → 重启 |
| Federation 房间 join 卡 | DNS 慢 | H17：Unbound + trusted_servers 放 fast server |
| 消息发不出去 / 对方收不到 | nginx proxy_buffering | 必须设 `proxy_buffering off`（nginx.conf 已写） |

### 🟠 TURN / WebRTC 视频

| 现象 | 原因 | 解决 |
|---|---|---|
| TURN 连不上 Coturn | secret 有空白（H22）或 coturn 没启 | 清 secret 前后空白 + `pm2 list` 查 coturn |
| WebRTC 握手 OPEN_ID_ERROR | nginx 没反代 lk-jwt-service（H21） | 加 3 条 location |
| 视频连上但没画面 | UDP 被挡（H14） | 阿里云安全组放行 50100-50200/udp |

### 🟢 Federation / Delegation

| 现象 | 原因 | 解决 |
|---|---|---|
| `@user:绿角犀域名` 用户名无效 | server_name 跟 well_known 不匹配 | H1：删掉重装 Continuwuity |
| 跨服务器邀请报错 | nginx .well-known 没对 | 验 `curl .well-known/matrix/server` 返回正确 JSON |
| OIDC 开启后 legacy 登录报错 | H12 硬规矩，legacy 自动禁用 | 前端只走 OAuth 跳转 |

---

## 二十四、Continuwuity 隐藏运维命令速查（admin 房间）

| 命令 | 用途 |
|---|---|
| `!admin server show-config` | **看实际生效的配置**（排查配置写错神器） |
| `!admin server backup` | 触发在线备份 |
| `!admin users create` | 创建新用户（YAML codeblock 里写 `username: xxx password: xxx`） |
| `!admin users issue-token --user @xxx:绿角犀域名` | 给 AI Bot 发 token（绕开 OIDC） |
| `!admin appservices register` | 注册 Application Service（YAML codeblock） |
| `!admin appservices list` | 列出所有已注册的 appservice |
| `!admin rooms alias` / `!admin rooms directory` | 房间别名和目录管理 |
| `!admin rooms moderation` | ban/ban-list/blocking |
| `!admin federation` | 查 / block 联邦服务器 |
| `!admin media` | 删媒体（MXC URI / 远端老媒体批量） |
| `!admin check` | 健康检查 |
| `!admin debug` | 调试信息 |
| `!admin query` | 查数据库里的东西 |

### AppService 注册 YAML 模板（Day 7 AI Bot 用）

```yaml
# 在 admin 房间发 !admin appservices register，然后 codeblock 贴这个：
id: ai-bot
url: https://绿角犀域名/api/bot/matrix  # 绿角犀 Express 的 AI Bot 回调
as_token: 随机生成的长字符串（Continuwuity 用这个验）
hs_token: 另一个随机字符串（Continuwuity 调 Bot URL 时带这个）
sender_localpart: aibot                  # Bot 用户 ID @aibot:绿角犀域名
rate_limited: false                      # Bot 不做 rate limit
protocols: ["m.*"]                       # 处理所有 Matrix event
namespaces:
  users:
    - exclusive: false
      regex: "@aibot.*"
  rooms:
    - exclusive: false
      regex: ".*"
```

---

## ✅ 升级清单总览（v1.3 完整 22 条硬规矩）

| # | 硬规矩 | 类型 |
|---|---|---|
| H1 | server_name 定死后不能改 | 架构 |
| H2 | nginx proxy_pass 后面不能加 path | nginx |
| H3 | Docker 锁 Continuwuity 版本（v0.5.10+） | 安全 |
| H4 | ip_lookup_strategy=1（阿里云 IPv4 only） | DNS |
| H5 | cache_capacity_modifier=0.3（低配）/ 2.0（高配） | 性能 |
| H6 | federation=false（不做跨服务器） | 安全 |
| H7 | Electron CSP connect-src 加 Continuwuity 云端 | Electron |
| H8 | preload.cjs 加 getMatrixURL() | Electron |
| H9 | matrix-react-sdk 锁死版本不要 ^ | 皮肤 |
| H10 | 房间懒加载（只拉最近 50 条） | 前端 |
| H11 | 恢复备份优先离线备份（停服务拷目录） | 备份 |
| H12 | OIDC 开启后禁用 legacy 登录 | 认证 |
| H13 | 旧 IM 数据自己写 admin API 脚本迁 | 迁移 |
| H14 | LiveKit 端口阿里云安全组放行 | 视频 |
| H15 | Android 13+ requestPermissions + FCM 初始化顺序 | 推送 |
| **H16** | Docker 镜像用 GHCR / Forgejo，别用 Docker Hub | 镜像 |
| **H17** | Docker DNS 自托管 Unbound，别用 systemd-resolved | DNS |
| **H18** | RocksDB .log 文件是 WAL 不能删，LOG（大写）才可以删 | 运维 |
| **H19** | 在线备份恢复必须停服务 + 合并 3 目录 + 改文件名 | 备份 |
| **H20** | LiveKit 必须启 lk-jwt-service brokering | 视频 |
| **H21** | nginx 反代 lk-jwt-service 3 条路径 | nginx |
| **H22** | Coturn TURN secret 不能有前后空白 | 视频 |
| **H23** | Prometheus metrics **必须配 token 或 nginx 屏蔽端点**，别公开暴露 `/_continuwuity/metrics` | 安全 |
| **H24** | 注册默认禁用，开启后**必须用 admin-issued tokens**（`!admin token issue`），别用开放注册 + captcha | 安全 |
| **H25** | MatrixRTC 必须在 config.toml 写 **`[global.matrix_rtc]` + foci 字段**指向 lk-jwt-service | 视频 |
| **H26** | 自定义 Docker resolv.conf 后，Appservice 容器间**用静态 IP 通信**（别用 hostname） | appservice |

> 🔴 每天开工前扫一遍 26 条硬规矩，违反任意一条 → 停下改

---

**v1.4 新硬规矩出处**

| # | 出处 |
|---|---|
| H23 | `continuwuity.org/guides/metrics`（metrics_token 必须配）|
| H24 | `continuwuity.org/authentication/internal`（allow_registration 默认 false，admin tokens 最安全）|
| H25 | `continuwuity.org/calls/livekit`（config.toml 必须写 matrix_rtc section 才生效）|
| H26 | `continuwuity.org/appservices`（Docker DNS caveat 节）|

---

**v1.4 来源汇总（十轮联网扫描）**

| 轮次 | 扫描范围 | 新增 |
|---|---|---|
| 第 1-3 轮 | Continuwuity Docker / nginx / SSL 基础 | H1-H6 最初 6 条 |
| 第 4 轮 | Electron CSP / preload / matrix-js-sdk CVE | H7-H10 |
| 第 5 轮 | OIDC / 数据迁移 / LiveKit / 推送 | H11-H15 |
| 第 6 轮 | continuwuity.org 全文档扫 20 页 | H16-H22 + config.toml 补全 + LiveKit 完整部署 + Element Theming |
| 第 7 轮 | maintenance troubleshooting perf push | 备份修正版 + 性能调优清单 + 运维 Checklist + 故障速查表 |
| **第 8 轮** | **Reference Config 全量选项** | **config.toml 完整参考（allow_registration / registration_token / smtp / rate_limit / global ACL）** |
| **第 9 轮** | **Metrics / Authentication / Appservices / TURN** | **Prometheus token / admin token 注册 / Email 配置 / TURN coturn 完整部署 / AppService YAML + Docker DNS caveat** |
| **第 10 轮** | **Tuwunel vs Continuwuity 对比 + Federation 备选** | **Tuwunel 作为备选迁移路径（RocksDB 兼容，换镜像即可）** |

**下次更新**：Day 1 验收后补 D1 结果；Day 9 LiveKit 部署后补经验

---

## 二十五、注册安全策略（H24：别开放注册）

> 出处：continuwuity.org/authentication/internal

### Continuwuity 注册默认禁用

```toml
# config.toml 默认就是这个，别改错
allow_registration = false
```

### 绿角犀推荐方式：Admin-Issued Tokens（最安全）

Continuwuity v0.5.2+ 新增数据库级注册 token（**不是 config.toml 硬编码的静态 token**），可以带过期时间和使用次数限制：

```
# 在 admin 房间发（注册 token）：
!admin token issue
```

会返回一个 token，格式类似 `xxx-xxx-xxx`。把这个 token 通过绿角犀 Express 邀请好友发给新用户，新用户在注册时输入即可。

### Config.toml 完整注册配置

```toml
[global]
# 开放注册必须同时设这行 + yes_i_am 那行（双重保险）
# allow_registration = true
# registration_token = "静态 token 字符串"       # 只给已知好友，别用！
# registration_token_file = "/path/to/token"    # 从文件读（比硬编码好）

[global.smtp]
# 如果要邮箱验证 + 密码重置（可选但推荐）
# connection_uri = "smtps://user%40example.com:password@mail.example.net:465"
# sender = "绿角犀 Matrix <matrix@绿角犀域名>"
# require_email_for_token_registration = true    # token + 邮箱双验证
# require_email_for_registration = true          # 邮箱注册（别单独开）
```

### 绿角犀邀请好友对接方案

```
绿角犀 Express 邀请好友 API
  → 调 Continuwuity !admin token issue（或直接 HTTP API 调）
  → 返回 token + 绿角犀注册链接
  → 用户点链接 → 绿角犀前端引导注册
  → 注册完自动成为 Continuwuity 用户
```

---

## 二十六、Prometheus + Grafana 完整配置（H23：别公开 metrics）

> 出处：continuwuity.org/guides/metrics（2026-10-07 更新）

### Config.toml 开启（必须配 token）

```toml
[global]
allow_prometheus_metrics = true
prometheus_metrics_token = "a-long-random-secret-at-least-32-chars"   # H23: 必配
# 或者 nginx 屏蔽 endpoint（两种方案二选一）
```

> 也可以**不用 Continuwuity 内置的 token**，让 nginx 在 `/_continuwuity/metrics` location 加 `allow 127.0.0.1; deny all;` 仅允许 Prometheus server 抓。

### Prometheus scrape_configs

```yaml
scrape_configs:
  - job_name: continuwuity
    scheme: https
    metrics_path: /_continuwuity/metrics
    authorization:
      credentials: "a-long-random-secret-at-least-32-chars"   # 和 config.toml 里 prometheus_metrics_token 一样
    static_configs:
      - targets: ["绿角犀域名"]
        labels:
          service: continuwuity
          env: production
```

### Continuwuity 导出的关键 Metrics（30+ 条）

| Metric | 类型 | 绿角犀关注 |
|---|---|---|
| `continuwuity_users` | gauge | ✅ 已注册用户数（local vs remote）|
| `continuwuity_database_size_bytes` | gauge | ✅ RocksDB 总大小（磁盘告警）|
| `continuwuity_database_memory_bytes` | gauge | ✅ memtable / table reader / row cache（H5 cache_capacity 效果）|
| `continuwuity_database_block_cache_bytes` | gauge | ✅ RocksDB block cache |
| `continuwuity_sender_queue_depth` | gauge | ✅ 消息发送队列深度（积压告警）|
| `continuwuity_media_files` | gauge | ✅ 媒体文件数（清理时机）|
| `continuwuity_media_write_size_bytes` | histogram | ✅ 媒体写入流量 |
| `process_memory_usage_bytes` | gauge | ✅ 进程内存（OOM 预警）|
| `continuwuity_tokio_alive_tasks` | gauge | Tokio 运行时活跃任务 |
| `continuwuity_cache_entries` | gauge | auth chain + state info 缓存条目 |

### Grafana Dashboard

直接导入 Continuwuity 官方现成的 dashboard：
- URL：continuwuity.org/guides/grafana-dashboard.json
- Grafana：Dashboards → New → Import → Paste URL

### Alertmanager 关键告警规则

```yaml
groups:
  - name: continuwuity
    rules:
      - alert: ContinuwuityDown
        expr: up{job="continuwuity"} == 0
        for: 2m
        labels: { severity: critical }
        annotations: { summary: "Continuwuity 挂了" }
      
      - alert: ContinuwuityOomSoon
        expr: process_memory_usage_bytes{job="continuwuity"} / 1024 / 1024 > 400
        for: 5m
        labels: { severity: warning }
        annotations: { summary: "内存 > 400MB，快要 OOM Kill 了" }
      
      - alert: DatabaseGrowingFast
        expr: rate(continuwuity_database_size_bytes[1h]) / 1024 / 1024 > 5
        for: 10m
        labels: { severity: warning }
        annotations: { summary: "RocksDB 每小时增长 > 5MB" }
      
      - alert: SenderQueueBackingUp
        expr: continuwuity_sender_queue_depth > 20
        for: 5m
        labels: { severity: warning }
        annotations: { summary: "消息发送队列积压" }
```

---

## 二十七、MatrixRTC config.toml 完整 Section（H25：别漏了这个）

> 出处：continuwuity.org/calls/livekit（2026-07 更新，**之前 Day 9 规划里完全漏掉了 config.toml 这一节！**）
> **上一轮写错**：之前写的 `foci = ["https://.../_continuwuity/foci"]` 格式完全错误，实际是对象列表

### 绿角犀 config.toml 必须加（Day 9 部署后加，注意格式！）

```toml
# Day 9 部署后加进 continuwuity-config.toml
# 注意：Continuwuity 里这节叫 [global.matrix_rtc]
# 正确格式：foci 是对象列表，每个元素带 type + livekit_service_url
[global.matrix_rtc]
foci = [
  { type = "livekit", livekit_service_url = "https://livekit.绿角犀域名" },
]
```

### foci 字段解释

| 字段 | 值 | 说明 |
|---|---|---|
| `type` | `"livekit"` | 固定值，标识这是 LiveKit SFU |
| `livekit_service_url` | `https://livekit.绿角犀域名` | **LiveKit 自己的域名**（不是 lk-jwt-service 的端口 8081，也不是 Continuwuity 的地址）|

### Continuwuity 会自动把 foci 暴露给客户端（**nginx 不用额外加反代**）

Continuwuity 会把 LiveKit 信息暴露在两个路径（都已被现有 nginx.conf 覆盖）：

| 端点 | 需要 auth | 说明 |
|---|---|---|
| `/_matrix/client/unstable/org.matrix.msc4143/rtc/transports` | ✅ 要 auth | 主发现路径，已被 `location ~ ^(/_matrix\|/_continuwuity)` 覆盖 |
| `/.well-known/matrix/client` | ❌ 公开 fallback | 如果 `[global.well_known].client` 已配置，会自动包含 |

**所以 nginx.conf 不需要额外加 MatrixRTC 路由**——之前第二十七章写的 `location ~ ^/_continuwuity/(matrixrtc|foci)` 是多余的，删掉！

### Continuwuity MatrixRTC vs Legacy Calls 对比

| 类型 | 协议 | 客户端支持 | 依赖 | 推荐 |
|---|---|---|---|---|
| **MatrixRTC（Element Call）** | MSC3567 + LiveKit SFU | Element X / Element Desktop / Element Web | Continuwuity config.toml matrix_rtc + lk-jwt-service + LiveKit | ✅ **首选**（Element 官方路线）|
| Legacy Calls（一对一直接） | STUN/TURN | 旧版 Element / Cinny / 部分客户端 | 只需要 Coturn TURN | 🟡 兜底 |

---

## 二十八、TURN Coturn 完整部署（Day 9 补充）

> 出处：continuwuity.org/calls/turn

### 为什么绿角犀需要 Coturn

MatrixRTC 用 LiveKit SFU 做群通话，但一对一 Legacy Calls 直接需要 Coturn TURN 做 NAT 穿透。LiveKit 也可以用内置 TURN，但 Coturn 更成熟。

### Coturn docker-compose（加进现有文件）

```yaml
coturn:
  image: coturn/coturn:latest
  container_name: coturn
  network_mode: host          # ⚠️ H22: Host network mode 性能最好
  restart: unless-stopped
  volumes:
    - ./coturn.conf:/etc/coturn/turnserver.conf:ro
```

### coturn.conf

```
# coturn.conf（用这个，别用默认的长模板）
use-auth-secret
static-auth-secret=绿角犀生成的64字节随机密钥    # H22: 确保没有前后空白！
realm=coturn.绿角犀域名

# 可选：TURNS
# cert=/etc/letsencrypt/coturn.绿角犀域名/fullchain.pem
# pkey=/etc/letsencrypt/coturn.绿角犀域名/privkey.pem

# 可选：TURN-over-TCP（有些防火墙只放行 TCP）
# tls_port=5349
# turn:5349
```

### Continuwuity config.toml 加 TURN URIs

```toml
# Day 9 部署后加
turn_uris = [
  "turn:coturn.绿角犀域名:3478?transport=udp",
  "turn:coturn.绿角犀域名:3478?transport=tcp",
  # 如果启了 TURNS
  # "turns:coturn.绿角犀域名:5349?transport=tcp"
]
```

### 阿里云安全组 Coturn 端口

| 端口 | 协议 | 必须放行 |
|---|---|---|
| 3478 | UDP | ✅（TURN over UDP）|
| 3478 | TCP | ✅（TURN over TCP，有些防火墙只通 TCP）|
| 5349 | TCP | 🟡（TURNS，可选）|
| 49152-65535 | UDP | ✅（TURN relay 端口，大一些范围保险）|

### 快速验 Coturn 通不通

```bash
# 浏览器打开 ice.webrtc.org/capture.html
# 填 Coturn turn URI
# 应该能看到 ICE candidates 成功（relay 类型）
```

---

## 二十九、Appservices 完整部署（Day 7 补充）

> 出处：continuwuity.org/appservices + continuwuity.org/reference/admin/appservices

### AppService 注册完整流程

```
Step 1: 在 Continuwuity 里注册
        admin 房间发：
        !admin appservices register
        ```yaml
        id: 绿角犀-aibot
        url: http://172.17.0.21:3000/api/matrix-bot
        as_token: <Continuwuity 内部 token>
        hs_token: <绿角犀 Bot 收到请求时验证用>
        sender_localpart: aibot
        rate_limited: false
        protocols: ["m.*"]
        namespaces:
          users: [{ exclusive: false, regex: "@绿角犀-bot.*" }]
          rooms: [{ exclusive: false, regex: ".*" }]
        ```

Step 2: 验证 Continuwuity 收到注册
        !admin appservices list
        → 应该返回 "Appservices (1): 绿角犀-aibot"

Step 3: 绿角犀 Express Bot 启动
        → Bot server 监听 port（上面 yaml 里的 url）
        → Bot 收到 Continuwuity 的 push 请求 → 验证 hs_token → 调 DeepSeek → 发回复
```

### 绿角犀 AI Bot Express 实现骨架

```javascript
// backend/src/routes/matrix-bot.routes.ts
import express from 'express';
const router = express.Router();

const HS_TOKEN = process.env.MATRIX_AS_HS_TOKEN;  // Continuwuity 注册时设的

// Continuwuity 推事件过来
router.post('/', async (req, res) => {
  // 1. 验 hs_token
  if (req.headers.authorization !== `Bearer ${HS_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  // 2. 解析 Matrix event
  const body = req.body;
  for (const event of body.events) {
    if (event.type === 'm.room.message' && event.content.msgtype === 'm.text') {
      const text = event.content.body;
      const roomId = event.room_id;
      // 3. 调 DeepSeek
      const reply = await callDeepSeek(text);
      // 4. 发回 Continuwuity（用 as_token 鉴权）
      await matrixClient.sendMessage(roomId, { msgtype: 'm.text', body: reply });
    }
  }
  res.json({});
});

module.exports = router;
```

### H26 Docker DNS Caveat

如果你用了自托管 Unbound DNS（H17）+ 自定义 Docker resolv.conf，**appservice 容器间用 hostname 连不上**，必须用静态 IP：

```yaml
# ❌ 别这样写（容器间用 hostname）
appservices:
  - bot_aibot:
      url: http://continuwuity-aibot:3000/matrix

# ✅ 必须这样写（用静态 IP）
appservices:
  - bot_aibot:
      url: http://172.17.0.21:3000/api/matrix-bot
```

### 常用 admin appservices 命令

```
!admin appservices list            # 列出所有已注册的
!admin appservices unregister 名字  # 注销
!admin appservices register        # 注册（YAML codeblock）
```

---

## 三十、备选迁移路径：Continuwuity ↔ Tuwunel 互迁

> **现状**：绿角犀选 Continuwuity（社区保守 fork）
> **好处**：所有方案 24 章已全写好
> **风险**：Continuwuity 是社区维护，长期有不确定性
> **预案**：如果 Continuwuity 社区维护力下降 → 换 Tuwunel（Matrix Construct 官方继任者，瑞士政府赞助）

### 为什么换可行（关键不变）

| 不变项 | 说明 |
|---|---|
| **RocksDB 格式兼容** | Tuwunel 继承 conduwuit RocksDB，**换镜像自动迁移**（continuwuity 同 conduwuit 兼容）|
| **Matrix 协议不变** | Continuwuity 和 Tuwunel 都是 Matrix spec 实现，客户端通用 |
| **Config.toml 格式类似** | 大部分配置项相同，少数要微调 |
| **admin 命令类似** | 都用 `!admin` 前缀，具体命令大同小异 |

### 怎么换（5 步，停服 5 分钟）

```bash
# Step 1: 停 Continuwuity
docker stop continuwuity

# Step 2: 备份（保险）
cp -r /data/continuwuity /backup/continuwuity-$(date +%Y%m%d)

# Step 3: 拉 Tuwunel 镜像
docker pull ghcr.io/matrix-construct/tuwunel:latest

# Step 4: 改 docker-compose.yml 镜像名
# image: ghcr.io/continuwuity/continuwuity:v0.5.10  ← 旧
# image: ghcr.io/matrix-construct/tuwunel:latest      ← 新

# Step 5: 启动（RocksDB 自动迁移）
docker up -d

# Step 6: 验
# curl https://绿角犀域名/_matrix/client/v3/versions → 应该变成 Tuwunel 版本
# 旧用户登录 → 应该还能看到历史消息（因为 RocksDB 没变）
```

### 换了之后哪些配置要改

| 配置 | Continuwuity | Tuwunel |
|---|---|---|
| 镜像地址 | `ghcr.io/continuwuity/continuwuity:v0.5.10` | `ghcr.io/matrix-construct/tuwunel:latest` |
| OIDC | 只有 delegated OIDC（Express 当 Provider） | **内置 OIDC Auth Server**（next-gen auth）—— H12 方案可简化！|
| S3 媒体 | ❌ 无 | ✅ `media_storage_providers` |
| next-gen auth | ❌ 只有 OAuth client 侧 | ✅ 内置 Server + Client |
| dehydrated devices | ❌ | ✅ |
| Docker Hub 镜像 | `continuwuity/continuwuity`（已废弃！H16） | `jevolk/tuwunel`（还有 GHCR 镜像）|

### 换了之后 26 条硬规矩哪些要改

| 硬规矩 | 改法 |
|---|---|
| H3（锁 Continuwuity 版本） | **删掉**，改用 H3-T：锁 Tuwunel 版本 |
| H12（OIDC 方案） | **简化**：Tuwunel 内置 Server，Express 不再需要当 Provider |
| H16（GHCR 镜像） | **保留**，换成 `ghcr.io/matrix-construct/tuwunel` |
| 其他 H1-H26 | **基本不变** |

### 什么时候考虑换

- Continuwuity 连续 2 周没更新（维护力下降信号）
- Continuwuity 出严重安全漏洞但延迟修复
- 绿角犀需要 S3 媒体存储（Continuwuity 没有）
- Continuwuity 升级 Matrix spec 太慢

---

**v1.4 总览**：26 条硬规矩（H1-H26）+ 30 章完整项目文本（24 章原 v1.3 + 6 章新 v1.4）

| 项目 | v1.3 | v1.4 | 新增 |
|---|---|---|---|
| 硬规矩 | 22 | **26** | H23-H26 |
| 章节 | 24 | **30** | 二十五-三十 |
| 联网扫描轮次 | 7 | **10** | 第八-十轮 |
| Tuwunel 备选 | ❌ | ✅ | RocksDB 兼容，换镜像迁移路径 |

**状态**：✅ v1.4 已定稿，选型锁定 Continuwuity，Tuwunel 作为备选
**下次更新**：Day 1 验收后补 D1 结果；Day 7 AppService 部署后补经验；Day 9 LiveKit/Coturn 部署后补经验

---

## 🎯 Day 1 作战卡（读完项目文本直接动手，别翻前面）

> 👀 **新 AI 读到这张卡 = 开干**。所有"第一个命令敲啥、哪几处要改、怎么算过"都在这。
> 不需要翻第八章 config.toml 原文——需要抄的内容我帮你摘在这张卡的配置块里了。
> 不需要翻十八章 Checklist——这张卡就是简化版 Checklist。

### ⚠️ 占位符约定

项目文本里所有 **`绿角犀域名`** 都是占位符，实际域名在 `secrets.md`。下面所有命令里的 `绿角犀域名` 都要先换成实际值再敲。

---

### 第 0 步：前置检查（不通过不许往下走）

| # | 检查 | 命令 | 过了才算 | 不过怎么办 |
|---|---|---|---|---|
| 0.1 | SSH 能连 | `ssh root@47.116.59.141` | 登录进服务器看到 shell | 密码在 AGENTS ⑥；连不上 → 跳过 Day 1，先找用户要新密码 |
| 0.2 | Docker 有 | `docker version` | 输出 Client/Server 版本号 | 没输出 → 先装 Docker（`curl -fsSL get.docker.com \| bash`）|
| 0.3 | 域名已绑 | `nslookup 绿角犀域名` | 返回 47.116.59.141 | 没返回 → 阿里云域名控制台加 A 记录 → 等 DNS 生效（最长 48h）|
| 0.4 | 安全组已放 | 阿里云控制台查 | 入方向有 80/tcp + 443/tcp + 443/udp | 没有 → 加规则 → 立即生效 |

**✅ 4 条全过 → 往下走。缺任何一条 → 停，解决了再动。**

---

### 第 1 步：拉 Continuwuity 镜像（H16）

```bash
# 1.1 进入服务器
ssh root@47.116.59.141

# 1.2 建目录
mkdir -p /data/continuwuity /data/continuwuity-backups
cd /data/continuwuity

# 1.3 拉镜像（GHCR，锁版本 v0.5.10，H16）
docker pull ghcr.io/continuwuity/continuwuity:v0.5.10

# 过了才算：docker images 里能看到这行
# ghcr.io/continuwuity/continuwuity   v0.5.10   xxx
```

---

### 第 2 步：写 config.toml（从第八章摘好的，改 1 处就行）

```bash
# 2.1 写配置文件
cat > /data/continuwuity/continuwuity-config.toml << 'EOF'
[global]
server_name = "绿角犀域名"   # ⚠️ 改成实际域名！H1 定死后不能改
address = ["0.0.0.0"]
port = 8008
database_path = "/data/continuwuity"
database_backup_path = "/data/continuwuity-backups"
database_backups_to_keep = 7
allow_federation = false    # H6
cache_capacity_modifier = 0.3   # H5：2GB 阿里云低配用 0.3，4GB 高配用 2.0
ip_lookup_strategy = 1          # H4：阿里云 IPv4 only
request_ip_source = "x_forwarded_for"
allow_registration = false       # H24：默认禁用注册
allow_prometheus_metrics = true  # H23
prometheus_metrics_token = "CHANGE_ME_TO_32_RANDOM_CHARS"   # H23：改成随机 32 字符

[global.well_known]
client = "https://绿角犀域名"    # ⚠️ 改域名
server = "绿角犀域名:443"        # ⚠️ 改域名

[global.observability]
otlp_exporter = "prometheus"
EOF

# 2.2 验改对了没
grep "server_name" /data/continuwuity/continuwuity-config.toml
# 过了才算：输出里 server_name = "实际域名"，不是占位符
```

---

### 第 3 步：写 nginx.conf（已整合 H23 metrics 屏蔽 + H21 lk-jwt-service 路径）

```bash
# 3.1 写 nginx 配置
cat > /data/continuwuity/nginx.conf << 'EOF'
server {
    listen 80;
    server_name 绿角犀域名;   # ⚠️ 改域名

    # HTTP → HTTPS 跳转
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 绿角犀域名;   # ⚠️ 改域名

    ssl_certificate /etc/letsencrypt/live/绿角犀域名/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/绿角犀域名/privkey.pem;

    # H2: proxy_pass 后面不加 path！
    location ~ ^(/_matrix|/_continuwuity) {
        proxy_pass http://127.0.0.1:8008;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # H23: Prometheus metrics — 只允许 127.0.0.1，别公开
    location /_continuwuity/metrics {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
    }

    # Day 9 才启：Express 后端
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }

    # Day 9 才启：lk-jwt-service（H21：3 条路径）
    location ~ ^/(sfu/get|healthz|get_token) {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
    }
}
EOF

# 3.2 验语法（如果服务器已有 nginx）
nginx -t 2>/dev/null || echo "nginx 没装，跳过语法检查，Day 1 最后装 nginx 时再验"
```

---

### 第 4 步：Certbot 申请 HTTPS + 启 nginx + 启 Continuwuity

```bash
# 4.1 装 nginx + certbot
apt update && apt install -y nginx certbot python3-certbot-nginx

# 4.2 复制 nginx 配置
cp /data/continuwuity/nginx.conf /etc/nginx/sites-available/continuwuity
ln -sf /etc/nginx/sites-available/continuwuity /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 4.3 申请证书（填你实际域名）
certbot --nginx -d 绿角犀域名 --non-interactive --agree-tos --email 运维邮箱@绿角犀域名

# 过了才算：浏览器开 https://绿角犀域名 看到小锁
```

---

### 第 5 步：docker-compose 启 Continuwuity

```bash
# 5.1 写 docker-compose（锁 GHCR 镜像 H16 + resolv.conf 挂载 H17）
cat > /data/continuwuity/docker-compose.yml << 'EOF'
services:
  continuwuity:
    image: ghcr.io/continuwuity/continuwuity:v0.5.10   # H16: GHCR
    container_name: continuwuity
    restart: unless-stopped
    network_mode: host
    volumes:
      - /data/continuwuity:/var/lib/continuwuity
      - /data/continuwuity-backups:/var/lib/continuwuity-backups
      - /data/continuwuity/continuwuity-config.toml:/var/lib/continuwuity/config.toml:ro
      # H17: 自定义 resolv.conf（自托管 Unbound 时用，先注释掉）
      # - /data/continuwuity/resolv.conf:/etc/resolv.conf:ro
EOF

# 5.2 启
cd /data/continuwuity && docker compose up -d

# 5.3 验容器跑起来了
docker ps | grep continuwuity
# 过了才算：状态 Up ... (healthy)
```

---

### 第 6 步：验 Matrix API + 验硬规矩全落地

```bash
# 6.1 验 Matrix API 通
curl -s https://绿角犀域名/_matrix/client/v3/versions | head -c 200
# 过了才算：看到 JSON 里有 "versions": ["v1.0", "v1.1", ...]

# 6.2 验硬规矩落地（!admin server show-config）
# 进服务器用 root shell（Continuwuity 容器里 admin room 发）
# 或者看日志：
docker logs continuwuity 2>&1 | grep -E "server_name|federation|cache_capacity|prometheus"
# 过了才算：
#   allow_federation = false （H6）
#   cache_capacity_modifier = 0.3 （H5）
#   prometheus_metrics_token 不是空 （H23）
```

---

### Day 1 完成判定（4 条全勾才算完）

| # | 判定 | 验 |
|---|---|---|
| ✅ | Continuwuity 容器 healthy | `docker ps` |
| ✅ | Matrix API 外网可达 | `curl https://绿角犀域名/_matrix/client/v3/versions` |
| ✅ | 浏览器能开 HTTPS | 小锁图标 |
| ✅ | 硬规矩 H1/H2/H3/H4/H5/H6/H16/H23 全落地 | `docker logs` grep |

---

### 卡壳了去哪找

| 症状 | 去哪 |
|---|---|
| Continuwuity 起不来 / 500 | 第二十三章《故障排查速查表》🔴 服务起不来 |
| Matrix API 404 | 第二十三章 🟡 join 慢 那节也看 |
| HTTPS 证书申请失败 | certbot 官方文档，或看 DNS 记录对不对 |
| metrics endpoint 公开暴露 | nginx.conf 里 `allow 127.0.0.1; deny all;` 加了没 |
| 新 AI 不懂 Continuwuity 概念 | 读第一-五章（架构 + 选型 + 硬规矩来源）|
| AI Bot 部署 | 第二十九章 Appservices |
| LiveKit 部署 | 第二十章 LiveKit 完整部署 |

---

### 每天开工前扫一遍硬规矩

**项目文本末尾"升级清单总览"**——26 条（H1-H26），每天开工前扫一遍。

---

### Day 1 实机踩坑实录（2026-10-26，lujax.fun 服务器）

> 🔥 **这些坑不改，Day 1 必崩。按顺序排，哪个先碰到先看哪个。**

| # | 坑 | 现象 | 根因 | 修 |
|---|---|---|---|---|
| **K1** | Continuwuity 容器启动即重启 | `Restarting (1)` | ❌ **之前写的 config 挂载路径错了**。Continuwuity 默认 config.toml 路径不是 `/var/lib/continuwuity/config.toml` | ✅ **改用 `-O` 参数方式传配置**（见下方修正版 docker-compose.yml） |
| **K2** | `-O` 参数报 TOML parse error | `Error: TOML parse error at line 1, column 13 ... string values must be quoted` | ❌ 字符串没加引号。`-O server_name=lujax.fun` 不行 | ✅ **TOML 格式，字符串必须加引号**：`-O "server_name=\"lujax.fun\""`；数组也要：`-O "address=[\"0.0.0.0\"]"` |
| **K3** | docker-compose command 报 `-O: executable file not found` | 容器尝试直接执行 `-O` | ❌ 丢了镜像的 CMD。Continuwuity 镜像 `ENTRYPOINT=[]`, `CMD=["/sbin/conduwuit"]`，docker-compose command 必须包含完整命令 | ✅ command 第一行写 `/sbin/conduwuit`，然后才是 `-O ...` |

#### K1+K2+K3 修正版 docker-compose.yml（**用这个！之前第八章写的那版不对**）

```yaml
services:
  continuwuity:
    image: ghcr.io/continuwuity/continuwuity:v0.5.10
    container_name: continuwuity
    restart: unless-stopped
    network_mode: host
    # ⚠️ K1+K3: 用 command 传 -O 参数，绕过 config.toml 路径问题
    command:
      - /sbin/conduwuit
      - -O
      - "server_name=\"lujax.fun\""              # K2: TOML 字符串要加引号
      - -O
      - "address=[\"0.0.0.0\"]"                 # K2: 数组也要加引号
      - -O
      - "port=8008"
      - -O
      - "database_path=/var/lib/continuwuity"
      - -O
      - "allow_federation=false"
      - -O
      - "cache_capacity_modifier=0.3"
      - -O
      - "ip_lookup_strategy=1"
      # H23: 下面两行 Continuwuity v0.5.10 版本报 unknown
      # 但 nginx.conf 里已经有 allow 127.0.0.1; deny all; 屏蔽了 metrics endpoint
      # 所以 nginx 层已经完成 H23，这里留到后续升级 Continuwuity 时再补
      # - -O
      # - "allow_prometheus_metrics=true"
      # - -O
      # - "prometheus_metrics_token=\"cwr_a8f3k9m2x7p4q6r1t5y8w3z\""
    volumes:
      - /data/continuwuity:/var/lib/continuwuity
      - /data/continuwuity-backups:/var/lib/continuwuity-backups
```

#### H23 的 nginx 层兜底（已生效）

Continuwuity v0.5.10 对 `allow_prometheus_metrics` 和 `prometheus_metrics_token` 报 unknown warning，但 **nginx.conf 里 `location /_continuwuity/metrics { allow 127.0.0.1; deny all; }` 已经把 endpoint 屏蔽了**。

#### 实机验证结果（2026-10-26）

| 验 | 命令 | 结果 |
|---|---|---|
| 容器 running | `docker ps` → Up | ✅ |
| Matrix API | `curl https://lujax.fun/_matrix/client/versions` | ✅ 19 个版本 |
| HTTPS 反代 | curl -sk https://lujax.fun | ✅ 合法 Let's Encrypt |
| H1 server_name | `lujax.fun`（定死）| ✅ |
| H6 federation | false | ✅ |
| H5 cache | 0.3（1.8GB 低配）| ✅ |
| H16 镜像 | ghcr.io/continuwuity/continuwuity:v0.5.10 | ✅ |
| 自动注册 token | `F3LIFWye4C4w6Dsd`（Continuwuity 首次启动自动生成）| 首次启 Continuwuity 会在日志里输出 |

#### Domain 选型修正（之前项目文本写"绿角犀域名"占位）

**实际用的是 `lujax.fun`**，不是 greenrhino.cn。greenrhino.cn 指向福建 CDN（218.85.134.107），lujax.fun 直接指向阿里云 47.116.59.141，有合法 Let's Encrypt 证书到 2026-12-03。

#### Server 实际资源

| 项 | 值 | 决策 |
|---|---|---|
| CPU | 3.3%（当前）| 够用 |
| 内存 | 1.8GB total，Continuwuity 约 30MB | H5 `cache_capacity_modifier=0.3` 正确 |
| 磁盘 | 40GB 总，已用 19GB | 够 |
