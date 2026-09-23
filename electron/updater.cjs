// 轻量自动更新（更新源走已有 frp 公网链路，零外网云依赖）
//   链路   = http://47.116.59.141:3900/updates → frp 隧道 → 本机 127.0.0.1:3900（remoteFileServer 公开静态目录）
//   更新源 = <userData>/updates/{manifest.json, frontend-dist.zip, backend-dist.zip, schema.prisma}
//   基线   = <resourcesRoot>/.version.json（updater 应用后写入，用于判断"有新版本吗"）
//   流程   = fetchRemote() 拉取清单+变更包 → applyIfNewer() 备份→解压→回滚兜底
//   使用   = 主进程启动时：先 fetchRemote(更新源)，再 applyIfNewer()；应用成功则 relaunch
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
// Windows 自带 bsdtar，可直接解压 zip（与发布脚本的 tar -a -cf 对应）
function unzip(zipPath, destDir) {
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const res = spawnSync("tar", ["-xf", zipPath, "-C", destDir], { windowsHide: true, stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}
// 带超时的 fetch（Electron 主进程内置 Node 22+，支持全局 fetch）
async function fetchWithTimeout(url, ms) {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

/**
 * createUpdater
 * @param {object} o
 * @param {string} o.resourcesRoot 资源根目录（打包: process.resourcesPath；开发: electron/resources）
 * @param {string} o.frontendTarget 前端 dist 解压目标（打包: resources/frontend；开发: resources/frontend/dist）
 * @param {string} o.backendDistTarget 后端 dist 解压目标（resources/backend/dist）
 * @param {string} o.backendRoot 后端根目录（resources/backend，用于 prisma CLI 与 schema 路径）
 * @param {string} o.userData 用户数据目录（更新缓存 userData/updates）
 * @param {boolean} o.isPackaged 是否打包模式
 */
function createUpdater({ resourcesRoot, frontendTarget, backendDistTarget, backendRoot, userData, isPackaged }) {
  const updatesDir = path.join(userData, "updates");
  const manifestPath = path.join(updatesDir, "manifest.json");
  const versionPath = path.join(resourcesRoot, ".version.json");
  const schemaFile = path.join(backendRoot, "prisma", "schema.prisma");
  const prismaCli = path.join(backendRoot, "node_modules", "prisma", "build", "index.js");

  function readManifest() {
    return readJson(manifestPath, null);
  }

  // 打包模式用 Electron 内置 node 跑脚本（ELECTRON_RUN_AS_NODE）
  function runNode(args, opts) {
    if (isPackaged) {
      return spawnSync(process.execPath, args, { ...opts, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    }
    return spawnSync("node", args, opts);
  }

  // 应用一个 part：备份旧 dist → 解压新 zip → 清理备份；失败回滚
  function applyPart(distDir, zipPath) {
    const bakDir = distDir + ".bak";
    fs.rmSync(bakDir, { recursive: true, force: true });
    if (fs.existsSync(distDir)) {
      try {
        fs.renameSync(distDir, bakDir);
      } catch {
        fs.rmSync(bakDir, { recursive: true, force: true });
        return false;
      }
    }
    if (!unzip(zipPath, distDir)) {
      // 回滚
      fs.rmSync(distDir, { recursive: true, force: true });
      if (fs.existsSync(bakDir)) fs.renameSync(bakDir, distDir);
      return false;
    }
    fs.rmSync(bakDir, { recursive: true, force: true });
    return true;
  }

  // 从远端（frp 公网链路）拉取 manifest 与变更包到更新源目录；已是最新则不动
  // 返回 { ok, reason?, latest?, changed?, changedParts? }
  async function fetchRemote(baseUrl) {
    const base = String(baseUrl || "").replace(/[\\/]+$/, "");
    if (!/^https?:\/\//.test(base)) return { ok: false, reason: "bad-url" };
    const manifestUrl = base + "/manifest.json";
    let res;
    try {
      res = await fetchWithTimeout(manifestUrl, 8000);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!res || !res.ok) return { ok: false, reason: "http-" + (res ? res.status : "?") };
    let remote = null;
    try {
      remote = await res.json();
    } catch {
      /* ignore */
    }
    if (!remote || !remote.parts) return { ok: false, reason: "bad-manifest" };

    const local = readJson(versionPath, null);
    const prev = (local && local.parts) || {};
    const parts = remote.parts;
    const changed = [];
    for (const k of ["frontend", "backend", "schema"]) {
      if (parts[k] && parts[k].sha256 && parts[k].sha256 !== prev[k]) changed.push(k);
    }
    if (!changed.length) return { ok: true, latest: String(remote.version || ""), changed: false };

    // 逐个下载并校验 sha256（与清单一致才落盘，防止损坏/篡改的包）
    for (const k of changed) {
      const name = k === "schema" ? "schema.prisma" : parts[k].zip;
      const url = base + "/" + encodeURIComponent(name);
      let d;
      try {
        d = await fetchWithTimeout(url, 120000);
      } catch {
        return { ok: false, reason: "dl-fail-" + k };
      }
      if (!d || !d.ok) return { ok: false, reason: "dl-http-" + k + "-" + (d ? d.status : "?") };
      let buf;
      try {
        buf = Buffer.from(await d.arrayBuffer());
      } catch {
        return { ok: false, reason: "dl-io-" + k };
      }
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (sha !== parts[k].sha256) return { ok: false, reason: "sha-" + k };
      fs.mkdirSync(updatesDir, { recursive: true });
      fs.writeFileSync(path.join(updatesDir, name), buf);
    }
    writeJson(manifestPath, remote);
    return { ok: true, latest: String(remote.version || ""), changed: true, changedParts: changed };
  }

  // 将更新源应用/覆盖到本地资源；幂等。返回 { applied, version, ...partChanged }
  function applyIfNewer() {
    const manifest = readManifest();
    if (!manifest || !manifest.parts) return { applied: false };
    const local = readJson(versionPath, null);
    const version = local || { version: "initial" };
    const prev = version.parts || {};
    const parts = manifest.parts;
    const out = { applied: false, version: manifest.version, frontend: false, backend: false, schema: false };
    const appliedParts = {};

    if (parts.frontend && parts.frontend.sha256 && parts.frontend.sha256 !== prev.frontend) {
      const zip = path.join(updatesDir, parts.frontend.zip);
      if (fs.existsSync(zip) && applyPart(frontendTarget, zip)) {
        out.frontend = true;
        appliedParts.frontend = parts.frontend.sha256;
      } else {
        appliedParts.frontend = prev.frontend;
      }
    } else {
      appliedParts.frontend = parts.frontend ? parts.frontend.sha256 : prev.frontend;
    }

    if (parts.backend && parts.backend.sha256 && parts.backend.sha256 !== prev.backend) {
      const zip = path.join(updatesDir, parts.backend.zip);
      if (fs.existsSync(zip) && applyPart(backendDistTarget, zip)) {
        out.backend = true;
        appliedParts.backend = parts.backend.sha256;
      } else {
        appliedParts.backend = prev.backend;
      }
    } else {
      appliedParts.backend = parts.backend ? parts.backend.sha256 : prev.backend;
    }

    if (parts.schema && parts.schema.sha256 && parts.schema.sha256 !== prev.schema) {
      const src = path.join(updatesDir, "schema.prisma");
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
        fs.copyFileSync(src, schemaFile);
        out.schema = true;
        appliedParts.schema = parts.schema.sha256;
      } else {
        appliedParts.schema = prev.schema;
      }
    } else {
      appliedParts.schema = parts.schema ? parts.schema.sha256 : prev.schema;
    }

    out.applied = out.frontend || out.backend || out.schema;
    if (out.applied) {
      version.version = manifest.version;
      version.parts = appliedParts;
      try {
        writeJson(versionPath, version);
      } catch (e) {
        console.warn("[updater] 写版本基线失败:", e.message);
      }
      // schema 变更 → 写标记：下次冷启动（后端未启动、无 DLL 锁）时重新生成 Prisma Client
      // 原因：应用更新时后端正在运行，query_engine-windows.dll.node 被锁定，原地 generate 会 EPERM
      if (out.schema) {
        const marker = path.join(updatesDir, ".prisma-regenerate");
        fs.writeFileSync(marker, String(Date.now()), "utf8");
        console.log("[updater] 已标记 Prisma Client 待重新生成（下次启动时执行）");
      }
      console.log(`[updater] ✅ 已应用更新包 v${manifest.version} frontend=${out.frontend} backend=${out.backend} schema=${out.schema}`);
    }
    return out;
  }

  // 是否存在"本地尚未应用"的待更新（不修改资源）
  function checkPending() {
    const manifest = readManifest();
    if (!manifest || !manifest.parts) return null;
    const local = readJson(versionPath, null);
    const prev = (local && local.parts) || {};
    const parts = manifest.parts;
    const pending = { frontend: false, backend: false, schema: false };
    let any = false;
    for (const k of ["frontend", "backend", "schema"]) {
      if (parts[k] && parts[k].sha256 && parts[k].sha256 !== prev[k]) {
        pending[k] = true;
        any = true;
      }
    }
    if (!any) return null;
    return { version: manifest.version, ...pending };
  }

  // 冷启动时（后端未运行）按标记重新生成 Prisma Client，成功后删标记
  function regeneratePrismaIfMarked() {
    const marker = path.join(updatesDir, ".prisma-regenerate");
    if (!fs.existsSync(marker)) return false;
    try {
      if (fs.existsSync(prismaCli)) {
        const r = runNode([prismaCli, "generate"], { cwd: backendRoot, windowsHide: true, stdio: "ignore" });
        console.log(`[updater] Prisma Client 重新生成 ${r.status === 0 ? "OK" : "失败 code=" + r.status}`);
      }
    } catch (e) {
      console.warn("[updater] Prisma Client 重新生成异常:", e.message);
    }
    fs.rmSync(marker, { force: true });
    return true;
  }

  return {
    fetchRemote,
    applyIfNewer,
    checkPending,
    regeneratePrismaIfMarked,
    getManifestPath: manifestPath,
    getUpdatesDir: updatesDir,
  };
}

module.exports = { createUpdater };