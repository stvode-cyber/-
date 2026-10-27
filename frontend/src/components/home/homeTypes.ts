/**
 * HomePage 共享类型
 * 从 HomePage.tsx 内联 interface 抽离，ChatPage 二次拆分 SOP 验证有效。
 */

export interface HomeTaskItem {
  id: string
  title: string
  priority: string
  status: string
  dueDate?: string | null
  important?: boolean
  category?: string
}

export interface HomeReminderItem {
  id: string
  title: string
  remindAt: string
  level?: string
  done: boolean
}

export interface HomeData {
  date: string
  greeting: string
  /** DG-12 场景化问候：按时段+当日数据生成的个性化问候 */
  sceneGreeting: {
    title: string
    subtitle: string
    tip: string
  }
  energy: number
  mood: string
  todayTip: string
  countdowns: { id: string; title: string; targetDate: string; days: number; icon: string }[]
  todayTasks: HomeTaskItem[]
  pendingTaskCount: number
  finance: { monthExpense: number; monthIncome: number; walletBalance: number }
  health: {
    todayMeals: number
    totalCalories: number
    suggestion: string
    // 昨晚睡眠数据（阶段二「睡眠分析」基础版）
    sleep: {
      durationMin: number
      quality?: number | null
      hint: string
    } | null
  }
  events: {
    id: string
    type: string
    title: string
    time: string
    priority?: string
    level?: string
    // 情境视角（EV-05）：work | life | finance
    scope: 'work' | 'life' | 'finance'
    // EV-06 事件手动管理：手动事件携带的扩展字段
    manual?: boolean
    important?: boolean
    location?: string | null
    attendees?: string[]
    color?: string
  }[]
  // 事件冲突（EV-02）：相邻事件间隔 < 15min 的冲突对
  conflicts: {
    a: { id: string; type: string; title: string; time: string }
    b: { id: string; type: string; title: string; time: string }
    gapMin: number
    suggestion: string
  }[]
  // DG-05 每日一问：基于当日数据的启发式问题
  dailyQuestion: {
    question: string
    hint: string
    action: string
  }
  /** DG-14 成就激励：今日进度 + 连续记录 + 徽章 */
  achievements: {
    todayProgress: { done: number; total: number; rate: number }
    streaks: { label: string; days: number; emoji: string }[]
    badges: { key: string; label: string; emoji: string; unlocked: boolean; hint: string }[]
    encouragement: string
  }
  reminders: HomeReminderItem[]
  handover: {
    draft: { id: string; title: string; updatedAt: string } | null
    pendingItemCount: number
  }
}

/**
 * EV-03 事件详情接口
 * 与后端 GET /manual-events/:id/detail 响应对齐。
 */
export interface EventDetail {
  id: string
  type: string
  title: string
  time: string
  scope: 'work' | 'life' | 'finance'
  description?: string | null
  location?: string | null
  attendees?: string[]
  color?: string
  priority?: string
  important?: boolean
  progress?: number
  level?: string
  repeat?: string
  countdown: number
  relatedPeople: string[]
  checklist: Array<{ text: string; optional?: boolean }>
}
