@echo off
chcp 65001 >nul
echo ============================================
echo   绿角犀 - 移动端构建脚本
echo ============================================
echo.

REM 设置 Node.js 路径（如果不在 PATH 中）
set PATH=C:\Users\Administrator\node-portable\node-v20.18.0-win-x64;%PATH%

REM 设置移动端 API 地址（修改为你的后端服务器地址）
set VITE_API_BASE_URL=https://lujax.fun:8444/api/v1

echo [1/4] 构建前端（移动端配置）...
cd /d "%~dp0\.."
call npx vite build
if errorlevel 1 (
    echo 前端构建失败！
    pause
    exit /b 1
)
echo.

echo [2/4] 同步 Web 资源到 Capacitor...
call npx cap sync android
if errorlevel 1 (
    echo Capacitor 同步失败！
    pause
    exit /b 1
)
echo.

echo [3/4] 构建 Android APK...
cd android
call .\gradlew.bat assembleDebug
if errorlevel 1 (
    echo APK 构建失败！
    echo 请确保已安装 JDK 17 和 Android SDK。
    echo.
    echo JDK 17 下载: https://download.oracle.com/java/17/latest/jdk-17_windows-x64_bin.zip
    echo Android SDK: https://developer.android.com/studio
    pause
    exit /b 1
)
echo.

echo [4/4] 构建完成！
echo APK 位置: android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo 注意: 请修改此脚本中的 VITE_API_BASE_URL 为你的后端服务器地址
pause
