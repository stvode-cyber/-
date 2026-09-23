# SKILL: Code Review Checklist

> 代码审查员的操作手册。审查时逐条打勾，不跳过。

## 使用方式

每次 review 前，先加载这个 checklist，然后对照 P0 → P1 → P2 顺序过一遍。不要只凭感觉挑风格问题。

---

## P0 — 必须拦截（任何一条 ❌ 就打回）

- [ ] 打包路径：`electron/package.json` extraResources `from` 值 vs `build-desktop.cjs` 复制的真实目录是否一致
- [ ] 版本号：`electron/package.json` version、`backend/package.json` version、前端 5 处显示字符串是否同步
- [ ] 数据库初始化：是否同时检查 `.db-version` hash **且** db 文件存在且非空
- [ ] zod schema：新路由输入有 schema + 有 refine 后端兜底
- [ ] JWT 安全：RS256 算法 + 私钥不外泄 + 本地只用公钥验签
- [ ] LLM_API_KEY：打包产物全文搜，确保为零
- [ ] TS strict：`npm run build` 零 error + 无 `any` 逃逸

## P1 — 应该拦截

- [ ] 三套路由：新页面在 App.tsx 三套 `<Routes>` 分支都注册了（未登录 / 桌面 / 移动）
- [ ] Express middleware 顺序：authMiddleware → rateLimit → 业务
- [ ] Promise 无 catch：async handler 是否 try-catch 或 `.catch(next)`
- [ ] 硬编码：没有写死 `47.116.59.141`、没有写死端口、没有写死密码
- [ ] console.log：生产代码无调试残留
- [ ] 资源释放：定时器 clearTimeout / 事件 removeEventListener / IPC 解绑
- [ ] 移动端适配：新 UI 在 768px 宽度下不断裂

## P2 — 建议优化

- [ ] 组件粒度：≤ 300 行，可拆分
- [ ] store 划分：按 domain 隔离，无跨 store 重复
- [ ] API 调用：有 loading / error 状态、无重复请求、有 abort 支持
- [ ] 常量提取：magic number / string 进 `constants.ts`

## 输出模板

```markdown
## Code Review — [模块名]

### P0: 1/7 ✅ / 6/7 ❌
### P1: x/x ✅ / y/y ❌  
### P2: x 条建议

### Bug（如有）
1. ...

### 结论：🟢 / 🟡 / 🔴
```
