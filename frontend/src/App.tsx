import { Routes, Route, Navigate, useLocation, useSearchParams, Outlet, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useAuthStore } from './stores/auth'
import { useHeartbeat } from './hooks/useHeartbeat'
import { isDesktop } from './hooks/useIsDesktop'
import Layout from './components/Layout'
import DesktopLayout from './components/DesktopLayout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ChatListPage from './pages/ChatListPage'
import ChatUserPage from './pages/ChatUserPage'
import CommunityPage from './pages/CommunityPage'
import ProfilePage from './pages/ProfilePage'
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt'
import OfflineBanner from './components/OfflineBanner'
import { Toaster } from './components/Toast'
import { ConfirmDialog } from './components/ConfirmDialog'

// 路由懒加载：非首屏页面按需加载，降低主 bundle 体积
const WalletPage = lazy(() => import('./pages/WalletPage'))
const WalletRechargePage = lazy(() => import('./pages/WalletRechargePage'))
const WalletTransactionsPage = lazy(() => import('./pages/WalletTransactionsPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const DietPage = lazy(() => import('./pages/DietPage'))
const HealthAnalyticsPage = lazy(() => import('./pages/HealthAnalyticsPage'))
const FragmentsPage = lazy(() => import('./pages/FragmentsPage'))
const VoiceMemoListPage = lazy(() => import('./pages/VoiceMemoListPage'))
const LiveMeetingPage = lazy(() => import('./pages/LiveMeetingPage'))
const VerifyPage = lazy(() => import('./pages/VerifyPage'))
const FinancePage = lazy(() => import('./pages/FinancePage'))
const FinanceAnalyticsPage = lazy(() => import('./pages/FinanceAnalyticsPage'))
const RemindersPage = lazy(() => import('./pages/RemindersPage'))
const HandoverPage = lazy(() => import('./pages/HandoverPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const CountdownListPage = lazy(() => import('./pages/CountdownListPage'))
const CountdownDetailPage = lazy(() => import('./pages/CountdownDetailPage'))
const PreviewSeparatorPage = lazy(() => import('./pages/PreviewSeparatorPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const NovelPage = lazy(() => import('./pages/NovelPage'))
const NovelReaderPage = lazy(() => import('./pages/NovelReaderPage'))
const PomodoroPage = lazy(() => import('./pages/PomodoroPage'))
const HabitPage = lazy(() => import('./pages/HabitPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const WaterPage = lazy(() => import('./pages/WaterPage'))
const WeightPage = lazy(() => import('./pages/WeightPage'))
const ExercisePage = lazy(() => import('./pages/ExercisePage'))
const DiaryPage = lazy(() => import('./pages/DiaryPage'))
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'))
const AnniversaryPage = lazy(() => import('./pages/AnniversaryPage'))
const WishlistPage = lazy(() => import('./pages/WishlistPage'))
const BookshelfPage = lazy(() => import('./pages/BookshelfPage'))
const SkillPage = lazy(() => import('./pages/SkillPage'))
const QuotePage = lazy(() => import('./pages/QuotePage'))
const WordPage = lazy(() => import('./pages/WordPage'))
const FocusSoundPage = lazy(() => import('./pages/FocusSoundPage'))
const ReadingNotePage = lazy(() => import('./pages/ReadingNotePage'))
const RecipePage = lazy(() => import('./pages/RecipePage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const ExportPage = lazy(() => import('./pages/ExportPage'))
const PetPage = lazy(() => import('./pages/PetPage'))
const StickyPage = lazy(() => import('./pages/StickyPage'))
const WallpaperPage = lazy(() => import('./pages/WallpaperPage'))
const MomentsPage = lazy(() => import('./pages/MomentsPage'))
const AlbumPage = lazy(() => import('./pages/AlbumPage'))
// 设置子页面（二次跳转结构）
const ProfileSettingsPage = lazy(() => import('./pages/settings/ProfileSettingsPage'))
const ToneSettingsPage = lazy(() => import('./pages/settings/ToneSettingsPage'))
const AIAssistantPage = lazy(() => import('./pages/settings/AIAssistantPage'))
const ThemeSettingsPage = lazy(() => import('./pages/settings/ThemeSettingsPage'))
const BackupSettingsPage = lazy(() => import('./pages/settings/BackupSettingsPage'))
const SecuritySettingsPage = lazy(() => import('./pages/settings/SecuritySettingsPage'))
const AboutSettingsPage = lazy(() => import('./pages/settings/AboutSettingsPage'))
const RemoteAccessPage = lazy(() => import('./pages/settings/RemoteAccessPage'))
const ServerSettingsPage = lazy(() => import('./pages/settings/ServerSettingsPage'))
const VaultPage = lazy(() => import('./pages/settings/VaultPage'))
const HoroscopePage = lazy(() => import('./pages/HoroscopePage'))
const IChingPage = lazy(() => import('./pages/IChingPage'))
const BaziPage = lazy(() => import('./pages/BaziPage'))
const ZodiacMatchPage = lazy(() => import('./pages/ZodiacMatchPage'))
// P1 周报单页（@回顾 跳转）
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'))
// P2 办公文档预览页（对话 office 卡片跳转）
const OfficeDocPage = lazy(() => import('./pages/OfficeDocPage'))
// P3 画像面板页（@画像 跳转）
const ProfilePanelPage = lazy(() => import('./pages/ProfilePanelPage'))
// P3 隐私控制面板（理解开关/撤销/导出）
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
// 合规：用户协议 + 隐私政策纯文本页（未登录也可访问）
const TermsPage = lazy(() => import('./pages/TermsPage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const TeamTasksPage = lazy(() => import('./pages/TeamTasksPage'))
const TeamSettingsPage = lazy(() => import('./pages/TeamSettingsPage'))

/** 懒加载路由的加载占位 */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-gray-400 animate-pulse">加载中...</div>
    </div>
  )
}

/**
 * 应用壳包装：包含全局 PWA 更新提示等跨页面元素
 * 放在每个路由分支外层，确保任何页面都能显示更新提示
 */
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
      <ConfirmDialog />
      <PWAUpdatePrompt />
      <OfflineBanner />
    </>
  )
}

/**
 * 桌面端条件布局：浮窗模式（float=1）跳过 DesktopLayout，仅渲染页面内容；
 * 正常导航则套用 DesktopLayout（深色侧边栏常驻）。
 */
function ConditionalDesktopLayout() {
  const [searchParams] = useSearchParams()
  const isFloat = searchParams.get('float') === '1'
  if (isFloat) return <Outlet />
  return <DesktopLayout />
}

/**
 * 应用根组件 · 路由总入口
 *
 * 路由分两层：
 * 1. 未登录路由：仅放行 /login，其余重定向到 /login
 * 2. 已登录路由：未完成冷启动的强制跳 /onboarding；其余按业务模块分发
 *
 * 注：管理后台已迁移为独立云端网页（后端宿主 /admin，独立前端构建），
 *     不再作为 APP 的一级路由存在。相关页面见 frontend/src/admin-main.tsx。
 *
 * 业务模块路由组织：
 * - 主 Tab（带 Layout 底部导航）：主页 / 对话 / 社区 / 个人中心
 * - 独立全屏页：钱包、任务、饮食、财务、提醒等
 */
export default function App() {
  const { user, token, loading, init } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  // 在线心跳：登录后每 3 分钟上报，累计在线时间用于等级计算
  useHeartbeat()

  useEffect(() => {
    init()
  }, [init])

  /**
   * 监听 Android 主屏小部件 deep link
   * - 小部件点击 → 启动应用 + Intent data = "aie://quick-note"
   * - Capacitor @capacitor/app 的 appUrlOpen 事件捕获该 URL
   * - 前端跳转 HomePage 并带 ?quick=1 参数，HomePage 检测后自动聚焦随手记输入框
   * - 仅移动端监听（桌面端无 Capacitor 运行时）
   */
  useEffect(() => {
    if (isDesktop()) return
    let plugin: any
    let listener: { remove: () => void } | undefined

    // 动态导入 @capacitor/app，避免桌面端打包失败
    import('@capacitor/app')
      .then(({ App: AppPlugin }) => {
        plugin = AppPlugin
        return AppPlugin.addListener('appUrlOpen', ({ url }: { url: string }) => {
          console.log('[deep-link] 收到 URL:', url)
          // 匹配 aie://quick-note
          if (url === 'aie://quick-note' || url.startsWith('aie://quick-note')) {
            // 跳转到首页并设置 quick=1，触发 HomePage 自动聚焦随手记输入框
            navigate('/?quick=1', { replace: true })
          }
        })
      })
      .then((l) => {
        listener = l
      })
      .catch((err) => {
        // @capacitor/app 仅在移动端可用，桌面端忽略错误
        console.debug('[deep-link] @capacitor/app 不可用（桌面端正常）:', err?.message)
      })

    return () => {
      listener?.remove?.()
    }
  }, [navigate])

  // 初始化中：显示 loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400 animate-pulse">加载中...</div>
      </div>
    )
  }

  // 未登录：仅放行 /login 和 /preview-separator
  if (!token || !user) {
    return (
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/preview-separator" element={<PreviewSeparatorPage />} />
            {/* 合规协议页：未登录也可访问（注册流程需展示） */}
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
    )
  }

  // 已登录主路由（不再强制冷启动引导，注册后直接进主页）
  // 桌面端：所有页面共用 DesktopLayout（深色侧边栏常驻）
  // 移动端：主 Tab 用 Layout（底部导航），其余独立全屏页
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          {isDesktop() ? (
            <>
              {/* 桌面端：主路由统一在 ConditionalDesktopLayout 下（float=1 时跳过布局） */}
              <Route element={<ConditionalDesktopLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/chat" element={<ChatListPage />} />
                <Route path="/community" element={<CommunityPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/wallet/recharge" element={<WalletRechargePage />} />
                <Route path="/wallet/transactions" element={<WalletTransactionsPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/diet" element={<DietPage />} />
                <Route path="/health/analytics" element={<HealthAnalyticsPage />} />
                <Route path="/fragments" element={<FragmentsPage />} />
                <Route path="/voice-memos" element={<VoiceMemoListPage />} />
                <Route path="/chat/ai" element={<ChatPage />} />
                <Route path="/chat/u/:convId" element={<ChatUserPage />} />
                <Route path="/chat/g/:convId" element={<ChatUserPage />} />
                <Route path="/live-meeting" element={<LiveMeetingPage />} />
                <Route path="/verify" element={<VerifyPage />} />
                <Route path="/finance" element={<FinancePage />} />
                <Route path="/finance/analytics" element={<FinanceAnalyticsPage />} />
                <Route path="/reminders" element={<RemindersPage />} />
                <Route path="/handover" element={<HandoverPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/profile" element={<ProfileSettingsPage />} />
                <Route path="/settings/tone" element={<ToneSettingsPage />} />
                <Route path="/settings/ai-assistant" element={<AIAssistantPage />} />
                <Route path="/settings/theme" element={<ThemeSettingsPage />} />
                <Route path="/settings/backup" element={<BackupSettingsPage />} />
                <Route path="/settings/security" element={<SecuritySettingsPage />} />
                <Route path="/settings/about" element={<AboutSettingsPage />} />
                <Route path="/settings/remote-access" element={<RemoteAccessPage />} />
                <Route path="/settings/server" element={<ServerSettingsPage />} />
                <Route path="/settings/vault" element={<VaultPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/export" element={<ExportPage />} />
                <Route path="/countdowns" element={<CountdownListPage />} />
                <Route path="/countdowns/:id" element={<CountdownDetailPage />} />
                <Route path="/preview-separator" element={<PreviewSeparatorPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/novel" element={<NovelPage />} />
                <Route path="/novel/:id" element={<NovelReaderPage />} />
                <Route path="/pomodoro" element={<PomodoroPage />} />
                <Route path="/habit" element={<HabitPage />} />
                <Route path="/review" element={<ReviewPage />} />
                <Route path="/water" element={<WaterPage />} />
                <Route path="/weight" element={<WeightPage />} />
                <Route path="/exercise" element={<ExercisePage />} />
                <Route path="/diary" element={<DiaryPage />} />
                <Route path="/subscription" element={<SubscriptionPage />} />
                <Route path="/anniversary" element={<AnniversaryPage />} />
                <Route path="/wishlist" element={<WishlistPage />} />
                <Route path="/bookshelf" element={<BookshelfPage />} />
                <Route path="/skill" element={<SkillPage />} />
                <Route path="/quote" element={<QuotePage />} />
                <Route path="/word" element={<WordPage />} />
                <Route path="/focus-sound" element={<FocusSoundPage />} />
                <Route path="/reading-notes" element={<ReadingNotePage />} />
                <Route path="/recipe" element={<RecipePage />} />
                {/* 功能页：放在 ConditionalDesktopLayout 内，正常访问带侧边栏（含返回首页）；
                    float=1 时 ConditionalDesktopLayout 自动跳过布局，浮窗透明渲染不受影响 */}
                <Route path="/pet" element={<PetPage />} />
                <Route path="/sticky" element={<StickyPage />} />
                <Route path="/moments" element={<MomentsPage />} />
                <Route path="/album" element={<AlbumPage />} />
                <Route path="/wallpaper" element={<WallpaperPage />} />
                <Route path="/horoscope" element={<HoroscopePage />} />
                <Route path="/iching" element={<IChingPage />} />
                <Route path="/bazi" element={<BaziPage />} />
                <Route path="/zodiac-match" element={<ZodiacMatchPage />} />
                <Route path="/weekly-report" element={<WeeklyReportPage />} />
                <Route path="/office-doc/:id" element={<OfficeDocPage />} />
                <Route path="/team/tasks" element={<TeamTasksPage />} />
                <Route path="/team/settings" element={<TeamSettingsPage />} />
                {/* 合规协议页 */}
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            // 移动端：主 Tab 用 Layout，其余独立全屏页
            <>
              <Route element={<Layout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/chat" element={<ChatListPage />} />
                <Route path="/community" element={<CommunityPage />} />
                <Route path="/profile" element={<ProfilePage />} />
              </Route>
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/wallet/recharge" element={<WalletRechargePage />} />
              <Route path="/wallet/transactions" element={<WalletTransactionsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/diet" element={<DietPage />} />
              <Route path="/health/analytics" element={<HealthAnalyticsPage />} />
              <Route path="/fragments" element={<FragmentsPage />} />
              <Route path="/voice-memos" element={<VoiceMemoListPage />} />
              <Route path="/chat/ai" element={<ChatPage />} />
              <Route path="/chat/u/:convId" element={<ChatUserPage />} />
              <Route path="/chat/g/:convId" element={<ChatUserPage />} />
              <Route path="/live-meeting" element={<LiveMeetingPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/finance/analytics" element={<FinanceAnalyticsPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/handover" element={<HandoverPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/profile" element={<ProfileSettingsPage />} />
              <Route path="/settings/tone" element={<ToneSettingsPage />} />
              <Route path="/settings/theme" element={<ThemeSettingsPage />} />
              <Route path="/settings/backup" element={<BackupSettingsPage />} />
              <Route path="/settings/security" element={<SecuritySettingsPage />} />
              <Route path="/settings/about" element={<AboutSettingsPage />} />
              <Route path="/settings/remote-access" element={<RemoteAccessPage />} />
              <Route path="/settings/vault" element={<VaultPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/countdowns" element={<CountdownListPage />} />
              <Route path="/countdowns/:id" element={<CountdownDetailPage />} />
              <Route path="/preview-separator" element={<PreviewSeparatorPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/novel" element={<NovelPage />} />
              <Route path="/novel/:id" element={<NovelReaderPage />} />
              <Route path="/pomodoro" element={<PomodoroPage />} />
              <Route path="/habit" element={<HabitPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/water" element={<WaterPage />} />
              <Route path="/weight" element={<WeightPage />} />
              <Route path="/exercise" element={<ExercisePage />} />
              <Route path="/diary" element={<DiaryPage />} />
              <Route path="/subscription" element={<SubscriptionPage />} />
              <Route path="/anniversary" element={<AnniversaryPage />} />
              <Route path="/wishlist" element={<WishlistPage />} />
              <Route path="/bookshelf" element={<BookshelfPage />} />
              <Route path="/skill" element={<SkillPage />} />
              <Route path="/quote" element={<QuotePage />} />
              <Route path="/word" element={<WordPage />} />
              <Route path="/focus-sound" element={<FocusSoundPage />} />
              <Route path="/reading-notes" element={<ReadingNotePage />} />
              <Route path="/recipe" element={<RecipePage />} />
              <Route path="/pet" element={<PetPage />} />
              <Route path="/sticky" element={<StickyPage />} />
              <Route path="/moments" element={<MomentsPage />} />
              <Route path="/album" element={<AlbumPage />} />
              <Route path="/wallpaper" element={<WallpaperPage />} />
              <Route path="/horoscope" element={<HoroscopePage />} />
              <Route path="/iching" element={<IChingPage />} />
              <Route path="/bazi" element={<BaziPage />} />
              <Route path="/zodiac-match" element={<ZodiacMatchPage />} />
              <Route path="/weekly-report" element={<WeeklyReportPage />} />
              <Route path="/office-doc/:id" element={<OfficeDocPage />} />
              <Route path="/team/tasks" element={<TeamTasksPage />} />
              <Route path="/team/settings" element={<TeamSettingsPage />} />
              <Route path="/profile-panel" element={<ProfilePanelPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              {/* 合规协议页 */}
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </Suspense>
    </AppShell>
  )
}
