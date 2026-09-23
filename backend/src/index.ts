import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'

import { requestId, notFound, errorHandler } from './middleware/error.js'
import { timing } from './middleware/timing.js'
import { requestContextMiddleware } from './utils/requestContext.js'
import authRoutes from './routes/auth.routes.js'
import { createAuthProxyRouter } from './middleware/authProxy.js'
import workRoutes from './routes/work.routes.js'
import lifeRoutes from './routes/life.routes.js'
import sleepRoutes from './routes/sleep.routes.js'
import verifyRoutes from './routes/verify.routes.js'
import financeRoutes from './routes/finance.routes.js'
import walletRoutes from './routes/wallet.routes.js'
import chatRoutes from './routes/chat.routes.js'
import reminderRoutes from './routes/reminder.routes.js'
import homeRoutes from './routes/home.routes.js'
import handoverRoutes from './routes/handover.routes.js'
import communityRoutes from './routes/community.routes.js'
import photoRoutes from './routes/photo.routes.js'
import searchRoutes from './routes/search.routes.js'
import adminRoutes from './routes/admin.routes.js'
import fragmentRoutes from './routes/fragment.routes.js'
import manualEventRoutes from './routes/manual-event.routes.js'
import voiceMemoRoutes from './routes/voice-memo.routes.js'
import conversationRoutes from './routes/conversation.routes.js'
import countdownRoutes from './routes/countdown.routes.js'
import habitRoutes from './routes/habit.routes.js'
import habitTrackRoutes from './routes/habitTrack.routes.js'
import spaceRoutes from './routes/space.routes.js'
import assetRoutes from './routes/asset.routes.js'
import remoteFetchRoutes from './routes/remoteFetch.routes.js'
import folderRoutes from './routes/folder.routes.js'
import tagRoutes from './routes/tag.routes.js'
import shareRoutes from './routes/share.routes.js'
import petRoutes from './routes/pet.routes.js'
import petShopRoutes from './routes/pet-shop.routes.js'
import stickyRoutes from './routes/sticky.routes.js'
import wallpaperRoutes from './routes/wallpaper.routes.js'
import categoryRuleRoutes from './routes/categoryRule.routes.js'
import vaultRoutes from './routes/vault.routes.js'
import exportRoutes from './routes/export.routes.js'
import calendarRoutes from './routes/calendar.routes.js'
import appRoutes from './routes/app.routes.js'
import divinationRoutes from './routes/divination.routes.js'
import remoteAccessRoutes from './routes/remoteAccess.routes.js'
import aiRoutes from './routes/ai.routes.js'
import { initRemoteFileServer } from './services/remoteFileServer.js'
import { startCountdownScheduler } from './utils/countdown.lib.js'
import { startMorningGreetingScheduler } from './utils/morningGreeting.lib.js'
import { startProactiveScheduler } from './utils/proactive.lib.js'
import { startWeeklyAggregatorScheduler } from './utils/weeklyAggregator.js'
import { startExecInstanceScheduler } from './utils/execInstanceScheduler.js'
import { startFetchJobScheduler } from './utils/fetchJobScheduler.js'
import { initAgentCore } from './services/agentCore.js'
import { prismaReady } from './lib/prisma.js'
import path from 'path'
import { fileURLToPath } from 'url'

const app = express()

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }))
// P1-1 修复：注入 helmet 安全响应头（X-Frame-Options/X-Content-Type-Options/STS 等）
// 关闭 crossOriginResourcePolicy 以允许 file:// 协议的 Electron 渲染进程加载资源
app.use(helmet({
  contentSecurityPolicy: false, // CSP 已在 Electron main.cjs 注入，后端不重复设置
  crossOriginResourcePolicy: false,
}))
// P3 修复：按路径放宽 body 上限（上传/多模态接口的 base64 体积大于全局 2MB）
// 顺序：特定路径的宽松限制在前，全局默认在后（express.json 解析一次后后续中间件跳过）
app.use('/api/v1/assets', express.json({ limit: '11mb' }))      // 资产上传 base64 上限 10MB
app.use('/api/v1/voice-memos', express.json({ limit: '6mb' }))  // 语音上传 base64 上限 5MB
app.use('/api/v1/chat', express.json({ limit: '6mb' }))         // 多模态消息 base64 上限 5MB
app.use('/api/v1/pet', express.json({ limit: '11mb' }))        // 宠物自定义形象上传 base64 上限 10MB
app.use('/api/v1/photos', express.json({ limit: '6mb' }))      // 相册照片上传 base64 上限 5MB
app.use('/api/v1/community', express.json({ limit: '12mb' }))   // 说说九宫格 9×压缩图 base64 上限
app.use('/api/v1/app', express.json({ limit: '101mb' }))        // APK 上传 base64 上限 100MB
// P2-8 修复：全局 body 限制降至 2MB；上传类路由已有各自的 base64 大小校验
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
// P3 修复：生产环境用 combined 格式（Apache 标准日志，含 UA/Referer），开发环境保留 dev
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
// 请求 ID + 耗时统计（注入 res.locals.requestId / startTime，供台账读取）
app.use(requestId)
app.use(timing)
// 每个请求开一个独立的 requestContext 存储上下文
app.use(requestContextMiddleware)

// 健康检查
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

// 路由挂载
// 上架激活：AUTH_MODE=cloud-proxy 时，/auth 走云端认证代理（本地后端将登录转发到云端身份源），
// 否则走本机 authRoutes（开发/单机模式本地签发）。
if ((process.env.AUTH_MODE || 'local') === 'cloud-proxy') {
  app.use('/api/v1/auth', createAuthProxyRouter())
} else {
  app.use('/api/v1/auth', authRoutes)
}
app.use('/api/v1/work', workRoutes)
app.use('/api/v1/life', lifeRoutes)
app.use('/api/v1/sleep', sleepRoutes)
app.use('/api/v1/verify', verifyRoutes)
app.use('/api/v1/finance', financeRoutes)
app.use('/api/v1/wallet', walletRoutes)
app.use('/api/v1/chat', chatRoutes)
app.use('/api/v1/reminder', reminderRoutes)
app.use('/api/v1/home', homeRoutes)
app.use('/api/v1/handover', handoverRoutes)
app.use('/api/v1/community', communityRoutes)
app.use('/api/v1/photos', photoRoutes)
app.use('/api/v1/search', searchRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/fragment', fragmentRoutes)
app.use('/api/v1/manual-events', manualEventRoutes)
app.use('/api/v1/voice-memos', voiceMemoRoutes)
app.use('/api/v1/conversations', conversationRoutes)
app.use('/api/v1/countdowns', countdownRoutes)
app.use('/api/v1/habits', habitRoutes)
app.use('/api/v1/habits/track', habitTrackRoutes)
app.use('/api/v1/spaces', spaceRoutes)
app.use('/api/v1/assets', assetRoutes)
app.use('/api/v1/remote-fetch', remoteFetchRoutes)
app.use('/api/v1/folders', folderRoutes)
app.use('/api/v1/tags', tagRoutes)
app.use('/api/v1/share', shareRoutes)
app.use('/api/v1/pet', petRoutes)
app.use('/api/v1/pet-shop', petShopRoutes)
app.use('/api/v1/sticky', stickyRoutes)
app.use('/api/v1/wallpaper', wallpaperRoutes)
app.use('/api/v1/category-rules', categoryRuleRoutes)
app.use('/api/v1/vault', vaultRoutes)
app.use('/api/v1/export', exportRoutes)
app.use('/api/v1/calendar', calendarRoutes)
app.use('/api/v1/app', appRoutes)
app.use('/api/v1/divination', divinationRoutes)
app.use('/api/v1/remote-access', remoteAccessRoutes)
app.use('/api/v1/ai', aiRoutes)

// 独立管理后台网页（云端浏览器访问）：后端静态托管 /admin
// - 管理页构建产物由 admin-vite.config.ts 输出到 frontend/admin-dist，
//   部署时拷到 <backend>/public/admin（生产 ENV ADMIN_WEB_DIR 可覆盖）。
// - /admin/* SPA fallback：深链/刷新时返回 admin.html，由前端 BrowserRouter 接管。
// - 置于所有 API 挂载之后（不吞 /api/v1/*），notFound 之前。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const adminWebDir = process.env.ADMIN_WEB_DIR || path.join(__dirname, '..', 'public', 'admin')
app.use('/admin', express.static(adminWebDir, { index: 'admin.html' }))
app.get('/admin/*', (_req, res) => res.sendFile(path.join(adminWebDir, 'admin.html')))

app.use(notFound)
app.use(errorHandler)

const PORT = Number(process.env.PORT) || 3001
// #2 修复：默认绑定 127.0.0.1 仅本机访问（防止局域网接管）
// - 桌面应用场景：前端与本机后端通信，无需暴露到局域网
// - 显式开放外部访问时通过 HOST=0.0.0.0 注入
const HOST = process.env.HOST || '127.0.0.1'

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 绿角犀后端已启动`)
  console.log(`   本地地址: http://${HOST}:${PORT}`)
  console.log(`   健康检查: http://${HOST}:${PORT}/health\n`)
  // 等待 Prisma journal_mode 设置完成（Electron 环境下避免 WAL 写入冲突）
  // 再启动调度器，防止 CountdownScheduler 首次扫描在 PRAGMA 执行前写入
  prismaReady.finally(() => {
    // 启动倒计时调度器（每分钟扫描 active 倒计时生成提醒）
    startCountdownScheduler()
    // 启动每日早安问候调度器（每天 9:00 向用户发送 AI 私信）
    startMorningGreetingScheduler()
    // 启动 AI 主动聊天调度器（每 5 分钟扫描，08-10 点窗口向 proactiveChatEnabled 用户推送问候）
    startProactiveScheduler()
    // 启动每周聚合调度器（每分钟检查，周一 03:00 为活跃用户预聚合上周周报缓存）
    startWeeklyAggregatorScheduler()
    // Worker 心跳超时清理调度器（每 60s 扫一次，>5min 没心跳 → 置 offline）
    startExecInstanceScheduler()
    // FetchJob 超时清理调度器（pending>10min→rejected，dispatched>30min→failed）
    startFetchJobScheduler()
    // 初始化 AgentCore 单例（预加载工具注册表，避免首条消息冷启动延迟）
    initAgentCore()
    // 远程文件访问（手机 → 电脑局域网直连）：读取持久化配置，enabled 则拉起独立端口
    initRemoteFileServer()
  })
})
