# Green Rhino AI Readiness Check - v3 (no Chinese literals)
# Run: powershell -ExecutionPolicy Bypass -File scripts\check-readiness.ps1

$ErrorActionPreference = "Continue"
$pass = 0
$fail = 0

function Check-Path {
    param([string]$Path, [string]$Label, [bool]$Required)
    $ok = [System.IO.File]::Exists($Path) -or [System.IO.Directory]::Exists($Path)
    if ($ok) { Write-Host "  [OK] $Label" -ForegroundColor Green; return $true }
    if ($Required) { Write-Host "  [FAIL] $Label -- MISSING!" -ForegroundColor Red; return $false }
    Write-Host "  [SKIP] $Label" -ForegroundColor DarkGray; return $null
}

$root = Split-Path -Parent $PSScriptRoot
Write-Host ""
Write-Host "==== Green Rhino AI Readiness Check ====" -ForegroundColor Cyan
Write-Host "Root: $root"

# Find Chinese-named files by pattern (avoids encoding issues)
$rootFiles = Get-ChildItem $root -File -ErrorAction SilentlyContinue
$progFile = $rootFiles | Where-Object { $_.Name -like "*8FDB*7A0B*8FDB*7A0B*.md" }
$dialogFile = $rootFiles | Where-Object { $_.Name -like "*5BF9*8BDD*5361*8BDD*5361*.md" }

# Fallback: use Unicode char codes
$progPath = Join-Path $root ([string][char]0x9879 + [char]0x76EE + [char]0x8FDB + [char]0x7A0B + ".md")
$dialogPath = Join-Path $root ([string][char]0x9879 + [char]0x76EE + [char]0x5BF9 + [char]0x8BDD + [char]0x5361 + ".md")

Write-Host ""
Write-Host "1) Core files" -ForegroundColor Yellow

$files = @(
    (Join-Path $root "AGENTS.md"), "AGENTS.md", $true,
    $progPath, "ProjectProgress.md (Iron Rule 21)", $true,
    $dialogPath, "ProjectDialogCard.md (Iron Rule 22)", $true,
    (Join-Path $root ".trae\memory\growth\handover.md"), "handover.md", $true,
    (Join-Path $root ".trae\memory\growth\secrets.md"), "secrets.md", $true,
    (Join-Path $root ".trae\memory\growth\INDEX.md"), "INDEX.md", $true
)

for ($i = 0; $i -lt $files.Count; $i += 3) {
    $r = Check-Path $files[$i] $files[$i+1] $files[$i+2]
    if ($r -eq $true) { $pass++ } elseif ($r -eq $false) { $fail++ }
}

Write-Host ""
Write-Host "2) Core SKILLs" -ForegroundColor Yellow
foreach ($sk in @("collab-25-rules", "secrets-sync-checklist", "work-growth-logger")) {
    $r = Check-Path (Join-Path $root ".trae\skills\$sk\SKILL.md") "SKILL: $sk" $true
    if ($r -eq $true) { $pass++ } elseif ($r -eq $false) { $fail++ }
}

Write-Host ""
Write-Host "3) Project version" -ForegroundColor Yellow
if ([System.IO.File]::Exists($progPath)) {
    $txt = [System.IO.File]::ReadAllText($progPath, [System.Text.Encoding]::UTF8)
    if ($txt -match "v(\d+)\.(\d+)") {
        Write-Host "  [OK] v$($Matches[1]).$($Matches[2])" -ForegroundColor Green; $pass++
    }
}

Write-Host ""
Write-Host "==== Summary ====" -ForegroundColor Cyan
Write-Host "  Pass: $pass  Fail: $fail"
if ($fail -eq 0) {
    Write-Host "  All checks passed!" -ForegroundColor Green; exit 0
} else {
    Write-Host "  $fail checks FAILED!" -ForegroundColor Red; exit 1
}
