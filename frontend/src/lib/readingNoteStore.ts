/**
 * 读书笔记 · 数据层
 *
 * - 书籍管理（在读/已读/想读/弃读）
 * - 笔记类型：高亮摘录 / 心得感悟 / 总结
 * - 标签 + 关键词搜索
 * - Markdown 导出
 * - 纯 localStorage 离线可用
 */

export type BookStatus = 'reading' | 'done' | 'wish' | 'abandoned'

export interface Book {
  id: string
  title: string
  author: string
  /** 封面色（用于卡片视觉） */
  coverColor: string
  /** 总页数（可选） */
  totalPages?: number
  status: BookStatus
  /** 阅读开始日期 YYYY-MM-DD */
  startDate?: string
  /** 阅读完成日期 */
  finishDate?: string
  /** 评分 1-5 */
  rating?: number
  createdAt: string
}

export type NoteType = 'highlight' | 'thought' | 'summary'

export interface Note {
  id: string
  bookId: string
  type: NoteType
  /** 笔记内容（高亮文本或心得文字） */
  content: string
  /** 关联章节（可选） */
  chapter?: string
  /** 页码（可选） */
  page?: number
  /** 标签数组 */
  tags: string[]
  createdAt: string
}

export const STATUS_META: Record<BookStatus, { label: string; emoji: string; color: string }> = {
  reading: { label: '在读', emoji: '📖', color: '#3B82F6' },
  done: { label: '已读', emoji: '✅', color: '#22C55E' },
  wish: { label: '想读', emoji: '🌟', color: '#F59E0B' },
  abandoned: { label: '弃读', emoji: '🗑️', color: '#94A3B8' },
}

export const NOTE_TYPE_META: Record<NoteType, { label: string; emoji: string; color: string }> = {
  highlight: { label: '高亮', emoji: '📌', color: '#3B82F6' },
  thought: { label: '心得', emoji: '💭', color: '#8B5CF6' },
  summary: { label: '总结', emoji: '📝', color: '#F59E0B' },
}

const COVER_COLORS = ['#3B82F6', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#14B8A6']

const BOOKS_KEY = 'reading_books_v1'
const NOTES_KEY = 'reading_notes_v1'

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ===== 书籍 =====

function loadBooks(): Book[] {
  try {
    const arr = JSON.parse(localStorage.getItem(BOOKS_KEY) || '[]') as Book[]
    return arr.filter((b) => b && typeof b.title === 'string')
  } catch {
    return []
  }
}

function saveBooks(list: Book[]) {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(list))
}

export function addBook(input: {
  title: string
  author: string
  totalPages?: number
  status: BookStatus
}): Book {
  const book: Book = {
    id: genId('bk'),
    title: input.title.trim(),
    author: input.author.trim() || '佚名',
    coverColor: COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)],
    totalPages: input.totalPages,
    status: input.status,
    startDate: input.status === 'reading' ? todayStr() : undefined,
    createdAt: new Date().toISOString(),
  }
  const all = loadBooks()
  all.unshift(book)
  saveBooks(all)
  return book
}

export function updateBook(id: string, patch: Partial<Book>) {
  const all = loadBooks()
  const idx = all.findIndex((b) => b.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], ...patch }
  saveBooks(all)
}

export function deleteBook(id: string) {
  saveBooks(loadBooks().filter((b) => b.id !== id))
  // 同步删除该书的所有笔记
  const notes = loadNotes().filter((n) => n.bookId !== id)
  saveNotes(notes)
}

export function getBook(id: string): Book | null {
  return loadBooks().find((b) => b.id === id) || null
}

export function listBooks(status?: BookStatus): Book[] {
  const all = loadBooks()
  if (!status) return all
  return all.filter((b) => b.status === status)
}

// ===== 笔记 =====

function loadNotes(): Note[] {
  try {
    const arr = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]') as Note[]
    return arr.filter((n) => n && typeof n.content === 'string')
  } catch {
    return []
  }
}

function saveNotes(list: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(list))
}

export function addNote(input: {
  bookId: string
  type: NoteType
  content: string
  chapter?: string
  page?: number
  tags?: string[]
}): Note {
  const note: Note = {
    id: genId('nt'),
    bookId: input.bookId,
    type: input.type,
    content: input.content.trim(),
    chapter: input.chapter?.trim() || undefined,
    page: input.page,
    tags: input.tags || [],
    createdAt: new Date().toISOString(),
  }
  const all = loadNotes()
  all.unshift(note)
  saveNotes(all)
  return note
}

export function updateNote(id: string, patch: Partial<Note>) {
  const all = loadNotes()
  const idx = all.findIndex((n) => n.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], ...patch }
  saveNotes(all)
}

export function deleteNote(id: string) {
  saveNotes(loadNotes().filter((n) => n.id !== id))
}

export function listNotes(bookId?: string): Note[] {
  const all = loadNotes()
  if (!bookId) return all
  return all.filter((n) => n.bookId === bookId)
}

export function searchNotes(keyword: string): Note[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return loadNotes()
  return loadNotes().filter((n) =>
    n.content.toLowerCase().includes(kw) ||
    (n.chapter && n.chapter.toLowerCase().includes(kw)) ||
    n.tags.some((t) => t.toLowerCase().includes(kw)),
  )
}

/** 所有标签及使用次数 */
export function getAllTags(): { tag: string; count: number }[] {
  const map: Record<string, number> = {}
  loadNotes().forEach((n) => {
    n.tags.forEach((t) => { map[t] = (map[t] || 0) + 1 })
  })
  return Object.entries(map)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}

// ===== 统计 =====

export function getStat() {
  const books = loadBooks()
  const notes = loadNotes()
  return {
    totalBooks: books.length,
    reading: books.filter((b) => b.status === 'reading').length,
    done: books.filter((b) => b.status === 'done').length,
    wish: books.filter((b) => b.status === 'wish').length,
    abandoned: books.filter((b) => b.status === 'abandoned').length,
    notes: notes.length,
    highlights: notes.filter((n) => n.type === 'highlight').length,
    thoughts: notes.filter((n) => n.type === 'thought').length,
    summaries: notes.filter((n) => n.type === 'summary').length,
  }
}

// ===== Markdown 导出 =====

export function exportBookMarkdown(bookId: string): string {
  const book = getBook(bookId)
  if (!book) return ''
  const notes = listNotes(bookId)
  const lines: string[] = []
  lines.push(`# ${book.title}`)
  lines.push('')
  lines.push(`- 作者：${book.author}`)
  lines.push(`- 状态：${STATUS_META[book.status].label}`)
  if (book.totalPages) lines.push(`- 页数：${book.totalPages}`)
  if (book.rating) lines.push(`- 评分：${'⭐'.repeat(book.rating)}`)
  if (book.startDate) lines.push(`- 开始：${book.startDate}`)
  if (book.finishDate) lines.push(`- 完成：${book.finishDate}`)
  lines.push('')

  if (notes.length === 0) {
    lines.push('暂无笔记')
    return lines.join('\n')
  }

  const byType: Record<NoteType, Note[]> = {
    highlight: [], thought: [], summary: [],
  }
  notes.forEach((n) => byType[n.type].push(n))

  if (byType.summary.length > 0) {
    lines.push('## 📝 总结')
    byType.summary.forEach((n) => {
      lines.push('')
      lines.push(n.content)
      if (n.tags.length) lines.push(`\n*标签：${n.tags.join('、')}*`)
    })
  }

  if (byType.highlight.length > 0) {
    lines.push('')
    lines.push('## 📌 高亮摘录')
    byType.highlight.forEach((n) => {
      lines.push('')
      lines.push(`> ${n.content}`)
      if (n.chapter || n.page) {
        lines.push(`> *— ${[n.chapter, n.page ? `第 ${n.page} 页` : ''].filter(Boolean).join(' · ')}*`)
      }
      if (n.tags.length) lines.push(`> *标签：${n.tags.join('、')}*`)
    })
  }

  if (byType.thought.length > 0) {
    lines.push('')
    lines.push('## 💭 心得感悟')
    byType.thought.forEach((n) => {
      lines.push('')
      lines.push(n.content)
      if (n.chapter || n.page) {
        lines.push(`\n*— ${[n.chapter, n.page ? `第 ${n.page} 页` : ''].filter(Boolean).join(' · ')}*`)
      }
      if (n.tags.length) lines.push(`\n*标签：${n.tags.join('、')}*`)
    })
  }

  return lines.join('\n')
}
