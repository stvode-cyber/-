@echo off
REM ====================================================================
REM 社区模块数据库迁移脚本
REM 执行 prisma db push 同步 schema 到 SQLite
REM ====================================================================
cd /d "%~dp0backend"

echo ========================================
echo  Prisma DB Push (社区模块)
echo ========================================
call npx prisma db push

if %ERRORLEVEL% EQU 0 (
  echo.
  echo [OK] 数据库 schema 同步成功。
) else (
  echo.
  echo [FAIL] 数据库同步失败，请查看上方错误。
)

echo.
pause
