/**
 * 每日单词 · 数据层
 *
 * - 内置词库（6 大分类，约 72 词：CET-4 / CET-6 / IELTS / TOEFL / 商务 / 日常）
 * - 每日一词（按日期确定性选取）
 * - SRS 间隔重复复习（SM-2 简化版）
 * - 个人收藏 + 自定义单词
 * - 纯 localStorage 离线可用
 */

/** 分类 */
export type WordCategory = 'cet4' | 'cet6' | 'ielts' | 'toefl' | 'business' | 'daily'

export interface Word {
  id: string
  /** 英文单词 */
  word: string
  /** 音标 IPA */
  phonetic: string
  /** 释义（中文） */
  meaning: string
  /** 词性简称：n. v. adj. adv. 等 */
  pos: string
  /** 例句（英文） */
  example: string
  /** 例句翻译 */
  exampleTrans: string
  category: WordCategory
  /** 来源标记：built-in / custom */
  source: 'builtin' | 'custom'
}

export const CATEGORY_META: Record<WordCategory, { label: string; emoji: string; color: string }> = {
  cet4: { label: '四级', emoji: '📘', color: '#3B82F6' },
  cet6: { label: '六级', emoji: '📗', color: '#22C55E' },
  ielts: { label: '雅思', emoji: '🛡️', color: '#EF4444' },
  toefl: { label: '托福', emoji: '🎓', color: '#8B5CF6' },
  business: { label: '商务', emoji: '💼', color: '#F59E0B' },
  daily: { label: '日常', emoji: '🌿', color: '#06B6D4' },
}

/** 内置词库 */
const BUILTIN_WORDS: Omit<Word, 'id' | 'source'>[] = [
  // ===== CET-4 四级 =====
  { word: 'abandon', phonetic: '/əˈbændən/', meaning: '放弃；遗弃', pos: 'v.', category: 'cet4', example: 'He abandoned his plan to study abroad.', exampleTrans: '他放弃了出国留学的计划。' },
  { word: 'absolute', phonetic: '/ˈæbsəluːt/', meaning: '绝对的；完全的', pos: 'adj.', category: 'cet4', example: 'I have absolute confidence in him.', exampleTrans: '我对他有绝对的信心。' },
  { word: 'academic', phonetic: '/ˌækəˈdemɪk/', meaning: '学术的；学院的', pos: 'adj.', category: 'cet4', example: 'The university has a strong academic reputation.', exampleTrans: '这所大学有很强的学术声誉。' },
  { word: 'benefit', phonetic: '/ˈbenɪfɪt/', meaning: '利益；益处', pos: 'n.', category: 'cet4', example: 'Regular exercise benefits your health.', exampleTrans: '经常运动有益健康。' },
  { word: 'capable', phonetic: '/ˈkeɪpəbl/', meaning: '有能力的；能干的', pos: 'adj.', category: 'cet4', example: 'She is capable of doing this job well.', exampleTrans: '她有能力做好这份工作。' },
  { word: 'determine', phonetic: '/dɪˈtɜːmɪn/', meaning: '决定；决心', pos: 'v.', category: 'cet4', example: 'Weather determines the success of the harvest.', exampleTrans: '天气决定丰收的成败。' },
  { word: 'evidence', phonetic: '/ˈevɪdəns/', meaning: '证据；证明', pos: 'n.', category: 'cet4', example: 'There is strong evidence to support his claim.', exampleTrans: '有强有力的证据支持他的主张。' },
  { word: 'familiar', phonetic: '/fəˈmɪliə(r)/', meaning: '熟悉的；常见的', pos: 'adj.', category: 'cet4', example: 'Your face looks familiar to me.', exampleTrans: '你的脸看起来很熟悉。' },
  { word: 'generate', phonetic: '/ˈdʒenəreɪt/', meaning: '产生；发生', pos: 'v.', category: 'cet4', example: 'The new project will generate many jobs.', exampleTrans: '新项目将创造许多就业。' },
  { word: 'hesitate', phonetic: '/ˈhezɪteɪt/', meaning: '犹豫；踌躇', pos: 'v.', category: 'cet4', example: 'Don\'t hesitate to ask if you need help.', exampleTrans: '需要帮助时不要犹豫。' },
  { word: 'imagine', phonetic: '/ɪˈmædʒɪn/', meaning: '想象；设想', pos: 'v.', category: 'cet4', example: 'I can\'t imagine life without music.', exampleTrans: '我无法想象没有音乐的生活。' },
  { word: 'journey', phonetic: '/ˈdʒɜːni/', meaning: '旅程；旅行', pos: 'n.', category: 'cet4', example: 'Life is a long journey full of surprises.', exampleTrans: '人生是一段充满惊喜的漫长旅程。' },

  // ===== CET-6 六级 =====
  { word: 'accommodate', phonetic: '/əˈkɒmədeɪt/', meaning: '容纳；适应', pos: 'v.', category: 'cet6', example: 'The hotel can accommodate up to 500 guests.', exampleTrans: '这家酒店最多可容纳500位客人。' },
  { word: 'bureaucracy', phonetic: '/bjʊəˈrɒkrəsi/', meaning: '官僚主义；官僚机构', pos: 'n.', category: 'cet6', example: 'The project was delayed by bureaucracy.', exampleTrans: '项目因官僚主义被延误。' },
  { word: 'conscience', phonetic: '/ˈkɒnʃəns/', meaning: '良心；道德心', pos: 'n.', category: 'cet6', example: 'A clear conscience is a soft pillow.', exampleTrans: '问心无愧，高枕无忧。' },
  { word: 'discriminate', phonetic: '/dɪˈskrɪmɪneɪt/', meaning: '歧视；区分', pos: 'v.', category: 'cet6', example: 'We must not discriminate against anyone.', exampleTrans: '我们不应歧视任何人。' },
  { word: 'enthusiasm', phonetic: '/ɪnˈθjuːziæzəm/', meaning: '热情；热忱', pos: 'n.', category: 'cet6', example: 'Her enthusiasm inspired the whole team.', exampleTrans: '她的热情激励了整个团队。' },
  { word: 'fundamental', phonetic: '/ˌfʌndəˈmentl/', meaning: '基本的；根本的', pos: 'adj.', category: 'cet6', example: 'Honesty is a fundamental principle of life.', exampleTrans: '诚实是做人的根本原则。' },
  { word: 'hypothesis', phonetic: '/haɪˈpɒθəsɪs/', meaning: '假设；假说', pos: 'n.', category: 'cet6', example: 'The experiment confirmed our hypothesis.', exampleTrans: '实验证实了我们的假设。' },
  { word: 'implement', phonetic: '/ˈɪmplɪment/', meaning: '实施；执行', pos: 'v.', category: 'cet6', example: 'We need to implement the new policy carefully.', exampleTrans: '我们需要谨慎地实施新政策。' },
  { word: 'legitimate', phonetic: '/lɪˈdʒɪtɪmət/', meaning: '合法的；合理的', pos: 'adj.', category: 'cet6', example: 'He has a legitimate reason for being late.', exampleTrans: '他迟到有正当理由。' },
  { word: 'manipulate', phonetic: '/məˈnɪpjuleɪt/', meaning: '操纵；操作', pos: 'v.', category: 'cet6', example: 'Don\'t let others manipulate your decisions.', exampleTrans: '不要让别人操纵你的决定。' },
  { word: 'negotiate', phonetic: '/nɪˈɡəʊʃieɪt/', meaning: '谈判；协商', pos: 'v.', category: 'cet6', example: 'They negotiated a fair contract.', exampleTrans: '他们协商出一份公平的合同。' },
  { word: 'preliminary', phonetic: '/prɪˈlɪmɪnəri/', meaning: '初步的；预备的', pos: 'adj.', category: 'cet6', example: 'The preliminary results look promising.', exampleTrans: '初步结果看起来很有希望。' },

  // ===== IELTS 雅思 =====
  { word: 'allocate', phonetic: '/ˈæləkeɪt/', meaning: '分配；分派', pos: 'v.', category: 'ielts', example: 'The government allocated funds for education.', exampleTrans: '政府为教育拨款。' },
  { word: 'comprehensive', phonetic: '/ˌkɒmprɪˈhensɪv/', meaning: '全面的；综合的', pos: 'adj.', category: 'ielts', example: 'The report gives a comprehensive analysis.', exampleTrans: '报告给出了全面的分析。' },
  { word: 'deteriorate', phonetic: '/dɪˈtɪəriəreɪt/', meaning: '恶化；变坏', pos: 'v.', category: 'ielts', example: 'Air quality deteriorated in winter.', exampleTrans: '冬季空气质量恶化。' },
  { word: 'elaborate', phonetic: '/ɪˈlæbərət/', meaning: '详尽的；精心制作的', pos: 'adj.', category: 'ielts', example: 'She prepared an elaborate dinner.', exampleTrans: '她准备了一顿精美的晚餐。' },
  { word: 'fluctuate', phonetic: '/ˈflʌktʃueɪt/', meaning: '波动；起伏', pos: 'v.', category: 'ielts', example: 'Prices fluctuate with demand.', exampleTrans: '价格随需求波动。' },
  { word: 'hierarchy', phonetic: '/ˈhaɪərɑːki/', meaning: '等级制度；层级', pos: 'n.', category: 'ielts', example: 'The company has a strict hierarchy.', exampleTrans: '公司有严格的等级制度。' },
  { word: 'inevitable', phonetic: '/ɪnˈevɪtəbl/', meaning: '不可避免的；必然的', pos: 'adj.', category: 'ielts', example: 'Change is inevitable in life.', exampleTrans: '变化是生活中不可避免的。' },
  { word: 'lucrative', phonetic: '/ˈluːkrətɪv/', meaning: '获利丰厚的', pos: 'adj.', category: 'ielts', example: 'Software development is a lucrative career.', exampleTrans: '软件开发是高收入职业。' },
  { word: 'predominant', phonetic: '/prɪˈdɒmɪnənt/', meaning: '主要的；占主导的', pos: 'adj.', category: 'ielts', example: 'English is the predominant language online.', exampleTrans: '英语是网络上的主要语言。' },
  { word: 'reluctant', phonetic: '/rɪˈlʌktənt/', meaning: '不情愿的；勉强的', pos: 'adj.', category: 'ielts', example: 'He was reluctant to admit his mistake.', exampleTrans: '他不情愿承认错误。' },
  { word: 'sustainable', phonetic: '/səˈsteɪnəbl/', meaning: '可持续的', pos: 'adj.', category: 'ielts', example: 'We must pursue sustainable development.', exampleTrans: '我们必须追求可持续发展。' },
  { word: 'tolerate', phonetic: '/ˈtɒləreɪt/', meaning: '容忍；忍受', pos: 'v.', category: 'ielts', example: 'I cannot tolerate such rudeness.', exampleTrans: '我不能容忍这种粗鲁。' },

  // ===== TOEFL 托福 =====
  { word: 'abundant', phonetic: '/əˈbʌndənt/', meaning: '丰富的；大量的', pos: 'adj.', category: 'toefl', example: 'The region has abundant natural resources.', exampleTrans: '该地区有丰富的自然资源。' },
  { word: 'coincide', phonetic: '/ˌkəʊɪnˈsaɪd/', meaning: '同时发生；一致', pos: 'v.', category: 'toefl', example: 'Their views coincide on this issue.', exampleTrans: '他们在这个问题上的观点一致。' },
  { word: 'derive', phonetic: '/dɪˈraɪv/', meaning: '起源；派生', pos: 'v.', category: 'toefl', example: 'The word derives from Latin.', exampleTrans: '这个词源自拉丁语。' },
  { word: 'endure', phonetic: '/ɪnˈdjʊə(r)/', meaning: '忍耐；持久', pos: 'v.', category: 'toefl', example: 'They endured many hardships together.', exampleTrans: '他们共同忍受了许多艰难。' },
  { word: 'fragile', phonetic: '/ˈfrædʒaɪl/', meaning: '脆弱的；易碎的', pos: 'adj.', category: 'toefl', example: 'Be careful, the glass is fragile.', exampleTrans: '小心，玻璃易碎。' },
  { word: 'haul', phonetic: '/hɔːl/', meaning: '拖运；搬运', pos: 'v.', category: 'toefl', example: 'They hauled the boat out of the water.', exampleTrans: '他们把船拖出水面。' },
  { word: 'intricate', phonetic: '/ˈɪntrɪkət/', meaning: '复杂的；精细的', pos: 'adj.', category: 'toefl', example: 'The watch has an intricate mechanism.', exampleTrans: '这只手表有精巧的机械结构。' },
  { word: 'manifest', phonetic: '/ˈmænɪfest/', meaning: '显示；表明', pos: 'v.', category: 'toefl', example: 'The disease manifests in many ways.', exampleTrans: '这种病有多种表现方式。' },
  { word: 'predominantly', phonetic: '/prɪˈdɒmɪnəntli/', meaning: '主要地；显著地', pos: 'adv.', category: 'toefl', example: 'The audience was predominantly young.', exampleTrans: '观众主要是年轻人。' },
  { word: 'rigid', phonetic: '/ˈrɪdʒɪd/', meaning: '僵硬的；严格的', pos: 'adj.', category: 'toefl', example: 'The rules are too rigid.', exampleTrans: '规则过于死板。' },
  { word: 'scarce', phonetic: '/skeəs/', meaning: '缺乏的；稀有的', pos: 'adj.', category: 'toefl', example: 'Clean water is scarce in some regions.', exampleTrans: '清洁水在一些地区很稀缺。' },
  { word: 'viable', phonetic: '/ˈvaɪəbl/', meaning: '可行的；能存活的', pos: 'adj.', category: 'toefl', example: 'Is this a viable solution?', exampleTrans: '这是一个可行的方案吗？' },

  // ===== Business 商务 =====
  { word: 'acquisition', phonetic: '/ˌækwɪˈzɪʃn/', meaning: '收购；获得', pos: 'n.', category: 'business', example: 'The company announced a major acquisition.', exampleTrans: '公司宣布了一项重大收购。' },
  { word: 'budget', phonetic: '/ˈbʌdʒɪt/', meaning: '预算', pos: 'n.', category: 'business', example: 'We need to stay within budget.', exampleTrans: '我们需要控制在预算内。' },
  { word: 'consensus', phonetic: '/kənˈsensəs/', meaning: '共识；一致', pos: 'n.', category: 'business', example: 'We reached a consensus on the plan.', exampleTrans: '我们就计划达成了共识。' },
  { word: 'deadline', phonetic: '/ˈdedlaɪn/', meaning: '截止日期', pos: 'n.', category: 'business', example: 'The deadline for submission is Friday.', exampleTrans: '提交截止日期是周五。' },
  { word: 'efficiency', phonetic: '/ɪˈfɪʃnsi/', meaning: '效率；效能', pos: 'n.', category: 'business', example: 'Automation improves efficiency.', exampleTrans: '自动化提升效率。' },
  { word: 'forecast', phonetic: '/ˈfɔːkɑːst/', meaning: '预测；预报', pos: 'v./n.', category: 'business', example: 'They forecast strong growth next year.', exampleTrans: '他们预测明年强劲增长。' },
  { word: 'leverage', phonetic: '/ˈliːvərɪdʒ/', meaning: '利用；杠杆', pos: 'v.', category: 'business', example: 'We leverage technology to grow.', exampleTrans: '我们利用技术来增长。' },
  { word: 'margin', phonetic: '/ˈmɑːdʒɪn/', meaning: '利润；边缘', pos: 'n.', category: 'business', example: 'Profit margins are tight this year.', exampleTrans: '今年利润率很紧。' },
  { word: 'proposal', phonetic: '/prəˈpəʊzl/', meaning: '提案；建议', pos: 'n.', category: 'business', example: 'Please review the proposal by Monday.', exampleTrans: '请在周一前审阅提案。' },
  { word: 'revenue', phonetic: '/ˈrevənjuː/', meaning: '收入；营收', pos: 'n.', category: 'business', example: 'Annual revenue exceeded expectations.', exampleTrans: '年度营收超过预期。' },
  { word: 'stakeholder', phonetic: '/ˈsteɪkhəʊldə(r)/', meaning: '利益相关者', pos: 'n.', category: 'business', example: 'We must consider all stakeholders.', exampleTrans: '我们必须考虑所有利益相关者。' },
  { word: 'vendor', phonetic: '/ˈvendə(r)/', meaning: '供应商；卖主', pos: 'n.', category: 'business', example: 'We work with trusted vendors.', exampleTrans: '我们与可信的供应商合作。' },

  // ===== Daily 日常 =====
  { word: 'appointment', phonetic: '/əˈpɔɪntmənt/', meaning: '预约；约会', pos: 'n.', category: 'daily', example: 'I have a doctor\'s appointment tomorrow.', exampleTrans: '我明天有医生的预约。' },
  { word: 'delicious', phonetic: '/dɪˈlɪʃəs/', meaning: '美味的', pos: 'adj.', category: 'daily', example: 'This soup is really delicious.', exampleTrans: '这汤真的很美味。' },
  { word: 'grocery', phonetic: '/ˈɡrəʊsəri/', meaning: '食品杂货', pos: 'n.', category: 'daily', example: 'I need to buy groceries today.', exampleTrans: '我今天需要买些杂货。' },
  { word: 'hobby', phonetic: '/ˈhɒbi/', meaning: '爱好；消遣', pos: 'n.', category: 'daily', example: 'Reading is my favorite hobby.', exampleTrans: '阅读是我最喜欢的爱好。' },
  { word: 'invitation', phonetic: '/ˌɪnvɪˈteɪʃn/', meaning: '邀请；请柬', pos: 'n.', category: 'daily', example: 'Thank you for the invitation.', exampleTrans: '谢谢你的邀请。' },
  { word: 'neighbor', phonetic: '/ˈneɪbə(r)/', meaning: '邻居', pos: 'n.', category: 'daily', example: 'My neighbor is very friendly.', exampleTrans: '我的邻居非常友好。' },
  { word: 'occasion', phonetic: '/əˈkeɪʒn/', meaning: '场合；时机', pos: 'n.', category: 'daily', example: 'This is a special occasion.', exampleTrans: '这是一个特殊的场合。' },
  { word: 'recipe', phonetic: '/ˈresəpi/', meaning: '食谱；秘诀', pos: 'n.', category: 'daily', example: 'Can you share this recipe with me?', exampleTrans: '你能和我分享这个食谱吗？' },
  { word: 'schedule', phonetic: '/ˈʃedjuːl/', meaning: '时间表；安排', pos: 'n.', category: 'daily', example: 'My schedule is full this week.', exampleTrans: '我这周日程排满了。' },
  { word: 'temperature', phonetic: '/ˈtemprətʃə(r)/', meaning: '温度；体温', pos: 'n.', category: 'daily', example: 'Check the temperature before cooking.', exampleTrans: '烹饪前检查温度。' },
  { word: 'vacation', phonetic: '/vəˈkeɪʃn/', meaning: '假期；休假', pos: 'n.', category: 'daily', example: 'We went to Hawaii for vacation.', exampleTrans: '我们去夏威夷度假。' },
  { word: 'weather', phonetic: '/ˈweðə(r)/', meaning: '天气', pos: 'n.', category: 'daily', example: 'The weather is lovely today.', exampleTrans: '今天天气很好。' },
]

/** 为内置单词生成稳定 id */
function builtinId(idx: number): string {
  return `bw_${idx}`
}

/** 获取全部内置单词（带 id） */
function getBuiltinWords(): Word[] {
  return BUILTIN_WORDS.map((w, i) => ({
    ...w,
    id: builtinId(i),
    source: 'builtin' as const,
  }))
}

// ===== 自定义单词 =====

const CUSTOM_KEY = 'custom_words_v1'
const FAV_KEY = 'favorite_words_v1'

function listCustom(): Word[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') as Word[]
    return raw.filter((w) => w && typeof w.word === 'string')
  } catch {
    return []
  }
}

function saveCustom(list: Word[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
}

function genId(): string {
  return `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 添加自定义单词 */
export function addCustomWord(
  word: string,
  phonetic: string,
  meaning: string,
  pos: string,
  example: string,
  exampleTrans: string,
  category: WordCategory,
): Word {
  const item: Word = {
    id: genId(),
    word: word.trim(),
    phonetic: phonetic.trim(),
    meaning: meaning.trim(),
    pos: pos.trim() || 'n.',
    example: example.trim(),
    exampleTrans: exampleTrans.trim(),
    category,
    source: 'custom',
  }
  const all = listCustom()
  all.push(item)
  saveCustom(all)
  return item
}

/** 删除自定义单词 */
export function deleteCustomWord(id: string) {
  saveCustom(listCustom().filter((w) => w.id !== id))
  toggleFavorite(id, false)
  // 同步移除复习进度
  setReviewState(id, null)
}

// ===== 收藏 =====

function listFavorites(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function saveFavorites(set: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
}

/** 切换收藏状态 */
export function toggleFavorite(id: string, force?: boolean) {
  const set = listFavorites()
  if (force === true) set.add(id)
  else if (force === false) set.delete(id)
  else { set.has(id) ? set.delete(id) : set.add(id) }
  saveFavorites(set)
}

/** 是否已收藏 */
export function isFavorite(id: string): boolean {
  return listFavorites().has(id)
}

// ===== SRS 间隔重复（SM-2 简化版） =====

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5
/** 0=完全忘记, 1=忘了, 2=艰难想起, 3=迟疑想起, 4=轻松想起, 5=瞬间想起 */

export interface ReviewState {
  /** 间隔（天） */
  interval: number
  /** 重复次数 */
  reps: number
  /** 易度因子（默认 2.5） */
  ease: number
  /** 下次复习日期 YYYY-MM-DD */
  due: string
  /** 最后复习日期 */
  lastReviewed: string | null
}

const REVIEW_KEY = 'word_review_v1'

function loadReviewMap(): Record<string, ReviewState> {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') as Record<string, ReviewState>
  } catch {
    return {}
  }
}

function saveReviewMap(map: Record<string, ReviewState>) {
  localStorage.setItem(REVIEW_KEY, JSON.stringify(map))
}

/** 获取单词的复习状态（不存在表示未复习过） */
export function getReviewState(id: string): ReviewState | null {
  const map = loadReviewMap()
  return map[id] || null
}

/** 内部：写入/删除复习状态 */
function setReviewState(id: string, state: ReviewState | null) {
  const map = loadReviewMap()
  if (state === null) delete map[id]
  else map[id] = state
  saveReviewMap(map)
}

/** 记录一次复习结果，更新 SRS 状态 */
export function reviewWord(id: string, quality: ReviewQuality): ReviewState {
  const prev = getReviewState(id)
  const today = new Date()
  const todayStr = formatDate(today)

  // SM-2 简化版
  let reps = prev?.reps || 0
  let ease = prev?.ease ?? 2.5
  let interval: number

  if (quality < 3) {
    // 复习失败：重置
    reps = 0
    interval = 1
  } else {
    reps += 1
    if (reps === 1) interval = 1
    else if (reps === 2) interval = 3
    else interval = Math.round((prev?.interval || 1) * ease)
  }

  // 调整 ease 因子
  ease = Math.max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))

  // 计算下次复习日期
  const dueDate = new Date(today)
  dueDate.setDate(dueDate.getDate() + interval)

  const state: ReviewState = {
    interval,
    reps,
    ease: Math.round(ease * 100) / 100,
    due: formatDate(dueDate),
    lastReviewed: todayStr,
  }
  setReviewState(id, state)
  return state
}

/** 今日待复习单词列表 */
export function getDueWords(): Word[] {
  const map = loadReviewMap()
  const today = todayStr()
  return getAllWords().filter((w) => {
    const s = map[w.id]
    return s && s.due <= today
  })
}

/** 今日待复习数量 */
export function getDueCount(): number {
  return getDueWords().length
}

// ===== 每日一词 =====

/** 基于日期的确定性 hash */
function dateHash(date: string): number {
  let h = 0
  for (let i = 0; i < date.length; i++) {
    h = (h * 31 + date.charCodeAt(i)) & 0x7fffffff
  }
  return h
}

/** 获取今日单词（确定性选取） */
export function getTodayWord(): Word {
  const all = getAllWords()
  const today = todayStr()
  const idx = dateHash(today) % all.length
  return all[idx]
}

// ===== 查询 =====

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr(d = new Date()): string {
  return formatDate(d)
}

/** 全部单词（内置 + 自定义） */
export function getAllWords(): Word[] {
  return [...getBuiltinWords(), ...listCustom()]
}

/** 按分类筛选 */
export function getWordsByCategory(category: WordCategory | 'all' | 'favorite'): Word[] {
  if (category === 'all') return getAllWords()
  if (category === 'favorite') {
    const fav = listFavorites()
    return getAllWords().filter((w) => fav.has(w.id))
  }
  return getAllWords().filter((w) => w.category === category)
}

/** 随机一个 */
export function getRandomWord(): Word {
  const all = getAllWords()
  return all[Math.floor(Math.random() * all.length)]
}

/** 统计 */
export function getWordStat() {
  const all = getAllWords()
  const custom = listCustom()
  const fav = listFavorites()
  const reviewMap = loadReviewMap()
  const today = todayStr()
  const dueCount = Object.values(reviewMap).filter((s) => s.due <= today).length
  const learnedCount = Object.keys(reviewMap).length
  return {
    total: all.length,
    builtin: all.length - custom.length,
    custom: custom.length,
    favorites: fav.size,
    learned: learnedCount,
    due: dueCount,
  }
}
