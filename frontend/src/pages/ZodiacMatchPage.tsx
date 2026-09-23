import { useState } from 'react'
import Header from '../components/Header'
import { useToast } from '../components/Toast'
import { getZodiacCompatibility, type ZodiacSign, type CompatibilityResult } from '../lib/api'
import { drawCompatibilityCard, downloadDataUrl } from '../lib/shareCard'
import { Heart, HeartHandshake, MessagesSquare, Users, Sparkles, ArrowLeftRight, Star, Share2, Download, X } from 'lucide-react'

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

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 45
  const offset = circumference * (1 - score / 100)
  const color = score >= 90 ? '#ec4899' : score >= 75 ? '#f59e0b' : score >= 60 ? '#3b82f6' : '#8b5cf6'
  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#f3f4f6" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="45" fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-800">{score}</span>
        <span className="text-[10px] text-gray-400">契合指数</span>
      </div>
    </div>
  )
}

function SignPicker({
  title, selected, onSelect, disabled,
}: { title: string; selected: ZodiacSign | null; onSelect: (s: ZodiacSign) => void; disabled: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1.5">{title}</div>
      <div className="grid grid-cols-6 gap-1.5">
        {ZODIAC_SIGNS.map((sign) => (
          <button
            key={sign.key}
            onClick={() => onSelect(sign)}
            disabled={disabled}
            title={`${sign.name} · ${sign.element}象`}
            className={`py-1.5 rounded-lg text-center transition-all disabled:opacity-50 ${
              selected?.key === sign.key
                ? 'bg-primary-500 text-white shadow-md scale-105'
                : 'bg-gray-50 hover:bg-gray-100'
            }`}
          >
            <div className="text-lg leading-none">{sign.symbol}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${ELEMENT_COLORS[selected.element]}`}>
          {selected.name} · {selected.element}象
        </div>
      )}
    </div>
  )
}

function MatchCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
        {icon} {title}
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
    </div>
  )
}

export default function ZodiacMatchPage() {
  const toast = useToast((s) => s.show)
  const [sign1, setSign1] = useState<ZodiacSign | null>(null)
  const [sign2, setSign2] = useState<ZodiacSign | null>(null)
  const [result, setResult] = useState<CompatibilityResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [shareImage, setShareImage] = useState<string | null>(null)

  const handleMatch = async () => {
    if (!sign1 || !sign2) {
      toast('请先选择两个星座', 'error')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await getZodiacCompatibility(sign1.key, sign2.key)
      setResult(res)
    } catch (e: any) {
      toast(e?.message || '配对失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSwap = () => {
    setSign1(sign2)
    setSign2(sign1)
    setResult(null)
    setShareImage(null)
  }

  const handleShare = () => {
    if (!result) return
    try {
      const dataUrl = drawCompatibilityCard(result)
      setShareImage(dataUrl)
    } catch {
      toast('生成卡片失败，请重试', 'error')
    }
  }

  const handleDownload = () => {
    if (!shareImage || !result) return
    downloadDataUrl(shareImage, `星座配对_${result.sign1.name}x${result.sign2.name}.png`)
  }

  return (
    <div className="app-shell">
      <Header title="星座配对" back />
      <div className="px-4 py-3 space-y-3">
        {/* 选择区 */}
        <div className="card p-4 space-y-3">
          <div className="text-center text-sm text-gray-500">
            选择两个星座，看看你们之间的星象缘分
          </div>

          <SignPicker title="你的星座" selected={sign1} onSelect={setSign1} disabled={loading} />

          <div className="flex justify-center">
            <button
              onClick={handleSwap}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-500 disabled:opacity-50 transition-colors"
            >
              <ArrowLeftRight size={13} /> 交换位置
            </button>
          </div>

          <SignPicker title="TA 的星座" selected={sign2} onSelect={setSign2} disabled={loading} />

          <button
            onClick={handleMatch}
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Sparkles size={16} className="animate-spin" />
                正在推演星象...
              </>
            ) : (
              <>
                <Heart size={16} />
                开始配对
              </>
            )}
          </button>
        </div>

        {/* 结果区 */}
        {result && !loading && (
          <>
            {/* 分数环 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-center gap-3">
                <div className="text-center">
                  <div className="text-3xl">{result.sign1.symbol}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{result.sign1.name}</div>
                </div>
                <Heart size={20} className="text-pink-400 fill-pink-400 animate-pulse" />
                <div className="text-center">
                  <div className="text-3xl">{result.sign2.symbol}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{result.sign2.name}</div>
                </div>
              </div>

              <ScoreRing score={result.score} />

              <div className="text-center">
                <div className="inline-block px-3 py-1 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium">
                  {result.level}
                </div>
                <p className="text-sm text-gray-600 mt-2">{result.interpretation.summary}</p>
              </div>
            </div>

            {/* 规则解读 */}
            <div className="card p-4 space-y-2">
              <div className="text-sm font-medium text-gray-700">星象依据</div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 mt-0.5">元素</span>
                <p className="text-sm text-gray-600">{result.elementRelation}</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 mt-0.5">相位</span>
                <div>
                  <p className="text-sm text-gray-700 font-medium">{result.aspect.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{result.aspect.desc}</p>
                </div>
              </div>
            </div>

            {/* AI 解读 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-1.5 font-medium text-gray-800">
                <Star size={16} className="text-primary-500" />
                深度解读
              </div>

              <MatchCard icon={<Heart size={13} className="text-pink-400" />} title="爱情配对">
                {result.interpretation.love}
              </MatchCard>

              <MatchCard icon={<Users size={13} className="text-blue-400" />} title="友情相处">
                {result.interpretation.friendship}
              </MatchCard>

              <MatchCard icon={<MessagesSquare size={13} className="text-cyan-400" />} title="沟通模式">
                {result.interpretation.communication}
              </MatchCard>

              <div className="flex items-start gap-2 bg-amber-50 rounded-xl p-3">
                <HeartHandshake size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">{result.interpretation.advice}</p>
              </div>

              <button
                onClick={handleShare}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                <Share2 size={15} />
                生成分享卡片
              </button>
            </div>

            <div className="text-center text-[11px] text-gray-300 pb-2">
              ※ 配对结果仅供娱乐参考，真心与包容才是相处的秘诀
            </div>
          </>
        )}
      </div>

      {/* 分享卡片预览弹窗 */}
      {shareImage && result && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShareImage(null)}
        >
          <div
            className="bg-white rounded-2xl p-3 max-w-[320px] w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-sm font-medium text-gray-700">分享卡片</span>
              <button onClick={() => setShareImage(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <img src={shareImage} alt="星座配对卡片" className="w-full rounded-lg shadow-md" />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShareImage(null)}
                className="flex-1 py-2 rounded-xl bg-gray-100 text-sm text-gray-600"
              >
                关闭
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm flex items-center justify-center gap-1.5"
              >
                <Download size={14} /> 保存图片
              </button>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-2">
              长按图片或保存后分享给好友
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
