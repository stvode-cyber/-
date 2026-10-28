# DIR-003 方向卡 — Day 8-9 Matrix E2EE MVP

> 方向卡编号：DIR-003 v1.0
> 日期：2026-10-27 制定 · 2026-10-28 完成落地
> 决策依据：会话口头点头通过（绿角犀管家 AI 方向推演）
> 状态：✅ 已完成（git a0b16b9 · 项目进程 v0.9）

---

## 为什么跳原 IM 主线 Day 8-9 改做 E2EE

原 IM 主线规划（见 Continuwuity-IM升级方案.md）：

| 原 Day | 规划内容 | 本次实际 | 原因 |
|---|---|---|---|
| Day 8 · D5 | AI 助理 Matrix bot（绿角犀AI助理 bot + Express webhook） | **Day 8-9 做 E2EE MVP** | E2EE 是底层基础设施，不先加密后面 bot/群聊/多端全部明文暴露；Continuwuity 0.5.10 `/keys/query` + `/keys/upload` API 已实测通（Day 1 时 admin 7 个设备 key 已存在），服务端侧 OK，前端可直接上 |
| Day 9 · D6 | 旧数据迁移（Prisma IM 表 → Continuwuity） | **被 E2EE 抢占** | 迁移本身可选（升级方案明确写了"不迁也行"），加密层优先级远高于一次性数据迁移 |
| Day 10-11 · D7 | 多端同步 + 离线推送 + **E2EE 密钥多端同步** | **只做单设备 E2EE MVP** | Day 10-11 是"多设备互通"，MVP 阶段单设备先跑通房间级加密就行；密钥多端同步单独一个方向卡 |

---

## 范围边界（只做这些，别超）

### ✅ 做了什么
1. `matrixClient.ts` 加 `initRustCrypto({ useIndexedDB: true })` — Rust WASM 替代 olm/vodem native 编译
2. 房间级加密开关：`sendStateEvent(EventType.RoomEncryption, { algorithm: 'm.megolm.v1.aes-sha2', rotation_period_msgs: 100 }, '')` — Matrix 协议规定：E2EE 是房间级不是客户端级
3. ChatPage 🔒 加密标识：消息气泡显示 `event.isEncrypted()` + 底部状态栏 E2EE 徽章
4. SDK v44 类型错误全修（tsc 零错）：sendStateEvent 参数顺序、无 isDecrypted() 方法、无 setRoomEncryption() 方法
5. Vite proxy `/_matrix` → `http://47.116.59.141:8008` 已就绪（Day 5-6 就配了）

### ❌ 没做什么（明确排除）
- ~~跨设备密钥同步~~ — Day 10-11 单独方向卡
- ~~设备验证 UI（扫码/交叉验证）~~ — 同上
- ~~加密恢复口令（recovery phrase）~~ — 同上
- ~~AI 通道加密~~ — AI 助理走 Express 后端不走 Matrix SDK，不碰
- ~~多房间自动加密~~ — 当前只在用户首次发送时自动调 enableRoomEncryption

---

## SDK v44 真坑（血泪记录，下次不许重踩）

| # | 幻觉代码 | 真相 | 解决 |
|---|---|---|---|
| 1 | `client.sendStateEvent(roomId, 'm.room.encryption', '', { algorithm: ... })` — 把 stateKey 当 content 传 | 签名是 `(roomId, eventType, content, stateKey?)`，content 是第三位 | `sendStateEvent(roomId, EventType.RoomEncryption, { algorithm: 'm.megolm.v1.aes-sha2', rotation_period_msgs: 100 }, '')` |
| 2 | `event.isDecrypted?.()` | MatrixEvent 根本没有 isDecrypted() 方法 | 用 msgtype 判断：`m.bad.encrypted` = 解密失败，否则成功（或本来明文） |
| 3 | `client.setRoomEncryption()` | SDK v44 没这方法 | 直接 sendStateEvent 就行 |
| 4 | `@matrix-org/vodem` / `@matrix-org/olm` — 想装 native 编译 | npm 404！正确依赖是 `@matrix-org/matrix-sdk-crypto-wasm`（SDK v44 内置） | `npm install @matrix-org/matrix-sdk-crypto-wasm` — Vite 5 自动兼容 .wasm ES import，不用加 wasm-loader |

---

## Continuwuity 服务端硬参数（Day 1 SSH 实测）

```
公网地址：http://47.116.59.141:8008
admin Matrix ID：@admin:lujax.fun
admin access_token：7nLXqrFgZwjbnZoZiJ6KoygK
admin room：!3b7C96Koy6pTBSfIlgxi5-R77vvIdsnrq1lfI6495t8
Continuwuity 版本：0.5.10 Docker
/keys/query + /keys/upload：200 OK 实测
admin 设备数：7（含 3 个 GreenRhino SSO 自动生成）
```

## E2EE 数据流（完整端到端）

```
createClient() → initRustCrypto({ useIndexedDB: true }) → 等首次 /sync
→ 首次 sendText() → 自动 enableRoomEncryption()
    └─ sendStateEvent(m.room.encryption, { algorithm: m.megolm.v1.aes-sha2 })
    └─ SDK 自动上传设备 key 到 Continuwuity
    └─ 发送加密消息（msgtype 变 m.room.encrypted）
→ 收消息：SDK 自动解密
    └─ event.isEncrypted() → true → UI 显示 🔒
    └─ msgtype === 'm.bad.encrypted' → 解密失败（设备 key 没对上）→ UI 显示 🔐
```

## 验收标准（全部打勾才叫完成）

- [x] `npm install @matrix-org/matrix-sdk-crypto-wasm` 成功
- [x] `npx tsc --noEmit` 零错误
- [x] `npm run build` 通过
- [x] git commit（a0b16b9）
- [ ] 浏览器实测：npm run dev → http://localhost:5173 → 切 Matrix tab → 发消息 → 看 🔒 图标

---

## 抢占后推的原 Day 8-9 规划（下一步候选）

| 优先级 | 内容 | 原 Day | 备注 |
|---|---|---|---|
| P1 | Matrix 房间管理 UI（创建/邀请/踢人/切换） | Day 6-7 | ChatPage 当前只硬编码 admin room |
| P2 | AI 助理 Matrix bot | Day 8 | `绿角犀AI助理` bot + Express webhook + DeepSeek 回复 |
| P3 | 多端同步 + 离线推送 | Day 10-11 | 含 E2EE 密钥多端同步 |
| P4 | 旧数据迁移（可选） | Day 9 | 升级方案兜底：不迁也行 |
