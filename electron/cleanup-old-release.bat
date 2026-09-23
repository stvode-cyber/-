REM TODO: [electronBuilder����ռ��] Ԥ��������ű��ײ� taskkill /F /IM �̽�Ϭ.exe��������һ�ι����� exe δ�ͷ��ļ��� �� EPERM Access denied
@echo off
chcp 65001 >nul
echo ============================================
echo   绿角犀 - �?release 目录清理脚本
echo ============================================
echo.

cd /d "c:\Users\Administrator\Desktop\助理项目\助理项目\APP-AIE\electron"

echo [1/3] 删除旧的 release 目录...
if exist "release" (
    rmdir /s /q "release"
    if exist "release" (
        echo [错误] �?release 目录仍无法删除，请确认没有程序占�?        pause
        exit /b 1
    )
    echo [成功] �?release 目录已删�?) else (
    echo [跳过] �?release 目录不存在（可能已删除）
)

echo.
echo [2/3] 重命�?release-new �?release...
if exist "release-new" (
    ren "release-new" "release"
    if exist "release\win-unpacked\绿角犀.exe" (
        echo [成功] 已重命名�?release
    ) else (
        echo [错误] 重命名后验证失败
        pause
        exit /b 1
    )
) else (
    echo [跳过] release-new 目录不存�?)

echo.
echo [3/3] 验证最终结�?..
if exist "release\win-unpacked\绿角犀.exe" (
    echo ============================================
    echo   清理完成�?    echo ============================================
    echo 打包目录: release\win-unpacked\
    echo 可执行文�? release\win-unpacked\绿角犀.exe
    echo.
    echo 可以删除此清理脚�?(cleanup-old-release.bat)
) else (
    echo [错误] 验证失败，请手动检�?release 目录
)

echo.
pause
