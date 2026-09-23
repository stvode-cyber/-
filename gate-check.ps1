# AIE release gate check
# ---------------------------------------------------------------------------
# 发布启动闸 -- 7 项门禁 + 可选版本号锁定
#
# 核心检查：G3/G4 同时校验 DEV 层和 PKG 层，保证路径对齐：
#   FE build:  frontend/dist
#   FE DEV:    electron/resources/frontend                ← sync-dist.ps1 平铺 + main.cjs DEV 路径
#   FE PKG:    release-*/win-unpacked/resources/frontend  ← electron-builder extraResources 平铺
#   BE build:  backend/dist
#   BE DEV:    electron/resources/backend/dist
#   BE PKG:    release-*/win-unpacked/resources/backend/dist
#
# Usage:
#   .\gate-check.ps1                        # 自动从 package.json 推断版本号
#   .\gate-check.ps1 -ExpectedVersion 1.0.5 # 锁定期望版本号,不一致直接 FAIL
#   .\gate-check.ps1 -ReleaseDir "D:\mybuild"  # 自定义 release 目录(默认 electron\release-* 最新)
# ---------------------------------------------------------------------------

param(
    [string]$ExpectedVersion = '',
    [string]$ReleaseDir = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step { param($m) Write-Host ''; Write-Host "==== $m ====" -ForegroundColor Cyan }
function OK   { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function WARN { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function FAIL { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }
function INFO { param($m) Write-Host "  ...   $m" -ForegroundColor DarkGray }

$g_pass = 0
$g_fail = 0
$g_warn = 0

function Count-Result($ok) {
    if ($ok -eq $true) { $script:g_pass++ }
    elseif ($ok -eq $false) { $script:g_fail++ }
    else { $script:g_warn++ }
}

# 取目录下所有文件的最大 LastWriteTime，比单文件时间戳更稳健
function Measure-FileTime($path) {
    if (-not (Test-Path $path)) { return $null }
    $item = Get-Item $path
    if ($item.PSIsContainer) {
        $files = Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue
        if (-not $files -or $files.Count -eq 0) { return $item.LastWriteTime }
        return ($files | Measure-Object -Property LastWriteTime -Maximum).Maximum
    }
    return $item.LastWriteTime
}

# 比较源目录 vs 目标目录的文件时间戳。
# target 时间 >= source 时间 → OK；否则 FAIL。
# @param label   显示标签（如 "DEV FE" / "PKG FE"）
# @param srcPath 构建产物目录
# @param dstPath 部署目标目录
# @returns 是否同步
function Assert-TargetSynced($label, $srcPath, $dstPath) {
    if (-not (Test-Path $srcPath)) {
        FAIL "$label : source missing: $srcPath"
        return $false
    }
    if (-not (Test-Path $dstPath)) {
        FAIL "$label : target missing: $dstPath"
        return $false
    }
    $tSrc = Measure-FileTime $srcPath
    $tDst = Measure-FileTime $dstPath
    if (-not $tSrc -or -not $tDst) {
        FAIL "$label : cannot determine timestamps"
        return $false
    }
    if ($tDst -lt $tSrc) {
        FAIL "$label : STALE  (build=$($tSrc.ToString('HH:mm:ss'))  target=$($tDst.ToString('HH:mm:ss')))"
        return $false
    }
    OK "$label : synced  (build=$($tSrc.ToString('HH:mm:ss'))  target=$($tDst.ToString('HH:mm:ss')))"
    return $true
}

# =========================================================================
# Gather
# =========================================================================

Write-Host ''
Write-Host '  AIE Release Gate (gate-check.ps1)' -ForegroundColor Magenta
Write-Host '  7 gates | exit 0 only if ALL PASS' -ForegroundColor Magenta
Write-Host ''

# --- 1. Determine version from 3 package.json ---
$pkgFiles = @(
    (Join-Path $ProjectRoot 'electron\package.json'),
    (Join-Path $ProjectRoot 'frontend\package.json'),
    (Join-Path $ProjectRoot 'backend\package.json')
)

$versions = @{}
foreach ($f in $pkgFiles) {
    if (-not (Test-Path $f)) {
        FAIL "package.json not found: $f"
        exit 1
    }
    $name = Split-Path (Split-Path $f -Parent) -Leaf
    $v = (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $versions[$name] = $v
}

# Pick electron version as canonical
$canonical = $versions['electron']

if ($ExpectedVersion) {
    if ($canonical -ne $ExpectedVersion) {
        FAIL "Expected version=$ExpectedVersion but electron package.json=$canonical"
        exit 1
    }
}

INFO "Canonical version: $canonical"

# --- 2. Resolve release dir ---
if (-not $ReleaseDir) {
    $parent = Join-Path $ProjectRoot 'electron'
    $dirs = Get-ChildItem $parent -Directory | Where-Object { $_.Name -like 'release-*' } | Sort-Object LastWriteTime -Descending
    if (-not $dirs) {
        FAIL "No release-* dir under electron\"
        exit 1
    }
    $ReleaseDir = $dirs[0].FullName
}

INFO "Release dir: $ReleaseDir"

# =========================================================================
# Gates
# =========================================================================

# ---------- G1: 3 package.json version aligned ----------
Step 'G1: version alignment across 3 package.json'

$g1_ok = $true
foreach ($kv in $versions.GetEnumerator()) {
    $isMatch = ($kv.Value -eq $canonical)
    if ($isMatch) {
        OK "$($kv.Key) = $($kv.Value)"
    } else {
        FAIL "$($kv.Key) = $($kv.Value)  (expected $canonical)"
        $g1_ok = $false
    }
}
Count-Result $g1_ok

# ---------- G2: EXE artifacts exist and large enough ----------
Step 'G2: EXE artifacts present + size sanity (> 150 MB)'

$g2_ok = $true
$setup = Get-ChildItem $ReleaseDir -Filter "*-Setup-$canonical.exe" | Select-Object -First 1
$portable = Get-ChildItem $ReleaseDir -Filter "*-Portable-$canonical.exe" | Select-Object -First 1

foreach ($exe in @($setup, $portable)) {
    if (-not $exe) {
        FAIL "Missing $canonical EXE in $ReleaseDir (Setup or Portable)"
        $g2_ok = $false
        continue
    }
    $mb = [math]::Round($exe.Length / 1MB, 1)
    if ($exe.Length -lt 150MB) {
        FAIL "$($exe.Name) = $mb MB  (too small, expected > 150 MB)"
        $g2_ok = $false
    } else {
        OK "$($exe.Name) = $mb MB"
    }
}
Count-Result $g2_ok

# ---------- G3: FE dist -> electron/resources + PKG 双路径 ----------
Step 'G3: FE dist <= DEV res + PKG res'

$feBldDir = Join-Path $ProjectRoot 'frontend\dist'
$feDevRes = Join-Path $ProjectRoot 'electron\resources\frontend'              # DEV/PKG 统一平铺到根目录
$fePkgRes = Join-Path $ReleaseDir 'win-unpacked\resources\frontend'

$g3a_ok = Assert-TargetSynced 'DEV FE'  $feBldDir $feDevRes
$g3b_ok = Assert-TargetSynced 'PKG FE'  $feBldDir $fePkgRes
Count-Result ($g3a_ok -and $g3b_ok)

# ---------- G4: BE dist -> electron/resources + PKG 双路径 ----------
Step 'G4: BE dist <= DEV res + PKG res'

$beBldDir = Join-Path $ProjectRoot 'backend\dist'
$beDevRes = Join-Path $ProjectRoot 'electron\resources\backend\dist'
$bePkgRes = Join-Path $ReleaseDir 'win-unpacked\resources\backend\dist'   # PKG 保留 dist 子目录

$g4a_ok = Assert-TargetSynced 'DEV BE'  $beBldDir $beDevRes
$g4b_ok = Assert-TargetSynced 'PKG BE'  $beBldDir $bePkgRes
Count-Result ($g4a_ok -and $g4b_ok)

# ---------- G5: cloud-jwt-public.pem exists ----------
Step 'G5: cloud-jwt-public.pem present (cloud activation)'

$pem = Join-Path $ProjectRoot 'electron\resources\backend\cloud-jwt-public.pem'
if (Test-Path $pem) {
    OK "cloud-jwt-public.pem exists"
    Count-Result $true
} else {
    WARN "cloud-jwt-public.pem missing -- local activation OK, cloud activation broken"
    Count-Result $null  # warn, non-blocking for internal test
}

# ---------- G6: prisma/dev.db has data ----------
Step 'G6: prisma/dev.db has data (> 1 MB)'

$db = Join-Path $ProjectRoot 'electron\resources\backend\prisma\dev.db'
$g6_ok = $true
if (-not (Test-Path $db)) {
    FAIL "prisma/dev.db not found at $db"
    $g6_ok = $false
} else {
    $mb = [math]::Round((Get-Item $db).Length / 1MB, 2)
    if ((Get-Item $db).Length -lt 1MB) {
        FAIL "dev.db = $mb MB (too small, seed or data migration needed)"
        $g6_ok = $false
    } else {
        OK "dev.db = $mb MB (data present)"
    }
}
Count-Result $g6_ok

# ---------- G7: EXE FileVersion matches package.json ----------
Step 'G7: EXE FileVersion matches canonical version'

$g7_ok = $true
foreach ($exe in @($setup, $portable)) {
    if (-not $exe) { continue }
    $fv = (Get-Item $exe.FullName).VersionInfo.FileVersion
    $pv = (Get-Item $exe.FullName).VersionInfo.ProductVersion
    # Normalize: strip trailing .0 segments that Windows drops
    $fvNorm = ($fv -split '\.')[0..2] -join '.'
    if ($fv -eq $canonical -or $fvNorm -eq $canonical) {
        OK "$($exe.Name)  FileVersion=$fv  ProductVersion=$pv"
    } else {
        FAIL "$($exe.Name)  FileVersion=$fv  (expected $canonical)"
        $g7_ok = $false
    }
}
Count-Result $g7_ok

# =========================================================================
# Summary
# =========================================================================

Write-Host ''
Write-Host '=========================================' -ForegroundColor Magenta
Write-Host "  PASS: $g_pass   FAIL: $g_fail   WARN: $g_warn" -ForegroundColor Magenta
Write-Host '=========================================' -ForegroundColor Magenta

if ($g_fail -gt 0) {
    Write-Host ''
    FAIL "GATE NOT PASSED -- fix $g_fail issue(s) before release"
    exit 1
}

# --- Bonus: SHA256 for cloud sync ---
Write-Host ''
INFO "SHA256 hashes for cloud sync:"
foreach ($exe in @($setup, $portable)) {
    if (-not $exe) { continue }
    $h = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash
    Write-Host "  $($exe.Name)" -ForegroundColor DarkGray
    Write-Host "    SHA256: $h" -ForegroundColor DarkGray
}

Write-Host ''
OK "ALL GATES PASSED -- v$canonical is clear to release."
exit 0
