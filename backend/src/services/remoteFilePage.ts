/**
 * 手机端 H5 页面（远程文件访问）
 *
 * 由 remoteFileServer 直接输出，无需打包、无外部依赖。
 * 结构：解锁屏（访问码）→ 文件浏览 + 上传 + AI 找文件
 * 风格：白底简洁，与 PC 端审美一致
 */

export function buildRemotePageHTML(code: string): string {
  // 访问码不预填进 HTML（避免未授权者从页面源码直接看到），仅用于长度提示；
  // 实际码由用户在 PC 设置页查看后手动输入。扫码场景用 #code=xxx 自动填充。
  void code
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>绿角犀 · 电脑文件</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif; background:#f5f6f8; color:#1f2937; min-height:100vh; }
  .hidden { display:none !important; }

  /* 解锁屏 */
  #lock { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  #lock .logo { font-size:44px; margin-bottom:8px; }
  #lock h1 { font-size:18px; font-weight:600; color:#374151; margin-bottom:4px; }
  #lock p { font-size:13px; color:#9ca3af; margin-bottom:28px; }
  #codeInput { width:220px; border:none; border-bottom:2px solid #d1d5db; outline:none; text-align:center;
    font-size:28px; letter-spacing:10px; padding:8px 0; text-transform:uppercase; background:transparent; }
  #codeInput:focus { border-color:#6366f1; }
  #lockBtn { margin-top:28px; width:220px; padding:12px; border:none; border-radius:12px; background:#6366f1;
    color:#fff; font-size:15px; font-weight:500; }
  #lockBtn:active { background:#4f46e5; }
  #lockErr { margin-top:14px; font-size:13px; color:#ef4444; min-height:18px; }

  /* 主界面 */
  #app { display:flex; flex-direction:column; min-height:100vh; }
  header { position:sticky; top:0; z-index:10; background:#fff; border-bottom:1px solid #f0f0f0; padding:14px 16px; }
  header .row { display:flex; align-items:center; gap:8px; }
  header .title { font-size:16px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  header .crumb { font-size:12px; color:#9ca3af; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .icon-btn { border:none; background:none; padding:6px; border-radius:8px; font-size:17px; cursor:pointer; }
  .icon-btn:active { background:#f3f4f6; }

  #tabs { display:flex; background:#fff; border-bottom:1px solid #f0f0f0; position:sticky; top:59px; z-index:9; }
  #tabs button { flex:1; padding:10px; border:none; background:none; font-size:14px; color:#9ca3af; }
  #tabs button.on { color:#6366f1; font-weight:600; border-bottom:2px solid #6366f1; }

  main { flex:1; padding:12px; }
  .card { background:#fff; border-radius:12px; margin-bottom:10px; overflow:hidden; }
  .item { display:flex; align-items:center; gap:12px; padding:13px 14px; border-bottom:1px solid #f6f6f6; cursor:pointer; }
  .item:last-child { border-bottom:none; }
  .item:active { background:#f9fafb; }
  .item .ic { font-size:22px; width:28px; text-align:center; flex-shrink:0; }
  .item .nm { flex:1; min-width:0; }
  .item .nm .n1 { font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item .nm .n2 { font-size:11px; color:#9ca3af; margin-top:2px; }
  .item .dl { border:none; background:#eef2ff; color:#4f46e5; font-size:12px; padding:6px 12px; border-radius:8px; flex-shrink:0; text-decoration:none; }
  .tip { text-align:center; color:#9ca3af; font-size:13px; padding:40px 0; }

  /* AI 面板 */
  #aiPane { display:flex; flex-direction:column; height:calc(100vh - 108px); }
  #aiLog { flex:1; overflow-y:auto; padding:12px; }
  .msg { max-width:82%; margin-bottom:10px; padding:10px 12px; border-radius:12px; font-size:14px; line-height:1.5; white-space:pre-wrap; word-break:break-all; }
  .msg.me { background:#6366f1; color:#fff; margin-left:auto; border-bottom-right-radius:4px; }
  .msg.ai { background:#fff; border-bottom-left-radius:4px; }
  .msg .f { display:block; margin-top:8px; padding:8px 10px; background:#f3f4f6; border-radius:8px; font-size:12px; color:#374151; }
  .msg .f a { color:#4f46e5; text-decoration:none; font-weight:500; }
  #aiBar { display:flex; gap:8px; padding:10px 12px 20px; background:#fff; border-top:1px solid #f0f0f0; }
  #aiInput { flex:1; border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; }
  #aiInput:focus { border-color:#6366f1; }
  #aiSend { border:none; background:#6366f1; color:#fff; border-radius:10px; padding:0 16px; font-size:14px; }
  #aiSend:disabled { background:#c7d2fe; }

  /* 上传 */
  #upPane { padding:16px; }
  #upPane .card { padding:20px; text-align:center; }
  #upTarget { font-size:14px; color:#374151; margin-bottom:16px; }
  #upBtn { display:block; width:100%; padding:13px; border:1.5px dashed #c7d2fe; border-radius:12px;
    background:#eef2ff50; color:#4f46e5; font-size:14px; text-align:center; }
  #upBar { margin-top:14px; font-size:12px; color:#6b7280; display:none; }
  #upDone { margin-top:10px; font-size:13px; color:#10b981; display:none; }
</style>
</head>
<body>

<!-- 解锁屏 -->
<div id="lock">
  <div class="logo">🦏</div>
  <h1>绿角犀 · 电脑文件</h1>
  <p>输入电脑上显示的 6 位访问码</p>
  <input id="codeInput" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="······">
  <button id="lockBtn">解锁</button>
  <div id="lockErr"></div>
</div>

<!-- 主界面 -->
<div id="app" class="hidden">
  <header>
    <div class="row">
      <button class="icon-btn" id="backBtn">‹</button>
      <div class="title" id="curTitle">电脑文件</div>
      <button class="icon-btn" id="tabFiles">📂</button>
    </div>
    <div class="crumb" id="crumb"></div>
  </header>

  <div id="tabs">
    <button id="tBrowse" class="on">文件</button>
    <button id="tAi">AI 找文件</button>
    <button id="tUpload">上传</button>
  </div>

  <main>
    <!-- 浏览 -->
    <div id="browsePane">
      <div id="roots" class="card"></div>
      <div id="list" class="card"></div>
      <div id="empty" class="tip hidden">空目录</div>
    </div>

    <!-- AI -->
    <div id="aiPane" class="hidden">
      <div id="aiLog">
        <div class="msg ai">我是电脑文件助手。想找什么直接说，比如"找一下合同"、"看下载目录"。</div>
      </div>
      <div id="aiBar">
        <input id="aiInput" placeholder="想找什么文件？">
        <button id="aiSend">发送</button>
      </div>
    </div>

    <!-- 上传 -->
    <div id="upPane" class="hidden">
      <div class="card">
        <div id="upTarget">上传到：选择目标目录</div>
        <button id="pickDir">选择目录</button>
        <button id="upBtn">＋ 选择要上传的文件</button>
        <div id="upBar">上传中… <span id="upPct"></span></div>
        <div id="upDone"></div>
      </div>
      <input type="file" id="fileInput" class="hidden">
    </div>
  </main>
</div>

<script>
var TOKEN = localStorage.getItem('aie_remote_token') || '';
var curDir = '';       // 当前目录（空 = 根，显示授权目录列表）
var upDir = '';        // 上传目标目录
var history = [];      // 目录栈

function api(method, url, body, raw) {
  var opt = { method: method, headers: { 'Authorization': 'Bearer ' + TOKEN } };
  if (body && !raw) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (body && raw) { opt.body = body; opt.headers['Content-Type'] = 'application/octet-stream'; }
  return fetch(url, opt).then(function (r) {
    if (r.status === 401) { localStorage.removeItem('aie_remote_token'); location.reload(); throw new Error('令牌失效'); }
    return r.json();
  });
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(iso) {
  var d = new Date(iso);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fileIcon(name) {
  var ext = name.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','gif','webp'].indexOf(ext) >= 0) return '🖼️';
  if (['mp4','mov','avi'].indexOf(ext) >= 0) return '🎬';
  if (['mp3','wav','m4a'].indexOf(ext) >= 0) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['doc','docx'].indexOf(ext) >= 0) return '📘';
  if (['xls','xlsx','csv'].indexOf(ext) >= 0) return '📗';
  if (['ppt','pptx'].indexOf(ext) >= 0) return '📙';
  if (['zip','rar','7z'].indexOf(ext) >= 0) return '🗜️';
  if (['txt','md'].indexOf(ext) >= 0) return '📄';
  return '📄';
}

// ---------- 解锁 ----------
var codeFromHash = (location.hash.match(/code=([A-Z0-9]{6})/i) || [])[1];
if (codeFromHash) document.getElementById('codeInput').value = codeFromHash.toUpperCase();

document.getElementById('lockBtn').addEventListener('click', unlock);
document.getElementById('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });

function unlock() {
  var code = document.getElementById('codeInput').value.trim().toUpperCase();
  var err = document.getElementById('lockErr');
  err.textContent = '';
  fetch('/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok) { err.textContent = res.j.error || '访问码不对'; return; }
      TOKEN = res.j.token;
      localStorage.setItem('aie_remote_token', TOKEN);
      enterApp();
    })
    .catch(function () { err.textContent = '连接失败，确认电脑端已开启'; });
}

function enterApp() {
  document.getElementById('lock').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadDir('');
}

// 已有令牌直接进
if (TOKEN) {
  api('GET', '/api/roots').then(function (r) {
    if (r.ok) enterApp();
    else { localStorage.removeItem('aie_remote_token'); TOKEN = ''; }
  }).catch(function () {});
}

// ---------- 浏览 ----------
function loadDir(dir) {
  curDir = dir;
  var rootsEl = document.getElementById('roots');
  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  rootsEl.classList.add('hidden');
  listEl.innerHTML = '<div class="tip">加载中…</div>';
  listEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  if (!dir) {
    api('GET', '/api/roots').then(function (r) {
      if (!r.ok) { listEl.innerHTML = '<div class="tip">' + (r.error || '加载失败') + '</div>'; return; }
      document.getElementById('curTitle').textContent = '电脑文件';
      document.getElementById('crumb').textContent = '授权目录';
      history = [];
      document.getElementById('backBtn').style.visibility = 'hidden';
      if (!r.roots.length) { listEl.classList.add('hidden'); emptyEl.textContent = '没有授权目录'; emptyEl.classList.remove('hidden'); return; }
      listEl.innerHTML = r.roots.map(function (it) {
        return '<div class="item" onclick="loadDir(' + jsq(it.path) + ')"><div class="ic">📁</div><div class="nm"><div class="n1">' + esc(it.name) + '</div></div></div>';
      }).join('');
    });
    return;
  }

  api('GET', '/api/list?path=' + encodeURIComponent(dir)).then(function (r) {
    if (!r.ok) { listEl.innerHTML = '<div class="tip">' + (r.error || '加载失败') + '</div>'; return; }
    var name = dir.split(/[\\\\/]/).filter(Boolean).pop();
    document.getElementById('curTitle').textContent = name;
    document.getElementById('crumb').textContent = r.dir;
    document.getElementById('backBtn').style.visibility = history.length ? 'visible' : 'hidden';
    if (!r.items.length) { listEl.classList.add('hidden'); emptyEl.textContent = '空目录'; emptyEl.classList.remove('hidden'); return; }
    listEl.innerHTML = r.items.map(function (it) {
      if (it.isDir) {
        return '<div class="item" onclick="pushAndLoad(' + jsq(it.path) + ')"><div class="ic">📁</div><div class="nm"><div class="n1">' + esc(it.name) + '</div><div class="n2">' + fmtDate(it.mtime) + '</div></div></div>';
      }
      return '<div class="item"><div class="ic">' + fileIcon(it.name) + '</div><div class="nm"><div class="n1">' + esc(it.name) + '</div><div class="n2">' + fmtSize(it.size) + ' · ' + fmtDate(it.mtime) + '</div></div><a class="dl" href="/api/file?path=' + encodeURIComponent(it.path) + '">下载</a></div>';
    }).join('');
  });
}

function pushAndLoad(p) { history.push(curDir); loadDir(p); }
document.getElementById('backBtn').addEventListener('click', function () {
  var prev = history.pop();
  loadDir(prev || '');
});

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function jsq(s) { return JSON.stringify(s); }

// ---------- Tab 切换 ----------
var tabs = [['tBrowse', 'browsePane'], ['tAi', 'aiPane'], ['tUpload', 'upPane']];
tabs.forEach(function (t) {
  document.getElementById(t[0]).addEventListener('click', function () {
    tabs.forEach(function (x) {
      document.getElementById(x[0]).classList.toggle('on', x[0] === t[0]);
      document.getElementById(x[1]).classList.toggle('hidden', x[0] !== t[0]);
    });
  });
});

// ---------- AI ----------
document.getElementById('aiSend').addEventListener('click', sendAi);
document.getElementById('aiInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendAi(); });

function sendAi() {
  var input = document.getElementById('aiInput');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  var log = document.getElementById('aiLog');
  log.insertAdjacentHTML('beforeend', '<div class="msg me">' + esc(msg) + '</div>');
  log.scrollTop = log.scrollHeight;
  var btn = document.getElementById('aiSend');
  btn.disabled = true;
  api('POST', '/api/ai', { message: msg }).then(function (r) {
    btn.disabled = false;
    var html = '<div class="msg ai">' + esc(r.reply || (r.error || '出错了'));
    if (r.files && r.files.length) {
      r.files.forEach(function (f) {
        html += '<span class="f">' + fileIcon(f.name) + ' ' + esc(f.name) + '（' + fmtSize(f.size) + '）<br><a href="/api/file?path=' + encodeURIComponent(f.path) + '">下载</a></span>';
      });
    }
    html += '</div>';
    log.insertAdjacentHTML('beforeend', html);
    log.scrollTop = log.scrollHeight;
  }).catch(function () {
    btn.disabled = false;
    log.insertAdjacentHTML('beforeend', '<div class="msg ai">网络异常，再试一次</div>');
  });
}

// ---------- 上传 ----------
var dirPickerOpen = false;
document.getElementById('pickDir').addEventListener('click', function () {
  // 简易目录选择：弹出授权目录+浏览，复用当前浏览位置
  if (curDir) { upDir = curDir; document.getElementById('upTarget').textContent = '上传到：' + curDir; return; }
  alert('先在「文件」页进入一个目录，再回来上传');
});
document.getElementById('upBtn').addEventListener('click', function () {
  if (!upDir) { alert('先点「选择目录」指定上传位置'); return; }
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', function () {
  var f = this.files[0];
  if (!f) return;
  if (f.size > 200 * 1024 * 1024) { alert('文件超过 200MB 上限'); this.value = ''; return; }
  var bar = document.getElementById('upBar');
  var done = document.getElementById('upDone');
  bar.style.display = 'block';
  done.style.display = 'none';
  document.getElementById('upPct').textContent = '0%';

  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload?dir=' + encodeURIComponent(upDir));
  xhr.setRequestHeader('Authorization', 'Bearer ' + TOKEN);
  xhr.setRequestHeader('x-filename', encodeURIComponent(f.name));
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.upload.onprogress = function (e) {
    if (e.lengthComputable) document.getElementById('upPct').textContent = Math.round(e.loaded / e.total * 100) + '%';
  };
  xhr.onload = function () {
    bar.style.display = 'none';
    var res = {};
    try { res = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status === 200 && res.ok) {
      done.textContent = '✅ 已保存到电脑：' + res.saved;
      done.style.display = 'block';
    } else {
      alert(res.error || '上传失败');
    }
  };
  xhr.onerror = function () { bar.style.display = 'none'; alert('上传失败'); };
  xhr.send(f);
  this.value = '';
});

// 离开上传页时同步当前浏览目录
tabs.forEach(function (t) {
  document.getElementById(t[0]).addEventListener('click', function () {
    if (t[0] === 'tUpload' && curDir) { upDir = curDir; document.getElementById('upTarget').textContent = '上传到：' + curDir; }
  });
});
</script>
</body>
</html>`
}
