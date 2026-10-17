/**
 * Novel 阅读器工具函数
 * Markdown 转 HTML + HTML 净化
 */

/** Markdown → HTML（轻量实现：标题/列表/引用/粗斜体/行内代码/链接/图片/围栏代码） */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false
  let inQuote = false
  const closeBlocks = () => {
    if (inList) { out.push('</ul>'); inList = false }
    if (inQuote) { out.push('</blockquote>'); inQuote = false }
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeBlocks()
      out.push(inCode ? '</code></pre>' : '<pre><code>')
      inCode = !inCode
      continue
    }
    if (inCode) { out.push(esc(line)); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      closeBlocks()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    const li = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (li) {
      if (!inList) { closeBlocks(); out.push('<ul>'); inList = true }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    const bq = /^>\s?(.*)$/.exec(line)
    if (bq) {
      if (inList) { out.push('</ul>'); inList = false }
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${inline(bq[1])}</p>`)
      continue
    }
    if (!line.trim()) { closeBlocks(); continue }
    closeBlocks()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeBlocks()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

/** HTML 文件：去掉 script/iframe 后渲染（本地文件，样式保留） */
export function sanitizeHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
}
