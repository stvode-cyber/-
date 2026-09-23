@echo off
chcp 65001 >nul

echo ============================================================
echo   绿角犀 - 启动服务
echo ============================================================
echo.
echo  正在启动后端 (http://localhost:3001)...
start "绿角犀-Backend" cmd /k "cd /d %~dp0backend && npm run dev"

echo  等待后端就绪...
timeout /t 3 /nobreak >nul

echo  正在启动前端 (http://localhost:5173)...
start "绿角犀-Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ============================================================
echo   服务已启动！
echo.
echo   前端:  http://localhost:5173
echo   后端:  http://localhost:3001
echo.
echo   演示账号：
echo     普通用户:  demo（密码已随机化，请通过 admin 重置）
echo     管理员:    admin（密码见 .env 中 ADMIN_PASSWORD，访问 /admin）
echo.
echo   关闭服务：直接关闭弹出的两个命令行窗口
echo ============================================================
echo.
echo  浏览器将自动打开...
timeout /t 2 /nobreak >nul
start http://localhost:5173
