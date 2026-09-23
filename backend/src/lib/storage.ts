import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Response } from 'express'

/**
 * 本地资产存储（DAM-lite）
 *
 * 设计取舍：
 * - 文档要求 MinIO(S3) 对象存储，本项目为 SQLite 单机部署，故用本地文件系统替代，
 *   目录结构保持与文档一致：data/assets/{spaceId}/{assetId}/original.{ext}
 * - 去重使用 sha256(文件内容)，与文档 checksum 字段对应
 * - 后续若需上云，只需替换 saveAssetFile/readAssetFile 两个实现，模型层不变
 */

const ASSET_ROOT = path.resolve(process.cwd(), 'data', 'assets')

export function getAssetRoot(): string {
  return ASSET_ROOT
}

export async function ensureAssetRoot(): Promise<void> {
  await fs.mkdir(ASSET_ROOT, { recursive: true })
}

/** 计算内容 sha256（去重用） */
export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function extFromName(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  const ext = name.slice(i + 1).toLowerCase()
  // 仅保留常见安全扩展名，防止路径穿越/伪造
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}

/**
 * 保存资产原文件，返回 storageKey（相对 ASSET_ROOT 的路径）
 */
export async function saveAssetFile(
  spaceId: string,
  assetId: string,
  originalName: string,
  buf: Buffer,
): Promise<string> {
  await ensureAssetRoot()
  const ext = extFromName(originalName)
  const dir = path.join(ASSET_ROOT, spaceId, assetId)
  await fs.mkdir(dir, { recursive: true })
  const filename = ext ? `original.${ext}` : 'original'
  const storageKey = path.join(spaceId, assetId, filename).split(path.sep).join('/')
  await fs.writeFile(path.join(ASSET_ROOT, storageKey), buf)
  return storageKey
}

/** 将 storageKey 解析为 ASSET_ROOT 内的绝对路径，并校验防穿透（严格前缀匹配，避免 /assets-evil 前缀碰撞） */
function resolveSafe(storageKey: string): string {
  const abs = path.resolve(ASSET_ROOT, storageKey)
  if (abs !== ASSET_ROOT && !abs.startsWith(ASSET_ROOT + path.sep)) {
    throw new Error('非法存储路径')
  }
  return abs
}

/** 读取资产原文件（不存在时抛错） */
export async function readAssetFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveSafe(storageKey))
}

/**
 * 保存资产版本文件，返回 storageKey（位于 {spaceId}/{assetId}/versions/{versionId}.{ext}）
 */
export async function saveVersionFile(
  spaceId: string,
  assetId: string,
  versionId: string,
  originalName: string,
  buf: Buffer,
): Promise<string> {
  await ensureAssetRoot()
  const ext = extFromName(originalName)
  const dir = path.join(ASSET_ROOT, spaceId, assetId, 'versions')
  await fs.mkdir(dir, { recursive: true })
  const filename = ext ? `${versionId}.${ext}` : versionId
  const storageKey = path.join(spaceId, assetId, 'versions', filename).split(path.sep).join('/')
  await fs.writeFile(path.join(ASSET_ROOT, storageKey), buf)
  return storageKey
}

/** 删除资产目录下全部文件（原文件 + 版本 + 缩略图），清理整个资产目录 */
export async function deleteAssetFile(storageKey: string): Promise<void> {
  if (!storageKey) return
  const assetDir = path.dirname(resolveSafe(storageKey))
  await fs.rm(assetDir, { recursive: true, force: true })
}

/**
 * 流式返回资产文件（避免大文件全量读入内存）。
 * contentType / disposition 由调用方决定（分享端点据此做 mime 白名单与 nosniff）；
 * 本函数统一兜底设置 X-Content-Type-Options: nosniff。
 */
export async function pipeAssetFile(
  res: Response,
  storageKey: string,
  opts: { contentType: string; disposition: 'inline' | 'attachment'; name: string },
): Promise<void> {
  const abs = resolveSafe(storageKey)
  const stat = await fs.stat(abs)
  res.setHeader('Content-Type', opts.contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `${opts.disposition}; filename="${encodeURIComponent(opts.name)}"`)
  res.setHeader('Content-Length', String(stat.size))
  const stream = createReadStream(abs)
  stream.on('error', () => {
    if (!res.writableEnded) res.end()
  })
  stream.pipe(res)
}
