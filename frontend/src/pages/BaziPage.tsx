import { useState } from 'react'
import Header from '../components/Header'
import { useToast } from '../components/Toast'
import { calculateBazi, type BaziResult, type BaziPillar, type BaziInterpretation } from '../lib/api'
import { User, UserCog, Sparkles, BookOpen, Heart, Briefcase, Coins, HeartPulse, Star } from 'lucide-react'

const WUXING_COLORS: Record<string, string> = {
  '木': 'bg-green-500',
  '火': 'bg-red-500',
  '土': 'bg-yellow-600',
  '金': 'bg-gray-400',
  '水': 'bg-blue-500',
}
const WUXING_TEXT: Record<string, string> = {
  '木': 'text-green-600',
  '火': 'text-red-600',
  '土': 'text-yellow-700',
  '金': 'text-gray-500',
  '水': 'text-blue-600',
}

const HOURS = [
  { label: '子时 (23:00-01:00)', value: 23 },
  { label: '丑时 (01:00-03:00)', value: 1 },
  { label: '寅时 (03:00-05:00)', value: 3 },
  { label: '卯时 (05:00-07:00)', value: 5 },
  { label: '辰时 (07:00-09:00)', value: 7 },
  { label: '巳时 (09:00-11:00)', value: 9 },
  { label: '午时 (11:00-13:00)', value: 11 },
  { label: '未时 (13:00-15:00)', value: 13 },
  { label: '申时 (15:00-17:00)', value: 15 },
  { label: '酉时 (17:00-19:00)', value: 17 },
  { label: '戌时 (19:00-21:00)', value: 19 },
  { label: '亥时 (21:00-23:00)', value: 21 },
]

function PillarCard({ title, pillar, isDay }: { title: string; pillar: BaziPillar | null; isDay?: boolean }) {
  if (!pillar) return (
    <div className="flex-1 text-center">
      <div className="text-xs text-gray-400 mb-1">{title}</div>
      <div className="bg-gray-50 rounded-lg py-3 text-gray-300">—</div>
    </div>
  )
  return (
    <div className={`flex-1 text-center ${isDay ? 'ring-2 ring-primary-400 rounded-lg' : ''}`}>
      <div className="text-xs text-gray-400 mb-1">{title}{isDay && <span className="text-primary-500"> · 日主</span>}</div>
      <div className={`rounded-lg py-2 px-1 ${isDay ? 'bg-primary-50' : 'bg-gray-50'}`}>
        <div className={`text-2xl font-bold ${WUXING_TEXT[pillar.wuxing.stem]}`}>{pillar.stem}</div>
        <div className={`text-2xl font-bold ${WUXING_TEXT[pillar.wuxing.branch]}`}>{pillar.branch}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">{pillar.nayin}</div>
        <div className="text-[10px] text-gray-400">
          {pillar.wuxing.stem}{pillar.yinyang.stem[0]} · {pillar.wuxing.branch}{pillar.yinyang.branch[0]}
        </div>
        {pillar.cangGan.length > 0 && (
          <div className="text-[10px] text-gray-300 mt-0.5">藏: {pillar.cangGan.join('')}</div>
        )}
      </div>
    </div>
  )
}

function WuxingBar({ element, percent }: { element: string; percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium w-4 ${WUXING_TEXT[element]}`}>{element}</span>
      <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${WUXING_COLORS[element]}`}
          style={{ width: `${Math.max(percent, 3)}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{percent}%</span>
    </div>
  )
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
        {icon} {title}
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
    </div>
  )
}

export default function BaziPage() {
  const toast = useToast((s) => s.show)
  const [year, setYear] = useState(1995)
  const [month, setMonth] = useState(1)
  const [day, setDay] = useState(1)
  const [hour, setHour] = useState(23)
  const [gender, setGender] = useState<'male' | 'female'>('male')
  const [result, setResult] = useState<{ bazi: BaziResult; interpretation: BaziInterpretation } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleCalc = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await calculateBazi(year, month, day, hour, gender)
      setResult(res)
    } catch (e: any) {
      toast(e?.message || '排盘失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const currentYear = new Date().getFullYear()

  return (
    <div className="app-shell">
      <Header title="生辰八字" back />
      <div className="px-4 py-3 space-y-3">
        {/* 输入表单 */}
        <div className="card p-4 space-y-3">
          <div className="text-center text-sm text-gray-500">
            输入出生日期和时辰，排四柱八字
          </div>

          {/* 性别 */}
          <div className="flex gap-2">
            <button
              onClick={() => setGender('male')}
              className={`flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors ${
                gender === 'male' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <User size={15} /> 男（乾造）
            </button>
            <button
              onClick={() => setGender('female')}
              className={`flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors ${
                gender === 'female' ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <UserCog size={15} /> 女（坤造）
            </button>
          </div>

          {/* 日期选择 */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-400">年</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="input py-1.5 text-sm"
                disabled={loading}
              >
                {Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">月</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="input py-1.5 text-sm"
                disabled={loading}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">日</label>
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="input py-1.5 text-sm"
                disabled={loading}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}日</option>
                ))}
              </select>
            </div>
          </div>

          {/* 时辰选择 */}
          <div>
            <label className="text-xs text-gray-400">出生时辰</label>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="input py-1.5 text-sm"
              disabled={loading}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleCalc}
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Sparkles size={16} className="animate-spin" />
                正在排盘推命...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                开始排盘
              </>
            )}
          </button>
        </div>

        {/* 排盘结果 */}
        {result && !loading && (
          <>
            {/* 四柱 */}
            <div className="card p-4 space-y-3">
              <div className="text-center">
                <div className="text-xs text-gray-400">{result.bazi.description}</div>
              </div>
              <div className="flex gap-2">
                <PillarCard title="年柱" pillar={result.bazi.year} />
                <PillarCard title="月柱" pillar={result.bazi.month} />
                <PillarCard title="日柱" pillar={result.bazi.day} isDay />
                <PillarCard title="时柱" pillar={result.bazi.hour} />
              </div>
              <div className="flex items-center justify-around text-xs text-gray-400 pt-1">
                <span>生肖: {result.bazi.year.animal}</span>
                <span>年命: {result.bazi.nayinYear}</span>
                <span>日主: <span className={WUXING_TEXT[result.bazi.dayMasterElement]}>{result.bazi.dayMaster}（{result.bazi.dayMasterElement}）</span></span>
              </div>
            </div>

            {/* 五行分布 */}
            <div className="card p-4 space-y-2">
              <div className="text-sm font-medium text-gray-700">五行分布</div>
              {Object.entries(result.bazi.wuxingPercent).map(([element, percent]) => (
                <WuxingBar key={element} element={element} percent={percent} />
              ))}
              <div className="text-xs text-gray-400 pt-1">
                {result.interpretation.favorable}
              </div>
            </div>

            {/* AI 解读 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-1.5 font-medium text-gray-800">
                <BookOpen size={16} className="text-primary-500" />
                命理解读
              </div>

              {/* 概括 */}
              <div className="bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl p-3 text-center">
                <p className="text-sm font-medium text-gray-700">{result.interpretation.summary}</p>
              </div>

              {/* 性格 */}
              <SectionCard icon={<User size={13} className="text-blue-400" />} title="性格特质">
                {result.interpretation.personality}
              </SectionCard>

              {/* 事业 */}
              <SectionCard icon={<Briefcase size={13} className="text-indigo-400" />} title="事业方向">
                {result.interpretation.career}
              </SectionCard>

              {/* 财运 */}
              <SectionCard icon={<Coins size={13} className="text-amber-400" />} title="财运分析">
                {result.interpretation.wealth}
              </SectionCard>

              {/* 感情 */}
              <SectionCard icon={<Heart size={13} className="text-pink-400" />} title="感情婚姻">
                {result.interpretation.love}
              </SectionCard>

              {/* 健康 */}
              <SectionCard icon={<HeartPulse size={13} className="text-green-400" />} title="健康提示">
                {result.interpretation.health}
              </SectionCard>

              {/* 建议 */}
              <div className="flex items-start gap-2 bg-amber-50 rounded-xl p-3">
                <Star size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">{result.interpretation.advice}</p>
              </div>
            </div>

            {/* 免责声明 */}
            <div className="text-center text-[11px] text-gray-300 pb-2">
              ※ 命理解读仅供文化娱乐参考，不应作为人生决策的依据
            </div>
          </>
        )}
      </div>
    </div>
  )
}
