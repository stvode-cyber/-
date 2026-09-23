---
name: "aie-electron-release"
description: "APP-AIE Electron desktop release pipeline: version alignment, build, gate check, archive. Invoke when bumping version or releasing internal/public test build."
---

# APP-AIE Electron Desktop Release Pipeline

端到端发布管线：版本对齐 -> 打包 -> 启动闸验收 -> 清理归档 -> CHANGELOG 记账 -> **推云端 EXE + seed 后端**。

## 铁律（必读）

| 铁律 | 原因 | 违规后果 |
|------|------|----------|
| **版本号 3 处必须完全一致** | electron/frontend/backend/package.json 一处漏改 -> FileVersion 不一致 -> 线上出现"幽灵版本" | 用户报告"我明明更了为什么还是旧版" |
| **改源码后必须 sync-dist 再打包** | Electron 打包用的是 electron/resources/ 下的 dist，不是 frontend/dist/ 或 backend/dist/ | 打包出来的 EXE 跑的是 N 天前的旧代码（鬼影 bug） |
| **启动闸 FAIL 必须阻断** | gate-check.ps1 exit != 0 时硬继续 -> 有版本号错位或 dist 陈旧的 EXE 流出 | 内测用户反馈后需回溯定位，耗时 1-2 小时 |
| **Exit code 必须 throw 阻断** | PowerShell 脚本里不能 Write-Error 后继续；build-desktop.cjs 不能 warn 后 return | 流水线"看起来过了其实没打包" |

## 环境与路径

```
$PROJ = d:\源码存档\助理项目\助理项目\APP-AIE
打包脚本: $PROJ\build-desktop.cjs
sync-dist: $PROJ\sync-dist.ps1
gate-check: $PROJ\gate-check.ps1
CHANGELOG: $PROJ\CHANGELOG.md
release 目录: $PROJ\electron\release-* (取最新)
```

## 完整流程（按顺序执行）

### Step 1 — 版本号对齐（3 个 package.json）

```powershell
$PROJ = "d:\源码存档\助理项目\助理项目\APP-AIE"
$old  = "1.0.4"          # 当前版本
$new  = "1.0.5"          # 目标版本

foreach ($pkg in @("electron","frontend","backend")) {
  $p = "$PROJ\$pkg\package.json"
  $c = Get-Content $p -Raw
  $c = $c -replace "`"version`": `"$old`"", "`"version`": `"$new`""
  Set-Content $p -Value $c -Encoding UTF8
}
```

验证：

```powershell
foreach ($pkg in @("electron","frontend","backend")) {
  $v = (Get-Content "$PROJ\$pkg\package.json" -Raw | ConvertFrom-Json).version
  Write-Host "$pkg : $v"
}
```

### Step 2 — 打包（build-desktop.cjs）

```powershell
Set-Location $PROJ
node build-desktop.cjs
```

**常见阻塞问题处理**：

| 错误 | 处理 |
|------|------|
| EPERM: Permission denied on electron/resources | 关 Electron + 所有 node 进程 -> 删 electron/resources -> 重跑 |
| electron-builder 卡住 | 看是否有残留 win-unpacked/ 被占用，删了重跑 |

### Step 3 — 启动闸验收（gate-check.ps1）

```powershell
Set-Location $PROJ
.\gate-check.ps1 -ExpectedVersion "1.0.5"
```

**7 项门禁**：

| 闸门 | 内容 | FAIL 阻断 |
|------|------|-----------|
| G1 | 3 x package.json 版本号对齐 | Y |
| G2 | Setup + Portable EXE 存在且 > 150 MB | Y |
| G3 | FE dist <= electron/resources/frontend 时间戳同步 | Y |
| G4 | BE dist <= electron/resources/backend 时间戳同步 | Y |
| G5 | cloud-jwt-public.pem 存在 | WARN（内测不阻断） |
| G6 | prisma/dev.db > 1 MB | Y |
| G7 | EXE FileVersion 与 package.json 一致 | Y |

**退出码**：exit 0 全过；exit 1 有 FAIL。

### Step 4 — 清理旧产物

```powershell
# 定位最新 release-* 目录
$rel = Get-ChildItem "$PROJ\electron" -Directory | Where-Object { $_.Name -like "release-*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Remove-Item "$($rel.FullName)\*$old*" -Force -ErrorAction SilentlyContinue
Remove-Item "$($rel.FullName)\*.blockmap" -Force -ErrorAction SilentlyContinue
Get-ChildItem $rel.FullName | Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}
```

### Step 5 — CHANGELOG 记账

在 CHANGELOG.md 顶部追加新条目，格式固定：

```markdown
## YYYY-MM-DD vX.Y.Z 内测发布

### 变更

- **版本号 X.Y.Z 全对齐**：...
- **启动闸 7 项全绿**：...
- **产物归档**：Setup-X.Y.Z.exe + Portable-X.Y.Z.exe

### 踩坑

- [P?-已解决] （如果有）

### 决策

- [YYYY-MM-DD] 启动闸 7 项作为后续版本发布前置门禁（active，铁律级）

---

## YYYY-MM-DD 上一个版本的条目
```

## Dist 同步铁律详细说明

sync-dist.ps1 固化了以下动作：

```powershell
.\sync-dist.ps1                      # Full: build FE + BE, sync, verify
.\sync-dist.ps1 -FrontendOnly        # FE only
.\sync-dist.ps1 -BackendOnly         # BE only
.\sync-dist.ps1 -SyncOnly            # 仅同步，跳过 build
.\sync-dist.ps1 -DryRun              # 预览，不执行
```

三层时间戳验证：frontend/src -> frontend/dist -> electron/resources/frontend/dist，任一层不匹配都 FAIL。


### Step 6 — 推云端 EXE

`powershell
# SCP to nginx static dir
scp "$PROJ\electron\release-v16\绿角犀-Setup-X.Y.Z.exe"        root@47.116.59.141:/usr/share/nginx/html/apk/
scp "$PROJ\electron\release-v16\绿角犀-Portable-X.Y.Z.exe" root@47.116.59.141:/usr/share/nginx/html/apk/

# verify file on server
ssh root@47.116.59.141 "ls -lh /usr/share/nginx/html/apk/*X.Y.Z*"
`

### Step 7 — Seed 后端 releases 表（一键脚本）

`powershell
.\seed-windows-release.ps1 -Version "X.Y.Z"
`

**自动做 5 件事**：
1. 从最新 release-* 目录定位 EXE
2. 本地计算 SHA256（大写）
3. SCP + SSH 到服务器，Prisma upsert 到 windows_releases
4. 公网 HTTPS API 回查验证 version + SHA256
5. 清理临时文件

**可选参数**：
`powershell
.\seed-windows-release.ps1 -Version "X.Y.Z" -ForceUpdate              # 强制更新
.\seed-windows-release.ps1 -Version "X.Y.Z" -Notes "Critical bugfix"  # 自定义说明
`

**返回值**：exit 0 = 成功；exit 1 = 失败（5 步任一步挂）。## PowerShell 5.1 踩坑备忘

| 坑 | 解法 |
|----|------|
| .sh 文件写 BOM 导致 bash 不认 | [System.IO.File]::WriteAllText($p, $c, [System.Text.UTF8Encoding]::new($false)) |
| 4 字节 emoji (U+1F000+) 报 Token 错误 | 禁用 emoji，用 ASCII 或 BMP 内字符 |
| here-string 结束符前有空格 | "@ 必须顶格 |
| $ErrorActionPreference='Stop' 把 npm stderr 警告当致命错误 | 临时切 Continue，跑完切回 |
| Unicode 标点 (· -- 等) 在 GBK 终端显示乱码 | 全用 ASCII 等效：· -> |，-- -> -- |
| PowerShell 5.1 curl 发中文 JSON body 被转成 ? | 改用 axios/fetch |

## 验收完成标准

1. gate-check.ps1 输出 PASS 7 / FAIL 0 / WARN 0
2. release-* 目录只剩当前版本 EXE (+ win-unpacked + builder-debug.yml)
3. CHANGELOG 已追加 vX.Y.Z 条目
4. 用户确认可以推云端
