<#
.SYNOPSIS
  Seed a new Windows desktop release into the cloud backend (prod.db -> windows_releases table).

.DESCRIPTION
  One-click release seeding after SCP-ing EXEs to nginx. Auto-discovers EXEs from the
  latest release-* dir, computes SHA256 locally, SSH-es to server, upserts via Prisma,
  then verifies with public HTTPS API.

.PARAMETER Version
  Version string like "1.0.6" (required).

.PARAMETER Server
  SSH target. Default: "root@47.116.59.141"

.PARAMETER BackendDir
  Backend dir on server. Default: "/root/backend"

.PARAMETER PublicBase
  Public URL prefix for download links. Default: "https://47.116.59.141/apk"

.PARAMETER ForceUpdate
  If set, marks this release as force-update (client must update).

.PARAMETER Notes
  Release notes (Markdown). Default: "vX.Y.Z release"

.EXAMPLE
  .\seed-windows-release.ps1 -Version 1.0.6

.EXAMPLE
  .\seed-windows-release.ps1 -Version 1.0.7 -ForceUpdate -Notes "Critical bugfix"
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$Version,

  [string]$Server      = "root@47.116.59.141",
  [string]$BackendDir  = "/root/backend",
  [string]$PublicBase  = "https://47.116.59.141/apk",
  [string]$Notes       = "",
  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
$PROJ = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Seed Windows Release v$Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Locate EXEs ---
Write-Host "[1/5] Locating EXEs..." -ForegroundColor Yellow
$relDir = Get-ChildItem "$PROJ\electron" -Directory |
  Where-Object { $_.Name -like "release-*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $relDir) { Write-Host "FAIL: no release-* dir found" -ForegroundColor Red; exit 1 }

$setup = Get-ChildItem $relDir.FullName -Filter "*Setup-$Version.exe" | Select-Object -First 1
$portable = Get-ChildItem $relDir.FullName -Filter "*Portable-$Version.exe" | Select-Object -First 1

if (-not $setup) { Write-Host "FAIL: Setup-$Version.exe not found in $($relDir.Name)" -ForegroundColor Red; exit 1 }

$setupSizeMB = [math]::Round($setup.Length / 1MB, 1)
$setupSha    = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToUpper()
$portableSha = if ($portable) { (Get-FileHash $portable.FullName -Algorithm SHA256).Hash.ToUpper() } else { "" }
$portableUrl = if ($portable) { "$PublicBase/$($portable.Name)" } else { $null }

Write-Host "  Setup   : $($setup.Name)  $setupSizeMB MB"
Write-Host "  SHA256  : $setupSha"
if ($portable) { Write-Host "  Portable: $($portable.Name)" }
Write-Host ""

# --- Step 2: Generate seed JS on the fly ---
Write-Host "[2/5] Preparing seed script..." -ForegroundColor Yellow
if (-not $Notes) { $Notes = "v$Version release (gate 7/7)" }
$force = if ($ForceUpdate) { "true" } else { "false" }

$seedJs = @"
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  await prisma.windowsRelease.updateMany({ data: { isLatest: false } })
  const r = await prisma.windowsRelease.upsert({
    where: { version: '$Version' },
    update: { isLatest: true },
    create: {
      version: '$Version',
      isLatest: true,
      sizeMB: $setupSizeMB,
      setupUrl: '$PublicBase/$($setup.Name)',
      portableUrl: $(if ($portableUrl) { "'$portableUrl'" } else { "null" }),
      setupSha256: '$setupSha',
      notes: '$Notes',
      forceUpdate: $force,
    },
  })
  console.log('SEEDED', r.version, 'isLatest=' + r.isLatest, 'sizeMB=' + r.sizeMB)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await prisma.`$disconnect() })
"@

$tmpSeed = Join-Path $env:TEMP "seed-win-$Version.mjs"
[System.IO.File]::WriteAllText($tmpSeed, $seedJs, [System.Text.UTF8Encoding]::new($false))

# --- Step 3: SCP + execute on server ---
Write-Host "[3/5] Uploading to server..." -ForegroundColor Yellow
scp $tmpSeed "$Server`:$BackendDir/seed-win-$Version.mjs" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: scp failed" -ForegroundColor Red; exit 1 }

Write-Host "[4/5] Executing seed..." -ForegroundColor Yellow
$seedOut = ssh $Server "cd $BackendDir && node seed-win-$Version.mjs 2>&1" 2>&1
Write-Host "  $seedOut"
if ($seedOut -notmatch "SEEDED") { Write-Host "FAIL: seed did not complete" -ForegroundColor Red; exit 1 }

# --- Step 4: Verify via public API ---
Write-Host "[5/5] Verifying public HTTPS API..." -ForegroundColor Yellow
$apiUrl = "https://47.116.59.141/api/v1/app/windows-version?current=0.0.1"
try {
  $resp = curl.exe -sk $apiUrl 2>&1 | ConvertFrom-Json
  if ($resp.code -eq 200 -and $resp.data.version -eq $Version) {
    Write-Host "  API OK: version=$($resp.data.version)  hasUpdate=$($resp.data.hasUpdate)  sha256=$($resp.data.setupSha256)" -ForegroundColor Green
    if ($resp.data.setupSha256 -ne $setupSha) {
      Write-Host "  WARN: SHA256 mismatch between local and API!" -ForegroundColor Red
    } else {
      Write-Host "  SHA256 match OK" -ForegroundColor Green
    }
  } else {
    Write-Host "  FAIL: API returned unexpected data" -ForegroundColor Red
    Write-Host "  $($resp | ConvertTo-Json -Compress)"
    exit 1
  }
} catch {
  Write-Host "  FAIL: could not reach public API - $_" -ForegroundColor Red
  exit 1
}

# Cleanup
Remove-Item $tmpSeed -Force -ErrorAction SilentlyContinue
ssh $Server "rm -f $BackendDir/seed-win-$Version.mjs" 2>&1 | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  v$Version SEEDED OK" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
