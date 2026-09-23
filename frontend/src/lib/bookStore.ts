/**
 * 书架管理 · 数据层
 *
 * - localStorage：书目（books_v1）
 * - 三状态：想读 / 在读 / 已读
 * - 进度追踪（页码/百分比）、读书笔记摘录、五星评分、年度统计
 * - 完全本地存储，离线可用
 */

/** 阅读状态 */
export type BookStatus = 'want' | 'reading' | 'read'

/** 分类 */
export type BookCategory = 'fiction' | 'nonfiction' | 'tech' | 'history' | 'bio' | 'philosophy' | 'other'

/** 读书笔记/摘录 */
export interface BookNote {
  id: string
  /** 页码（可选） */
  page?: number
  /** 内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
}

export interface Book {
  id: string
  /** 书名 */
  title: string
  /** 作者 */
  author: string
  /** 封面 emoji */
  emoji: string
  /** 状态 */
  status: BookStatus
  /** 分类 */
  category: BookCategory
  /** 总页数（可选） */
  totalPages?: number
  /** 当前页数 */
  currentPage: number
  /** 评分 0-5（0=未评） */
  rating: number
  /** 书评（可选） */
  review?: string
  /** 开始阅读日期 YYYY-MM-DD */
  startDate?: string
  /** 读完日期 */
  finishDate?: string
  /** 笔记列表 */
  notes: BookNote[]
  /** 关联本地书架书籍 ID（可选；有值时点击书行直接进入阅读页） */
  novelId?: string
  /** 创建时间戳 */
  createdAt: number
}

export interface BookStat {
  total: number
  byStatus: Record<BookStatus, number>
  /** 本年已读数 */
  readThisYear: number
  /** 在读总页数进度 */
  readingPages: number
  readingTotal: number
  /** 平均评分（已读） */
  avgRating: number
  /** 笔记总数 */
  noteCount: number
}

/** 状态元数据 */
export const STATUS_META: Record<BookStatus, { label: string; color: string; emoji: string }> = {
  want: { label: '想读', color: '#A78BFA', emoji: '📚' },
  reading: { label: '在读', color: '#3B82F6', emoji: '📖' },
  read: { label: '已读', color: '#10B981', emoji: '✅' },
}

/** 分类元数据 */
export const CATEGORY_META: Record<BookCategory, { label: string; emoji: string }> = {
  fiction: { label: '小说', emoji: '📖' },
  nonfiction: { label: '非虚构', emoji: '📝' },
  tech: { label: '技术', emoji: '💻' },
  history: { label: '历史', emoji: '🏛️' },
  bio: { label: '传记', emoji: '👤' },
  philosophy: { label: '哲思', emoji: '🤔' },
  other: { label: '其他', emoji: '📦' },
}

/** 封面 emoji */
export const EMOJI_OPTIONS = [
  '📖', '📚', '📕', '📗', '📘', '📙', '📓', '📔',
  '🗺️', '⚔️', '🔮', '💫', '🧙', '🚀', '💡', '🎨',
]

const KEY = 'books_v1'

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ===== CRUD =====

function listAll(): Book[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Book[]
    return raw.filter((b) => b && typeof b.id === 'string' && typeof b.title === 'string')
  } catch {
    return []
  }
}

function saveAll(list: Book[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

function genId(): string {
  return `book_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新增 */
export function addBook(data: Omit<Book, 'id' | 'createdAt' | 'notes'>): Book {
  const book: Book = {
    ...data,
    notes: [],
    id: genId(),
    createdAt: Date.now(),
  }
  const all = listAll()
  all.push(book)
  saveAll(all)
  return book
}

/** 更新 */
export function updateBook(id: string, data: Partial<Omit<Book, 'id' | 'createdAt'>>) {
  const all = listAll()
  const idx = all.findIndex((b) => b.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...data }
  saveAll(all)
}

/** 删除 */
export function deleteBook(id: string) {
  saveAll(listAll().filter((b) => b.id !== id))
}

// ===== 笔记 =====

/** 添加笔记 */
export function addNote(bookId: string, content: string, page?: number) {
  if (!content.trim()) return
  const all = listAll()
  const book = all.find((b) => b.id === bookId)
  if (!book) return
  book.notes.push({ id: genId(), content: content.trim(), page, createdAt: Date.now() })
  saveAll(all)
}

/** 删除笔记 */
export function deleteNote(bookId: string, noteId: string) {
  const all = listAll()
  const book = all.find((b) => b.id === bookId)
  if (!book) return
  book.notes = book.notes.filter((n) => n.id !== noteId)
  saveAll(all)
}

// ===== 状态推进 =====

/** 推进状态：想读 → 在读 → 已读 */
export function advanceStatus(id: string): BookStatus | null {
  const all = listAll()
  const book = all.find((b) => b.id === id)
  if (!book) return null
  const flow: BookStatus[] = ['want', 'reading', 'read']
  const curIdx = flow.indexOf(book.status)
  const next = flow[curIdx + 1] || flow[0]
  book.status = next
  if (next === 'reading' && !book.startDate) book.startDate = todayStr()
  if (next === 'read') {
    book.finishDate = todayStr()
    if (book.totalPages) book.currentPage = book.totalPages
  }
  // 从已读退回
  if (next === 'want') {
    book.finishDate = undefined
  }
  saveAll(all)
  return next
}

// ===== 统计 =====

export function getBookStat(): BookStat {
  const all = listAll()
  const byStatus: Record<BookStatus, number> = { want: 0, reading: 0, read: 0 }
  let readThisYear = 0
  let readingPages = 0
  let readingTotal = 0
  let ratingSum = 0
  let ratingCount = 0
  let noteCount = 0
  const yearPrefix = String(new Date().getFullYear())

  for (const b of all) {
    byStatus[b.status]++
    noteCount += b.notes.length
    if (b.status === 'reading') {
      readingPages += b.currentPage
      readingTotal += b.totalPages || 0
    }
    if (b.status === 'read') {
      if (b.finishDate && b.finishDate.startsWith(yearPrefix)) readThisYear++
      if (b.rating > 0) { ratingSum += b.rating; ratingCount++ }
    }
  }

  return {
    total: all.length,
    byStatus,
    readThisYear,
    readingPages,
    readingTotal,
    avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
    noteCount,
  }
}

/** 按状态分组（组内按更新时间降序） */
export function groupByStatus(): { status: BookStatus; items: Book[] }[] {
  const all = listAll()
  const map = new Map<BookStatus, Book[]>()
  for (const b of all) {
    const arr = map.get(b.status) || []
    arr.push(b)
    map.set(b.status, arr)
  }
  return (Object.keys(STATUS_META) as BookStatus[])
    .filter((s) => map.has(s))
    .map((status) => ({
      status,
      items: (map.get(status) || []).sort((a, b) => b.createdAt - a.createdAt),
    }))
}

/** 进度百分比 */
export function progressPct(book: Book): number {
  if (!book.totalPages || book.totalPages === 0) return 0
  return Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
}
