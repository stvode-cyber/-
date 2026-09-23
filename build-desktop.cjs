// 桌面端打包脚本
// 流程：
//   1. 构建前端 → electron/resources/frontend/
//   2. 构建后端 → electron/resources/backend/
//   3. 安装后端生产依赖 → electron/resources/backend/node_modules/
//   4. 复制 Prisma schema + 引擎
//   5. 安装 Electron 依赖
//   6. electron-builder 打包 exe
//
// 用法：node build-desktop.cjs [--skip-frontend] [--skip-backend] [--pack-only]

// TODO: [Electron 双 dist 鬼影 bug] 预防：改 frontend/backend 源码后必须 build + 同步到 electron/resources/{frontend,backend}/dist 才能在 Electron App 里生效；开发态用 sync-dist.ps1，打包态由本脚本自动执行 build+sync 步骤

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const ELECTRON_DIR = path.join(ROOT, 'electron');
const RESOURCES_DIR = path.join(ELECTRON_DIR, 'resources');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const BACKEND_DIR = path.join(ROOT, 'backend');

// 颜色输出
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg, color = c.cyan) {
  console.log(`${color}[${new Date().toLocaleTimeString()}]${c.reset} ${msg}`);
}

function run(cmd, options = {}) {
  log(`> ${cmd}`, c.yellow);
  // 注入 Electron 镜像源（避免 GitHub 下载失败）
  const env = {
    ...process.env,
    ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  };
  execSync(cmd, {
    stdio: 'inherit',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    env,
    ...options,
  });
}

function copyDir(src, dest, excludes = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const items = fs.readdirSync(src);
  for (const item of items) {
    if (excludes.includes(item)) continue;
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath, excludes);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

// 解析参数
const args = process.argv.slice(2);
const skipFrontend = args.includes('--skip-frontend');
const skipBackend = args.includes('--skip-backend');
const packOnly = args.includes('--pack-only');

async function main() {
  log('=== 桌面端打包开始 ===', c.green);

  // 仅在重新构建前端/后端时清理 resources 目录
  if (!skipFrontend || !skipBackend) {
    log('清理 resources 目录...');
    rmrf(RESOURCES_DIR);
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  } else {
    log('保留 resources 目录（跳过构建）', c.yellow);
  }

  // ---- 1. 构建前端 ----
  if (!skipFrontend) {
    log('=== [1/6] 构建前端 ===', c.green);
    run(`npm install`, { cwd: FRONTEND_DIR });
    run(`npx vite build`, { cwd: FRONTEND_DIR });

    const frontendDest = path.join(RESOURCES_DIR, 'frontend');
    log(`复制前端 dist → ${frontendDest}`);
    copyDir(path.join(FRONTEND_DIR, 'dist'), frontendDest);
  } else {
    log('跳过前端构建', c.yellow);
  }

  // ---- 2. 构建后端 ----
  if (!skipBackend) {
    log('=== [2/6] 构建后端 ===', c.green);
    run(`npm install`, { cwd: BACKEND_DIR });
    run(`npx prisma generate`, { cwd: BACKEND_DIR });
    run(`npx tsc`, { cwd: BACKEND_DIR });

    const backendDest = path.join(RESOURCES_DIR, 'backend');
    log(`复制后端 dist + prisma + package.json → ${backendDest}`);

    // 复制 dist
    copyDir(path.join(BACKEND_DIR, 'dist'), path.join(backendDest, 'dist'));
    // 复制 prisma 目录（schema.prisma + 种子脚本）
    copyDir(path.join(BACKEND_DIR, 'prisma'), path.join(backendDest, 'prisma'));
    // 复制 package.json
    fs.copyFileSync(path.join(BACKEND_DIR, 'package.json'), path.join(backendDest, 'package.json'));
    // 复制 .env.example 作为默认配置（实际运行时由 Electron 注入环境变量）
    if (fs.existsSync(path.join(BACKEND_DIR, '.env.example'))) {
      fs.copyFileSync(path.join(BACKEND_DIR, '.env.example'), path.join(backendDest, '.env.example'));
    }
    // TODO: [打包版心跳500] 预防：必须复制 cloud-jwt-public.pem（云端 RSA 公钥），main.cjs 检测到才会走 cloud-proxy 模式；缺失则自动降级 local
    const publicKey = path.join(BACKEND_DIR, 'cloud-jwt-public.pem');
    if (fs.existsSync(publicKey)) {
      fs.copyFileSync(publicKey, path.join(backendDest, 'cloud-jwt-public.pem'));
      log('  ✓ cloud-jwt-public.pem 已复制', c.green);
    } else {
      log('  ⚠ cloud-jwt-public.pem 不存在！打包版将降级 AUTH_MODE=local，无法连通云端身份源', c.yellow);
    }

    // ---- 3. 安装后端生产依赖 ----
    log('=== [3/6] 安装后端生产依赖 ===', c.green);
    // 使用 --omit=dev 安装生产依赖到 backend 目录
    run(`npm install --omit=dev`, { cwd: backendDest });
    // 重新生成 Prisma 客户端（确保 node_modules 中的引擎存在）
    log('重新生成 Prisma 客户端...');
    // 把 prisma 从 devDependencies 临时挪到 dependencies
    const pkgPath = path.join(backendDest, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.devDependencies && pkg.devDependencies.prisma) {
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies.prisma = pkg.devDependencies.prisma;
      delete pkg.devDependencies.prisma;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
    run(`npx prisma generate`, { cwd: backendDest });
  } else {
    log('跳过后端构建', c.yellow);
  }

  // ---- 4. 验证目录结构 ----
  log('=== [4/6] 验证目录结构 ===', c.green);
  const checks = [
    path.join(RESOURCES_DIR, 'frontend', 'index.html'),
    path.join(RESOURCES_DIR, 'backend', 'dist', 'index.js'),
    path.join(RESOURCES_DIR, 'backend', 'prisma', 'schema.prisma'),
    path.join(RESOURCES_DIR, 'backend', 'node_modules', '@prisma', 'client'),
  ];
  for (const p of checks) {
    if (!fs.existsSync(p)) {
      log(`❌ 缺失: ${p}`, c.red);
      process.exit(1);
    } else {
      log(`✅ ${path.relative(RESOURCES_DIR, p)}`);
    }
  }

  // ---- 5. 安装 Electron 依赖 ----
  log('=== [5/6] 安装 Electron 依赖 ===', c.green);
  run(`npm install`, { cwd: ELECTRON_DIR });

  // ---- 6. electron-builder 打包 ----
  log('=== [6/6] electron-builder 打包 ===', c.green);
  const buildCmd = packOnly ? `npm run pack` : `npm run dist:win`;
  run(buildCmd, { cwd: ELECTRON_DIR });

  log('=== ✅ 打包完成 ===', c.green);
  log(`输出目录: ${path.join(ELECTRON_DIR, 'release')}`, c.green);
}

main().catch((err) => {
  console.error(`${c.red}❌ 打包失败:${c.reset}`, err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
