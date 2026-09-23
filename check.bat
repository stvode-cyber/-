@echo off
REM ====================================================================
REM TypeScript 类型检查脚本
REM 用法：双击本文件 或 在命令行执行 check.bat
REM ====================================================================
cd /d "%~dp0backend"

echo ========================================
echo  Backend TypeScript 类型检查
echo ========================================
call npx tsc --noEmit

if %ERRORLEVEL% EQU 0 (
  echo.
  echo [OK] 后端类型检查通过，无任何错误。
) else (
  echo.
  echo [FAIL] 后端类型检查未通过，请查看上方错误。
)

cd /d "%~dp0frontend"
echo.
echo ========================================
echo  Frontend TypeScript 类型检查
echo ========================================
echo [1/2] 检查 src 业务代码...
call npx tsc --noEmit
if %ERRORLEVEL% NEQ 0 goto :fe_fail

echo [2/2] 检查 vite.config.ts...
call npx tsc -p tsconfig.node.json --noEmit
if %ERRORLEVEL% NEQ 0 goto :fe_fail

echo.
echo [OK] 前端类型检查通过，无任何错误。
goto :fe_done

:fe_fail
echo.
echo [FAIL] 前端类型检查未通过，请查看上方错误。

:fe_done
echo.
pause
