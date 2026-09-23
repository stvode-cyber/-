$exe = "c:\Users\Administrator\Desktop\助理项目\助理项目\APP-AIE\electron\release-v15\绿角犀-Portable-1.0.0.exe"
$script = "c:\Users\Administrator\Desktop\助理项目\助理项目\APP-AIE\backend\verify-template-abs.mjs"
$outFile = "c:\Users\Administrator\AppData\Local\Temp\verify-template-out.txt"
$errFile = "c:\Users\Administrator\AppData\Local\Temp\verify-template-err.txt"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = '"' + $script + '"'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
$psi.EnvironmentVariables['ELECTRON_DISABLE_SECURITY_WARNINGS'] = '1'
$psi.WorkingDirectory = "c:\Users\Administrator\Desktop\助理项目\助理项目\APP-AIE\backend"

$p = [System.Diagnostics.Process]::Start($psi)
$stdout = $p.StandardOutput.ReadToEnd()
$stderr = $p.StandardError.ReadToEnd()
$p.WaitForExit(60000) | Out-Null
$p.Kill()  # ensure cleanup if still running

$stdout | Out-File -FilePath $outFile -Encoding utf8
$stderr | Out-File -FilePath $errFile -Encoding utf8

Write-Output "EXIT_CODE: $($p.ExitCode)"
Write-Output "--- STDOUT ---"
Write-Output $stdout
Write-Output "--- STDERR ---"
Write-Output $stderr
