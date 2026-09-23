# DAM-lite 数字资产管理（含远程提取分级授权）

> 整合来源：`DAM_LITE_DESIGN.md` + `DAM_INTEGRATION.md` + `ASSET_CLASSIFY_FEATURE.md` + `ASSET_CLASSIFY_RULES_FEATURE.md`
> 版本：v1.0（整合稿） ｜ 状态：设计定稿，核心链路已实现验证
> 覆盖：定位 / 模块 / 选型 / 路线图 / 数据模型 / API / 前端 / Electron 采集 / 安全修复 / 验证

---

## 一、定位（Positioning）

### 1.1 产品是什么
DAM-lite 是面向**个人 / 小团队**的轻量化数字资产管理（Digital Asset Management）工具，覆盖**文档 / 图片 / 音频 / 视频**四类核心资源。与重型企业 DAM 的区别在于：零运维、单机可跑、强调**本地优先与离线可用**，并把"PC 桌面端自动采集 → 自动分类 → 同步 → 智能归纳"做成开箱即用的主链路。

### 1.2 服务谁
| 角色 | 典型场景 |
|------|----------|
| 个人用户 | 把散落在多个文件夹的资料自动抓进统一库，离线也能分类检索 |
| 小团队 | 建空间共享资料，按分类/标签/文件夹组织，对外发公开分享链接 |
| 远程办公者 | 通过"特定区"机制，在二次验证 + 设备绑定保护下远程提取本机指定资料 |

### 1.3 平台与形态
- **Web**：跨平台浏览器访问，主管理界面。
- **Mobile**：移动端查阅/检索/接收分享（路线图中）。
- **PC 桌面端**：**核心差异点** —— 指定文件夹自由抓取、自动分类、自动同步、离线归纳；并承载"特定区"远程提取执行端。

### 1.4 设计原则（贯穿全文）
1. **本地优先 / 离线可用**：核心分类与归纳**不依赖云端推理**，断网照常工作。
2. **权限边界清晰**：空间级 RBAC + 远程提取"特定区"双权限等级。
3. **增量与去重**：采集/同步按内容指纹 + 路径定位做增量，避免重复入库。
4. **安全默认**：路径穿越防护、令牌吊销、二次验证、分享默认过期。

---

## 二、模块（Modules）

主链路：**采集 → 分类 → 同步 → 归纳**，辅以**组织协作**与**特定区远程提取**两大支撑模块。

### M1 采集（PC 桌面端指定文件夹抓取）
- **能力**：用户指定一个或多个监控文件夹，桌面端递归扫描文档/图片/音频/视频，过滤系统/隐藏/高危目录。
- **增量**：按 `mtime` + `size` 本地预判，未变化的文件跳过；变化时上报。
- **监听**：开启"自动监听"后，文件系统变化事件（节流后）触发增量同步。
- **实现落点**：`electron/collector.cjs`（纯 fs 递归 + 离线基础分类 + 扩展名白名单）、`electron/main.cjs` 注册 `dam:selectFolder / scanFolder / readFileBytes / watchStart / watchStop`、`frontend/src/components/SyncPanel.tsx`（仅桌面端显示）。

### M2 分类（离线本地智能归纳）
- **内置确定性引擎**：输入仅 `{ name, mime, size }`，输出 10 类之一 —— `票据 / 截图 / 合同 / 文档 / 照片 / 代码 / 音频 / 视频 / 归档 / 其他`。判定优先级：扩展名 → MIME → 文件名关键词 → 回退 `type`。**零外部依赖，断网照常**。
- **用户自定义映射规则**：`CategoryRule`（按空间维度）支持 `extension / nameContains / mimeStartsWith` 三种匹配，命中即返回（用户口径覆盖内置），同空间按 `priority` 降序。提供"重新分类"一键重算全空间。
- **实现落点**：`backend/src/lib/classifyAsset.ts`、`backend/src/routes/categoryRule.routes.ts`（`/api/v1/category-rules`）、`Asset.category` 字段 + `(spaceId, category)` 索引。

### M3 同步（采集入库与多端一致）
- **接口**：`POST /assets/sync`，入参 `{ spaceId, folderId?, autoTag?, items:[{name, mime?, base64, localPath, localMtime}] }`。
- **策略**：按 `spaceId + localPath` 定位已采集资产 —— 内容未变→`skipped`；内容变化→**在位更新并追加版本快照**；不存在→新建。`autoTag` 时取来源父文件夹名作为标签（离线基础归纳）。
- **离线缓存 / 用时再下**：列表多选批量下载（zip）；桌面端把勾选文件缓存到本地磁盘，断网可读取/预览；抽屉内"离线优先下载"先读本地副本、否则在线下载并回写缓存。
- **实现落点**：`backend/src/routes/asset.routes.ts`、`frontend/src/lib/localCache.ts`、`electron/cacheStore.cjs` + 五个缓存 IPC。

### M4 归纳（概览与检索）
- **统计看板**：`GET /assets/stats` 返回 `{ total, byCategory, byType, trend }`，前端横向条形 + 30 天趋势 SVG。
- **筛选与检索**：按 `category` / `type` / `tag` / `folderId` / 关键词（`name` OR `metadata`）筛选；分类 chips 单选。
- **实现落点**：`asset.routes.ts` 的 `/stats` 与列表查询、`LibraryPage` 看板与筛选 UI、`TrendChart` 纯 SVG 组件。

### M5 组织协作
- **空间 / 成员**：空间 CRUD + 成员管理（owner/operator/member 角色）。
- **文件夹树**：嵌套 + 自动路径 + 资产计数 + 级联删除。
- **标签**：空间唯一，upsert 复用，带使用计数。
- **资产版本**：初始 + 新版本 + 恢复。
- **公开分享**：免登录外链，密码 + 有效期（默认 7 天），view/download；访问审计。
- **实现落点**：`space/folder/tag/share.routes.ts`，`assertSpaceAccess(spaceId, userId, write?)` RBAC。

### M6 特定区远程提取（双权限等级 + 设备绑定 + 二次验证）
- **资源区登记**：`ResourceZone` 记录监控边界 `fetchScope`（见下），绑定到执行实例。
- **双权限等级**：
  - `specified_zone`（指定区域）：仅扫描登记的资源区路径；触发者对该空间有写入权限即可。
  - `full_instance`（全电脑，高危）：涉及整实例文件系统；除实例侧确认外，**强制要求触发者为空间所有者(owner)**，否则 403。
- **设备绑定**：`ExecInstance` 指纹 + 实例令牌（30 天 TTL、可心跳续期、可解绑吊销）。
- **二次验证（step-up）**：触发提取前需密码重校验签发 5 分钟短令牌 `x-stepup-token`；`full_instance` 级触发**每次强制本地确认**（`requireConfirm`）。
- **执行闭环**：触发提取 → 实例拉取待办 → 本地确认 → 执行（服务端扫描 `sourcePath` 入库）。
- **鉴权链**：`authRequired`(JWT) → `requireStepUp` → `instanceAuth`(实例令牌：未吊销+已绑定+在线+未过期)。
- **实现落点**：`backend/src/routes/remoteFetch.routes.ts`、`prisma/schema.prisma`（`ExecInstance / ResourceZone / FetchJob / AssetSource`）。

---

## 三、选型（Tech Selection）

### 3.1 技术栈（规划口径）
| 层 | 选型 | 说明 |
|----|------|------|
| PC 桌面端 | **Tauri + React** | 轻量、原生文件系统能力，替代/演进当前 Electron 壳 |
| Web / Mobile | **React + Vite** | 跨端复用组件 |
| 后端 | **NestJS** | 模块化、Pipe/Guard 适合 RBAC 与鉴权链 |
| 数据库 | **PostgreSQL** | 关系型 + 索引，承载空间/资产/规则 |
| 对象存储 | **MinIO** | S3 兼容，存资产原文与版本 |

### 3.2 当前单机实现栈（已验证）
为满足"先跑通再上云"，当前以** Node + Express + Prisma + SQLite + 本地文件系统**实现等价能力：
- 资产原文存本地磁盘（`storage.ts`，含路径穿越防护、`sha256` 去重、流式下载）；
- 检索用 DB `LIKE` 替代 Meilisearch；
- 桌面壳用 **Electron**（当前沙箱缺 `electron.asar`，GUI 需真机 `npm start` 验证）。

### 3.3 离线分类选型理由
- **为何不用云端 LLM**：离线要求是硬约束（断网环境必须可用），且分类需**确定性与可复现**（同文件同结果，便于增量去重与版本判定）。
- **为何规则引擎**：纯本地、零依赖、可审计、可被用户自定义规则覆盖；后续可叠加"本地轻量模型"作为可选增强，但当前规则引擎已满足离线门槛。
- **自定义规则优先于内置**：用户口径覆盖内置，保证团队自有分类标准落地。

### 3.4 安全选型
- **路径严格匹配**：`abs === ROOT || abs.startsWith(ROOT + sep)` 防前缀碰撞穿越。
- **令牌可吊销**：实例令牌 TTL + `revoked` 标记，泄漏可立即解绑。
- **分享默认过期**：未指定过期则兜底 7 天，防永久外链。
- **内容嗅探防护**：inline 仅放行白名单媒体类型，其余降级 `octet-stream` + `nosniff`，防存储型 XSS。

---

## 四、数据模型（Prisma）

新增 12 个模型：`Space` `SpaceMember` `Folder` `Tag` `AssetTag` `Asset` `AssetVersion` `ShareLink` `ExecInstance` `ResourceZone` `FetchJob` `AssetSource`

关键点：
- `Asset.category`：`String`，默认 `other`；索引 `(spaceId, category)`
- `Asset.localPath` / `localMtime`（`BigInt`）：桌面采集定位 + 增量去重；索引 `@@index([spaceId, localPath])`
- `AssetSource.localMtime`：`BigInt`（原 `Int` 溢出已修复）
- `CategoryRule`：`@@unique([spaceId, matchType, pattern])` 防重复规则
- `ExecInstance`：`tokenExpireAt` / `revoked` / `lastUsedAt`（令牌可吊销）
- `ShareLink`：`accessedAt` / `accessedCount`（访问审计）
- SQLite 限制：所有 JSON（`rulesJson`、资产 `metadata`）以 `String` 存储并手动 `JSON.parse/stringify`
- `User` 关联字段（`ownerId`/`requesterId`/`operatorId`）采用 `String`，未与 `User` 模型强关联

---

## 五、核心 API（均挂在 `/api/v1` 下）

### 资产 / 空间 / 文件夹 / 标签 / 分享
- `POST /assets/upload` 上传（base64，支持 `folderId`/`tags`/`description`；`folderId` 接受 null）
- `GET /assets?spaceId&folderId&type&tag&category&q&page` 列表（`q` 同时匹配 `name` 与 `metadata`）
- `GET /assets/:id` 详情（`select` 排除 `shareLinks.password`）
- `GET /assets/:id/file` 下载（**流式**返回，`pipeAssetFile` + `Content-Length`）
- `DELETE /assets/:id`（仅空间所有者 或 资产拥有者）
- `PATCH /assets/:id` 编辑元数据（仅空间所有者 或 资产拥有者，否则 403）
- `POST /assets/:id/share` 分享（未传 `expireAt` 时兜底 7 天）
- `GET /assets/:id/versions` / `POST /assets/:id/versions` / `POST /assets/:id/versions/:vid/restore`
- `POST /assets/batch-download` 批量下载（1–100 个，逐个空间权限校验，archiver 流式 zip）
- `POST /assets/sync` 桌面端自动采集同步（批量入库：自动分类 + 按 `spaceId+localPath` 增量去重）
- `GET /assets/stats?spaceId=` 统计看板（`{ total, byCategory, byType }`）

- `POST /spaces` / `GET /spaces` / `POST /spaces/:id/members` / `DELETE /spaces/:id`
- `POST /folders`（嵌套，自动计算 path，禁名称含 `/`）/ `GET /folders?spaceId`（含 `_count.assets`）/ `GET /folders/:id` / `DELETE /folders/:id`（级联删子目录，资产 folderId 置空）
- `GET /tags?spaceId`（含使用计数）/ `POST /tags`（upsert 空间唯一，`name` 自动 `.trim()`）/ `DELETE /tags/:id`
- `GET /share/:token` 免登录取回分享元数据（可选 `?password=`）
- `GET /share/:token/file` 免登录下载/预览（可选 `?password=`，`view`=内联预览 `download`=附件；inline 仅放行白名单媒体，其余降级 `octet-stream`+`nosniff`）

### 分类规则（`/api/v1/category-rules`）
- `GET /?spaceId=` 列出规则 + 标准分类口径
- `POST /` 新建（写权限校验，唯一约束冲突返回 400/409）
- `PUT /:id` 更新（priority / targetCategory / enabled / pattern）
- `DELETE /:id` 删除
- `POST /reclassify` 按当前规则重算空间内全部资产分类，返回 `{ total, changed }`

### 远程提取（`/api/v1/remote-fetch`）
- `POST /remote-fetch/step-up` 二次验证（密码重校验→5min 令牌 `x-stepup-token`）
- `POST /remote-fetch/instances/bind` 绑定实例（返回 `token`，30 天 TTL）
- `GET /instances` / `POST /instances/:id/heartbeat`（续期）/ `POST /instances/:id/unbind`（仅 owner，吊销令牌）
- `POST /remote-fetch/resource-zones` 登记资源区（需实例归属 + 空间写权限）
- `GET /resource-zones`
- `POST /remote-fetch/resource-zones/:id/fetch` 触发提取（**需 `x-stepup-token`**；`full_instance` 强制要求 owner，否则 403）
- `GET /remote-fetch/fetch-jobs/pending`（`x-instance-token`）
- `POST /fetch-jobs/:id/confirm` / `POST /fetch-jobs/:id/execute`（服务端扫描 `sourcePath` 并入库）
- `GET /fetch-jobs/:id`

> 鉴权链：`authRequired`(JWT) → 触发提取需 `requireStepUp` → 实例侧拉取/确认/执行需 `instanceAuth`（实例令牌：未吊销+已绑定+在线+未过期）。

---

## 六、前端（`frontend/src/pages/LibraryPage.tsx` 等）

| 文件 | 说明 |
| --- | --- |
| `frontend/src/pages/LibraryPage.tsx` | 资料库主页面：空间选择 + 文件夹树 + 标签过滤 + 资产网格（搜索/类型/分类/分页）+ 上传弹窗 + 资产详情抽屉（下载、元数据编辑、版本列表+恢复、生成公开分享链接）+ 批量下载/缓存工具栏 + 分类统计看板 + 分类规则弹窗 |
| `frontend/src/App.tsx` | 懒加载路由 `/library` |
| `frontend/src/pages/ProfilePage.tsx` | 个人中心「常用功能」新增「资料库」入口（FolderOpen 图标） |
| `frontend/src/lib/localCache.ts` | 本地缓存统一封装：桌面端经 `window.desktopAPI` 走 Electron IPC 写本地磁盘，浏览器兜底走 IndexedDB |
| `frontend/src/components/SyncPanel.tsx` | 桌面端「自动采集与同步」面板（仅 `isDesktop()` 显示） |
| `frontend/src/components/TrendChart.tsx` | 纯 SVG 30 天趋势图 |

### 关键 UI 能力
- 资源卡片：分类彩色徽章 + 「已缓存」徽标
- 工具栏：10 类筛选 chips（单选+全部）+ 「全选本页 / 下载选中(N) / 缓存选中(N)」
- 详情抽屉：「离线优先下载」（先读本地副本，否则在线下载并回写缓存）+「缓存到本机」按钮
- 分类统计看板：总数 + 按 10 类横向条形（比例+计数），点击任一类即筛选
- 分类规则弹窗：新建规则（匹配类型/匹配串/目标分类/优先级）+ 规则列表（含命中预览、删除）+「重新分类」一键应用
- 下载：批量走 `POST /assets/batch-download` 拿 zip；单文件走离线优先；公开分享走免登录直链

---

## 七、Electron 桌面采集与缓存（`electron/`）

| 文件 | 说明 |
| --- | --- |
| `electron/collector.cjs` | 纯 fs 采集核心（不依赖 Electron 运行时，可独立 node 测试）：`scanFolder` 递归扫描并过滤文档/图片/音频/视频（跳过高危/隐藏目录）、`classifyByExt` 离线基础分类、`ALLOWED_EXT` 扩展名表。新增 `require.main` 独立 CLI（`--scan <dir>` / `--check <root>` / `--selftest`） |
| `electron/cacheStore.cjs` | 纯 fs 缓存层（不依赖 Electron 运行时，可独立 node 测试）：`createCacheStore(root)` 维护 `index.json`、文件名安全化、强制落在 `assetId` 子目录内防穿越。新增 `--selftest` CLI |
| `electron/main.cjs` | 注册缓存 `dam:cacheAsset/getCached/readCached/removeCached/listCached` 五个 `ipcMain.handle`；注册采集 `dam:selectFolder/scanFolder/readFileBytes/watchStart/watchStop` 五个 `ipcMain.handle`（缓存根 `userData/cache`）；文件变化节流后触发增量同步 |
| `electron/preload.cjs` | 经 `contextBridge.exposeInMainWorld('desktopAPI', …)` 暴露上述方法（`cacheAsset` 将 ArrayBuffer 转 `Buffer`；`onFileChanged` 订阅主进程 `dam:fileChanged` 事件） |
| `electron/agent/collectorAgent.cjs` | 适配层（默认 in-process 调用，预留 `COLLECTOR_AGENT_MODE=spawn` 独立进程模式），`main.cjs` 的 `dam:scanFolder` IPC 改走该层 |
| `electron/integration-check.cjs` | 无 GUI 运行期验证：用与 `dam:scanFolder` IPC 处理器完全一致的调用 `scan(folderPath, { max: 5000 })` 跑通 agent→collector→classify 链路 |

---

## 八、安全修复（代码审查后修复，均已回归测试）

### A 类：权限与生命周期
- **分级授权语义塌陷**：原 `requireConfirm = zone.fetchScope === 'full_instance' ? true : true`（恒 true 无效）。已改为真实分级：`specified_zone` 触发者对该空间有写入权限即可；`full_instance` 强制要求触发者为空间所有者(owner)，否则 403。
- **实例令牌静态无吊销/轮换**：原 `ExecInstance.token` 为持久化 bearer，无过期/吊销。已修复：新增 `tokenExpireAt`/`revoked`/`lastUsedAt`；30 天 TTL + 心跳续期；`instanceAuth` 校验「未吊销 + 已绑定 + 在线 + 未过期」；新增 `POST /instances/:id/unbind`（仅 owner）吊销令牌。
- **资产元数据编辑越权**：原 `PATCH /:id` 仅校验空间写权限，member/operator 可改他人资产。已对齐 `DELETE`：仅「空间所有者 或 资产拥有者」可编辑，否则 403。
- **公开分享默认过期**：原未传 `expireAt` 时存 `null`（永久有效），可绕过前端兜底。已新增常量 `SHARE_DEFAULT_TTL_DAYS = 7`，未显式指定时兜底为「当前时间 + 7 天」。
- **公开分享访问无审计**：原分享消费完全静默。已修复：`ShareLink` 新增 `accessedAt`/`accessedCount`；`GET /share/:token` 与 `/:token/file` 端点均 `auditReq` 记录匿名访问（含 IP/UA，`userId` 置空）。

### B 类：XSS 与内容嗅探
- **公开分享存储型 XSS**：原 `/:token/file` 直接用用户可控的 `Asset.mime` 作为 `Content-Type` 且 `view` 时 `inline`，攻击者可上传 `text/html` 在同源自联渲染 → 存储型 XSS。已修复：inline 仅放行白名单媒体类型（`image/{png,jpeg,gif,webp,bmp,svg+xml}`、`audio/*`、`video/*`、`application/pdf`），其余一律降级 `application/octet-stream`，并强制 `X-Content-Type-Options: nosniff`。
- **资产详情泄漏分享密码哈希**：原 `GET /assets/:id` 的 `include shareLinks: true` 会把 bcrypt 密码哈希暴露给任意空间成员。已改为 `select` 仅返回 `id/token/permission/expireAt/createdAt`，排除 `password`。

### C 类：路径穿越与流式
- **路径穿越前缀碰撞**：原 `abs.startsWith(ASSET_ROOT)` 判断，存在 `/data/assets-evil/file` 命中 `/data/assets` 前缀的碰撞风险。改为 `abs === ASSET_ROOT || abs.startsWith(ASSET_ROOT + path.sep)` 的严格匹配。
- **文件端点全量读内存**：`/assets/:id/file` 与 `/share/:token/file` 原整文件读入 Buffer 再 `res.send`，大视频会吃内存且不流式。新增 `pipeAssetFile` 用 `fs.createReadStream` 流式返回并设置 `Content-Length`；`storage` 新增 `resolveSafe` 统一路径解析。
- **文件夹名允许 `/`**：原创建校验未禁止分隔符，破坏 `path` 语义。已加 `.refine` 拒绝名称含 `/`。
- **标签名未 trim**：原 `name` 未裁剪，纯空格名会通过 `min(1)`。已加 `.trim()`，空格名被拒、前后空格自动归一。

### D 类：逻辑与一致性
- **`AssetSource.localMtime` 整型溢出**：原 `Int`（32 位，上限 2.1e9）无法承载 `Math.floor(fstat.mtimeMs)`（~1.78e12），导致 `assetSource.create()` 抛错被 `catch` 吞掉、`resultCount=0`。已改为 `BigInt`，代码侧改为 `BigInt(Math.floor(stat.mtimeMs))`。
- **BigInt 序列化回归**：`res.json` 默认无法序列化 BigInt（抛 `Do not know how to serialize a BigInt`）。已在 `utils/response.ts` 的 `success/fail` 统一改用带 BigInt→字符串 replacer 的 `safeStringify`。
- **`share.routes.ts` 公开端点错误码丢失**：原 `resolveLink` 通过 `fail(null as any, …)` 在 `res=null` 时抛 `TypeError`，异常被路由 `catch` 后降级为 500。已改为 `resolveLink` 返回纯描述 `{ status, message }`，路由内再调用 `fail(res, …)` 正确设置 HTTP 状态码（404/401/410）。
- **搜索语义对齐**：原 `GET /assets?q=` 只匹配 `name`，与前端承诺"文件名 / 描述"不符。已改为 `q` 同时 `OR` 匹配 `name` 与 `metadata`；删除无人调用的冗余 `/assets/search` 死路由。
- **去重逻辑两处不一致**：`asset.routes.ts` 上传去重过滤 `status:'ready'`，而 `remoteFetch.routes.ts` 远程提取去重未过滤。已统一为两处均按 `status:'ready'` 去重。
- **`inferType` 重复实现**：`asset.routes.ts` 与 `remoteFetch.routes.ts` 各有一份类型推断。已抽到 `lib/asset.ts` 的 `inferType(name, mime?)`，两路由统一 import 复用。
- **上传 `folderId` 接受 null**：原 `z.string().optional()` 不接受 `null`，前端上传未选文件夹时传 `null` 导致 422。已放宽为 `z.string().nullable().optional()`。

---

## 九、路线图（Roadmap）

### P0 · 单机可用版（✅ 已落地并验证）
- 空间/成员/文件夹树/标签/资产/版本/分享：✅
- 离线确定性分类（10 类）+ 用户自定义规则 + 统计看板：✅
- PC 采集-同步链路（`/assets/sync` + Electron collector + SyncPanel）：✅
- 特定区远程提取（双权限 + 设备绑定 + step-up + 强制确认）：✅
- 离线缓存 / 用时再下：✅
- 验证：后端冒烟 165/165、前后端 `tsc`+`vite build` 均通过。
- **遗留**：Electron 真机 GUI 因沙箱缺 `electron.asar` 未实跑（环境限制，非缺陷）。

### P1 · 跨平台客户端标准化
- **P1-1 Electron 真机验证**：在可访问 GitHub release CDN 的机器 `npm install` 补全 `electron.asar`，按 `ELECTRON_VERIFICATION_GUIDE.md` 验证 SyncPanel/自动监听/离线缓存/IPC。
- **P1-2 桌面壳选型 Spike**：产出 `Tauri_vs_Electron.md`（体积/启动/FS API/签名分发/React 复用度/Rust 改造成本）。
- **P1-3 Mobile 最小可用客户端（查阅端）**：PWA 或 React Native；只读（列表/筛选/搜索/分享预览）；不做采集/写入。
- **P1-4 桌面 agent 与采集能力解耦**：✅ 已完成（2026-08-12）。`collector.cjs`/`cacheStore.cjs` 新增 `--selftest` CLI；新增 `agent/collectorAgent.cjs` 适配层；`integration-check.cjs` 无 GUI 验证通过。

### P2 · 云端同步与多端一致
- **P2-1 PostgreSQL 迁移**：Prisma `provider` 切 `postgresql`；`prisma migrate` 基线；双写影子读跑 1 周后切主。
- **P2-2 MinIO/S3 存储抽象**：抽象 `StorageBackend` 接口（put/get/delete/presign），本地 FS 与 MinIO 双实现；上传经服务端代理签名直传。
- **P2-3 多端实时同步与冲突策略**：Web 端上传协同；以 `localMtime + hash` 为版本向量；删除走软删 + 回收站；SyncPanel 改"基于 cursor/ETag 增量拉取"。
- **P2-4 检索升级 Meilisearch**：替代 `LIKE` 模糊查询；资产入库异步写索引；向量雏形（`ocrText`/标题 embedding）。

### P3 · 智能增强
- **P3-1 OCR 文本抽取**：本地 OCR（Tesseract WASM / 轻量模型）写 `ocrText`；敏感资产强制本地执行。
- **P3-2 向量检索 / 语义搜索**：embedding + 向量近邻召回 + 关键词 BM25 融合（RRF）。
- **P3-3 多人实时协同编辑与权限细分**：CRDT/OT 协同；五级权限（查看/评论/编辑/管理/拥有）。
- **P3-4 本地轻量模型叠加分类（可选）**：规则引擎仍为离线基线；模型给"低置信规则结果"二次建议，不强制覆盖。

### 已知风险
| 项 | 状态 |
|----|------|
| Electron 真机 GUI 验证 | 阻塞：`electron.asar` 缺失（GitHub release CDN 被防火墙拦截）；逻辑层已用 `integration-check.cjs` 验证通过 |
| PostgreSQL / MinIO 上云迁移 | P2 规划中 |
| OCR / 向量检索 | P3 规划中 |
| 多人实时协同 | P3 规划中 |

---

## 十、验证

### 后端冒烟 `backend/smoke.mjs`
运行：`cd backend && node smoke.mjs`（需后端 :3001 运行）

当前规模：**165/165 全绿**，覆盖：
- 注册/建空间/绑实例/登资源区/step-up/触发/确认/执行 result=3/列资产=3/文件可下载
- 缺 step-up 返 401、全实例 requireConfirm=true
- 文件夹嵌套+列表、标签创建、带文件夹/标签上传、新版本+列版本+恢复、元数据编辑
- 创建分享+免登录取回+免登录下载、错误密码 401、不存在链接 404
- **安全回归**：分级授权（非 owner 触发 full_instance→403）、PATCH 越权（非 owner 改他人资产→403）、详情不泄漏分享密码哈希、实例令牌吊销（解绑后心跳→401）、分享默认过期（≈7 天）、搜索匹配描述、文件夹名禁 `/`→422、标签 trim 归一、分享 inline HTML 降级 octet-stream+nosniff
- **批量下载**：上传两文件→批量下载 200 + zip 魔数 PK、空 ids→422、越权用户→403
- **桌面采集同步**（[40]~[43]）：同步新建 3 条且自动分类（document/image/document）正确、按来源父文件夹自动打标签（合同）、内容未变再次同步全部 skipped、改内容后同步 updated=1 且文件内容/版本更新、非空间成员同步 403
- **离线分类**（[71]）：代码/发票PDF→票据/微信支付截图→票据/屏幕截图→截图/保密协议→合同/旅行照片→照片/压缩包→归档/歌曲→音频/视频→视频/Word→文档/未知二进制→其他，全部确定性命中
- **分类筛选**（[72]）：按 `category` 筛选仅返回对应类；不存在分类返回空列表
- **分类规则**（[73]~[77]）：建规则前 pdf→文档、建规则 201 + 重复拒、新 pdf→合同（规则覆盖）、重算变更≥1、规则列表 + 统计看板含合同类

### 其他验证
- 后端 `tsc`（`npm run build`）：0 错误
- 前端 `tsc --noEmit` + `vite build`：通过（LibraryPage 独立 chunk）
- 三个 electron cjs `node --check` 通过
- `collector.cjs --selftest`：6/6 通过
- `cacheStore.cjs --selftest`：5/5 通过
- `integration-check.cjs`：6 资产分类/过滤/递归正确

### 如何运行
```bash
cd backend
# 依赖 Prisma 客户端已生成；如改动 schema 后：
npx prisma db push && npx prisma generate
# 启动（监听 3001，须绑定 127.0.0.1）
npx tsx src/index.ts
# 端到端冒烟（自包含，会新建临时源目录）
node smoke.mjs
```

> 注：`/share/*` 为公开端点（不挂 `authRequired`），仅依赖链接 token / 密码，可与登录态解耦用于外部分享。
> 响应约定：`success()` 始终返回 HTTP 200，真实状态码放在响应体 `code` 字段（如 201）；`fail()` 会正确设置 HTTP 状态码。`smoke.mjs` 据此断言 `res.data.code` 而非 `res.status`。
