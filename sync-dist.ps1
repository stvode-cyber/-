# AIE dev one-click sync
# ---------------------------------------------------------------------------
# Electron 平铺架构铁律:
#   frontend/dist  ->  electron/resources/frontend        (平铺, 与 build-desktop + electron-builder extraResources 对齐)
#   backend/dist   ->  electron/resources/backend/dist    (保留 dist 子目录)
# main.cjs getFrontendPath() DEV/PKG 均指向 resources/frontend 根目录
# If you edit source without syncing these two, Electron runs stale code!
#
# Usage:
#   .\sync-dist.ps1               # Full: build FE + BE, sync, verify
#   .\sync-dist.ps1 -FrontendOnly # Build + sync frontend only
#   .\sync-dist.ps1 -BackendOnly  # Build + sync backend only
#   .\sync-dist.ps1 -SyncOnly     # Sync only (skip build)
#   .\sync-dist.ps1 -DryRun       # Preview, no changes
#   .\sync-dist.ps1 -SkipVerify   # Skip verification report at the end
# ---------------------------------------------------------------------------

param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$SyncOnly,
    [switch]$DryRun,
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Paths
$FE_SRC = Join-Path $ProjectRoot 'frontend\dist'
$FE_DST = Join-Path $ProjectRoot 'electron\resources\frontend'   # 平铺到根目录 (与 build-desktop.cjs 对齐)
$BE_SRC = Join-Path $ProjectRoot 'backend\dist'
$BE_DST = Join-Path $ProjectRoot 'electron\resources\backend\dist'

function Step { param($m) Write-Host ''; Write-Host "==== $m ====" -ForegroundColor Cyan }
function OK   { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function WARN { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function FAIL { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }
function INFO { param($m) Write-Host "  ...   $m" -ForegroundColor DarkGray }

function Measure-FileTime($path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-ChildItem $path -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum
}

function Invoke-Sync($src, $dst, $label) {
    if (-not (Test-Path $src)) {
        FAIL "$label source not found: $src"
        exit 1
    }

    $srcTime = Measure-FileTime $src
    $dstTime = Measure-FileTime $dst

    if ($dstTime -and $srcTime -and $dstTime -ge $srcTime) {
        OK "$label already up-to-date ($($srcTime.ToString('HH:mm:ss')))"
        return
    }

    if ($DryRun) {
        WARN "[DryRun] Would sync $src -> $dst"
        return
    }

    INFO "Removing old $label dist..."
    Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $dst -Force | Out-Null

    INFO "Copying $label dist..."
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force

    $count = (Get-ChildItem $dst -Recurse -File).Count
    OK "$label synced ($count files)"
}

function Invoke-Build($dir, $label) {
    Push-Location $dir
    try {
        INFO "Running npm run build..."
        $prevErrAct = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & npm run build 2>$null | Out-Null
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevErrAct
        if ($exit -ne 0) {
            FAIL "$label build FAILED (exit=$exit)"
            Pop-Location
            exit 1
        }
        OK "$label build OK"
    } finally {
        Pop-Location
    }
}

function Show-Verification {
    Step "Verify: source vs build vs electron/resources"

    $checks = @(
        @{ Name = 'Frontend'; Src = (Join-Path $ProjectRoot 'frontend\src'); Build = $FE_SRC; Res = $FE_DST },
        @{ Name = 'Backend';  Src = (Join-Path $ProjectRoot 'backend\src');  Build = $BE_SRC; Res = $BE_DST }
    )

    $allOk = $true
    foreach ($c in $checks) {
        $tSrc = Measure-FileTime $c.Src
        $tBld = Measure-FileTime $c.Build
        $tRes = Measure-FileTime $c.Res

        Write-Host ("  {0,-10} src={1}  build={2}  res={3}" -f `
            $c.Name, `
            $(if($tSrc){$tSrc.ToString('MM-dd HH:mm:ss')}else{'N/A'}), `
            $(if($tBld){$tBld.ToString('MM-dd HH:mm:ss')}else{'N/A'}), `
            $(if($tRes){$tRes.ToString('MM-dd HH:mm:ss')}else{'N/A'}))

        if ($tBld -lt $tSrc) { WARN  "$($c.Name): SOURCE NEWER than build - need rebuild"; $allOk = $false }
        if ($tRes -lt $tBld) { FAIL  "$($c.Name): BUILD NEWER than electron - need resync"; $allOk = $false }
        if ($tBld -ge $tSrc -and $tRes -ge $tBld) { OK "$($c.Name): all 3 layers consistent" }
    }

    if ($allOk) {
        Write-Host ''
        OK 'All green - Electron will run latest code.'
    }
}

# =========================================================================
# Main
# =========================================================================

Write-Host ''
Write-Host '  AIE Dev Sync (sync-dist.ps1)' -ForegroundColor Magenta
Write-Host '  Electron flat-dist sync guardian' -ForegroundColor Magenta
Write-Host '  FE: frontend/dist -> electron/resources/frontend (平铺)'
Write-Host '  BE: backend/dist  -> electron/resources/backend/dist'
Write-Host ''

# --- SyncOnly ---
if ($SyncOnly) {
    Step 'Sync only (skip build)'
    if (-not $BackendOnly) { Invoke-Sync $FE_SRC $FE_DST 'Frontend' }
    if (-not $FrontendOnly) { Invoke-Sync $BE_SRC $BE_DST 'Backend' }
    if (-not $SkipVerify) { Show-Verification }
    exit 0
}

# --- Build ---
if (-not $BackendOnly) {
    Step 'Building Frontend'
    Invoke-Build (Join-Path $ProjectRoot 'frontend') 'Frontend'
}

if (-not $FrontendOnly) {
    Step 'Building Backend'
    Invoke-Build (Join-Path $ProjectRoot 'backend') 'Backend'
}

# --- Sync to electron/resources ---
Step 'Syncing to electron/resources'
if (-not $BackendOnly) { Invoke-Sync $FE_SRC $FE_DST 'Frontend' }
if (-not $FrontendOnly) { Invoke-Sync $BE_SRC $BE_DST 'Backend' }

# --- Verify ---
if (-not $SkipVerify) { Show-Verification }

Write-Host ''
OK 'Done.'
