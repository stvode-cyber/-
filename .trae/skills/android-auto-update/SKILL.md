---
name: "android-auto-update"
description: "APP-AIE Android APK release pipeline + auto-update chain: version sync, build, upload, seed, verify. Invoke when building APK or bumping Android version."
---

# APP-AIE Android APK 发布 + 自动更新管线

端到端链路：**改版本号 → vite build → cap sync → gradlew assembleDebug → 算 MD5 → SCP 上传 nginx → seed 后端 android_releases → curl 验证 → adb install 真机验收**。

## 铁律（必读）

| 铁律 | 原因 | 违规后果 |
|------|------|----------|
| **版本号 3 处必须一致** | UpdateNotice.tsx 的 CURRENT_APK_VERSION + android/app/build.gradle 的 versionName + seed 传入的 version | 前端版本判断错乱，hasUpdate 永远 true 或永远 false |
| **APK URL 必须走 47.116.59.141 直连** | lujax.fun 域名因 SNI 封锁不可用 | 用户点"去更新"打不开下载页 |
| **先 seed 再验证 API** | seed 完立刻 curl /api/v1/app/android-version?current=旧版 看 hasUpdate=true | 线上用户检查更新时 404 或返回错误版本 |
| **手机端关掉应用分身再测** | 分身 user 900-904 会自动装包 + 抢 Activity 栈 | adb install 后看不到 App / 被 ERP 覆盖 |

## 架构

```
手机启动
  │
  ├── React 渲染 → Layout 挂载 UpdateNotice
  │
  └── useEffect (3s 延迟)
        │
        └── GET /api/v1/app/android-version?current=1.0.2
              │
              ├── hasUpdate=false → 静默忽略
              │
              └── hasUpdate=true → 弹 UpdateNotice Dialog
                    │
                    ├── "去更新" → window.open(apkUrl)
                    │               → 浏览器下载 APK
                    │               → 用户手动安装（Android Intent）
                    │
                    └── "下次再说" → localStorage 记 dismissedVersion
                                     → 同版本不再弹
```

## 环境与路径

```
$PROJ = d:\源码存档\助理项目\助理项目\APP-AIE
APK 产物: $PROJ\frontend\android\app\build\outputs\apk\debug\app-debug.apk
前端版本常量: $PROJ\frontend\src\components\UpdateNotice.tsx → CURRENT_APK_VERSION
Gradle 版本: $PROJ\frontend\android\app\build.gradle → versionName
后端 seed 脚本: $PROJ\backend\seed-android-release.cjs
APK 云端托管: /usr/share/nginx/html/apk/greenrhino-latest.apk
数据库表: android_releases (SQLite)
SSH: root@47.116.59.141
```

## 完整流程（按顺序执行）

### Step 1 — 版本号 3 处对齐

```
# 1. UpdateNotice.tsx 顶部常量
CURRENT_APK_VERSION = '1.0.3'          ← 改成新版本

# 2. android/app/build.gradle
versionCode 4                          ← +1 递增
versionName "1.0.3"                    ← 改成新版本

# 3. seed-android-release.cjs 调用时传入同一个版本号
```

### Step 2 — 构建 APK

```powershell
cd $PROJ\frontend

# Vite build（mobile 模式，API base URL 指向云端）
$env:VITE_API_BASE_URL = 'http://47.116.59.141/api/v1'
npx cross-env VITE_BUILD_MODE=mobile vite build --config mobile-vite.config.ts

# Capacitor sync
npx cap sync android

# Gradle assembleDebug
cd android
.\gradlew.bat assembleDebug
```

**阻塞问题处理**：

| 错误 | 处理 |
|------|------|
| `sourceCompatibility 无效源发行版 21` | android/build.gradle 已设 afterEvaluate 强制 JDK 17，确认环境有 JDK 17 |
| `EPERM on .dex / .tmp` | 关 Android Studio + 删 app/build 目录重跑 |

### Step 3 — 算 APK 大小 + MD5

```powershell
$apk = "$PROJ\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
$sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 2)
$md5    = (Get-FileHash $apk -Algorithm MD5).Hash.ToLower()
Write-Host "sizeMB=$sizeMB md5=$md5"
```

### Step 4 — SCP 上传 APK 到云端

```powershell
# 主 APK（latest 软链）
scp $apk root@47.116.59.141:/usr/share/nginx/html/apk/greenrhino-latest.apk

# 同时存一份带版本号的归档（可选）
scp $apk "root@47.116.59.141:/usr/share/nginx/html/apk/greenrhino-v1.0.3.apk"

# 验证文件在服务器上
ssh root@47.116.59.141 "ls -lh /usr/share/nginx/html/apk/greenrhino*"
```

### Step 5 — Seed 后端 android_releases 表

```powershell
# 上传 seed 脚本到云端（首次或更新时）
scp "$PROJ\backend\seed-android-release.cjs" root@47.116.59.141:/root/backend/

# 执行 seed
ssh root@47.116.59.141 @"
cd /root/backend
node seed-android-release.cjs 1.0.3 13.68 https://47.116.59.141/apk/greenrhino-latest.apk 30dcddab9bbd6f01fc0b924cac2321dd '更新说明（弹框展示的 notes 段落）'
"@
```

**seed 脚本自动做 2 件事**：
1. 把所有旧记录 isLatest 置 false
2. 插入新版本 isLatest=true

### Step 6 — 公网 API 回查验证

```powershell
# 模拟手机当前版本 1.0.2，应该 hasUpdate=true
Invoke-RestMethod -Uri "http://47.116.59.141/api/v1/app/android-version?current=1.0.2"

# 模拟手机已是 1.0.3，应该 hasUpdate=false
Invoke-RestMethod -Uri "http://47.116.59.141/api/v1/app/android-version?current=1.0.3"
```

**验收标准**：
- 旧版请求 → `hasUpdate: true` + 正确的 version/apkUrl/sizeMB
- 新版请求 → `hasUpdate: false`

### Step 7 — 真机验收（可选，内测阶段）

```powershell
# 关应用分身后（用户手动去手机设置）
adb install -r "$PROJ\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
adb shell am force-stop com.aie.assistant
adb shell "am start -n com.aie.assistant/.MainActivity --user 0"

# 等 auto-login(~15s) + UpdateNotice 延迟 3s = 约 18s 后截图
Start-Sleep -Seconds 20
adb shell "screencap -p /sdcard/check.png"
adb pull /sdcard/check.png "$env:TEMP\check.png"
```

**验收标准**：
- 启动后 3-5 秒弹"发现新版本 vX.Y.Z → vX.Y.Z" Dialog
- 点"去更新" → 跳浏览器下载
- 点"下次再说" → 关闭，同版本不再弹

### Step 8 — 后端代码更新（仅改了后端时）

```powershell
# 如果改了 backend 代码（不是前端）
cd $PROJ\backend
npm run build
scp -r dist root@47.116.59.141:/root/backend/
scp prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/
ssh root@47.116.59.141 "cd /root/backend && npx prisma db push && pm2 restart aie-backend"
```

## Force Update 模式

在 seed 脚本最后加 `true` 参数（forceUpdate=true）：

```bash
node seed-android-release.cjs 1.0.4 13.8 ... "关键安全更新" true
```

效果：
- 前端 Dialog **不显示"下次再说"按钮**
- 显示红色"🔴 本次更新为强制更新，请尽快安装"
- 用户只能点"立即下载"

## 版本号铁律速查

| 位置 | 文件 | 字段 |
|------|------|------|
| 前端常量 | `src/components/UpdateNotice.tsx` | `CURRENT_APK_VERSION` |
| Gradle | `android/app/build.gradle` | `versionCode` / `versionName` |
| Seed 调用 | `node seed-android-release.cjs X.Y.Z ...` | 第一个参数 |
| 显示文案 | `src/pages/settings/AboutSettingsPage.tsx` | `CURRENT_VERSION`（可选同步） |

## 已知限制

| 限制 | 现状 | 后续 |
|------|------|------|
| Android 13+ 未知来源安装 | 用户点"去更新"后浏览器下载 → 手动点 APK 安装 | 正式版加 FileProvider + Android Intent 静默安装 |
| 应用分身抢 Activity | 必须用户手动去手机设置关分身开关 | adb 无法关系统级分身，只能提示用户 |
| MD5 vs SHA256 | 用 MD5（兼容旧 Android） | 升级后改 SHA256 |
| 前端 bundle 内嵌 APK | 每次改前端 JS 必须重打包 APK | 可考虑 Capacitor Hot Code Push 插件 |

## 验收完成标准

1. `curl /api/v1/app/android-version?current=旧版` → hasUpdate=true
2. `curl /api/v1/app/android-version?current=新版` → hasUpdate=false
3. 手机启动 3s 后弹更新 Dialog（应用分身关掉后）
4. APK URL 在浏览器能直接下载
