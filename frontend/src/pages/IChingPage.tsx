import { useState } from 'react'
import Header from '../components/Header'
import { useToast } from '../components/Toast'
import { castIChing, type IChingResult } from '../lib/api'
import { Sparkles, Send, RefreshCw, BookOpen, Lightbulb, TrendingUp } from 'lucide-react'

// 渲染单爻：阳爻=实线，阴爻=断线，变爻高亮
function YaoLine({ value, changing, label }: { value: number; changing: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-6 text-right">{label}</span>
      <div className={`flex-1 h-5 rounded-sm relative ${changing ? 'bg-amber-100' : ''}`}>
        {value === 1 ? (
          <div className={`h-2.5 w-full rounded-sm ${changing ? 'bg-amber-500' : 'bg-gray-700'} absolute top-1/2 -translate-y-1/2`} />
        ) : (
          <div className="absolute top-1/2 -translate-y-1/2 w-full flex justify-between">
            <div className={`h-2.5 w-[45%] rounded-sm ${changing ? 'bg-amber-500' : 'bg-gray-700'}`} />
            <div className={`h-2.5 w-[45%] rounded-sm ${changing ? 'bg-amber-500' : 'bg-gray-700'}`} />
          </div>
        )}
        {changing && (
          <span className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full text-[10px] text-amber-500 whitespace-nowrap">
            {value === 1 ? '老阳' : '老阴'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function IChingPage() {
  const toast = useToast((s) => s.show)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<IChingResult | null>(null)
  const [loading, setLoading] = useState(false)

  const handleCast = async () => {
    if (!question.trim()) { toast('请先输入你的问题', 'error'); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await castIChing(question.trim())
      setResult(res)
    } catch (e: any) {
      toast(e?.message || '占卦失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setQuestion('')
  }

  const yaoLabels = ['初', '二', '三', '四', '五', '上']

  return (
    <div className="app-shell">
      <Header title="八卦算命" back />
      <div className="px-4 py-3 space-y-3">
        {/* 说明 */}
        {!result && !loading && (
          <div className="card p-4 text-center">
            <div className="text-4xl mb-2">䷀</div>
            <h2 className="font-medium text-gray-800 mb-1">周易六十四卦</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              心中默念你的问题，然后用三硬币法占卦。<br />
              系统将为你生成卦象，并由 AI 解读。
            </p>
          </div>
        )}

        {/* 问题输入 */}
        {!result && (
          <div className="card p-3 space-y-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="输入你想问的问题，如：最近的事业发展如何？"
              maxLength={200}
              rows={3}
              className="input resize-none"
              disabled={loading}
            />
            <button
              onClick={handleCast}
              disabled={loading || !question.trim()}
              className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  正在投掷铜钱...
                </>
              ) : (
                <>
                  <Send size={16} />
                  开始占卦
                </>
              )}
            </button>
          </div>
        )}

        {/* 占卦动画 */}
        {loading && (
          <div className="card p-6 text-center">
            <div className="text-5xl mb-3 animate-bounce">🪙</div>
            <div className="space-y-1">
              <Sparkles className="mx-auto text-primary-500" size={20} />
              <p className="text-sm text-gray-500">六次投掷，生成卦象...</p>
            </div>
          </div>
        )}

        {/* 占卦结果 */}
        {result && !loading && (
          <>
            {/* 本卦 */}
            <div className="card p-4 space-y-3">
              <div className="text-center">
                <div className="text-xs text-gray-400 mb-1">本卦</div>
                <div className="text-5xl mb-1">{result.hexagram.symbol}</div>
                <div className="font-medium text-gray-800">
                  第{result.hexagram.num}卦 · {result.hexagram.fullName}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  上卦 {result.hexagram.upperTrigram} · 下卦 {result.hexagram.lowerTrigram}
                </div>
              </div>

              {/* 爻象（从上到下显示，即上爻在上） */}
              <div className="space-y-1 py-2">
                {[5, 4, 3, 2, 1, 0].map((i) => (
                  <YaoLine
                    key={i}
                    value={result.lines[i].value}
                    changing={result.lines[i].changing}
                    label={yaoLabels[i]}
                  />
                ))}
              </div>

              {/* 卦辞 */}
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-sm text-gray-600 italic">「{result.hexagram.judgment}」</p>
              </div>
            </div>

            {/* 变卦 */}
            {result.changingHexagram && (
              <div className="card p-4 space-y-2">
                <div className="text-center">
                  <div className="text-xs text-amber-500 mb-1">变卦</div>
                  <div className="text-4xl mb-1">{result.changingHexagram.symbol}</div>
                  <div className="font-medium text-gray-800">
                    第{result.changingHexagram.num}卦 · {result.changingHexagram.fullName}
                  </div>
                </div>
                <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                  <p className="text-sm text-amber-700 italic">「{result.changingHexagram.judgment}」</p>
                </div>
                <div className="text-xs text-gray-400 text-center">
                  变爻：{result.changingLines.map((i) => yaoLabels[i] + '爻').join('、')}
                </div>
              </div>
            )}

            {/* 问题回顾 */}
            <div className="card p-3">
              <div className="text-xs text-gray-400 mb-1">所问之事</div>
              <p className="text-sm text-gray-700">{result.question}</p>
            </div>

            {/* AI 解读 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-1.5 font-medium text-gray-800">
                <BookOpen size={16} className="text-primary-500" />
                卦象解读
              </div>

              {/* 概括 */}
              <div className="bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl p-3 text-center">
                <p className="text-sm font-medium text-gray-700">{result.interpretation.summary}</p>
              </div>

              {/* 详细解读 */}
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-sm text-gray-600 leading-relaxed">{result.interpretation.interpretation}</p>
              </div>

              {/* 建议 */}
              <div className="flex items-start gap-2 bg-blue-50 rounded-xl p-3">
                <Lightbulb size={14} className="text-blue-400 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-700">{result.interpretation.advice}</p>
              </div>

              {/* 展望 */}
              <div className="flex items-start gap-2 bg-green-50 rounded-xl p-3">
                <TrendingUp size={14} className="text-green-400 mt-0.5 shrink-0" />
                <p className="text-sm text-green-700">{result.interpretation.outlook}</p>
              </div>
            </div>

            {/* 再占一卦 */}
            <button onClick={handleReset} className="btn-secondary w-full flex items-center justify-center gap-1.5">
              <RefreshCw size={16} /> 再占一卦
            </button>
          </>
        )}
      </div>
    </div>
  )
}
