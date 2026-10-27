---
name: "secrets-sync-checklist"
description: "重要信息变更同步清单。改完 secrets.md（真相源）后必须 Grep 全项目扫残留旧值，防止 pm2 三次漂移这类各文件信息互相矛盾的事重演。每次版本 bump、服务器操作、发版前必跑。"
---

# secrets.md 变更同步清单

## 🔴 核心铁律

**secrets.md 是唯一真相源**，任何信息变更必须：
1. ✅ 先改 secrets.md
2. ✅ Grep 全项目扫残留旧值
3. ✅ 修正所有活跃文件的残留
4. ✅ 历史档案（CHANGELOG/archive/06_交接）故意留着当教训，不改

---

## 触发时机（6 个必跑点）

| # | 什么时候 | 要扫什么 |
|---|---------|---------|
| 1 | 改了 pm2 进程名/端口/服务器 IP/目录 | pm2 名 + 端口 + 路径全项目扫 |
| 2 | 改了数据库类型/表名前缀 | MySQL/SQLite + 表名模式全项目扫 |
| 3 | 版本号 bump（AGENTS.md 铁律 #1） | 版本号 5 落点全同步 + 残留旧版本号 |
| 4 | 新增/修改管理员账号、LLM key 路径等敏感路径 | 路径引用全项目扫 |
| 5 | 任何 secrets.md 表格里的单元格变动 | 该单元格的旧值全项目扫 |
| 6 | Electron 打包前 | Defender DLL 锁 → 检查旧 release 目录 + 换新输出目录绕过 |

---

## 可执行清单（改完 secrets.md 立刻跑）

### 第一步：提取旧值

改完 secrets.md 后，**把被替换掉的旧值列出来**。例如：
- 旧 pm2 进程名：`backend`（从 `aie-backend` → `backend` → `erp-backend`，三个都要扫）
- 旧端口：`3100`（从 3001 → 3100 → 3000）
- 旧数据库类型：`MySQL`（从 MySQL → SQLite）

### 第二步：Grep 扫活跃文件

```powershell
# 在 APP-AIE/ 根目录执行
$PROJ = "D:\源码存档\助理项目\助理项目\APP-AIE"
$oldValues = @("旧值1", "旧值2", "旧值3")  # ← 把第一步的旧值列进来

foreach($v in $oldValues) {
  Write-Output "==== 扫旧值: $v ===="
  # 扫 .md 台账（排除 archive 和 06_审查与交接 历史档案）
  Get-ChildItem -Path $PROJ -Recurse -Filter *.md |
    Where-Object { $_.FullName -notmatch 'archive|06_审查与交接|CHANGELOG' } |
    Select-String -Pattern $v -SimpleMatch |
    ForEach-Object { "  🔴 $($_.Path.Replace($PROJ+'\','')) :$($_.LineNumber)" }
}
```

### 第三步：逐个修正

- 活跃文件里的残留 → Edit 工具逐块替换
- SKILL.md 里的残留 → 同样 Edit 替换
- agents/*.md 里的残留 → 同样 Edit 替换
- 历史档案里的残留 → **故意不改**（留着当教训）

### 第四步：验证再扫一遍

改完后重新跑第二步的 Grep，**活跃文件里零残留**才算过关。

### 第五步：写台账

把"改了啥旧值、哪些文件有残留、修正了哪些"追加到今日 daily.md。

---

## 真实案例（2026-10-18 pm2 三次漂移）

### 漂移历史
```
初始状态   → aie-backend（agents/SKILL/handover 全写这个）
10-14 临时 → backend（pm2 list 看到这个，只改了 handover）
10-17 实测 → erp-backend（secrets.md 实测确认真名）
```

### 改完 secrets.md 后的残留 Grep 结果（当时没做，后来补扫的）

| 旧值 | 活跃文件残留数 | 修正 |
|------|---------------|------|
| `aie-backend` | ~50 处（agents/SKILL/handover/issues/INDEX） | ✅ 全修 |
| `backend`（非 erp-backend） | ~20 处（INDEX/issues/STATUS） | ✅ 全修 |
| `3100` | ~10 处（AGENTS/handover/STATUS） | ✅ 全修 |
| `MySQL` | 5 处（AGENTS ⑥ 区块） | ✅ 全修 |
| `pitfalls.md`（已删除） | 10 处（work-growth-logger SKILL） | ✅ 改 issues.md |

### 教训

**只改 secrets.md 而不 Grep 扫残留 = 改了等于没改**。三次漂移每次都只改了部分文件，导致新旧信息长期共存，新 AI 进门被矛盾信息搞懵。

---

## 与 AGENTS.md 铁律的关系

| 铁律 | 关系 |
|------|------|
| #14 重要信息变更三处同步 | 本 SKILL 是 #14 的**可执行落地版**——不是口头说"同步"，而是有具体 Grep 步骤 |
| #15 关键远程操作前必须先验证 | 改完后 Grep 扫残留 → 就是一种验证 |

---

## 维护升级

- **触发**：下次再改 secrets.md 里的任何值时，回来更新这个 SKILL（比如新增要扫的关键词、优化 Grep 命令）
- **归档**：每次跑这个 SKILL 后，把发现的残留数量追加到本文件底部的"实战战绩"区块
- **实战战绩**：
  - [2026-10-18] pm2 三次漂移统一 → 扫出 100+ 处残留，修正 13 个文件（详见 daily/2026-10-18.md）