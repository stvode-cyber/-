#!/bin/bash
# ============================================
# AI 助理系统 - 一键部署脚本
# ============================================
# 使用方式：
#   chmod +x deploy.sh
#   ./deploy.sh
#
# 前置条件：
#   - Node.js >= 20
#   - PM2 全局安装：npm install -g pm2
#   - Nginx 已安装
#   - Git 已安装
#
# 本脚本在服务器端执行，假设代码已通过 git clone 或 scp 传到服务器

set -e  # 任何命令失败立即退出

echo "=========================================="
echo "  AI 助理系统 - 开始部署"
echo "=========================================="

# ---- 变量配置 ----
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"
WEB_DIR="/var/www/aie-frontend"

echo "应用目录: $APP_DIR"

# ---- 1. 检查环境 ----
echo ""
echo "[1/8] 检查运行环境..."
node -v || { echo "❌ Node.js 未安装，请先安装 Node.js >= 20"; exit 1; }
pm2 -v || { echo "❌ PM2 未安装，正在安装..."; npm install -g pm2; }
nginx -v 2>&1 || echo "⚠️ Nginx 未安装（前端静态文件需手动部署）"
echo "✅ 环境检查通过"

# ---- 2. 后端依赖安装 ----
echo ""
echo "[2/8] 安装后端依赖..."
cd "$BACKEND_DIR"
npm install --production=false
echo "✅ 后端依赖安装完成"

# ---- 3. 后端环境变量配置 ----
echo ""
echo "[3/8] 检查后端环境变量..."
if [ ! -f .env ]; then
    cp .env.example .env
    # 生成随机 JWT_SECRET
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/请替换为32位以上的随机字符串/$JWT_SECRET/g" .env
    echo "✅ 已创建 .env（JWT_SECRET 已自动生成）"
    echo "⚠️ 请编辑 backend/.env 修改 CORS_ORIGIN 为实际访问地址"
else
    echo "✅ .env 已存在，跳过"
fi

# ---- 4. 生成 Prisma Client ----
echo ""
echo "[4/8] 生成 Prisma Client..."
npx prisma generate
echo "✅ Prisma Client 生成完成"

# ---- 5. 初始化数据库 ----
echo ""
echo "[5/8] 初始化数据库..."
# 使用 db push 同步表结构（不创建迁移文件）
npx prisma db push --accept-data-loss
echo "✅ 数据库表结构已同步"

# 种子数据（仅首次部署时执行）
if [ ! -f .seeded ]; then
    echo "执行种子数据..."
    npm run seed || echo "⚠️ 种子数据执行失败（可能已存在）"
    touch .seeded
    echo "✅ 种子数据已初始化"
else
    echo "✅ 种子数据已存在，跳过"
fi

# ---- 6. 后端构建 + 启动 ----
echo ""
echo "[6/8] 构建并启动后端..."
npm run build
mkdir -p logs

# 停止旧进程（如有）
pm2 delete aie-backend 2>/dev/null || true
# 启动新进程
pm2 start ecosystem.config.cjs
pm2 save
echo "✅ 后端已启动（PM2 守护）"

# ---- 7. 前端构建 ----
echo ""
echo "[7/8] 构建前端..."
cd "$FRONTEND_DIR"
npm install
npm run build
echo "✅ 前端构建完成"

# ---- 8. 部署前端到 Nginx 目录 ----
echo ""
echo "[8/8] 部署前端静态文件..."
sudo mkdir -p "$WEB_DIR"
sudo cp -r "$FRONTEND_DIR/dist/"* "$WEB_DIR/"
echo "✅ 前端已部署到 $WEB_DIR"

# ---- 完成 ----
echo ""
echo "=========================================="
echo "  🎉 部署完成！"
echo "=========================================="
echo ""
echo "后端服务："
echo "  - PM2 进程：pm2 status"
echo "  - 查看日志：pm2 logs aie-backend"
echo "  - 重启服务：pm2 restart aie-backend"
echo ""
echo "前端访问："
echo "  - Nginx 配置：cp nginx.conf.example 到 /etc/nginx/sites-available/"
echo "  - 重载 Nginx：sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "⚠️ 重要：请编辑 backend/.env"
echo "  - CORS_ORIGIN 改为实际访问地址"
echo "  - 确认 JWT_SECRET 已设置"
echo ""
echo "常用命令："
echo "  - pm2 status      # 查看进程状态"
echo "  - pm2 logs        # 查看实时日志"
echo "  - pm2 monit       # 监控面板"
echo "  - pm2 startup     # 设置开机自启"
echo "=========================================="
