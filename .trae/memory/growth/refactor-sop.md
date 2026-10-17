# 大 Page 拆子组件 SOP

> 2026-10-17 实战 4 次验证：ChatPage / HomePage / PetPage / LibraryPage

---

## 触发动机

**Page 超过 1000 行 → 必须拆**。目标 ≤ 800 行。

---

## 统一流程（5 步）

### ① 读边界

```powershell
# 找所有内联组件/函数声明行号
Select-String -Path src/pages/XxxPage.tsx -Pattern "^function |^const [A-Z]\w+\s*="
```

同时看总行数 `(Get-Content XxxPage.tsx).Count`。

### ② 选目的地（2 选一）

| 情况 | 目的地 | 例子 |
|---|---|---|
| 单一职责（数据/录音/计时） | 抽 hook 到 `src/pages/xxx/useXxx.ts` | `useHomeData.ts` / `useVoiceRecording.ts` |
| ≥4 个内联 UI 组件 | 集中到 `src/components/xxx/XxxWidgets.tsx` | `PetGames.tsx` / `LibraryWidgets.tsx` |

### ③ 搬家（Widgets 模式）

Widgets.tsx 结构：
```
imports（lucide icons / hooks / lib/utils / lib/localCache / lib/api）
↓
export interface Space { ... }        # 所有用到的 type 都 export
export interface Folder { ... }
↓
export const TYPE_META = { ... }      # 常量 export
export const CATEGORIES = [ ... ]
↓
export function fmtSize(n) { ... }     # 工具函数 export
↓
export function ModalShell() { ... }     # 小组件 export
export function Field() { ... }
export function FolderNode() { ... }
export function UploadModal() { ... }
export function DetailDrawer() { ... }
export function TrendChart() { ... }
```

**组件里用到的本地 hook（useToast / useConfirm）**——直接在 Widgets.tsx 里 import，每个独立使用，不用传 props。

### ④ 清理原 Page 文件

```
删底部所有内联组件声明块（Edit 替换为一行注释）
删顶部重复 interface / 常量 / 工具函数
↓
加 import：
import {
  TYPE_META, CATEGORY_META, fmtSize, PAGE_SIZE,
  FolderNode, UploadModal, DetailDrawer, TrendChart,
  type Folder, type Asset, type Space,
} from '../components/library/LibraryWidgets'
↓
加注释标记：
// ===== 以下常量/类型/组件已搬到 ... =====
```

### ⑤ 双验

```powershell
cd frontend
npx tsc --noEmit          # 必须零错
npm run build             # desktop
npm run build:mobile      # mobile
npm run build:admin       # admin
```

---

## 实战战绩

| Page | 之前 | 之后 | 降幅 | 目的地 |
|---|---|---|---|---|
| ChatPage | 2932 | 2796 | -5% | `chat/useVoiceRecording.ts`（hook） |
| HomePage | 1284 | 1093 | **-15%** | `home/useHomeData.ts`（hook） |
| PetPage | 1232 | 862 | **-30%** | `components/pet/PetGames.tsx`（5 组件） |
| LibraryPage | 1143 | 743 | **-35%** | `components/library/LibraryWidgets.tsx`（10 组件） |

---

## 踩过的坑（6 条铁律）

| # | 坑 | 解法 |
|---|---|---|
| 1 | 脚本 splice 多次改同一文件炸文件 | **Edit 逐块替换**，每步前 `git stash` 备份 |
| 2 | ChatPage types 单独抽文件 | JSON metadata 类型断言太复杂 → **types 不抽**，内联留在 page 里 |
| 3 | hook 里的 state 类型断言太复杂 | 用 `any` 代替外部复杂 interface，主组件 cast：`const data = _data as HomeData \| null` |
| 4 | PetPage 的 MEM_EMOJIS 只在 PetGames 内部但 PetPage 会引用 | 必须 **export 常量** + PetPage import |
| 5 | Prisma DATABASE_URL 相对路径 `file:./dev.db` | 会被 resolve 到 `backend/prisma/dev.db`（不是 `backend/dev.db`），**下次统一用绝对路径** |
| 6 | Electron 内嵌 backend SQLite 是空文件 | main.cjs 先跑 `prisma db push` 自动建表，再调 `ensureReleaseTables()` seed |

---

## 迁移模式统一约定

- **目录约定**：`components/<page>/XxxWidgets.tsx`（小写 page 名）
- **命名约定**：Widgets 里的组件名与原内联组件名完全一致，不改名字
- **不抽的东西**：复杂 JSON metadata 的 type 定义（types.ts 拆了炸过）、page 独有的本地 hook 调用逻辑
- **PowerShell 中文路径**：`sqlite3 "d:\源码存档\..."` 会炸 → 必须 `cd` 进去再用相对路径
