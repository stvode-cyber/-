# ========================================================================
# Android 发版脚本 — 一键构建 + 签名 + 上传 + 写 DB
# 用法:
#   .\release-android.ps1 -Version 1.0.5 -Notes "v1.0.5 功能说明"
#   .\release-android.ps1 -Version 1.0.5 -Notes "修复登录 bug" -Force
# ========================================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,          # 新版本号，如 1.0.5

    [string]$Notes = "",       # 发版说明

    [switch]$Force = $false,   # 强制更新旧版本 (默认只在 version 变了才写 DB)

    [string]$Server = "root@47.116.59.141",
    [string]$RemoteApkDir = "/opt/aie-app/data",
    [string]$RemoteDb = "/opt/aie-app/prisma/prisma/prod.db"
)

$ErrorActionPreference = "Stop"
$frontendDir = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$apkName = "aie-mobile-$Version.apk"
$serverUrl = "http://47.116.59.141/apk/$apkName"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  绿角犀 Android 发版 v$Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 构建 mobile-dist ----------
Write-Host "[1/5] 构建 Vite mobile-dist ..." -ForegroundColor Yellow
Push-Location "$frontendDir\frontend"
try {
    npm run build:mobile 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "Vite build:mobile 失败" }
    Write-Host "  ✅ mobile-dist 构建完成" -ForegroundColor Green
}
finally { Pop-Location }

# ---------- 2. 拷贝到 Capacitor assets ----------
Write-Host "[2/5] 拷贝 mobile-dist → android assets ..." -ForegroundColor Yellow
$androidAssets = "$frontendDir\frontend\android\app\src\main\assets\public"
if (Test-Path $androidAssets) { Remove-Item $androidAssets -Recurse -Force }
Copy-Item "$frontendDir\frontend\mobile-dist" $androidAssets -Recurse -Force
Write-Host "  ✅ assets 已更新" -ForegroundColor Green

# ---------- 3. Gradle assembleRelease ----------
Write-Host "[3/5] Gradle assembleRelease ..." -ForegroundColor Yellow
$env:ANDROID_HOME = "C:\Users\Administrator\.android-sdk"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.14+7"
Push-Location "$frontendDir\frontend\android"
try {
    .\gradlew.bat clean assembleRelease --no-daemon 2>&1 | Select-Object -Last 15
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease 失败" }
    Write-Host "  ✅ APK 构建完成" -ForegroundColor Green
}
finally { Pop-Location }

# ---------- 4. 重命名 + 计算 MD5 ----------
$apkSrc = "$frontendDir\frontend\android\app\build\outputs\apk\release\app-release.apk"
$apkDst = "$PSScriptRoot\$apkName"
if (!(Test-Path $apkSrc)) { throw "APK 不存在: $apkSrc" }
Copy-Item $apkSrc $apkDst -Force

$md5 = (Get-FileHash $apkDst -Algorithm MD5).Hash.ToUpper()
$sizeMB = [math]::Round((Get-Item $apkDst).Length / 1MB, 2)
Write-Host "[4/5] APK 信息:" -ForegroundColor Yellow
Write-Host "  路径: $apkDst"
Write-Host "  MD5:  $md5"
Write-Host "  大小: $sizeMB MB"

# ---------- 5. 上传服务器 + 写 DB ----------
Write-Host "[5/5] 上传 ECS + 写 DB ..." -ForegroundColor Yellow

# 5a. 上传 APK
$remoteTemp = "/tmp/$apkName"
Write-Host "  上传 → $Server`:$remoteTemp" -NoNewline
scp $apkDst "$Server`:$remoteTemp" 2>&1 | Out-Null
Write-Host " ✅" -ForegroundColor Green

# 5b. 移动到 Express data 目录 + 写 DB
$sqliteSql = @"
UPDATE android_releases SET isLatest=0;
INSERT OR REPLACE INTO android_releases (id, version, isLatest, sizeMB, apkUrl, apkMd5, notes, forceUpdate)
VALUES ('apk_v$($Version.Replace('.','_'))', '$Version', 1, $sizeMB, '$serverUrl', '$md5', '$(($Notes -replace "'", "''"))', 0);
"@

$remoteCmd = @"
mv $remoteTemp $RemoteApkDir/$apkName &&
sqlite3 $RemoteDb "$sqliteSql" &&
echo '=== DB 更新后 ===' &&
sqlite3 $RemoteDb "SELECT id, version, isLatest, apkMd5, sizeMB FROM android_releases;" &&
echo '=== API 验证 ===' &&
curl -s http://127.0.0.1:3101/api/v1/app/android-version?current=$Version
"@

ssh $Server $remoteCmd

# ---------- 完成 ----------
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ Android v$Version 发版完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  APK URL : $serverUrl"
Write-Host "  APK MD5 : $md5"
Write-Host "  APK 大小: $sizeMB MB"
Write-Host ""
Write-Host "  用户自动检测到 hasUpdate=true"
Write-Host ""
