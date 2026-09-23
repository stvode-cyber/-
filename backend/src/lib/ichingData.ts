// 八卦（三爻）基本信息
const TRIGRAMS: Record<string, { name: string; nature: string; symbol: string }> = {
  '111': { name: '乾', nature: '天', symbol: '☰' },
  '110': { name: '兑', nature: '泽', symbol: '☱' },
  '101': { name: '离', nature: '火', symbol: '☲' },
  '100': { name: '震', nature: '雷', symbol: '☳' },
  '011': { name: '巽', nature: '风', symbol: '☴' },
  '010': { name: '坎', nature: '水', symbol: '☵' },
  '001': { name: '艮', nature: '山', symbol: '☶' },
  '000': { name: '坤', nature: '地', symbol: '☷' },
}

// 六十四卦：key = 6位二进制（自下而上，1=阳爻，0=阴爻）
interface Hexagram {
  num: number
  name: string
  fullName: string
  judgment: string
}

const HEXAGRAMS: Record<string, Hexagram> = {
  '111111': { num: 1, name: '乾', fullName: '乾为天', judgment: '元亨利贞' },
  '000000': { num: 2, name: '坤', fullName: '坤为地', judgment: '元亨，利牝马之贞' },
  '100010': { num: 3, name: '屯', fullName: '水雷屯', judgment: '元亨利贞，勿用有攸往，利建侯' },
  '010001': { num: 4, name: '蒙', fullName: '山水蒙', judgment: '亨。匪我求童蒙，童蒙求我' },
  '111010': { num: 5, name: '需', fullName: '水天需', judgment: '有孚，光亨贞吉，利涉大川' },
  '010111': { num: 6, name: '讼', fullName: '天水讼', judgment: '有孚窒惕，中吉终凶' },
  '010000': { num: 7, name: '师', fullName: '地水师', judgment: '贞，丈人吉无咎' },
  '000010': { num: 8, name: '比', fullName: '水地比', judgment: '吉。原筮元永贞，无咎' },
  '111011': { num: 9, name: '小畜', fullName: '风天小畜', judgment: '亨。密云不雨，自我西郊' },
  '110111': { num: 10, name: '履', fullName: '天泽履', judgment: '履虎尾，不咥人，亨' },
  '111000': { num: 11, name: '泰', fullName: '地天泰', judgment: '小往大来，吉亨' },
  '000111': { num: 12, name: '否', fullName: '天地否', judgment: '否之匪人，不利君子贞' },
  '101111': { num: 13, name: '同人', fullName: '天火同人', judgment: '同人于野，亨，利涉大川' },
  '111101': { num: 14, name: '大有', fullName: '火天大有', judgment: '元亨' },
  '001000': { num: 15, name: '谦', fullName: '地山谦', judgment: '亨，君子有终' },
  '000100': { num: 16, name: '豫', fullName: '雷地豫', judgment: '利建侯行师' },
  '100110': { num: 17, name: '随', fullName: '泽雷随', judgment: '元亨利贞，无咎' },
  '011001': { num: 18, name: '蛊', fullName: '山风蛊', judgment: '元亨，利涉大川' },
  '110000': { num: 19, name: '临', fullName: '地泽临', judgment: '元亨利贞，至于八月有凶' },
  '000011': { num: 20, name: '观', fullName: '风地观', judgment: '盥而不荐，有孚颙若' },
  '100101': { num: 21, name: '噬嗑', fullName: '火雷噬嗑', judgment: '亨，利用狱' },
  '101001': { num: 22, name: '贲', fullName: '山火贲', judgment: '亨，小利有攸往' },
  '000001': { num: 23, name: '剥', fullName: '山地剥', judgment: '不利有攸往' },
  '100000': { num: 24, name: '复', fullName: '地雷复', judgment: '亨。出入无疾，朋来无咎' },
  '100111': { num: 25, name: '无妄', fullName: '天雷无妄', judgment: '元亨利贞，其匪正有眚' },
  '111001': { num: 26, name: '大畜', fullName: '山天大畜', judgment: '利贞，不家食吉' },
  '100001': { num: 27, name: '颐', fullName: '山雷颐', judgment: '贞吉，观颐，自求口实' },
  '011110': { num: 28, name: '大过', fullName: '泽风大过', judgment: '栋桡，利有攸往，亨' },
  '010010': { num: 29, name: '坎', fullName: '坎为水', judgment: '维心亨，行有尚' },
  '101101': { num: 30, name: '离', fullName: '离为火', judgment: '利贞，亨。畜牝牛吉' },
  '001110': { num: 31, name: '咸', fullName: '泽山咸', judgment: '亨，利贞，取女吉' },
  '011100': { num: 32, name: '恒', fullName: '雷风恒', judgment: '亨，无咎，利贞' },
  '001111': { num: 33, name: '遁', fullName: '天山遁', judgment: '亨，小利贞' },
  '111100': { num: 34, name: '大壮', fullName: '雷天大壮', judgment: '利贞' },
  '000101': { num: 35, name: '晋', fullName: '火地晋', judgment: '康侯用锡马蕃庶，昼日三接' },
  '101000': { num: 36, name: '明夷', fullName: '地火明夷', judgment: '利艰贞' },
  '101011': { num: 37, name: '家人', fullName: '风火家人', judgment: '利女贞' },
  '110101': { num: 38, name: '睽', fullName: '火泽睽', judgment: '小事吉' },
  '001010': { num: 39, name: '蹇', fullName: '水山蹇', judgment: '利西南，不利东北' },
  '010100': { num: 40, name: '解', fullName: '雷水解', judgment: '利西南，无所往' },
  '110001': { num: 41, name: '损', fullName: '山泽损', judgment: '有孚，元吉无咎' },
  '100011': { num: 42, name: '益', fullName: '风雷益', judgment: '利有攸往，利涉大川' },
  '111110': { num: 43, name: '夬', fullName: '泽天夬', judgment: '扬于王庭，孚号有厉' },
  '011111': { num: 44, name: '姤', fullName: '天风姤', judgment: '女壮，勿用取女' },
  '000110': { num: 45, name: '萃', fullName: '泽地萃', judgment: '亨，王假有庙' },
  '011000': { num: 46, name: '升', fullName: '地风升', judgment: '元亨，用见大人' },
  '010110': { num: 47, name: '困', fullName: '泽水困', judgment: '亨，贞，大人吉无咎' },
  '011010': { num: 48, name: '井', fullName: '水风井', judgment: '改邑不改井，无丧无得' },
  '101110': { num: 49, name: '革', fullName: '泽火革', judgment: '己日乃孚，元亨利贞' },
  '011101': { num: 50, name: '鼎', fullName: '火风鼎', judgment: '元吉，亨' },
  '100100': { num: 51, name: '震', fullName: '震为雷', judgment: '亨。震来虩虩，笑言哑哑' },
  '001001': { num: 52, name: '艮', fullName: '艮为山', judgment: '艮其背，不获其身' },
  '001011': { num: 53, name: '渐', fullName: '风山渐', judgment: '女归吉，利贞' },
  '110100': { num: 54, name: '归妹', fullName: '雷泽归妹', judgment: '征凶，无攸利' },
  '101100': { num: 55, name: '丰', fullName: '雷火丰', judgment: '亨，王假之' },
  '001101': { num: 56, name: '旅', fullName: '火山旅', judgment: '小亨，旅贞吉' },
  '011011': { num: 57, name: '巽', fullName: '巽为风', judgment: '小亨，利有攸往' },
  '110110': { num: 58, name: '兑', fullName: '兑为泽', judgment: '亨，利贞' },
  '010011': { num: 59, name: '涣', fullName: '风水涣', judgment: '亨，王假有庙' },
  '110010': { num: 60, name: '节', fullName: '水泽节', judgment: '亨，苦节不可贞' },
  '110011': { num: 61, name: '中孚', fullName: '风泽中孚', judgment: '豚鱼吉，利涉大川' },
  '001100': { num: 62, name: '小过', fullName: '雷山小过', judgment: '亨利贞，可小事不可大事' },
  '101010': { num: 63, name: '既济', fullName: '水火既济', judgment: '亨小，利贞，初吉终乱' },
  '010101': { num: 64, name: '未济', fullName: '火水未济', judgment: '亨，小狐汔济，濡其尾' },
}

export interface IChingLine {
  coins: number[]
  sum: number
  type: '老阴' | '少阳' | '少阴' | '老阳'
  value: 0 | 1
  changing: boolean
}

export interface IChingResult {
  lines: IChingLine[]
  binary: string
  changingBinary: string
  hexagram: Hexagram & { lowerTrigram: string; upperTrigram: string; symbol: string }
  changingHexagram: (Hexagram & { lowerTrigram: string; upperTrigram: string; symbol: string }) | null
  changingLines: number[]
}

function getTrigramInfo(bits: string) {
  const t = TRIGRAMS[bits]
  return t ? `${t.name}（${t.nature}）` : bits
}

function getHexagramSymbol(num: number): string {
  return String.fromCodePoint(0x4dc0 + num - 1)
}

function buildHexagram(binary: string) {
  const h = HEXAGRAMS[binary]
  if (!h) return null
  const lower = binary.slice(0, 3)
  const upper = binary.slice(3, 6)
  const lt = TRIGRAMS[lower]
  const ut = TRIGRAMS[upper]
  return {
    ...h,
    lowerTrigram: lt ? `${lt.name}（${lt.nature}）` : lower,
    upperTrigram: ut ? `${ut.name}（${ut.nature}）` : upper,
    symbol: getHexagramSymbol(h.num),
  }
}

// 模拟三硬币法占卦
export function castIChing(): IChingResult {
  const lines: IChingLine[] = []
  for (let i = 0; i < 6; i++) {
    const coins = [
      Math.random() < 0.5 ? 2 : 3,
      Math.random() < 0.5 ? 2 : 3,
      Math.random() < 0.5 ? 2 : 3,
    ]
    const sum = coins.reduce((a, b) => a + b, 0)
    let type: IChingLine['type']
    let value: 0 | 1
    let changing = false

    if (sum === 6) { type = '老阴'; value = 0; changing = true }
    else if (sum === 7) { type = '少阳'; value = 1 }
    else if (sum === 8) { type = '少阴'; value = 0 }
    else { type = '老阳'; value = 1; changing = true }

    lines.push({ coins, sum, type, value, changing })
  }

  const binary = lines.map((l) => l.value).join('')
  const changingLines = lines.map((l, i) => (l.changing ? i : -1)).filter((i) => i >= 0)
  const changingBinary = lines.map((l) => (l.changing ? (l.value === 1 ? 0 : 1) : l.value)).join('')

  const hexagram = buildHexagram(binary)!
  const changingHexagram = changingLines.length > 0 ? buildHexagram(changingBinary) : null

  return { lines, binary, changingBinary, hexagram, changingHexagram, changingLines }
}
