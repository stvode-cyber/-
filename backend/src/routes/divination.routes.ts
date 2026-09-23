import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { llmGenerateChat, type ChatMessage } from '../services/llmService.js'
import { castIChing, type IChingResult } from '../lib/ichingData.js'
import { calculateBazi, getWuxingRelation, type BaziResult } from '../lib/baziData.js'

const router = Router()
router.use(authRequired)

// ---- 星座配置 ----
const ZODIAC_SIGNS = [
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
] as const

// GET /divination/zodiac —— 获取十二星座列表
router.get('/zodiac', (_req, res) => {
  return success(res, ZODIAC_SIGNS, 'ok')
})

// POST /divination/horoscope —— 今日星座运势
const horoscopeSchema = z.object({
  sign: z.string().min(1),
})
router.post('/horoscope', async (req, res, next) => {
  try {
    const parsed = horoscopeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('请选择星座', 422)
    const { sign } = parsed.data
    const zodiac = ZODIAC_SIGNS.find((s) => s.key === sign || s.name === sign)
    if (!zodiac) throw new HttpError('未知的星座', 422)

    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
    const systemPrompt = `你是一位精通占星术的星座运势师，语言风格温暖、积极、富有诗意。请用中文回答。`
    const userPrompt = `请为${zodiac.name}（${zodiac.symbol}，${zodiac.element}象星座）生成今日（${today}）的星座运势。

请严格按照以下 JSON 格式输出（不要输出其他内容）：
{
  "overall": 1-5的整数评分,
  "love": 1-5的整数评分,
  "career": 1-5的整数评分,
  "wealth": 1-5的整数评分,
  "health": 1-5的整数评分,
  "luckyColor": "幸运颜色",
  "luckyNumber": 幸运数字,
  "summary": "一句话概括今日运势",
  "detail": "100字左右的详细运势分析",
  "advice": "一句贴心的建议"
}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
    const llmResult = await llmGenerateChat(messages)

    let fortune: Record<string, unknown>
    if (llmResult && llmResult.text) {
      try {
        const jsonMatch = llmResult.text.match(/\{[\s\S]*\}/)
        fortune = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: llmResult.text }
      } catch {
        fortune = { summary: llmResult.text }
      }
    } else {
      fortune = {
        overall: 3, love: 3, career: 3, wealth: 3, health: 3,
        luckyColor: '蓝色', luckyNumber: 7,
        summary: '今日运势平稳，保持积极心态。',
        detail: '整体运势中等，适合处理日常事务，不宜做重大决定。',
        advice: '保持平常心，顺其自然。',
      }
    }

    auditReq(req, res, { category: 'divination', action: 'horoscope', summary: `查看${zodiac.name}今日运势` })

    return success(res, { sign: zodiac, date: today, fortune }, 'ok')
  } catch (e) {
    next(e)
  }
})

// GET /divination/iching/info —— 获取八卦算命说明
router.get('/iching/info', (_req, res) => {
  return success(res, {
    title: '八卦算命',
    desc: '基于《周易》六十四卦，使用三硬币法占卦。静心冥想你的问题，然后开始占卦。',
    steps: [
      '心中默念你的问题',
      '系统模拟三硬币法投掷六次，生成卦象',
      'AI 根据卦象为你解读',
    ],
  }, 'ok')
})

// POST /divination/iching —— 八卦算命
const ichingSchema = z.object({
  question: z.string().min(1).max(200),
})
router.post('/iching', async (req, res, next) => {
  try {
    const parsed = ichingSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('请输入你的问题（1-200字）', 422)
    const { question } = parsed.data

    const result = castIChing()

    const linesDesc = result.lines.map((l, i) => {
      const pos = ['初', '二', '三', '四', '五', '上'][i]
      const yao = l.value === 1 ? '阳爻' : '阴爻'
      const change = l.changing ? `（${l.type}，变爻）` : ''
      return `${pos}爻：${yao}${change}（三币合=${l.sum}）`
    }).join('；')

    const hexagramDesc = `本卦：第${result.hexagram.num}卦 ${result.hexagram.fullName}（${result.hexagram.symbol}）
卦辞：${result.hexagram.judgment}
上卦：${result.hexagram.upperTrigram}，下卦：${result.hexagram.lowerTrigram}
爻象：${linesDesc}`

    const changingDesc = result.changingHexagram
      ? `\n变卦：第${result.changingHexagram.num}卦 ${result.changingHexagram.fullName}（${result.changingHexagram.symbol}）
变卦卦辞：${result.changingHexagram.judgment}
变爻位置：${result.changingLines.map((i) => ['初', '二', '三', '四', '五', '上'][i] + '爻').join('、')}`
      : '\n（无变爻，以本卦卦辞断之）'

    const systemPrompt = `你是一位精通《周易》的占卦解卦大师，学识渊博，语言典雅而不失通俗。请用中文回答，给出有建设性的解读。`
    const userPrompt = `求测者问题：「${question}」

占卦结果：
${hexagramDesc}${changingDesc}

请根据以上卦象，为求测者详细解读。请严格按照以下 JSON 格式输出（不要输出其他内容）：
{
  "summary": "一句话概括卦象吉凶",
  "interpretation": "200字左右的详细解读，结合卦象和问题",
  "advice": "具体可行的建议",
  "outlook": "短期前景展望"
}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
    const llmResult = await llmGenerateChat(messages)

    let interpretation: Record<string, unknown>
    if (llmResult && llmResult.text) {
      try {
        const jsonMatch = llmResult.text.match(/\{[\s\S]*\}/)
        interpretation = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: llmResult.text }
      } catch {
        interpretation = { summary: llmResult.text }
      }
    } else {
      interpretation = {
        summary: `${result.hexagram.fullName}——${result.hexagram.judgment}`,
        interpretation: `本卦为${result.hexagram.fullName}，${result.changingHexagram ? `变卦为${result.changingHexagram.fullName}。` : ''}卦辞云：「${result.hexagram.judgment}」。此卦象提示你需要根据自身情况审时度势，谨慎行事。`,
        advice: '保持平和心态，顺时而动，逆时而静。',
        outlook: '事物发展有其规律，耐心等待时机。',
      }
    }

    auditReq(req, res, { category: 'divination', action: 'iching', summary: `八卦算命：${question.slice(0, 20)}` })

    const responseData = {
      question,
      lines: result.lines,
      hexagram: result.hexagram,
      changingHexagram: result.changingHexagram,
      changingLines: result.changingLines,
      interpretation,
    }

    return success(res, responseData, '占卦成功')
  } catch (e) {
    next(e)
  }
})

// POST /divination/compatibility —— 星座配对
// 元素亲和度：火风相煽、土水相滋；相位：拱/半合加分，刑/冲减分
const ELEMENT_AFFINITY: Record<string, number> = {
  '火+风': 90, '风+火': 90,
  '土+水': 90, '水+土': 90,
  '火+火': 80, '土+土': 80, '风+风': 80, '水+水': 80,
  '火+土': 60, '土+火': 60,
  '风+水': 60, '水+风': 60,
  '火+水': 50, '水+火': 50,
  '风+土': 50, '土+风': 50,
}
const ASPECTS: { offsets: number[]; bonus: number; name: string; desc: string }[] = [
  { offsets: [0], bonus: 5, name: '同星座', desc: '同为同一星座，性情相通，但也容易放大彼此的缺点' },
  { offsets: [4, 8], bonus: 10, name: '三合（拱相位 120°）', desc: '元素相同、气韵相通，是最和谐流畅的相位' },
  { offsets: [2, 10], bonus: 8, name: '半合（六合 60°）', desc: '互补互助，相处轻松，机会相位' },
  { offsets: [1, 11], bonus: -5, name: '邻座', desc: '季节相邻，性格差异明显，互补大于相似' },
  { offsets: [3, 9], bonus: -10, name: '刑相位（90°）', desc: '摩擦与张力并存，磨合后成长最快' },
  { offsets: [6], bonus: -8, name: '对冲（180°）', desc: '强烈吸引又互相对立，爱恨交织的经典相位' },
  { offsets: [5, 7], bonus: 0, name: '平相位（150°）', desc: '不即不离，需要主动经营的关系' },
]
const ELEMENT_RELATION_DESC: Record<string, string> = {
  '火+风': '风助火势，彼此激发热情与灵感',
  '土+水': '水润土泽，彼此滋养、安稳踏实',
}

function getCompatibilityLevel(score: number): string {
  if (score >= 90) return '天作之合'
  if (score >= 75) return '默契十足'
  if (score >= 60) return '相辅相成'
  if (score >= 45) return '求同存异'
  return '磨合成长'
}

const compatibilitySchema = z.object({
  sign1: z.string().min(1),
  sign2: z.string().min(1),
})
router.post('/compatibility', async (req, res, next) => {
  try {
    const parsed = compatibilitySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('请选择两个星座', 422)
    const { sign1, sign2 } = parsed.data

    const z1 = ZODIAC_SIGNS.find((s) => s.key === sign1 || s.name === sign1)
    const z2 = ZODIAC_SIGNS.find((s) => s.key === sign2 || s.name === sign2)
    if (!z1 || !z2) throw new HttpError('未知的星座', 422)

    // 规则计算基础契合度
    const base = ELEMENT_AFFINITY[`${z1.element}+${z2.element}`] ?? 65
    const idx1 = ZODIAC_SIGNS.findIndex((s) => s.key === z1.key)
    const idx2 = ZODIAC_SIGNS.findIndex((s) => s.key === z2.key)
    const offset = (idx2 - idx1 + 12) % 12
    const aspect = ASPECTS.find((a) => a.offsets.includes(offset)) ?? ASPECTS[ASPECTS.length - 1]
    const score = Math.min(100, Math.max(40, base + aspect.bonus))
    const level = getCompatibilityLevel(score)
    const elementRelation =
      ELEMENT_RELATION_DESC[`${z1.element}+${z2.element}`] ||
      ELEMENT_RELATION_DESC[`${z2.element}+${z1.element}`] ||
      `${z1.element}${z2.element}相遇，性格底色各有千秋`

    const systemPrompt = `你是一位精通占星术的星座配对专家，语言温暖风趣，善于发现两人相处的闪光点与磨合点。请用中文回答。配对结果仅供娱乐参考。`
    const userPrompt = `请分析 ${z1.name}（${z1.symbol}，${z1.element}象）与 ${z2.name}（${z2.symbol}，${z2.element}象）的配对。

已知规则计算结果：
- 契合指数：${score}/100（${level}）
- 元素关系：${elementRelation}
- 星座相位：${aspect.name}——${aspect.desc}

请基于以上信息深入解读。请严格按照以下 JSON 格式输出（不要输出其他内容）：
{
  "summary": "一句话概括这对组合的配对气质",
  "love": "80字左右的爱情配对分析",
  "friendship": "80字左右的友情相处分析",
  "communication": "80字左右的沟通模式与注意事项",
  "advice": "一句给这对组合的相处建议"
}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
    // LLM 偶发慢响应会超过前端 axios 15s 超时，8s 内未返回直接用规则文案兜底
    const llmResult = await Promise.race([
      llmGenerateChat(messages),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ])

    // 规则文案兜底：LLM 输出不可解析时使用，避免把退化文本透传给前端
    const fallbackInterpretation = {
      summary: `${z1.name} × ${z2.name}：${elementRelation}，${level}。`,
      love: `${aspect.name}之下，${z1.name}与${z2.name}的感情需要用心经营，${aspect.bonus >= 0 ? '天生缘分不浅' : '磨合后更显珍贵'}。`,
      friendship: `${z1.element}象与${z2.element}象的碰撞，让你们的友情充满新鲜感。`,
      communication: `注意${z1.element}象直抒胸臆与${z2.element}象的表达方式差异，多倾听少争辩。`,
      advice: '星座只是参考，真心与包容才是长久相处的秘诀。',
    }
    let interpretation: Record<string, unknown> = fallbackInterpretation
    if (llmResult && llmResult.text) {
      try {
        const jsonMatch = llmResult.text.match(/\{[\s\S]*\}/)
        const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : null
        if (parsed && typeof parsed === 'object' && typeof parsed.summary === 'string' && parsed.summary.length <= 100) {
          interpretation = { ...fallbackInterpretation, ...parsed }
        }
      } catch {
        // 解析失败保持兜底文案
      }
    }

    auditReq(req, res, { category: 'divination', action: 'compatibility', summary: `星座配对：${z1.name} × ${z2.name}` })

    return success(res, {
      sign1: z1,
      sign2: z2,
      score,
      level,
      elementRelation,
      aspect: { name: aspect.name, desc: aspect.desc },
      interpretation,
    }, '配对成功')
  } catch (e) {
    next(e)
  }
})

// POST /divination/bazi —— 生辰八字排盘 + AI 解读
const baziSchema = z.object({
  year: z.number().int().min(1900).max(2100),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23),
  gender: z.enum(['male', 'female']).default('male'),
})
router.post('/bazi', async (req, res, next) => {
  try {
    const parsed = baziSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('请输入正确的出生日期和时辰', 422)
    const { year, month, day, hour, gender } = parsed.data

    const bazi = calculateBazi(year, month, day, hour, gender)

    // 构建五行分布描述
    const wuxingDesc = Object.entries(bazi.wuxingCount)
      .map(([k, v]) => `${k}=${v.toFixed(1)}`)
      .join('，')
    const wuxingPercentDesc = Object.entries(bazi.wuxingPercent)
      .map(([k, v]) => `${k}${v}%`)
      .join('，')

    // 日主五行关系
    const relation = getWuxingRelation(bazi.dayMasterElement)
    const relationDesc = `日主${bazi.dayMaster}（${bazi.dayMasterElement}）：生${relation.sheng}，克${relation.ke}，被${relation.beiSheng}生，被${relation.beiKe}克`

    const pillarsDesc = `年柱：${bazi.year.stem}${bazi.year.branch}（${bazi.year.nayin}，${bazi.year.wuxing.stem}${bazi.year.wuxing.branch}）
月柱：${bazi.month.stem}${bazi.month.branch}（${bazi.month.nayin}，${bazi.month.wuxing.stem}${bazi.month.wuxing.branch}）
日柱：${bazi.day.stem}${bazi.day.branch}（${bazi.day.nayin}，${bazi.day.wuxing.stem}${bazi.day.wuxing.branch}）
时柱：${bazi.hour.stem}${bazi.hour.branch}（${bazi.hour.nayin}，${bazi.hour.wuxing.stem}${bazi.hour.wuxing.branch}）`

    const systemPrompt = `你是一位精通子平八字命理的命理师，学识渊博，解读客观中正，语言通俗易懂。请用中文回答。注意：命理解读仅供文化娱乐参考，不应作为人生决策的唯一依据。`
    const userPrompt = `请为以下八字排盘进行解读：

${bazi.description}
${pillarsDesc}

日主：${bazi.dayMaster}（${bazi.dayMasterElement}）
五行分布：${wuxingDesc}（${wuxingPercentDesc}）
${relationDesc}
年命纳音：${bazi.nayinYear}
生肖：${bazi.year.animal}
性别：${gender === 'male' ? '男' : '女'}

请严格按照以下 JSON 格式输出（不要输出其他内容）：
{
  "summary": "一句话概括命局特点",
  "personality": "100字左右分析性格特质，结合日主和五行",
  "career": "100字左右分析事业方向",
  "wealth": "100字左右分析财运特点",
  "love": "100字左右分析感情婚姻",
  "health": "80字左右分析健康注意事项",
  "favorable": "喜用神及有利五行",
  "advice": "一句贴心的人生建议"
}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
    const llmResult = await llmGenerateChat(messages)

    let interpretation: Record<string, unknown>
    if (llmResult && llmResult.text) {
      try {
        const jsonMatch = llmResult.text.match(/\{[\s\S]*\}/)
        interpretation = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: llmResult.text }
      } catch {
        interpretation = { summary: llmResult.text }
      }
    } else {
      interpretation = {
        summary: `日主${bazi.dayMaster}（${bazi.dayMasterElement}），五行${wuxingPercentDesc}`,
        personality: `日主为${bazi.dayMaster}（${bazi.dayMasterElement}），${bazi.dayMasterElement}气${bazi.wuxingCount[bazi.dayMasterElement] > 2 ? '偏旺' : '适中'}。`,
        career: '建议结合自身兴趣和五行喜忌选择事业方向。',
        wealth: '财运需看财星与日主的关系，目前五行分布可作为参考。',
        love: '感情方面需注意夫妻宫（日支）的五行属性。',
        health: `注意${bazi.dayMasterElement}对应身体部位的保养。`,
        favorable: `喜用五行需结合整体格局判断。`,
        advice: '命理仅供参考，人生掌握在自己手中。',
      }
    }

    auditReq(req, res, { category: 'divination', action: 'bazi', summary: `八字排盘：${year}-${month}-${day} ${hour}时` })

    return success(res, { bazi, interpretation }, '排盘成功')
  } catch (e) {
    next(e)
  }
})

export default router
