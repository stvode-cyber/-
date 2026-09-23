// 自动更新发布脚本
// 用法: node publish-update.cjs [版本号]   （版本号缺省 = 时间戳，如 2026.9.2.1830）
// 流程:
//   1. 构建前后端（frontend: npm run build → dist；backend: tsc → dist）
//   2. 同步到 electron/resources（开发运行目标，避免"界面一直是旧版"大坑）
//   3. bsdtar 打 zip + sha256 → 写 manifest.json → 发布到 <userData>/updates
//      （该目录由 remoteFileServer 的 /updates 公开，经 frp 公网链路分发）
//   4. 写本地基线 electron/resources/.version.json（与本次发布一致 → 本机判定"无更新"）
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");       // APP-AIE
const FRONTEND = path.join(ROOT, "frontend");
const BACKEND = path.join(ROOT, "backend");
const RES = path.join(__dirname, "resources");    // electron/resources
const FRONT_DIST = path.join(RES, "frontend", "dist");
const BACK_DIST = path.join(RES, "backend", "dist");
const SCHEMA_SRC = path.join(BACKEND, "prisma", "schema.prisma");

// 默认版本：时间戳，如 2026.9.2.1830
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}
const version = process.argv[2] || nowStamp();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(" ")}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, windowsHide: true, timeout: 600000 });
  if (r.error) { console.error("执行失败:", r.error.message); process.exit(1); }
  if (r.status !== 0) { console.error(`构建失败 (exit ${r.status})`); process.exit(1); }
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// 用 bsdtar 打 zip（zip 内含 dist 内容，可直接解压到目标目录）
function zipDist(zipFile, dir) {
  fs.rmSync(zipFile, { force: true });
  const r = spawnSync("tar", ["-a", "-cf", zipFile, "-C", dir, "."], { windowsHide: true, stdio: "ignore", timeout: 300000 });
  if (r.status !== 0) { console.error(`打包失败: ${zipFile}`); process.exit(1); }
}

console.log(`=== 自动更新发布 v${version} ===`);

// 1. 构建
run(npm, ["run", "build"], FRONTEND);   // → frontend/dist
run(npm, ["run", "build"], BACKEND);    // → backend/dist

// 2. 同步到 electron/resources（开发运行目标）
console.log("→ 同步 frontend/backend dist 到 electron/resources ...");
copyDir(path.join(FRONTEND, "dist"), FRONT_DIST);
copyDir(path.join(BACKEND, "dist"), BACK_DIST);
fs.mkdirSync(path.dirname(SCHEMA_SRC), { recursive: true });
fs.mkdirSync(path.join(RES, "backend", "prisma"), { recursive: true });
fs.copyFileSync(SCHEMA_SRC, path.join(RES, "backend", "prisma", "schema.prisma"));

// 3. 打 zip + sha256
console.log("→ 打包更新包 ...");
const tmp = path.join(__dirname, ".publish-tmp");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const zipF = path.join(tmp, "frontend-dist.zip");
const zipB = path.join(tmp, "backend-dist.zip");
zipDist(zipF, FRONT_DIST);
zipDist(zipB, BACK_DIST);
const shaF = sha256File(zipF);
const shaB = sha256File(zipB);
const shaS = sha256File(SCHEMA_SRC);

// 4. manifest + 发布到用户数据目录（remoteFileServer /updates 静态供给，frp 公网链路分发）
const userData = path.join(process.env.APPDATA, "aie-desktop");
const publishDir = path.join(userData, "updates");
fs.mkdirSync(publishDir, { recursive: true });
fs.copyFileSync(zipF, path.join(publishDir, "frontend-dist.zip"));
fs.copyFileSync(zipB, path.join(publishDir, "backend-dist.zip"));
fs.copyFileSync(SCHEMA_SRC, path.join(publishDir, "schema.prisma"));
const manifest = {
  version,
  publishedAt: new Date().toISOString(),
  parts: {
    frontend: { zip: "frontend-dist.zip", sha256: shaF },
    backend: { zip: "backend-dist.zip", sha256: shaB },
    schema: { zip: "schema.prisma", sha256: shaS },
  },
};
fs.writeFileSync(path.join(publishDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

// 5. 本地基线（与本次发布相同 → 本机应用启动时判定"无更新"，不重复自更新）
const baseline = { version, parts: { frontend: shaF, backend: shaB, schema: shaS } };
fs.writeFileSync(path.join(RES, ".version.json"), JSON.stringify(baseline, null, 2), "utf8");

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n✅ 发布完成 v${version}`);
console.log(`   更新源目录: ${publishDir}`);
console.log(`   frontend=${shaF.slice(0, 8)} backend=${shaB.slice(0, 8)} schema=${shaS.slice(0, 8)}`);
console.log("   外部访问: http://47.116.59.141:3900/updates/manifest.json");