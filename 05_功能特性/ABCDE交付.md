# APP-AIE · A–E 功能交付文档

> 日期：2026-08-11
> 范围：进化视觉化 / 等级特权 / 跨会话排行榜 / 分类规则导入导出+趋势图 / Electron 真机验证清单
> 验证结论：**后端构建通过、冒烟 165/165 通过、前端 tsc+vite 构建通过**

---

## A. 进化视觉化（3D 宠物本体进化反馈）

**目标**：让进化不仅体现在徽章/光环 emoji，而是直接反映在 3D 宠物模型上。

### 后端 / 配置
- `petEvolution.ts`：阶段 `baby(Lv1) → grow(Lv3) → mature(Lv5) → full(Lv8) → legend(Lv12)`，每阶段带 `title / aura / desc`。

### 前端
- `frontend/src/components/Pet3D.tsx`
  - 新增 props：`evolutionStage?: string`、`aura?: string | null`。
  - 体型缩放（`targetScale`，按阶段平滑 lerp）：legend 1.25 / full 1.15 / mature 1.05 / grow 0.95 / baby 0.85。
  - 传奇阶段：`gold` 材质 + `metalness 0.65` + `emissive` 自发光。
  - 光环（TorusGeometry 1.35×0.09）随成长阶段（grow+）显隐，颜色按阶段变化；legend 阶段光环旋转并缩放呼吸。
- `frontend/src/pages/PetPage.tsx`：两处 `<Pet3D>` 均传入 `evolutionStage={pet.evolutionStage}`。

### 验证
- [78] 进化接口：Lv1→幼崽，下一阶段为成长体(Lv3)。
- [81] 小游戏高分跨 Lv1→Lv3 触发成长体进化。
- 前端构建通过（Pet3D 471KB 分包）。

---

## B. 等级特权扩展（专属互动 + 经验加成）

**目标**：高等级解锁专属互动动作，且经验获取随等级加成。

### 后端
- `backend/src/routes/pet.routes.ts`
  - `SPECIAL_ACTIONS`：`walk 遛弯(Lv5)`、`train 特训(Lv8)`，含 mood/energy/exp/coins 影响。
  - `LEVEL_EXP_MUL(level) = min(1 + level*0.02, 1.5)`（最高 +50%）。
  - 互动处理：未达解锁等级 → `403`；基础经验乘以加成倍率。
  - 小游戏结算经验同样按 `LEVEL_EXP_MUL` 加成。
  - 新增 `GET /api/v1/pet/special-actions`（返回动作列表 + `unlocked` 标记）。
  - `actionSchema` 枚举扩展 `walk | train`。

### 前端
- `frontend/src/lib/api.ts`：`ActionType` 扩展 `walk|train`；新增 `PetSpecialAction` 接口与 `getPetSpecialActions()`。
- `frontend/src/pages/PetPage.tsx`：新增「专属互动」卡片，未解锁显示「LvN 解锁」锁定态。

### 验证（smoke）
- [84] Lv3 遛弯/特训 均 403。
- [85] Lv3 feed 实得经验 11（基础10 ×1.06）。
- [86] 专属动作列表 `unlocked=false`（Lv5/Lv8 未解锁）。
- [83] 每日签到等级加成（Lv3 奖励=5+3=8）。

---

## C. 跨会话宠物排行榜

**目标**：跨会话/跨用户按等级与经验排名，脱敏展示。

### 后端
- `backend/src/routes/pet.routes.ts`：`GET /api/v1/pet/leaderboard`
  - `prisma.pet.findMany`：`include user{nickname,username}`，`orderBy level desc, exp desc`，`take 1..50`。
  - 返回：`rank / petId / name / ownerName / level / exp / evolutionTitle / evolutionAura / isMe`（当前用户高亮）。

### 前端
- `frontend/src/lib/api.ts`：`PetLeaderboardEntry` 接口 + `getPetLeaderboard(limit=20)`。
- `frontend/src/pages/PetPage.tsx`：新增「宠物排行榜」卡片，前三名 🥇🥈🥉，自己行 `bg-primary-50` 高亮。
- 轮询：5 个 loader 每 15s 刷新。

### 验证（smoke）
- [87] 排行榜 200 非空、按等级降序、含脱敏 `ownerName`、标记 `isMe`。

---

## D. 分类规则导入/导出 + 统计趋势图

**目标**：规则可备份/迁移（导入导出），并可视化近 30 天资产增长趋势。

### 后端
- `backend/src/routes/categoryRule.routes.ts`
  - `GET /api/v1/category-rules/export`：返回 `{ version, spaceId, exportedAt, rules[] }`（映射 matchType/pattern/targetCategory/priority/enabled）。
  - `POST /api/v1/category-rules/import`：**覆盖式**（先 `deleteMany({spaceId})` 再批量 `create`，上限 500），返回 `{ created, total }`。
- `backend/src/routes/asset.routes.ts`：`/stats` 新增 `trend`：按 `YYYY-MM-DD` 分桶统计近 30 天（起始 00:00），返回 `{ total, byCategory, byType, trend:[{date,count}] }`。

### 前端
- `frontend/src/lib/api.ts`：`CategoryRuleExport` 接口 + `exportCategoryRules(spaceId)` / `importCategoryRules(spaceId, rules)`；`AssetStats` 增加 `trend?`。
- `frontend/src/pages/LibraryPage.tsx`
  - 导出：Blob 下载 `category-rules-{spaceId}.json`。
  - 导入：`<input type=file>` 读取 JSON，校验 `.rules` 数组后调用 import，刷新规则与统计。
  - `TrendChart` 纯 SVG 组件（polyline + area，viewBox 300×56），统计面板渲染 30 天趋势。

### 验证（smoke）
- [88] 导出含已建 `pdf→合同` 规则。
- [89] 导入 2 条（覆盖），导入后总数=2。
- [90] 趋势数组长度=30，均为非负整数。

---

## E. Electron 真机验证清单

**文档**：`backend/ELECTRON_VERIFICATION_GUIDE.md`

**沙箱根因**：本机 `resources/` 缺少 `electron.asar`，导致 Electron GUI 无法在沙箱内启动（环境限制，非代码缺陷）。

**文档内容**：
- 根因说明 + 重新安装步骤。
- `resources/frontend` 与 `resources/backend` 的 Junction（符号链接）搭建。
- `npm start` 预期日志。
- 逐项验证表（含 A–D 需要真机视觉确认的点）。
- 故障排查。
- A–D 中需真机视觉确认的项：A 的 3D 进化特效、C 排行榜渲染、D 趋势图渲染。

> Electron GUI 链路需在「可访问 GitHub 的机器」上重装 electron 后实跑确认。

---

## F. 增强迭代（1 / 2 / 3）

> 在 A–E 基础上追加三项增强。验证结论：**后端构建通过、冒烟 165/165 通过、前端 tsc+vite 构建通过**

### 1. A 进化造型差异（3D 宠物本体部件）
**目标**：让不同进化阶段在 3D 模型上有明显造型差异，而非仅缩放/变色。

**前端** `frontend/src/components/Pet3D.tsx`：
- 新增条件可见部件（初始 `visible=false`，动画循环内按 `evolutionStage` 切换）：
  - 小翼芽（左右各一，`BoxGeometry` 旋转 35°，`grow+` 显形，legend 加大）。
  - 犄角（左右各一，`ConeGeometry`，`mature+` 显形）。
  - 王冠（`CylinderGeometry` 环形 + 三枚 `ConeGeometry` 尖齿，`legend` 显形，金色）。
- 传奇阶段同时启用金色自发光 + 大翼 + 王冠 + 更强光环；幼崽保持最简形态。

### 2. 排行榜周 / 月榜切换（后端 + 前端）
**后端** `pet.routes.ts` `GET /pet/leaderboard`：
- 新增 `range` 查询参数：`all`（默认，全量）/ `week`（近 7 天 `updatedAt`）/ `month`（近 30 天）。
- 按时间窗过滤后再按 `level desc, exp desc` 排序；响应新增 `range` 字段回传。
- 全局榜 `total` 仍为全量宠物数（不受 `range` 影响，仅列表受时间窗约束）。

**前端** `api.ts` + `PetPage.tsx`：
- `getPetLeaderboard(limit, range)`，`range: LeaderboardRange = 'all' | 'week' | 'month'`。
- 排行榜卡片新增「总榜 / 周榜 / 月榜」三态切换按钮（选中高亮），切换即重载榜单。

### 3. 分类规则导入增量合并（后端 + 前端）
**后端** `categoryRule.routes.ts` `POST /category-rules/import`：
- 新增 `mode` 参数：`cover`（默认，删后重建）/ `merge`（增量合并）。
- `merge` 逻辑：以 `spaceId + matchType + pattern` 为去重键——已存在则 `update`（更新 `targetCategory/priority/enabled`），不存在则 `create`；返回 `{ created, updated, total }`。
- `cover` 逻辑保持原覆盖式（先 `deleteMany` 后逐条 `create`），返回 `{ created, total }`。

**前端** `api.ts` + `LibraryPage.tsx`：
- `importCategoryRules(spaceId, rules, mode?)` 透传 `mode`。
- 导入弹窗新增「覆盖 / 合并」选择器（默认覆盖），合并时提示「已存在规则将更新」。

### 验证（smoke，新增用例）
- [91] 排行榜 `range=all/week/month` 均返回列表且带 `range` 字段。
- [92] 导入 `merge`：新建 1 + 更新 1，`total=3`，`pdf` 规则被合并更新为「文档」。

---

## 验证总览

| 项 | 结果 |
|----|------|
| 后端 `npm run build` | ✅ exit 0，无 TS 错误 |
| 后端 `node smoke.mjs` | ✅ 165 通过 / 0 失败（含 [84]–[92]） |
| 前端 `tsc --noEmit` | ✅ exit 0 |
| 前端 `vite build` | ✅ 构建成功（PetPage 485KB 分包） |
| Electron GUI 实跑 | ⏸️ 受沙箱 `electron.asar` 缺失限制，需真机 |

## 已知限制
1. Electron 桌面端（浮窗宠物/壁纸/便签/采集）需真机 `npm start` 验证，沙箱无法启动 GUI。
2. A 的 3D 进化视觉、C/D 的图表渲染建议在真机或浏览器中肉眼确认观感。
3. 排行榜为全局跨用户榜单，已做 `ownerName` 脱敏（昵称/用户名）。

## 运行方式
- 后端：`cd backend && npm run build && node dist/index.js`（默认 `:3001`）
- 前端：`cd frontend && npm run dev`（开发） / `npm run build`（产物 `dist/`）
- 冒烟：`cd backend && node smoke.mjs`
