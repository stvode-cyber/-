---
name: "android-auto-update"
description: "APP-AIE Android APK release pipeline + auto-update chain: version sync, build, upload, seed, verify. Invoke when building APK or bumping Android version."
---

# APP-AIE Android APK 发布 + 自动更新管线

端到端链路：**改版本号 → vite build → cap sync → gradlew assembleDebug → 算 MD5 → SCP 上传 nginx → seed 后端 android_releases → curl 验证 → adb install 真机验收**。

**App 内下载链路（不走浏览器）**：`UpdateNotice` → `Filesystem.downloadFile({ progress: true })` → `IntentInstaller.install()` → 系统安装器。

## 铁律（必读）

| 铁律 | 原因 | 违规后果 |
|------|------|----------|
| **版本号 3 处必须一致** | UpdateNotice.tsx 的 CURRENT_APK_VERSION + android/app/build.gradle 的 versionName + seed 传入的 version | 前端版本判断错乱，hasUpdate 永远 true 或永远 false |
| **APK URL 必须走 47.116.59.141 直连** | lujax.fun 域名因 SNI 封锁不可用 | 用户点"去更新"打不开下载页 |
| **先 seed 再验证 API** | seed 完立刻 curl /api/v1/app/android-version?current=旧版 看 hasUpdate=true | 线上用户检查更新时 404 或返回错误版本 |
| **手机端关掉应用分身再测** | 分身 user 900-904 会自动装包 + 抢 Activity 栈 | adb install 后看不到 App / 被 ERP 覆盖 |
| **禁 CapacitorHttp 原生拦截** | Capacitor v8 的 CapacitorHttp 自动注册拦截 WebView fetch，OkHttp 对 HTTP cleartext 有限制 → "Failed to fetch" | UpdateNotice 里 fetch 报 Failed to fetch，APK 下载全挂 |
| **Java HttpURLConnection 也需 cleartext 放行** | Filesystem.downloadFile 原生用 HttpURLConnection（不是 OkHttp），也受 cleartext 限制 | downloadFile 挂住不返回，进度永远 5% |
| **IntentInstallerPlugin 用 initialPlugins.add 注册** | MainActivity.onCreate() 里 `this.initialPlugins.add(IntentInstallerPlugin.class)` 比 load()→registerPlugin() 更稳 | PluginLoadException / registerPlugin 不生效，JS 调 install() 直接抛异常 |
| **Gradle clean 后再 assembleDebug** | Kotlin 插件容易被 "up-to-date" 跳过编译，AAR 里缺 .class | FilesystemPlugin / IntentInstallerPlugin 找不到 class |

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
                    ├── "立即更新" ──────────────────┐
                    │                                 │
                    │   Filesystem.downloadFile({    │
                    │     url: apkUrl,               │
                    │     path: fileName,            │
                    │     directory: Directory.Data,  │
                    │     progress: true              │
                    │   })                           │
                    │   ↑ addListener('progress')    │
                    │     实时更新进度条              │
                    │                                 │
                    │   IntentInstaller.install({    │
                    │     path: downloadResult.path  │
                    │   })                           │
                    │   → FileProvider               │
                    │   → Intent.ACTION_VIEW         │
                    │   → 系统安装器弹出 ✅           │
                    │                                 │
                    └── "下次再说" → localStorage 记 dismissedVersion
                                     → 同版本不再弹
```

## App 内下载链路代码要点

### UpdateNotice.tsx 下载（正确写法）

```ts
// ✅ 用 Filesystem.downloadFile 原生下载（一步到位，绕过 fetch 拦截）
// ❌ 别用 fetch() + blob + base64 + writeFile（被 CapacitorHttp 原生拦截）
// ❌ 别用 window.open() 跳转浏览器（用户明确说不要）

// 1. 注册进度监听（可选，但用户体验好很多）
const progressListener = await Filesystem.addListener('progress', (e) => {
  if (e.contentLength > 0) {
    const pct = Math.round((e.bytes / e.contentLength) * 100)
    setProgress(Math.max(5, Math.min(85, pct)))
  }
})

// 2. 原生下载
const dlResult = await Filesystem.downloadFile({
  url: info.apkUrl,
  path: `update-${info.version}.apk`,
  directory: Directory.Data,
  progress: true,  // 必须开！不然没进度回调
})

// 3. 清理监听器
await progressListener.remove()

// 4. 调原生安装
let installPath = dlResult.path.replace(/^file:\/\//, '')
await IntentInstaller.install({ path: installPath })
```

### capacitor.config.ts（必须配置）

```ts
plugins: {
  // 禁 CapacitorHttp 原生拦截 — 让 WebView 自己处理 fetch
  // 原生 OkHttp 对 HTTP cleartext 有额外限制
  CapacitorHttp: { enabled: false },
}
```

### AndroidManifest.xml（必须配置）

```xml
<!-- Java HttpURLConnection 也需 cleartext 放行 -->
<application
    android:usesCleartextTraffic="true"
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

### network_security_config.xml（必须创建）

路径：`android/app/src/main/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">47.116.59.141</domain>
    </domain-config>
</network-security-config>
```

### MainActivity.java（正确注册插件方式）

```java
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ✅ initialPlugins.add() — 在 Bridge 创建前注册，最稳
        this.initialPlugins.add(IntentInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
    // ❌ 别用 load() 覆盖 — registerPlugin() 可能时序不对
}
```

### IntentInstallerPlugin.java（系统安装器）

```java
@CapacitorPlugin(name = "IntentInstaller")
public class IntentInstallerPlugin extends Plugin {
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File apkFile = new File(path);
        Uri apkUri = FileProvider.getUriForFile(getContext(),
            getContext().getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(intent, 1);
        call.resolve();
    }
}
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

关键文件:
$PROJ\frontend\capacitor.config.ts              ← 禁 CapacitorHttp
$PROJ\frontend\android\app\src\main\AndroidManifest.xml
$PROJ\frontend\android\app\src\main\res\xml\network_security_config.xml
$PROJ\frontend\android\app\src\main\java\com\aie\assistant\MainActivity.java
$PROJ\frontend\android\app\src\main\java\com\aie\assistant\IntentInstallerPlugin.java
$PROJ\frontend\src\components\UpdateNotice.tsx
$PROJ\frontend\src\lib\intent-installer.ts
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

### Step 2 — 构建 APK（**必须 clean！**）

```powershell
cd $PROJ\frontend

# Vite build（mobile 模式，API base URL 指向云端）
npm run build:mobile

# Capacitor sync
npx cap sync android

# Gradle clean + assembleDebug —— Kotlin 插件容易被 up-to-date 跳过编译
cd android
.\gradlew.bat clean assembleDebug --no-build-cache
```

**阻塞问题处理**：

| 错误 | 处理 |
|------|------|
| `sourceCompatibility 无效源发行版 21` | android/build.gradle 已设 afterEvaluate 强制 JDK 17，确认环境有 JDK 17 |
| `EPERM on .dex / .tmp` | 关 Android Studio + 删 app/build 目录重跑 |
| FilesystemPlugin / IntentInstallerPlugin 找不到 class | **必 clean！** `gradlew clean` + `assembleDebug --no-build-cache` |
| fetch 报 "Failed to fetch" | 查 capacitor.config.ts 有没有 `CapacitorHttp.enabled = false` |
| downloadFile 挂住不返回 | 查 network_security_config.xml 有没有放行 47.116.59.141 cleartext |
| IntentInstaller 注册不到 | 查 MainActivity 有没有 `initialPlugins.add(IntentInstallerPlugin.class)` |

### Step 3 — 算 APK 大小 + MD5

```powershell
$apk = "$PROJ\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
$sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 2)
$md5    = (Get-FileHash $apk -Algorithm MD5).Hash.ToLower()
Write-Host "sizeMB=$sizeMB md5=$md5"
```

### Step 4 — SCP 上传 APK 到云端

```powershell
scp $apk root@47.116.59.141:/usr/share/nginx/html/apk/greenrhino-latest.apk
scp $apk "root@47.116.59.141:/usr/share/nginx/html/apk/greenrhino-v1.0.3.apk"
ssh root@47.116.59.141 "ls -lh /usr/share/nginx/html/apk/greenrhino*"
```

### Step 5 — Seed 后端 android_releases 表

```powershell
scp "$PROJ\backend\seed-android-release.cjs" root@47.116.59.141:/root/backend/
ssh root@47.116.59.141 @"
cd /root/backend
node seed-android-release.cjs 1.0.3 13.68 http://47.116.59.141/apk/greenrhino-latest.apk 30dcddab9bbd6f01fc0b924cac2321dd '更新说明（弹框展示的 notes 段落）'
"@
```

### Step 6 — 公网 API 回查验证

```powershell
Invoke-RestMethod -Uri "http://47.116.59.141/api/v1/app/android-version?current=1.0.2"
# 应该 hasUpdate=true

Invoke-RestMethod -Uri "http://47.116.59.141/api/v1/app/android-version?current=1.0.3"
# 应该 hasUpdate=false
```

### Step 7 — 真机验收

```powershell
# 关应用分身后
adb install -r "$PROJ\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
adb shell pm clear com.aie.assistant  # 清 localStorage dismissed 标记 + token
adb shell am force-stop com.aie.assistant
adb shell "am start -n com.aie.assistant/.MainActivity"

# 等 auto-login(~5s) + UpdateNotice 延迟 3s + 下载 30s = 约 40s
```

**验收标准**：
1. 启动后 3-5 秒弹"发现新版本" Dialog
2. 点"立即更新" → 进度条从 5% 开始逐步增长（不会卡 5%）
3. 进度到 100% 后 → **系统安装器弹出**（不是浏览器！）
4. "下次再说" → 关闭，同版本不再弹

### Step 8 — 后端代码更新（仅改了后端时）

```powershell
cd $PROJ\backend
npm run build
scp -r dist root@47.116.59.141:/root/backend/
scp prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/
ssh root@47.116.59.141 "cd /root/backend && npx prisma db push && pm2 restart backend"
```

## Force Update 模式

在 seed 脚本最后加 `true` 参数：

```bash
node seed-android-release.cjs 1.0.4 13.8 ... "关键安全更新" true
```

效果：Dialog 不显示"下次再说"按钮 + 显示红色"🔴 本次更新为强制更新"。

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
| 服务器出口带宽 ~5Mbps | 13MB APK 下载约 30-35 秒 | 阿里云升级带宽 |
| 应用分身抢 Activity | 必须用户手动去手机设置关分身开关 | adb 无法关系统级分身 |
| MD5 vs SHA256 | 用 MD5（兼容旧 Android） | 升级后改 SHA256 |

## 踩坑清单（历史教训，必读）

| 坑 | 现象 | 根因 | 解法 |
|---|---|---|---|
| CapacitorHttp 拦截 fetch | fetch 报 "Failed to fetch" | Capacitor v8 自动注册 CapacitorHttp 拦截 fetch，OkHttp 对 cleartext 有限制 | capacitor.config.ts 禁 CapacitorHttp 或用 Filesystem.downloadFile |
| Java HttpURLConnection cleartext | downloadFile 挂住不返回 | HttpURLConnection 也受 cleartext 限制 | 加 network_security_config.xml 放行 |
| IntentInstallerPlugin 注册失败 | PluginLoadException / 调 install() 抛异常 | load()→registerPlugin() 时序可能不对 | onCreate()→initialPlugins.add() |
| Gradle up-to-date 跳过 Kotlin | FilesystemPlugin class 找不到 | Kotlin 插件编译被跳过 | `gradlew clean assembleDebug --no-build-cache` |
| APK 里搜不到 Kotlin 类 | UTF8 搜 .dex 字符串搜不到 | Kotlin 类名在 dex 里用 Mangled 格式 | 看 build/intermediates/ 或搜 Java 类 |

## 验收完成标准

1. `curl /api/v1/app/android-version?current=旧版` → hasUpdate=true
2. `curl /api/v1/app/android-version?current=新版` → hasUpdate=false
3. 手机启动 3s 后弹更新 Dialog（应用分身关掉后）
4. 点"立即更新" → 进度条正常增长 → **系统安装器弹出**（不是浏览器）
5. APK URL `http://47.116.59.141/apk/greenrhino-latest.apk` 在浏览器能直接下载
