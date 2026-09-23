// 头部解耦集成校验（无显示 / 无 electron.asar 也能跑）
// 验证 P1-4：main.cjs 的 dam:scanFolder IPC 处理器实际调用的就是
//   const { scan } = require('./agent/collectorAgent.cjs'); scan(folderPath, { max: 5000 })
// 这里用与运行时完全一致的调用路径，确认 agent→collector→classify 链路在 Node 主进程语境下工作。
//
// 用法: node integration-check.cjs   (exit 0 = 通过)

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, classify, USE_SPAWN } = require('./agent/collectorAgent.cjs');
const { scanFolder, classifyByExt } = require('./collector.cjs');

function makeFixture(root) {
  const files = {
    'a.pdf': 'document',
    'b.png': 'image',
    'c.mp3': 'audio',
    'd.mp4': 'video',
    'e.xyz': 'ignore', // 非关注扩展名，应被过滤
    'sub/f.txt': 'document', // 递归
    'sub/nested/g.jpg': 'image', // 深层递归
  };
  for (const [rel, _] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
  return files;
}

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg);
}

async function main() {
  // 1) 模式确认：当前为 in-process，等价于直接 require collector（与 main.cjs 注释一致）
  assert(USE_SPAWN === false, '当前应为 in-process 模式（USE_SPAWN=false）');

  // 2) classify 单一入口与底层一致
  assert(classify('photo.png') === classifyByExt('photo.png'), 'classify 应与 classifyByExt 等价');

  // 3) 构造临时素材并走 agent 层 scan（与 IPC 处理器同签名）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aie-int-'));
  try {
    makeFixture(root);
    const list = await scan(root, { max: 5000 });

    // 预期：a.pdf / b.png / c.mp3 / d.mp4 / sub/f.txt / sub/nested/g.jpg = 6，
    // e.xyz 被过滤
    assert(list.length === 6, `应扫描到 6 个资产，实际 ${list.length}: ${list.map((x) => x.name).join(',')}`);

    // 注意: collector 返回的 name 是 basename（如 f.txt, g.jpg），递归后仍用 basename 作 key
    const byName = Object.fromEntries(list.map((x) => [x.name, x.type]));
    assert(byName['a.pdf'] === 'document', 'a.pdf 应为 document');
    assert(byName['b.png'] === 'image', 'b.png 应为 image');
    assert(byName['c.mp3'] === 'audio', 'c.mp3 应为 audio');
    assert(byName['d.mp4'] === 'video', 'd.mp4 应为 video');
    assert(byName['f.txt'] === 'document', '深层递归 sub/f.txt 应为 document');
    assert(byName['g.jpg'] === 'image', '深层递归 sub/nested/g.jpg 应为 image');
    assert(!('e.xyz' in byName), 'e.xyz 应被过滤');

    // 4) 与直接 require collector.cjs 结果一致（验证解耦行为等价）
    // collector 返回字段为 path/name/ext/type/size/mtime（无 id），以 path 集合比较
    const direct = await scanFolder(root, { max: 5000 });
    assert(direct.length === list.length, 'agent.scan 与 collector.scanFolder 数量应一致');
    const samePaths = JSON.stringify(list.map((x) => x.path).sort()) ===
      JSON.stringify(direct.map((x) => x.path).sort());
    assert(samePaths, 'agent.scan 与 collector.scanFolder 的资产 path 集合应一致');

    console.log('✅ 集成校验通过 (agent→collector→classify):');
    console.log(`   - 模式: in-process (USE_SPAWN=${USE_SPAWN})`);
    console.log(`   - 扫描资产: ${list.length} 个 (e.xyz 已过滤)`);
    console.log(`   - 分类: ${Object.entries(byName).map(([k, v]) => k + '=' + v).join(', ')}`);
    console.log(`   - 与 collector.scanFolder 结果一致: ${samePaths}`);
    return true;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ 集成校验失败:', e.message);
    process.exit(1);
  });
