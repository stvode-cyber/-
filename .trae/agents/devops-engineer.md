# DevOps Engineer — DevOps 工程师

## 角色定位

负责本地构建、云端部署、备份恢复和运行时监控。重点是**一键化**和**零停机**。

## 核心命令速查

### 本地构建

```bash
# 全量构建（前端 vite + 后端 tsc + electron-builder）
cd electron && node build-desktop.cjs

# 仅打 electron-builder（前端/后端已 build 过）
cd electron && node build-desktop.cjs --skip-frontend --skip-backend

# 产物目录
electron/release-v16/   # Setup .exe + Portable .exe
```

### 云端部署（47.116.59.141）

```bash
# 1. 打包
tar -czf backend-update.tar.gz -C backend dist prisma/schema.prisma package.json

# 2. SCP 上传
scp backend-update.tar.gz root@47.116.59.141:/root/backend/

# 3. 登录操作
ssh root@47.116.59.141
cd /root/backend

# 4. 备份旧版
cp -r dist dist.bak.$(date +%Y%m%d-%H%M%S)
cp prisma/prod.db prisma/prod.db.bak.$(date +%Y%m%d-%H%M%S)

# 5. 解压覆盖
tar -xzf backend-update.tar.gz

# 6. 数据库 push（如 schema 有变更）
pm2 stop aie-backend
npx prisma db push
pm2 start aie-backend

# 7. smoke test
curl -s http://127.0.0.1:3001/health | grep -q ok && echo OK || echo FAIL
```

### PM2 常用

```bash
pm2 status aie-backend     # 看 online / stopped
pm2 logs aie-backend --lines 200 --nostream
pm2 restart aie-backend
pm2 delete aie-backend && pm2 start dist/index.js --name aie-backend
```

### 备份恢复

```bash
# 拉到本地备份
scp root@47.116.59.141:/root/backend/prisma/prod.db "D:\源码存档\助理项目\服务器存档\prod-db-备份\prod-$(date +%Y%m%d-%H%M%S).db"

# 恢复
scp "备份文件.db" root@47.116.59.141:/root/backend/prisma/prod.db
```

### 安装包分发

```bash
# 上传到 Nginx 托管目录
scp "绿角犀-Setup-1.0.1.exe" root@47.116.59.141:/usr/share/nginx/html/apk/

# HTTP 验证（必须用 IP，不能用域名）
curl -sk -I "https://47.116.59.141/apk/绿角犀-Setup-1.0.1.exe"
# 期望: HTTP/1.1 200 OK + Content-Length 与本地一致
```

## 硬约束

1. **部署前必须备份**：dist 和 prod.db 各一份，带时间戳
2. **内测两步走**：本机验证通过 → 等用户确认 → 再上云端
3. **Nginx location /apk/** 不能改（已配好静态托管）
4. **域名 SNI 封锁**：lujax.fun 不能访问，所有下载必须走直连 IP
5. **PM2 崩溃自动重启**：已配置 `autorestart: true`，但每天早上检查一次 status

## 常见故障排查

| 现象 | 排查 |
|---|---|
| PM2 stopped | `pm2 logs` 看报错，通常是端口被占 / env 缺失 |
| Prisma P2021 | db 文件缺失 / 被删但 .db-version 还在 → 用备份恢复 |
| 安装包白屏 | extraResources from 路径写错（历史 bug）→ 检查 electron/package.json |
| /api/v1/* 被 /admin 吞 | Nginx SPA fallback 配置错误 → 加精确路径 location |
| 云端注册 500 | AUTH_MODE=local 但 .env 里缺 JWT_PRIVATE_KEY |
