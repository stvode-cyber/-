import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronRight, Shield, Award, Info, Trash2, User, MessageSquare, LogOut, SunMoon, DatabaseBackup, ShieldCheck,
  ListTodo, UtensilsCrossed, Bell, Clock, Coins, Wallet, Sparkles, FolderOpen, ClipboardList, Puzzle, Mic, Radio,
  PawPrint, Timer, Flame, BarChart3, CalendarCheck, StickyNote, Image as ImageIcon, Smartphone, Brain,
  Server, Group,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Header from '../components/Header'
import { useToast } from '../components/Toast'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { useConfirm } from '../components/ConfirmDialog'
import { toneMeta } from '../lib/utils'
import { isDesktop } from '../lib/localCache'

/**
 * 设置页 · 菜单列表（二次跳转结构）
 *
 * 本页仅展示菜单分组，点击菜单项进入对应子页面编辑：
 * - 个人设置：个人资料 / AI 语气偏好
 * - 外观：主题模式 / 数据备份
 * - 账号与安全：安全中心 / 实名认证 / 隐私与理解
 * - 功能（备份）：与「我的」页同步的全功能入口——所有功能在这里都有一份
 * - 其他：关于
 *
 * 保持在当前页的操作：
 * - 清除本地缓存（confirm 弹窗，保留登录态后 reload）
 * - 退出登录（confirm 弹窗）
 */

interface MenuItem {
  to: string
  icon: LucideIcon
  label: string
  desc?: string
}

export default function SettingsPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const { user, logout } = useAuthStore()
  const themeMode = useThemeStore((s) => s.mode)

  /** 清除业务缓存（保留登录态与主题偏好） */
  const clearCache = async () => {
    if (!(await confirm({
      title: '清除本地缓存',
      message: '确认清除本地缓存？登录态会保留，但页面数据需重新加载。',
      confirmText: '清除',
      danger: true,
    }))) return
    const token = localStorage.getItem('aie_token')
    const userStr = localStorage.getItem('aie_user')
    const theme = localStorage.getItem('aie_theme')
    localStorage.clear()
    if (token) localStorage.setItem('aie_token', token)
    if (userStr) localStorage.setItem('aie_user', userStr)
    if (theme) localStorage.setItem('aie_theme', theme)
    toast('缓存已清除', 'success')
    setTimeout(() => window.location.reload(), 500)
  }

  /** 退出登录确认 */
  const onLogout = async () => {
    if (await confirm({
      title: '退出登录',
      message: '确认退出当前账号？',
      confirmText: '退出',
      danger: true,
    })) logout()
  }

  const currentToneLabel = user?.preferredTone
    ? toneMeta[user.preferredTone]?.label
    : '未设置'

  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '跟随系统'

  const sections: { title: string; items: MenuItem[] }[] = [
    {
      title: '个人设置',
      items: [
        {
          to: '/settings/profile',
          icon: User,
          label: '个人资料',
          desc: user?.nickname || '未设置',
        },
        {
          to: '/settings/tone',
          icon: MessageSquare,
          label: 'AI 语气偏好',
          desc: currentToneLabel,
        },
      ],
    },
    {
      title: '外观',
      items: [
        {
          to: '/settings/theme',
          icon: SunMoon,
          label: '主题模式',
          desc: themeLabel,
        },
        {
          to: '/settings/backup',
          icon: DatabaseBackup,
          label: '数据备份',
          desc: '导出 / 恢复本地数据',
        },
      ],
    },
    {
      title: '账号与安全',
      items: [
        { to: '/settings/security', icon: Shield, label: '安全中心' },
        { to: '/verify', icon: Award, label: '实名认证', desc: 'Lv0-Lv5 五级认证体系' },
        {
          to: '/privacy',
          icon: ShieldCheck,
          label: '隐私与理解',
          desc: '理解开关 / 记忆撤销 / 数据导出',
        },
      ],
    },
    // ============ 功能备份（与「我的」页功能清单同步） ============
    {
      title: '功能 · 生活助理',
      items: [
        { to: '/tasks', icon: ListTodo, label: '待办事项', desc: '任务日程 · 进度跟踪' },
        { to: '/diet', icon: UtensilsCrossed, label: '饮食记录', desc: '拍照/写名 · AI 算热量' },
        { to: '/reminders', icon: Bell, label: '提醒管理', desc: '日程提醒 · 重复设置' },
        { to: '/countdowns', icon: Clock, label: '倒计时', desc: '重要日期 · 时间追踪' },
      ],
    },
    {
      title: '功能 · 财务',
      items: [
        { to: '/finance', icon: Coins, label: '财务记账', desc: '收支流水 · 分类统计' },
        { to: '/wallet', icon: Wallet, label: '我的钱包', desc: '余额 · 充值 · 流水明细' },
        { to: '/pm', icon: BarChart3, label: '项目账款', desc: '采购→销售→收付款→发票全链路' },
      ],
    },
    {
      title: '功能 · 社交分享',
      items: [
        { to: '/moments', icon: Sparkles, label: '朋友圈', desc: '分享动态 · 好友互动' },
        { to: '/album', icon: FolderOpen, label: '相册', desc: '照片 · 回忆 · 云同步' },
      ],
    },
    {
      title: '功能 · 常用',
      items: [
        { to: '/handover', icon: ClipboardList, label: '工作交接表' },
        { to: '/fragments', icon: Puzzle, label: '碎片收藏', desc: '文字 / 链接 / 想法' },
        { to: '/voice-memos', icon: Mic, label: '录音纪要', desc: '录音转写与待办提取' },
        { to: '/live-meeting', icon: Radio, label: '实时纪要', desc: '会议持续录音 · 自动切片' },
        { to: '/library', icon: FolderOpen, label: '资料库', desc: '文件 · 文件夹 · 标签与分享' },
        { to: '/settings/vault', icon: Brain, label: 'AI 记忆库', desc: 'AI 记住的你的资料 · 可管理' },
        { to: '/pet', icon: PawPrint, label: '我的宠物', desc: '桌面陪伴 · 互动小游戏' },
        { to: '/horoscope', icon: Sparkles, label: '趣味占卜', desc: '星座 · 八卦 · 八字 · 配对' },
      ],
    },
    {
      title: '功能 · 团队协作',
      items: [
        { to: '/team/tasks', icon: ClipboardList, label: '团队任务', desc: '分配 · 流转 · 逾期提醒' },
        { to: '/team/settings', icon: Group, label: '团队设置', desc: '成员角色 · 部门管理 · 任务转移' },
      ],
    },
    {
      title: '功能 · 效率',
      items: [
        { to: '/pomodoro', icon: Timer, label: '番茄钟', desc: '专注计时 · 提升效率' },
        { to: '/habit', icon: Flame, label: '习惯追踪', desc: '每日打卡 · 连续天数' },
        { to: '/review', icon: BarChart3, label: '每周回顾', desc: '习惯/专注/阅读周报' },
        { to: '/calendar', icon: CalendarCheck, label: '日历视图', desc: '月视图 · 日程安排' },
      ],
    },
    ...(isDesktop()
      ? [
          {
            title: '功能 · 桌面工具',
            items: [
              { to: '/sticky', icon: StickyNote, label: '桌面便签', desc: '随手记 · 浮动便签 · 云同步' },
              { to: '/wallpaper', icon: ImageIcon, label: '动态壁纸', desc: '桌面动画背景 · 鼠标穿透' },
              { to: '/settings/remote-access', icon: Smartphone, label: '远程访问', desc: '手机访问电脑文件 · AI 找文件' },
            ],
          },
        ]
      : []),
    {
      title: '其他',
      items: [
        {
          to: '/settings/server',
          icon: Server,
          label: '服务器设置',
          desc: '后端连接地址 · 换服务器无需重装',
        },
        { to: '/settings/about', icon: Info, label: '关于', desc: 'v1.0.6' },
      ],
    },
  ]

  return (
    <div className="app-shell">
      <Header title="设置" />

      <div className="px-3 py-4 space-y-4">
        {/* 菜单分组 */}
        {sections.map((sec) => (
          <div key={sec.title} className="card overflow-hidden p-0">
            <div className="px-4 pt-3 pb-1 text-xs text-primary-400 font-medium">
              {sec.title}
            </div>
            <div>
              {sec.items.map((item, i) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-primary-50/50 transition-colors ${
                    i < sec.items.length - 1 ? 'border-b border-gray-50' : ''
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <item.icon size={18} className="text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 font-medium">{item.label}</div>
                    {item.desc && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{item.desc}</div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* 清除本地缓存（当前页 confirm） */}
        <button
          onClick={clearCache}
          className="card w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-gray-500" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-gray-800 font-medium">清除本地缓存</div>
            <div className="text-xs text-gray-400 mt-0.5">清理页面缓存，登录态保留</div>
          </div>
          <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
        </button>

        {/* 退出登录（当前页 confirm） */}
        <button
          onClick={onLogout}
          className="card w-full flex items-center justify-center gap-2 py-3 text-red-500 hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">退出登录</span>
        </button>

        <div className="text-center text-xs text-gray-300 py-2">
          绿角犀 v1.0.6
        </div>
      </div>
    </div>
  )
}


