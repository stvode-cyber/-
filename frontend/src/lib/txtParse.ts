/**
 * TXT 解析：编码检测 + 章节切分
 *
 * 中文小说大量使用 GBK/GB18030 编码，浏览器 TextDecoder 原生支持。
 * 策略：先按 UTF-8 严格模式解码（fatal: true），失败则回退 GBK（GB18030 超集）。
 */

export function decodeTxt(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

export interface TxtChapter {
  title: string
  /** 章节正文（含标题行） */
  content: string
}

const CHAPTER_RE =
  /^\s{0,4}(第\s*[0-9零〇一二两三四五六七八九十百千万亿]+\s*[章节卷回部集幕]|序章|序言|楔子|引子|前言|后记|尾声|终章|番外篇?|楔)\s*[^\n]{0,30}$/

/**
 * 按行扫描切分章节。未匹配到任何章节标题时整书作为单章返回。
 */
export function splitChapters(text: string): TxtChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chapters: TxtChapter[] = []
  let currentTitle = '开始'
  let currentLines: string[] = []

  const push = () => {
    const content = currentLines.join('\n').trim()
    if (content) chapters.push({ title: currentTitle, content })
  }

  for (const line of lines) {
    if (CHAPTER_RE.test(line)) {
      push()
      currentTitle = line.trim()
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }
  push()

  if (chapters.length <= 1) {
    return [{ title: '全文', content: text.replace(/\r\n?/g, '\n').trim() }]
  }
  return chapters
}
