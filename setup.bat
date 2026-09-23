@echo off
chcp 65001 >nul
setlocal

echo ============================================================
echo   绿角犀 - 一键安装脚本 (首次运行)
echo ============================================================
echo.

REM === 1. 后端依赖 ===
echo [1/5] 安装后端依赖...
cd /d "%~dp0backend"
call npm install
if errorlevel 1 (
    echo  [X] 后端依赖安装失败，请检查 Node.js 是否已安装
    pause
    exit /b 1
)
echo  [OK] 后端依赖安装完成
echo.

REM === 2. Prisma 生成客户端 ===
echo [2/5] 生成 Prisma 客户端...
call npx prisma generate
if errorlevel 1 (
    echo  [X] Prisma 客户端生成失败
    pause
    exit /b 1
)
echo  [OK] Prisma 客户端已生成
echo.

REM === 3. 数据库迁移 ===
echo [3/5] 创建数据库并执行迁移...
call npx prisma migrate dev --name init
if errorlevel 1 (
    echo  [X] 数据库迁移失败
    pause
    exit /b 1
)
echo  [OK] 数据库已创建
echo.

REM === 4. 种子数据 ===
echo [4/5] 写入演示数据...
call npm run seed
if errorlevel 1 (
    echo  [X] 种子数据写入失败
    pause
    exit /b 1
)
echo  [OK] 演示数据已写入
echo.

REM === 5. 前端依赖 ===
echo [5/5] 安装前端依赖...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 (
    echo  [X] 前端依赖安装失败
    pause
    exit /b 1
)
echo  [OK] 前端依赖安装完成
echo.

echo ============================================================
echo   安装完成！
echo.
echo   演示账号：
echo     普通用户:  demo（密码已随机化，请通过 admin 重置）
echo     管理员:    admin（密码见 .env 中 ADMIN_PASSWORD）
echo.
echo   下一步：双击 start.bat 启动服务
echo ============================================================
pause
