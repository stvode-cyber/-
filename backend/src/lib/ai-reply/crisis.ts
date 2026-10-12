import type { ReplyResult } from './index.js'
export type CrisisLevel = 'critical' | 'high' | 'moderate' | null

export interface CrisisIntervention {
  level: 'critical' | 'high' | 'moderate'
  hotlines: Array<{ name: string; phone: string; desc: string }>
  message: string
  suggestions: string[]
}

export function detectCrisisSignal(content: string): CrisisLevel {
  const text = content.toLowerCase()

  // critical：明确自杀意念/自伤计划
  const criticalPatterns = [
    /不想活/,
    /想死/,
    /自杀/,
    /结束.{0,4}生命/,
    /了结自己/,
    /结束一切/,
    /活不下去/,
    /自杀方法/,
    /怎么死/,
    /跳楼/,
    /割腕/,
    /吃药.{0,6}死|吃.{0,4}药.{0,4}自杀/,
    /上吊/,
    /烧炭/,
    /安乐死/,
    /kill\s*myself/i,
    /end.{0,4}my.{0,4}life/i,
    /想走.{0,2}绝路/,
    /生无可恋/,
  ]
  for (const p of criticalPatterns) {
    if (p.test(text)) return 'critical'
  }

  // high：无望感、消失念头、严重抑郁情绪
  const highPatterns = [
    /想消失/,
    /消失了.{0,4}好/,
    /没有意义/,
    /毫无意义/,
    /活着.{0,4}没意义/,
    /不想面对/,
    /撑不下去/,
    /坚持不下去/,
    /解脱/,
    /一了百了/,
    /生不如死/,
    /想永远睡/,
    /不想醒来/,
  ]
  for (const p of highPatterns) {
    if (p.test(text)) return 'high'
  }

  // moderate：负面情绪、压力大
  const moderatePatterns = [
    /很累.{0,4}不想动/,
    /崩溃/,
    /绝望/,
    /痛苦.{0,4}不堪/,
    /压抑.{0,4}难/,
    /很难受.{0,4}想哭/,
    /抑郁/,
    /焦虑.{0,4}睡不着/,
  ]
  for (const p of moderatePatterns) {
    if (p.test(text)) return 'moderate'
  }

  return null
}

/** 根据危机等级生成干预回复（不分析、不指导，只引导到专业资源） */
export function generateCrisisReply(level: 'critical' | 'high' | 'moderate'): ReplyResult {
  const intervention: CrisisIntervention = {
    level,
    hotlines: [
      {
        name: '全国心理援助热线',
        phone: '400-161-9995',
        desc: '24 小时免费心理危机干预热线，由专业心理咨询师接听',
      },
      {
        name: '北京心理危机研究与干预中心',
        phone: '010-82951332',
        desc: '24 小时热线，专注于自杀危机干预',
      },
      {
        name: '生命热线',
        phone: '400-821-1215',
        desc: '24 小时情绪支持与危机干预',
      },
    ],
    message: '',
    suggestions: [],
  }

  if (level === 'critical') {
    intervention.message =
      '我听到你正在经历非常艰难的时刻，你的感受很重要。请现在就拨打下方任一热线，会有专业的人陪伴你度过这一刻。你不是一个人。'
    intervention.suggestions = [
      '立即拨打 400-161-9995（全国心理援助热线，24 小时）',
      '联系你信任的亲友或家人，告诉他们你现在的感受',
      '如情况紧急请直接拨打 120 或前往最近的医院急诊',
      '暂时远离可能伤害自己的物品',
    ]
  } else if (level === 'high') {
    intervention.message =
      '你愿意说出这些感受已经非常勇敢。这样的时刻你不是一个人在面对，请试试拨打下方热线，让专业的人陪你聊聊。'
    intervention.suggestions = [
      '拨打心理援助热线 400-161-9995，与专业咨询师聊聊',
      '告诉身边信任的人你现在的感受，不要独自承受',
      '尝试做一些让你感到安全的小事：喝杯温水、深呼吸',
      '如果情绪持续恶化，请尽快寻求精神科医生帮助',
    ]
  } else {
    intervention.message =
      '听起来你最近压力很大。情绪低落是会过去的，给自己一些喘息的时间。如果需要聊聊，下方热线随时可以拨打。'
    intervention.suggestions = [
      '若需要倾诉可拨打 400-161-9995',
      '给自己安排一个短暂的休息，做点喜欢的事',
      '与朋友或家人聊一聊近况',
      '规律作息、适当运动有助于缓解情绪',
    ]
  }

  return {
    reply: intervention.message,
    messageType: 'crisis_card',
    metadata: { crisis: intervention },
  }
}
