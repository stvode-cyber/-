/**
 * 本地小说阅读器 · 数据层
 *
 * - IndexedDB（aie-novel-library/books）：存书籍文件 Blob（不占 localStorage 配额）
 * - localStorage：书架元数据（novel_books_v1）+ 阅读设置（novel_settings_v1）
 *               + 书签笔记（novel_marks_v1）+ 阅读统计（novel_stats_v1）
 * - 支持格式：txt / epub / pdf / docx / html / md；mobi 等无前端解析库的格式在导入时拦截
 */

export type NovelFormat = 'txt' | 'epub' | 'pdf' | 'docx' | 'html' | 'md'

export interface NovelBook {
  id: string
  title: string
  format: NovelFormat
  size: number
  addedAt: number
  lastReadAt: number | null
  /** 阅读进度：百分比 0-100 */
  percent: number
  /** TXT：章节索引 + 章内滚动比例；EPUB：CFI；PDF：页码 */
  chapterIdx: number
  scrollRatio: number
  cfi: string | null
  page: number
  totalPages: number
  chapterCount: number
  /** 累计阅读时长（秒），由阅读统计合并而来 */
  readSeconds: number
}

/** 书签 / 笔记：用 location 字段表达不同格式的定位（章节索引 / CFI / 页码） */
export interface NovelMark {
  id: string
  bookId: string
  type: 'bookmark' | 'note'
  /** 定位：TXT=`ch:${idx}:r:${ratio}`  EPUB=cfi  PDF=`p:${page}` */
  location: string
  /** 章节标题或可读位置描述 */
  chapterTitle: string
  /** 摘录：选中文本或截取的上下文 */
  excerpt: string
  /** 笔记内容（type=note 时使用） */
  note?: string
  createdAt: number
}

/** 阅读统计：按天聚合 */
export interface NovelStat {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 当日阅读秒数 */
  seconds: number
  /** 当日阅读的书籍 ID（去重） */
  bookIds: string[]
}

/** 全局统计概览 */
export interface NovelStatOverview {
  totalSeconds: number
  totalDays: number
  streakDays: number
  last7Days: { date: string; seconds: number }[]
  topBooks: { bookId: string; title: string; seconds: number }[]
}

export interface NovelSettings {
  fontSize: number
  lineHeight: number
  /** light 白 / sepia 米黄 / green 护眼绿 / dark 夜间 */
  theme: 'light' | 'sepia' | 'green' | 'dark'
}

const BOOKS_KEY = 'novel_books_v1'
const SETTINGS_KEY = 'novel_settings_v1'
const MARKS_KEY = 'novel_marks_v1'
const STATS_KEY = 'novel_stats_v1'
export const DB_NAME = 'aie-novel-library'
const STORE = 'books'

export const SUPPORTED_EXTS = ['txt', 'epub', 'pdf', 'docx', 'html', 'htm', 'md', 'markdown'] as const

export function detectFormat(fileName: string): NovelFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  if (ext === 'txt') return 'txt'
  if (ext === 'epub') return 'epub'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'md'
  return null
}

/** 无前端解析库、需要提示转换的格式 → 中文说明 */
const UNSUPPORTED_HINTS: Record<string, string> = {
  mobi: 'MOBI 是 Kindle 专用格式，请用 Calibre 转换为 EPUB/TXT 后导入',
  azw3: 'AZW3 是 Kindle 专用格式，请用 Calibre 转换为 EPUB/TXT 后导入',
  azw: 'AZW 是 Kindle 专用格式，请用 Calibre 转换为 EPUB/TXT 后导入',
  prc: 'PRC 是 Kindle 专用格式，请用 Calibre 转换为 EPUB/TXT 后导入',
  doc: 'DOC 老格式请另存为 DOCX 或 TXT 后导入',
  fb2: 'FB2 请转换为 EPUB 后导入',
  chm: 'CHM 请转换为 PDF 或 EPUB 后导入',
}

export function unsupportedHint(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return UNSUPPORTED_HINTS[ext] || null
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ===== IndexedDB：书籍文件存取 =====

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveBookFile(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadBookFile(id: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Blob) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteBookFile(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ===== 书架元数据 =====

export function listBooks(): NovelBook[] {
  try {
    return JSON.parse(localStorage.getItem(BOOKS_KEY) || '[]') as NovelBook[]
  } catch {
    return []
  }
}

function saveBooks(books: NovelBook[]) {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books))
}

export function getBook(id: string): NovelBook | null {
  return listBooks().find((b) => b.id === id) || null
}

export function upsertBook(book: NovelBook) {
  const books = listBooks().filter((b) => b.id !== book.id)
  books.push(book)
  saveBooks(books)
}

export function removeBook(id: string) {
  saveBooks(listBooks().filter((b) => b.id !== id))
  // 同步清除该书的所有书签/笔记
  saveMarks(listMarks().filter((m) => m.bookId !== id))
  // 同步从统计中清除（仅清除 bookIds 引用，秒数保留为历史数据）
  const stats = listStats()
  stats.forEach((s) => {
    if (s.bookIds.includes(id)) s.bookIds = s.bookIds.filter((b) => b !== id)
  })
  saveStats(stats)
}

export function genBookId(): string {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ===== 书签 / 笔记 =====

function listMarks(): NovelMark[] {
  try {
    return JSON.parse(localStorage.getItem(MARKS_KEY) || '[]') as NovelMark[]
  } catch {
    return []
  }
}

function saveMarks(marks: NovelMark[]) {
  localStorage.setItem(MARKS_KEY, JSON.stringify(marks))
}

export function listBookMarks(bookId: string): NovelMark[] {
  return listMarks()
    .filter((m) => m.bookId === bookId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function addMark(mark: Omit<NovelMark, 'id' | 'createdAt'>): NovelMark {
  const full: NovelMark = {
    ...mark,
    id: `mk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  }
  const marks = listMarks()
  marks.push(full)
  saveMarks(marks)
  return full
}

export function removeMark(id: string) {
  saveMarks(listMarks().filter((m) => m.id !== id))
}

export function updateMarkNote(id: string, note: string) {
  const marks = listMarks()
  const idx = marks.findIndex((m) => m.id === id)
  if (idx >= 0) {
    marks[idx] = { ...marks[idx], note }
    saveMarks(marks)
  }
}

// ===== 阅读统计 =====

function listStats(): NovelStat[] {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) || '[]') as NovelStat[]
  } catch {
    return []
  }
}

function saveStats(stats: NovelStat[]) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats))
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 累加阅读时长（秒），并同步更新对应书籍的 readSeconds 字段 */
export function addReadSeconds(bookId: string, seconds: number) {
  if (seconds <= 0) return
  const stats = listStats()
  const today = todayStr()
  let stat = stats.find((s) => s.date === today)
  if (!stat) {
    stat = { date: today, seconds: 0, bookIds: [] }
    stats.push(stat)
  }
  stat.seconds += seconds
  if (!stat.bookIds.includes(bookId)) stat.bookIds.push(bookId)
  saveStats(stats)

  // 同步书籍累计时长
  const book = getBook(bookId)
  if (book) {
    upsertBook({ ...book, readSeconds: (book.readSeconds || 0) + seconds })
  }
}

/** 按日期范围查询阅读统计（含起止日，无记录的日期补 0），供周报等聚合使用 */
export function getStatsInRange(startDate: string, endDate: string): NovelStat[] {
  const stats = listStats()
  const map = new Map(stats.map((s) => [s.date, s]))
  const out: NovelStat[] = []
  const cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (cur <= end) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    const s = map.get(ds)
    out.push(s || { date: ds, seconds: 0, bookIds: [] })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** 全局统计概览：总时长 / 阅读天数 / 连续天数 / 近 7 天 / Top 书籍 */
export function getStatOverview(): NovelStatOverview {
  const stats = listStats().sort((a, b) => a.date.localeCompare(b.date))
  const books = listBooks()
  const totalSeconds = stats.reduce((s, x) => s + x.seconds, 0)

  // 连续天数：从今天往前数，连续有阅读记录的天数
  let streakDays = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hit = stats.find((s) => s.date === ds && s.seconds > 0)
    if (hit) streakDays++
    else if (i === 0) continue // 今天还没读：不算断
    else break
  }

  // 近 7 天数据
  const last7Days: { date: string; seconds: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const s = stats.find((x) => x.date === ds)
    last7Days.push({ date: ds, seconds: s?.seconds || 0 })
  }

  // Top 书籍：聚合每本书的累计秒数（用书籍 readSeconds 字段，回退到统计累加）
  const bookSeconds = new Map<string, number>()
  stats.forEach((s) => {
    s.bookIds.forEach((bid) => {
      bookSeconds.set(bid, (bookSeconds.get(bid) || 0) + Math.floor(s.seconds / Math.max(1, s.bookIds.length)))
    })
  })
  const topBooks = books
    .map((b) => ({ bookId: b.id, title: b.title, seconds: b.readSeconds || bookSeconds.get(b.id) || 0 }))
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)

  return {
    totalSeconds,
    totalDays: stats.filter((s) => s.seconds > 0).length,
    streakDays,
    last7Days,
    topBooks,
  }
}

/** 单本书的阅读统计概览 */
export function getBookStat(bookId: string): { totalSeconds: number; last7Days: { date: string; seconds: number }[] } {
  const stats = listStats()
  const today = new Date()
  const last7Days: { date: string; seconds: number }[] = []
  let totalSeconds = 0
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const s = stats.find((x) => x.date === ds)
    const secs = s && s.bookIds.includes(bookId) ? Math.floor(s.seconds / Math.max(1, s.bookIds.length)) : 0
    last7Days.push({ date: ds, seconds: secs })
    totalSeconds += secs
  }
  // 总时长以书籍字段为准（更准确）
  const book = getBook(bookId)
  return { totalSeconds: book?.readSeconds || totalSeconds, last7Days }
}

// ===== 阅读时长格式化 =====

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}分钟`
  const h = Math.floor(m / 60)
  const restM = m % 60
  return restM > 0 ? `${h}小时${restM}分` : `${h}小时`
}

// ===== 阅读设置 =====

export const DEFAULT_SETTINGS: NovelSettings = { fontSize: 18, lineHeight: 1.9, theme: 'light' }

export function loadSettings(): NovelSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: NovelSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ===== 阅读器主题 =====

export const READER_THEMES: Record<NovelSettings['theme'], { bg: string; text: string; name: string }> = {
  light: { bg: '#FFFFFF', text: '#1E293B', name: '白纸' },
  sepia: { bg: '#F5EBD8', text: '#5B4636', name: '米黄' },
  green: { bg: '#C7E5C9', text: '#1F3D2B', name: '护眼' },
  dark: { bg: '#111318', text: '#C9CCD1', name: '夜间' },
}
