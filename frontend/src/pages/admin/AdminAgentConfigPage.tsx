import { useEffect, useState } from 'react'
import { RefreshCw, Save, RotateCcw, FlaskConical, Sun, Copy, Trash2 } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState } from '../../components/StateView'
import { useConfirm } from '../../components/ConfirmDialog'

/** 问候语料变体（A 必有；B 可为 null=跟随 A） */
interface GreetingVariant {
  timePools: { morning: string[]; noon: string[]; evening: string[]; late: string[] }
  relationPools: { first: string[]; returning: string[]; daily: string[]; streak: string[] }
  casualNotes: string[]
  noteProb: number
}

interface AgentConfig {
  version: number
  abTest: { enabled: boolean }
  greeting: { A: GreetingVariant; B: GreetingVariant | null }
  weeklyNotes: { A: string[]; B: string[] | null }
  personaPrompt: string
}

interface ConfigDesc {
  config: AgentConfig
  file: { path: string; mtime: string | null; exists: boolean }
  defaults: AgentConfig
}

const TIME_POOL_META: { key: keyof GreetingVariant['timePools']; label: string; hint: string }[] = [
  { key: 'morning', label: '早安（6-11点）', hint: '' },
  { key: 'noon', label: '午间（11-14点）', hint: '' },
  { key: 'evening', label: '傍晚（14-19点）', hint: '' },
  { key: 'late', label: '夜晚（19-次日6点）', hint: '' },
]

const RELATION_POOL_META: { key: keyof GreetingVariant['relationPools']; label: string; hint: string }[] = [
  { key: 'first', label: '首次见面', hint: '' },
  { key: 'returning', label: '久别回归（≥3天未聊）', hint: '' },
  { key: 'daily', label: '日常', hint: '' },
  { key: 'streak', label: '连续互动', hint: '支持 {n} 占位符=连续天数' },
]

/** 数组 ↔ 多行文本互转（一行一条，忽略空行） */
const toText = (arr: string[] | null | undefined) => (arr || []).join('\n')
const toArr = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean)

/**
 * 管理后台 · Agent 语料与人设配置页（P4 运营配置化）
 *
 * - 问候/碎碎念/周报模板 A-B 双语料池编辑（B 池按 userId 稳定分桶）
 * - 人设 System Prompt 覆盖（留空用内置）
 * - 保存即热更（PUT 原子写文件+刷新缓存，无需重启后端）
 * - 「热更重读」兜底外部直接改文件的场景
 */
export default function AdminAgentConfigPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [desc, setDesc] = useState<ConfigDesc | null>(null)
  const [cfg, setCfg] = useState<AgentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await unwrap<ConfigDesc>(api.get('/admin/agent-config'))
      setDesc(res)
      setCfg(structuredClone(res.config))
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 保存：PUT 全量配置（后端校验失败返回 422 + 具体字段错误信息） */
  const save = async () => {
    if (!cfg) return
    // 前端轻校验：必填池转文本后不能为空（与后端 assertStrArray 对齐）
    for (const key of TIME_POOL_META) {
      if (toArr(toText(cfg.greeting.A.timePools[key.key])).length === 0) {
        toast(`A 池·时段问候「${key.label}」至少保留 1 条`, 'error')
        return
      }
    }
    if (toArr(toText(cfg.weeklyNotes.A)).length === 0) {
      toast('周报碎碎念 A 池至少保留 1 条', 'error')
      return
    }
    setSaving(true)
    try {
      // 深拷贝并把多行文本状态里可能残留的空行清掉
      const body = structuredClone(cfg)
      const res = await unwrap<AgentConfig>(api.put('/admin/agent-config', body))
      setCfg(structuredClone(res))
      setDesc((d) => (d ? { ...d, config: res } : d))
      toast('配置已保存并即时生效', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  /** 强制热更（外部直接改文件后的兜底重读） */
  const reload = async () => {
    try {
      await unwrap(api.post('/admin/agent-config/reload'))
      toast('已强制重读配置文件', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 恢复内置默认（二次确认） */
  const resetDefaults = async () => {
    if (!desc) return
    if (!(await confirm({
      title: '恢复内置默认',
      message: '将全部语料池与人设恢复为内置默认值（保存前可放弃）。',
      confirmText: '恢复默认',
    }))) return
    setCfg(structuredClone(desc.defaults))
    toast('已载入内置默认值，点「保存」生效', 'success')
  }

  const setVariant = (pool: 'A' | 'B', patch: Partial<GreetingVariant>) => {
    setCfg((c) => {
      if (!c) return c
      const src = pool === 'B' ? c.greeting.B : c.greeting.A
      if (!src) return c
      const next = { ...src, ...patch }
      return { ...c, greeting: { ...c.greeting, [pool]: next } }
    })
  }

  /** 从 A 复制启用 B 池 */
  const enableB = () => {
    setCfg((c) => (c ? { ...c, greeting: { ...c.greeting, B: structuredClone(c.greeting.A) }, weeklyNotes: { ...c.weeklyNotes, B: [...c.weeklyNotes.A] } } : c))
    toast('B 池已从 A 复制，可开始差异化编辑', 'success')
  }

  /** 清空 B 池（B 桶用户回退 A 池） */
  const disableB = async () => {
    if (!(await confirm({
      title: '清空 B 池',
      message: 'B 池语料将被清空，B 桶用户自动回退使用 A 池。',
      confirmText: '清空 B 池',
      danger: true,
    }))) return
    setCfg((c) => (c ? { ...c, greeting: { ...c.greeting, B: null }, weeklyNotes: { ...c.weeklyNotes, B: null } } : c))
  }

  if (loading) return <div className="p-6"><LoadingState text="加载配置中…" /></div>
  if (error || !cfg || !desc) return <div className="p-6"><ErrorState onRetry={load} /></div>

  const hasB = !!cfg.greeting.B || !!cfg.weeklyNotes.B
  const abWarn = cfg.abTest.enabled && !cfg.greeting.B

  return (
    <div className="p-6 max-w-4xl">
      {/* 头部：标题 + 文件信息 + 操作 */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">语料与人设配置</h1>
          <p className="text-xs text-gray-400 mt-1">
            {desc.file.exists ? `文件：agent-config.json · 更新于 ${new Date(desc.file.mtime!).toLocaleString()}` : '配置文件缺失，当前使用内置默认值'}
            {' · '}保存即热更，无需重启后端
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} /> 热更重读
          </button>
          <button onClick={resetDefaults} className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <RotateCcw size={14} /> 恢复默认
          </button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 btn-primary rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">
            <Save size={14} /> {saving ? '保存中…' : '保存并生效'}
          </button>
        </div>
      </div>

      {/* A/B 实验 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-emerald-600" />
            <span className="font-medium text-gray-800 text-sm">A/B 语料池实验</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
            <input
              type="checkbox"
              checked={cfg.abTest.enabled}
              onChange={(e) => setCfg({ ...cfg, abTest: { enabled: e.target.checked } })}
              className="accent-emerald-600 w-4 h-4"
            />
            开启分桶
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          开启后按用户 ID 稳定分桶（同一用户永远同一桶）；未配置 B 池时 B 桶用户回退 A 池。
        </p>
        <div className="flex items-center gap-2 mt-3">
          {hasB ? (
            <button onClick={disableB} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
              <Trash2 size={12} /> 清空 B 池
            </button>
          ) : (
            <button onClick={enableB} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700">
              <Copy size={12} /> 从 A 复制启用 B 池
            </button>
          )}
          {abWarn && <span className="text-xs text-amber-600">已开启分桶但 B 池未配置，B 桶用户将使用 A 池语料</span>}
        </div>
      </div>

      {/* 问候语料池 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Sun size={16} className="text-amber-500" />
          <span className="font-medium text-gray-800 text-sm">问候与碎碎念</span>
          <span className="text-xs text-gray-400">（启动问候，一行一条，随机抽取）</span>
        </div>

        {(['A', 'B'] as const).map((pool) => {
          const v = pool === 'A' ? cfg.greeting.A : cfg.greeting.B
          if (pool === 'B' && !v) return null
          return (
            <div key={pool} className="mt-3 pt-3 border-t border-gray-100 first:border-0">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${pool === 'A' ? 'bg-emerald-600' : 'bg-teal-600'}`}>{pool}</span>
                <span className="text-sm text-gray-600">问候语料池 {pool}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {TIME_POOL_META.map(({ key, label }) => (
                  <div key={key}>
                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                    <textarea
                      value={toText(v!.timePools[key])}
                      onChange={(e) => setVariant(pool, { timePools: { ...v!.timePools, [key]: toArr(e.target.value) } })}
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      placeholder="一行一条"
                    />
                  </div>
                ))}
                {RELATION_POOL_META.map(({ key, label, hint }) => (
                  <div key={key}>
                    <div className="text-xs text-gray-500 mb-1">{label}{hint && <span className="text-gray-300 ml-1">{hint}</span>}</div>
                    <textarea
                      value={toText(v!.relationPools[key])}
                      onChange={(e) => setVariant(pool, { relationPools: { ...v!.relationPools, [key]: toArr(e.target.value) } })}
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      placeholder="一行一条"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_200px] gap-3 mt-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">碎碎念池（概率追加在问候后）</div>
                  <textarea
                    value={toText(v!.casualNotes)}
                    onChange={(e) => setVariant(pool, { casualNotes: toArr(e.target.value) })}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    placeholder="一行一条；可留空=不追加碎碎念"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">碎碎念概率</div>
                  <div className="flex items-center gap-2 h-[62px]">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={v!.noteProb}
                      onChange={(e) => setVariant(pool, { noteProb: Number(e.target.value) })}
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-sm text-gray-600 w-8 text-right">{Math.round(v!.noteProb * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 周报碎碎念 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-medium text-gray-800 text-sm">周报碎碎念</span>
          <span className="text-xs text-gray-400">（@回顾/周报页随机取一条；支持 {'{streak}'}={'记账连击天数'}、{'{top_cat}'}={'消费最高分类'}）</span>
        </div>
        {(['A', 'B'] as const).map((pool) => {
          const notes = pool === 'A' ? cfg.weeklyNotes.A : cfg.weeklyNotes.B
          if (pool === 'B' && !notes) return null
          return (
            <div key={pool} className="mb-3 last:mb-0">
              <div className="text-xs text-gray-500 mb-1">{pool} 池</div>
              <textarea
                value={toText(notes || [])}
                onChange={(e) => setCfg({ ...cfg, weeklyNotes: { ...cfg.weeklyNotes, [pool]: toArr(e.target.value) } })}
                rows={4}
                className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                placeholder="一行一条"
              />
            </div>
          )
        })}
      </div>

      {/* 人设覆盖 */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-800 text-sm">人设 System Prompt 覆盖</span>
        </div>
        <p className="text-xs text-gray-400 mb-2">
          留空使用内置人设（老朋友口吻/短回复分支/禁用词等）。非空时整体替换说话方式区块，时间/问候上下文仍自动注入。修改保存即热更。
        </p>
        <textarea
          value={cfg.personaPrompt}
          onChange={(e) => setCfg({ ...cfg, personaPrompt: e.target.value })}
          rows={6}
          maxLength={3000}
          className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400"
          placeholder={'例：\n你是用户的大学室友，说话直接、爱开玩笑。\n- 用"你"不用"您"\n- 回复1-2句\n- 禁止说"欢迎回来"'}
        />
        <div className="text-right text-xs text-gray-300 mt-1">{cfg.personaPrompt.length}/3000</div>
      </div>
    </div>
  )
}
