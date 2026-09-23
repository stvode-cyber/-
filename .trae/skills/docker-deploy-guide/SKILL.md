# SKILL: Docker Deploy Guide

> ⚠️ **当前版本（1.0.1）未使用 Docker**，生产环境用 PM2 管理。本文件为未来引入 Docker 时的参考模板。

## 当前实际部署方式（PM2）

完整流程见 `devops-engineer.md`。核心命令：

```bash
# 云端部署四步法
tar -czf backend-update.tar.gz -C backend dist prisma/schema.prisma package.json
scp backend-update.tar.gz root@47.116.59.141:/root/backend/
ssh root@47.116.59.141 "cd /root/backend && cp dist dist.bak.\$(date +%Y%m%d-%H%M%S) && cp prisma/prod.db prisma/prod.db.bak.\$(date +%Y%m%d-%H%M%S) && tar -xzf backend-update.tar.gz && pm2 stop aie-backend && npx prisma db push && pm2 start dist/index.js --name aie-backend && pm2 status aie-backend"
curl -s http://47.116.59.141:3001/health
```

## Docker 化参考（如需引入）

### Dockerfile 模板（后端）

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --only=production
COPY backend/dist ./dist
COPY backend/prisma ./prisma
COPY backend/package.json .
RUN npx prisma generate

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json .
ENV HOST=0.0.0.0 PORT=3001 NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### docker-compose.yml（未来）

```yaml
services:
  backend:
    build: ./backend
    restart: always
    env_file: ./backend/.env
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/prisma     # prod.db 持久化
      - ./backup:/backup       # 备份挂载
  nginx:
    image: nginx:alpine
    ports:
      - "8444:8444"
      - "443:443"
    volumes:
      - ./nginx/conf:/etc/nginx/conf.d
      - ./apk-files:/usr/share/nginx/html/apk
    depends_on:
      - backend
```

## 迁移 PM2 → Docker 检查清单

- [ ] 确认 prod.db 备份策略在 volume 下工作正常
- [ ] Nginx SSL 证书挂载到容器
- [ ] JWT 密钥 / LLM key 用 `--env-file` 注入，不写进 Dockerfile
- [ ] 健康检查：`HEALTHCHECK CMD curl -f http://localhost:3001/health || exit 1`
- [ ] 日志驱动：`--log-driver json-file --log-opt max-size=10m`
- [ ] 数据库初始化：容器启动时 `prisma db push`（幂等，无影响）
