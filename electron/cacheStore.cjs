// 纯 fs 本地缓存层（不依赖 electron runtime，可独立 node 测试）
// 职责：把已下载的资产原文按 assetId 写入本地磁盘目录，并维护 index.json 索引，
// 供桌面端「离线可用」——已缓存资产断网时仍可从本地读取/预览。
const fs = require('fs')
const path = require('path')

// #11 修复：assetId 白名单——仅允许字母、数字、_-，长度 1-64
// 防止 ../../../Desktop/evil 这类路径穿越。
// 原型污染保留键（__proto__/constructor/prototype）虽由字符集允许，但显式拒绝：
// ① 与 line 8 注释承诺一致；② 纵深防御——若未来 readIndex 重构不再用 Object.create(null)，
//    这些键仍不会进入索引（避免污染普通对象的 [[Prototype]] 链）
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeAssetId(assetId) {
  if (typeof assetId !== 'string') return false
  if (!ASSET_ID_RE.test(assetId)) return false
  if (RESERVED_KEYS.has(assetId)) return false
  return true
}

function createCacheStore(cacheRoot) {
  const indexFile = path.join(cacheRoot, 'index.json')
  fs.mkdirSync(cacheRoot, { recursive: true })
  // 解析后的绝对根目录，用于后续路径前缀校验
  const cacheRootAbs = path.resolve(cacheRoot)

  function readIndex() {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      // 防原型污染：用 Object.create(null) 重建索引
      const idx = Object.create(null)
      if (raw && typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
          // 仅保留符合白名单的 assetId，过滤历史脏数据
          if (isSafeAssetId(k)) idx[k] = raw[k]
        }
      }
      return idx
    } catch {
      return Object.create(null)
    }
  }
  function writeIndex(idx) {
    fs.writeFileSync(indexFile, JSON.stringify(idx, null, 2))
  }
  // 文件名安全化，且强制落在 assetId 子目录内，杜绝路径穿越
  function safeName(name) {
    const n = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
    return n || 'file'
  }
  // #11 修复：解析最终路径并校验必须以 cacheRootAbs 为前缀
  function safeAssetDir(assetId) {
    const dir = path.resolve(cacheRootAbs, assetId)
    const rel = path.relative(cacheRootAbs, dir)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`非法 assetId 导致路径穿越: ${assetId}`)
    }
    return dir
  }

  return {
    root: cacheRootAbs,

    /** 写入一个资产的本地缓存，返回元信息；重复写入会覆盖 */
    cacheAsset(assetId, fileName, buffer) {
      // #11 修复：assetId 白名单校验，拦截路径穿越
      if (!isSafeAssetId(assetId)) {
        throw new Error(`非法 assetId: ${assetId}`)
      }
      const dir = safeAssetDir(assetId)
      fs.mkdirSync(dir, { recursive: true })
      const name = safeName(fileName)
      const filePath = path.join(dir, name)
      // 二次校验最终文件路径仍在 cacheRootAbs 内
      const fileRel = path.relative(cacheRootAbs, path.resolve(filePath))
      if (!fileRel || fileRel.startsWith('..') || path.isAbsolute(fileRel)) {
        throw new Error(`非法 fileName 导致路径穿越: ${fileName}`)
      }
      fs.writeFileSync(filePath, buffer)
      const stat = fs.statSync(filePath)
      const idx = readIndex()
      idx[assetId] = {
        fileName: name,
        originalName: fileName,
        size: stat.size,
        mtime: stat.mtimeMs,
        localPath: filePath,
        cachedAt: Date.now(),
      }
      writeIndex(idx)
      return idx[assetId]
    },

    /** 读取某资产的缓存元信息（不存在返回 null） */
    getCached(assetId) {
      if (!isSafeAssetId(assetId)) return null
      const idx = readIndex()
      return idx[assetId] || null
    },

    /** 读取某资产的缓存文件内容（Buffer），未缓存或损坏返回 null */
    readCached(assetId) {
      const meta = this.getCached(assetId)
      if (!meta) return null
      try {
        // 校验 localPath 仍在 cacheRootAbs 内（防止历史脏数据指向外部）
        const rel = path.relative(cacheRootAbs, path.resolve(meta.localPath))
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
        return fs.readFileSync(meta.localPath)
      } catch {
        return null
      }
    },

    /** 移除某资产的本地缓存，返回是否移除成功 */
    removeCached(assetId) {
      if (!isSafeAssetId(assetId)) return false
      const idx = readIndex()
      if (idx[assetId]) {
        try {
          // 仅删除已校验安全的 assetId 子目录（safeAssetDir 已做前缀校验）
          const dir = safeAssetDir(assetId)
          fs.rmSync(dir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
        delete idx[assetId]
        writeIndex(idx)
        return true
      }
      return false
    },

    /** 列出全部已缓存的 assetId */
    listCached() {
      return Object.keys(readIndex())
    },
  }
}

module.exports = { createCacheStore }

// ---- 独立运行入口（P1-4 解耦验证）：node cacheStore.cjs [--check <root>] | [--selftest] ----
// cacheStore 本就是纯 fs 模块（不依赖 electron runtime），此入口证明其可被独立 node 进程运行，
// 便于将来切壳（Tauri）或远程助手以 spawn/stdio 方式复用本地缓存能力。
if (require.main === module) {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    process.exit(runSelfTest() ? 0 : 1)
  }
  const os = require('os')
  const checkIdx = argv.indexOf('--check')
  const root = checkIdx !== -1 ? argv[checkIdx + 1] : path.join(os.tmpdir(), 'cache-check')
  const store = createCacheStore(root)
  const meta = store.cacheAsset('aid1', 't.txt', Buffer.from('hello'))
  console.log(JSON.stringify(meta, null, 2))
}

// 自测：5 项 happy path + 7 项安全攻击向量（路径穿越/原型污染/脏数据）
function runSelfTest() {
  const os = require('os')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-selftest-'))
  const rootAbs = path.resolve(root)
  const store = createCacheStore(root)
  const buf = Buffer.from('hello-world')

  // --- happy path ---
  const meta = store.cacheAsset('a1', 'doc.txt', buf)
  const got = store.getCached('a1')
  const read = store.readCached('a1')
  const removed = store.removeCached('a1')
  const after = store.getCached('a1')

  // --- 安全攻击向量 ---
  // 向量1：路径穿越 assetId 应抛错
  const tryThrow = (fn) => { try { fn(); return false } catch { return true } }
  const trav1 = tryThrow(() => store.cacheAsset('../../../etc/evil', 'x.txt', buf))
  const trav2 = tryThrow(() => store.cacheAsset('..', 'x.txt', buf))
  const trav3 = tryThrow(() => store.cacheAsset('a/b', 'x.txt', buf))
  // 向量2：原型污染保留键应抛错
  const proto1 = tryThrow(() => store.cacheAsset('__proto__', 'x.txt', buf))
  const proto2 = tryThrow(() => store.cacheAsset('constructor', 'x.txt', buf))
  // 向量3：readCached 防历史脏数据（index.json 指向 cacheRoot 外）
  const externalPath = path.join(os.tmpdir(), 'cache-selftest-external-secret.txt')
  fs.writeFileSync(externalPath, 'secret')
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ evilid: { fileName: 'e.txt', localPath: externalPath, size: 6, mtime: 0, cachedAt: 0 } }))
  const dirtyRead = store.readCached('evilid') // 应返回 null（localPath 在 cacheRoot 外）
  try { fs.unlinkSync(externalPath) } catch { /* noop */ }

  const checks = [
    ['happy: cacheAsset 返回元信息', !!meta && typeof meta.size === 'number' && meta.size === buf.length],
    ['happy: getCached 命中', !!got],
    ['happy: readCached 内容一致', !!read && read.toString() === 'hello-world'],
    ['happy: removeCached 成功', removed === true],
    ['happy: 移除后 getCached 为 null', after === null],
    ['安全: 路径穿越 assetId "../../../etc/evil" 被拒', trav1],
    ['安全: 路径穿越 assetId ".." 被拒', trav2],
    ['安全: 路径穿越 assetId "a/b" 被拒', trav3],
    ['安全: 原型污染 assetId "__proto__" 被拒', proto1],
    ['安全: 原型污染 assetId "constructor" 被拒', proto2],
    ['安全: readCached 拒绝指向外部的脏数据', dirtyRead === null],
  ]
  let pass = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
    if (ok) pass++
  }
  console.log(`自测结果: ${pass}/${checks.length}`)
  fs.rmSync(root, { recursive: true, force: true })
  return pass === checks.length
}
