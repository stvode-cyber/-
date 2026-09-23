import { useState } from 'react'
import Header from '../components/Header'
import { useToast } from '../components/Toast'
import { getHoroscope, type ZodiacSign, type HoroscopeFortune } from '../lib/api'
import { Sparkles, Star, Heart, Briefcase, Coins, HeartPulse, Palette, Hash } from 'lucide-react'

const ZODIAC_SIGNS: ZodiacSign[] = [
  { key: 'aries', name: '白羊座', symbol: '♈', date: '3/21-4/19', element: '火' },
  { key: 'taurus', name: '金牛座', symbol: '♉', date: '4/20-5/20', element: '土' },
  { key: 'gemini', name: '双子座', symbol: '♊', date: '5/21-6/21', element: '风' },
  { key: 'cancer', name: '巨蟹座', symbol: '♋', date: '6/22-7/22', element: '水' },
  { key: 'leo', name: '狮子座', symbol: '♌', date: '7/23-8/22', element: '火' },
  { key: 'virgo', name: '处女座', symbol: '♍', date: '8/23-9/22', element: '土' },
  { key: 'libra', name: '天秤座', symbol: '♎', date: '9/23-10/23', element: '风' },
  { key: 'scorpio', name: '天蝎座', symbol: '♏', date: '10/24-11/22', element: '水' },
  { key: 'sagittarius', name: '射手座', symbol: '♐', date: '11/23-12/21', element: '火' },
  { key: 'capricorn', name: '摩羯座', symbol: '♑', date: '12/22-1/19', element: '土' },
  { key: 'aquarius', name: '水瓶座', symbol: '♒', date: '1/20-2/18', element: '风' },
  { key: 'pisces', name: '双鱼座', symbol: '♓', date: '2/19-3/20', element: '水' },
]

const ELEMENT_COLORS: Record<string, string> = {
  '火': 'text-red-500 bg-red-50',
  '土': 'text-yellow-600 bg-yellow-50',
  '风': 'text-cyan-500 bg-cyan-50',
  '水': 'text-blue-500 bg-blue-50',
}

function Stars({ count }: { count: number }) {
  return (
    <span className="text-amber-400 tracking-tight">
      {'★'.repeat(count)}
      <span className="text-gray-200">{'★'.repeat(5 - count)}</span>
    </span>
  )
}

function FortuneRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-1.5 text-sm text-gray-600">
        {icon} {label}
      </span>
      <Stars count={value} />
    </div>
  )
}

export default function HoroscopePage() {
  const toast = useToast((s) => s.show)
  const [selected, setSelected] = useState<ZodiacSign | null>(null)
  const [fortune, setFortune] = useState<HoroscopeFortune | null>(null)
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSelect = async (sign: ZodiacSign) => {
    setSelected(sign)
    setLoading(true)
    setFortune(null)
    try {
      const res = await getHoroscope(sign.key)
      setFortune(res.fortune)
      setDate(res.date)
    } catch (e: any) {
      toast(e?.message || '获取运势失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <Header title="星座运势" back />
      <div className="px-4 py-3 space-y-3">
        {/* 星座选择网格 */}
        <div className="grid grid-cols-3 gap-2">
          {ZODIAC_SIGNS.map((sign) => (
            <button
              key={sign.key}
              onClick={() => handleSelect(sign)}
              className={`card p-3 text-center transition-all ${
                selected?.key === sign.key ? 'ring-2 ring-primary-500' : 'hover:shadow-md'
              }`}
            >
              <div className="text-2xl mb-0.5">{sign.symbol}</div>
              <div className="text-xs font-medium text-gray-700">{sign.name}</div>
              <div className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${ELEMENT_COLORS[sign.element] || ''}`}>
                {sign.element}象
              </div>
            </button>
          ))}
        </div>

        {/* 运势结果 */}
        {selected && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-3xl">{selected.symbol}</span>
                <div>
                  <div className="font-medium text-gray-800">{selected.name}</div>
                  <div className="text-xs text-gray-400">{selected.date} · {selected.element}象</div>
                </div>
              </div>
              {date && <div className="text-xs text-gray-400">{date}</div>}
            </div>

            {loading ? (
              <div className="text-center py-6 text-primary-500 animate-pulse">
                <Sparkles className="mx-auto mb-2" size={28} />
                <span className="text-sm">正在观测星象...</span>
              </div>
            ) : fortune ? (
              <>
                {/* 总运 */}
                <div className="bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">综合运势</div>
                  <Stars count={fortune.overall} />
                  <div className="text-sm text-gray-600 mt-1">{fortune.summary}</div>
                </div>

                {/* 分项运势 */}
                <div className="space-y-0.5">
                  <FortuneRow icon={<Heart size={14} className="text-pink-500" />} label="爱情" value={fortune.love} />
                  <FortuneRow icon={<Briefcase size={14} className="text-blue-500" />} label="事业" value={fortune.career} />
                  <FortuneRow icon={<Coins size={14} className="text-amber-500" />} label="财运" value={fortune.wealth} />
                  <FortuneRow icon={<HeartPulse size={14} className="text-green-500" />} label="健康" value={fortune.health} />
                </div>

                {/* 幸运元素 */}
                <div className="flex gap-2">
                  <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                    <Palette size={14} className="mx-auto text-purple-400 mb-0.5" />
                    <div className="text-[10px] text-gray-400">幸运颜色</div>
                    <div className="text-sm font-medium text-gray-700">{fortune.luckyColor}</div>
                  </div>
                  <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                    <Hash size={14} className="mx-auto text-blue-400 mb-0.5" />
                    <div className="text-[10px] text-gray-400">幸运数字</div>
                    <div className="text-sm font-medium text-gray-700">{fortune.luckyNumber}</div>
                  </div>
                </div>

                {/* 详细分析 */}
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-xs font-medium text-gray-500 mb-1">详细分析</div>
                  <p className="text-sm text-gray-600 leading-relaxed">{fortune.detail}</p>
                </div>

                {/* 建议 */}
                <div className="flex items-start gap-2 bg-amber-50 rounded-xl p-3">
                  <Star size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-700">{fortune.advice}</p>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
