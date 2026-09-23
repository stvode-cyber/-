import { useState, useMemo, useCallback } from 'react'
import {
  GraduationCap, Plus, Trash2, X, Pencil, Clock, Flame, TrendingUp, ChevronRight,
} from 'lucide-react'
import {
  listSkillsWithStats, getSkillStat, addSkill, updateSkill, deleteSkill,
  addPractice, deletePractice, getPracticeLogs,
  CATEGORY_META, EMOJI_OPTIONS, COLOR_OPTIONS, todayStr,
  type Skill, type SkillCategory, type PracticeLog, type SkillWithStats,
} from '../lib/skillStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 技能学习追踪页
 *
 * 布局：
 * 1. 统计汇总：技能数 / 总小时 / 本周分钟 / 最长连续
 * 2. 技能卡片：等级徽章 + 进度条 + 连续天数 + 本周柱状图
 * 3. 点击展开：练习日志 + 记录练习
 */

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 等级徽章颜色 */
function levelColor(level: number): string {
  const colors = ['#94A3B8', '#A78BFA', '#3B82F6', '#10B981', '#F59E0B']
  return colors[Math.min(level - 1, colors.length - 1)]
}

export default function SkillPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [editing, setEditing] = useState<Skill | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [practiceSkillId, setPracticeSkillId] = useState<string | null>(null)
  const [practiceMinutes, setPracticeMinutes] = useState('30')
  const [practiceNote, setPracticeNote] = useState('')
  const [logs, setLogs] = useState<PracticeLog[]>([])

  const skills = useMemo(() => listSkillsWithStats(), [version])
  const stat = useMemo(() => getSkillStat(), [version])

  const handleAddPractice = useCallback((skillId: string) => {
    const minutes = parseInt(practiceMinutes, 10)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
      toast('请输入有效时长（1-600 分钟）', 'error')
      return
    }
    addPractice(skillId, minutes, practiceNote)
    const skill = skills.find((s) => s.id === skillId)
    const totalMin = (skill?.totalMinutes || 0) + minutes
    toast(`+${minutes}分钟 已记录 (${Math.round(totalMin / 60 * 10) / 10}h)`, 'success')
    setPracticeSkillId(null)
    setPracticeNote('')
    setPracticeMinutes('30')
    refresh()
  }, [practiceMinutes, practiceNote, skills, toast, refresh])

  const handleExpand = useCallback((skill: SkillWithStats) => {
    const id = skill.id
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setLogs(getPracticeLogs(id, 15))
  }, [expandedId])

  const handleDelete = useCallback((skill: Skill) => {
    deleteSkill(skill.id)
    toast(`已删除「${skill.name}」`, 'info')
    setExpandedId(null)
    refresh()
  }, [toast, refresh])

  const handleDeleteLog = useCallback((logId: string, skillId: string) => {
    deletePractice(logId)
    setLogs(getPracticeLogs(skillId, 15))
    refresh()
  }, [refresh])

  const handleSave = useCallback((data: Omit<Skill, 'id' | 'createdAt'>, id?: string) => {
    if (id) {
      updateSkill(id, data)
      toast('技能已更新', 'success')
    } else {
      addSkill(data)
      toast('技能已添加 🎯', 'success')
    }
    setShowAdd(false)
    setEditing(null)
    refresh()
  }, [toast, refresh])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <GraduationCap size={22} className="text-indigo-500" /> 技能追踪
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">一万小时定律 · 累积练习时长</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 新技能
          </button>
        </div>

        {/* 统计汇总 */}
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-4 divide-x divide-gray-100 text-center">
            <div>
              <div className="text-2xl font-bold text-indigo-500 tabular-nums">{stat.totalSkills}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">技能数</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800 tabular-nums">{stat.totalHours}h</div>
              <div className="text-[11px] text-gray-400 mt-0.5">总练习</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-500 tabular-nums">{stat.weekMinutes}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">本周分钟</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-500 tabular-nums flex items-center justify-center gap-0.5">
                <Flame size={14} /> {stat.maxStreak}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">最长连续</div>
            </div>
          </div>
        </div>

        {/* 技能列表 */}
        {skills.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-2xl mb-1.5">🎯</div>
            <p className="text-xs text-gray-400 mb-3">还没有技能，把你在学的东西加进来吧</p>
            <p className="text-[10px] text-gray-400 mb-4">吉他、外语、编程、绘画… 一万小时从今天开始</p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100 active:scale-95 transition-all"
            >
              + 添加第一个技能
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {skills.map((skill) => {
              const expanded = expandedId === skill.id
              const lvl = levelColor(skill.level)
              const cmeta = CATEGORY_META[skill.category]
              const maxBar = Math.max(1, ...skill.weekBars.map((b) => b.minutes))
              const isPracticePanel = practiceSkillId === skill.id
              return (
                <div key={skill.id} className="card overflow-hidden">
                  {/* 卡片主体 */}
                  <div className="p-4 cursor-pointer group" onClick={() => handleExpand(skill)}>
                    <div className="flex items-start gap-3">
                      {/* emoji + 等级 */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                          style={{ background: `${skill.color}1A` }}
                        >
                          {skill.emoji}
                        </div>
                        <span
                          className="text-[9px] font-bold rounded px-1.5 py-0.5 text-white"
                          style={{ background: lvl }}
                        >
                          Lv{skill.level}
                        </span>
                      </div>
                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 truncate">{skill.name}</span>
                          <span className="text-[9px] text-gray-400 flex-shrink-0">{cmeta.emoji} {cmeta.label}</span>
                          <span className="text-[9px] text-gray-400 flex-shrink-0">{skill.levelTitle}</span>
                        </div>
                        {/* 等级进度条 */}
                        <div className="mt-1.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${skill.levelPct}%`, background: skill.color }}
                              />
                            </div>
                            <span className="text-[9px] text-gray-400 tabular-nums w-12 text-right">
                              {skill.totalHours}h
                              {skill.toNextLevel > 0 && <span className="text-gray-300">/{skill.toNextLevel + skill.totalHours}h</span>}
                            </span>
                          </div>
                        </div>
                        {/* 本周柱状图 */}
                        <div className="flex items-end gap-1 mt-2 h-8">
                          {skill.weekBars.map((bar, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                              <div
                                className="w-full rounded-sm transition-all"
                                style={{
                                  height: bar.minutes > 0 ? `${Math.max(2, (bar.minutes / maxBar) * 28)}px` : '2px',
                                  background: bar.minutes > 0 ? skill.color : 'rgba(0,0,0,0.05)',
                                  opacity: bar.minutes > 0 ? 1 : 0.3,
                                }}
                                title={`周${WEEKDAY_LABELS[i]} ${bar.minutes}分钟`}
                              />
                              <span className="text-[7px] text-gray-300">{WEEKDAY_LABELS[i]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* 右侧统计 */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {skill.streak > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-orange-500 font-semibold">
                            <Flame size={11} /> {skill.streak}天
                          </span>
                        )}
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                          <Clock size={10} /> {skill.weekMinutes}分
                        </span>
                        <ChevronRight
                          size={16}
                          className={`text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 展开面板 */}
                  {expanded && (
                    <div className="border-t border-gray-50 px-4 pb-4">
                      {/* 目标进度 */}
                      <div className="mt-3 flex items-center gap-2">
                        <TrendingUp size={12} className="text-gray-400" />
                        <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${skill.targetPct}%`, background: skill.color }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 tabular-nums">{skill.targetPct}%</span>
                        <span className="text-[9px] text-gray-400">目标{skill.targetHours}h</span>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setPracticeSkillId(isPracticePanel ? null : skill.id); setPracticeMinutes('30'); setPracticeNote('') }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                          style={{ background: `${skill.color}14`, color: skill.color }}
                        >
                          <Clock size={12} /> {isPracticePanel ? '收起' : '记一次练习'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(skill) }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 flex items-center gap-1"
                        >
                          <Pencil size={12} /> 编辑
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(skill) }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-400 flex items-center gap-1 ml-auto"
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>

                      {/* 练习记录面板 */}
                      {isPracticePanel && (
                        <div className="mt-3 rounded-lg bg-gray-50 p-3">
                          <div className="flex items-center gap-2">
                            <input
                              value={practiceMinutes}
                              onChange={(e) => setPracticeMinutes(e.target.value)}
                              inputMode="numeric"
                              className="w-16 px-2 py-1.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400 text-center bg-white"
                            />
                            <span className="text-xs text-gray-400">分钟</span>
                            <input
                              value={practiceNote}
                              onChange={(e) => setPracticeNote(e.target.value)}
                              maxLength={50}
                              placeholder="备注（可选）"
                              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs border border-gray-200 outline-none focus:border-indigo-400 bg-white"
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAddPractice(skill.id) }}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                              style={{ background: skill.color }}
                            >
                              记录
                            </button>
                          </div>
                          {/* 快捷时长 */}
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-[10px] text-gray-400">快捷：</span>
                            {[15, 25, 30, 45, 60].map((m) => (
                              <button
                                key={m}
                                onClick={(e) => { e.stopPropagation(); setPracticeMinutes(String(m)) }}
                                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                                  practiceMinutes === String(m) ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-500'
                                }`}
                              >
                                {m}分
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 最近日志 */}
                      {logs.length > 0 ? (
                        <div className="mt-3">
                          <div className="text-[10px] text-gray-400 mb-2">最近练习</div>
                          <div className="space-y-1">
                            {logs.map((log) => (
                              <div key={log.id} className="flex items-center gap-2 text-xs group/log">
                                <span className="text-gray-400 tabular-nums w-16">{log.date.slice(5).replace('-', '/')}</span>
                                <span className="font-medium text-gray-700 tabular-nums">{log.duration}分</span>
                                {log.note && <span className="text-gray-400 truncate flex-1">{log.note}</span>}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteLog(log.id, skill.id) }}
                                  className="p-0.5 rounded text-gray-300 hover:text-rose-500 opacity-0 group-hover/log:opacity-100 flex-shrink-0"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-400 mt-3 text-center">还没有练习记录</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {(showAdd || editing) && (
        <SkillModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ===== 新增/编辑弹窗 =====

const CATEGORY_LIST = Object.keys(CATEGORY_META) as SkillCategory[]

function SkillModal({ initial, onClose, onSave }: {
  initial: Skill | null
  onClose: () => void
  onSave: (data: Omit<Skill, 'id' | 'createdAt'>, id?: string) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '🎸')
  const [category, setCategory] = useState<SkillCategory>(initial?.category || 'music')
  const [targetHours, setTargetHours] = useState(initial ? String(initial.targetHours) : '100')
  const [color, setColor] = useState(initial?.color || '#8B5CF6')

  const valid = name.trim().length > 0

  const submit = () => {
    if (!valid) return
    const th = parseInt(targetHours, 10)
    onSave(
      {
        name: name.trim().slice(0, 20),
        emoji,
        category,
        targetHours: Number.isFinite(th) && th > 0 ? th : 100,
        color,
      },
      initial?.id,
    )
  }

  // 切换分类时同步默认 emoji
  const handleCategoryChange = (c: SkillCategory) => {
    setCategory(c)
    if (!initial || emoji === CATEGORY_META[initial.category].emoji) {
      setEmoji(CATEGORY_META[c].emoji)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">{initial ? '编辑技能' : '新增技能'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 + emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">名称</label>
            <div className="flex items-center gap-2">
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{ background: `${color}1A` }}
              >
                {emoji}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="如：吉他、英语、Python"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {/* emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">图标</label>
            <div className="grid grid-cols-10 gap-1">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-7 rounded-lg text-sm flex items-center justify-center border transition ${
                    emoji === e ? 'border-indigo-400 bg-indigo-50 scale-110' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 分类 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">分类</label>
            <div className="grid grid-cols-4 gap-1.5">
              {CATEGORY_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => handleCategoryChange(c)}
                  className={`py-1.5 rounded-lg text-[11px] border transition flex items-center justify-center gap-0.5 ${
                    category === c ? 'border-indigo-400 bg-indigo-50 text-indigo-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  <span>{CATEGORY_META[c].emoji}</span>
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>

          {/* 目标小时数 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">目标小时数（达到即"精通"）</label>
            <div className="flex items-center gap-2">
              <input
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                inputMode="numeric"
                placeholder="100"
                className="w-20 px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400 text-center"
              />
              <span className="text-xs text-gray-400">小时</span>
              <div className="flex items-center gap-1 ml-1">
                {[100, 300, 1000, 10000].map((h) => (
                  <button
                    key={h}
                    onClick={() => setTargetHours(String(h))}
                    className="px-2 py-1 rounded text-[10px] border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    {h >= 1000 ? `${h / 1000}k` : h}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 颜色 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">主题色</label>
            <div className="grid grid-cols-8 gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 rounded-lg border-2 transition ${
                    color === c ? 'border-gray-400 scale-110' : 'border-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
