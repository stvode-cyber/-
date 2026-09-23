// 采集能力解耦适配层（P1-4）
// 职责：作为"桌面 agent"与"采集核心 collector.cjs"之间的边界。
// - 当前默认 in-process 调用 collector.cjs（与 Electron 主进程内 require 行为等价，零回归）；
// - 预留 spawn 独立进程模式（COLLECTOR_AGENT_MODE=spawn）：将来切壳（Tauri）或远程助手
//   调用时，可改为 spawn 独立 node 进程并解析其 stdout JSON，无需改动核心扫描逻辑。
const { scanFolder, classifyByExt } = require('../collector.cjs')

const USE_SPAWN = process.env.COLLECTOR_AGENT_MODE === 'spawn'

async function scan(folderPath, opts = {}) {
  if (USE_SPAWN) {
    // TODO(spawn 模式): 经 child_process.spawn 调用 `node collector.cjs --scan <folder>` 并解析 stdout JSON
    throw new Error('spawn 模式尚未启用（COLLECTOR_AGENT_MODE=spawn）')
  }
  // in-process 模式：与主进程内 require 调用完全等价
  return scanFolder(folderPath, opts)
}

function classify(name) {
  return classifyByExt(name)
}

module.exports = { scan, classify, USE_SPAWN }
