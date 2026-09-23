/**
 * 资产离线语义分类引擎（智能归纳的核心，零外部依赖、可离线、确定性）
 *
 * 设计目标（对应 DAM-lite 核心诉求）：
 * - 不依赖云端 / LLM，纯规则推断，断网环境照常工作
 * - 输入仅 { name, mime, size }，输出稳定可复现的中文语义分类
 * - 与 mime 粗类（type）解耦：type 决定渲染图标，category 决定业务归类
 *
 * 分类口径（10 类）：
 *   票据 / 截图 / 合同 / 文档 / 照片 / 代码 / 音频 / 视频 / 归档 / 其他
 *
 * 判定优先级（命中即返回，保证确定性）：
 *   1. 扩展名 → 代码 / 归档
 *   2. MIME → 音频 / 视频 / 图片 / PDF
 *   3. 文件名关键词 → 票据 / 截图 / 合同
 *   4. 回退到 type（inferType）
 */

import { inferType } from './asset.js'

export type AssetCategory =
  | '票据'
  | '截图'
  | '合同'
  | '文档'
  | '照片'
  | '代码'
  | '音频'
  | '视频'
  | '归档'
  | '其他'

export const ASSET_CATEGORIES: AssetCategory[] = [
  '票据',
  '截图',
  '合同',
  '文档',
  '照片',
  '代码',
  '音频',
  '视频',
  '归档',
  '其他',
]

// 自定义映射规则输入（来自 CategoryRule 表，运行时注入，优先级高于内置规则）
export interface CategoryRuleInput {
  matchType: 'extension' | 'nameContains' | 'mimeStartsWith'
  pattern: string
  targetCategory: string
  priority?: number
  enabled?: boolean
}

// 1) 代码类扩展名（源码 / 配置 / 标记语言 / 数据描述）
const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'go', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs',
  'rb', 'php', 'rs', 'swift', 'kt', 'scala', 'lua', 'pl', 'sh', 'bash', 'zsh', 'ps1',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'env', 'properties', 'cfg',
  'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sass',
  'sql', 'graphql', 'proto',
  'md', 'markdown', 'rst', 'tex', 'adoc',
  'vue', 'svelte', 'astro',
  'dockerfile', 'makefile', 'cmake', 'lock',
])

// 2) 归档 / 安装包类扩展名
const ARCHIVE_EXT = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz4', 'z',
  'iso', 'img', 'dmg', 'apk', 'ipa', 'deb', 'rpm', 'msi', 'exe', 'cab',
])

// 3) 文件名关键词（不区分大小写）
const RECEIPT_KW = [
  '发票', '收据', '小票', 'invoice', 'receipt', '报销', '账单', 'bill',
  '支付凭证', '付款凭证', '转账', '微信支付', '支付宝', 'alipay', 'wechat pay',
  '缴费', '结算单', '对账单', '回执', '凭证',
]
const SCREENSHOT_KW = [
  '截图', '截屏', 'screen', 'screenshot', 'capture', 'snip', 'snipaste',
  '屏幕快照', '截圖',
]
const CONTRACT_KW = [
  '合同', '协议', '合约', 'contract', 'agreement', '保密', '聘书', '意向书',
  '备忘录', 'mou', '条款', '契约', '嘱书',
]

// 二进制 / 其他类扩展名（既非代码也非归档、且无文本语义）
const BINARY_EXT = new Set([
  'bin', 'dat', 'dll', 'so', 'dylib', 'class', 'o', 'obj', 'a', 'lib', 'wasm',
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'fon',
  'db', 'sqlite', 'sqlite3', 'mdb',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

function hasKeyword(haystack: string, kws: string[]): boolean {
  return kws.some((k) => haystack.includes(k.toLowerCase()))
}

/**
 * 推断资产语义分类（纯本地、确定性、可离线）
 * @param name 文件名（含扩展名）
 * @param mime MIME 类型
 * @param size 字节数（当前用于区分二进制/其他，预留扩展）
 * @param rules 自定义映射规则（来自 CategoryRule，优先级高于内置规则）；不传则仅用内置口径
 */
export function classifyAsset(
  opts: { name: string; mime?: string | null; size?: number },
  rules?: CategoryRuleInput[],
): AssetCategory {
  const { name, mime, size } = opts
  const ext = extOf(name)
  const lower = name.toLowerCase()
  const m = (mime || '').toLowerCase()

  // 0) 自定义规则优先（按 priority 降序，命中即返回，用户口径覆盖内置）
  if (rules?.length) {
    const active = rules.filter((r) => r.enabled !== false)
    active.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    for (const r of active) {
      const p = r.pattern.toLowerCase()
      if (r.matchType === 'extension') {
        if (ext && ext === p) return r.targetCategory as AssetCategory
      } else if (r.matchType === 'nameContains') {
        if (p && lower.includes(p)) return r.targetCategory as AssetCategory
      } else if (r.matchType === 'mimeStartsWith') {
        if (p && m.startsWith(p)) return r.targetCategory as AssetCategory
      }
    }
  }

  // 1) 扩展名优先：代码 / 归档
  if (CODE_EXT.has(ext)) return '代码'
  if (ARCHIVE_EXT.has(ext)) return '归档'

  // 2) MIME 主导
  if (m.startsWith('audio/')) return '音频'
  if (m.startsWith('video/')) return '视频'
  if (m.startsWith('image/')) {
    if (hasKeyword(lower, RECEIPT_KW)) return '票据'
    if (hasKeyword(lower, SCREENSHOT_KW)) return '截图'
    return '照片'
  }
  if (m === 'application/pdf') {
    if (hasKeyword(lower, RECEIPT_KW)) return '票据'
    if (hasKeyword(lower, CONTRACT_KW)) return '合同'
    return '文档'
  }

  // 3) 文件名关键词（兜底文档类没有可靠 MIME 时）
  if (hasKeyword(lower, RECEIPT_KW)) return '票据'
  if (hasKeyword(lower, SCREENSHOT_KW)) return '截图'
  if (hasKeyword(lower, CONTRACT_KW)) return '合同'

  // 4) 回退到 type
  const t = inferType(name, mime)
  if (t === 'audio') return '音频'
  if (t === 'video') return '视频'
  if (t === 'image') return '照片'
  // document 类：明确二进制的归"其他"，其余归"文档"
  if (BINARY_EXT.has(ext)) return '其他'
  return '文档'
}
