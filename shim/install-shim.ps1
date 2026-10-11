# Replaces the stock OTD GUI exe with a shim that opens AimForge, and registers the daemon at
# login. Fully reversible: .\install-shim.ps1 -Undo
param([switch]$Undo)
$ErrorActionPreference = "Stop"
$b = Split-Path $PSScriptRoot
$pen = "D:\Pen"
$uxExe = Join-Path $pen "OpenTabletDriver.UX.Wpf.exe"
$uxOrig = Join-Path $pen "OpenTabletDriver.UX.Wpf.original.exe"
$shimDll = Join-Path $pen "AimForgeUxShim.dll"
$runKey = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"

if ($Undo) {
  if (Test-Path $uxOrig) { Remove-Item $uxExe -Force -ErrorAction SilentlyContinue; Move-Item $uxOrig $uxExe -Force }
  Remove-Item $shimDll -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $pen "AimForgeUxShim.runtimeconfig.json") -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKey -Name "AimForgeDaemon" -ErrorAction SilentlyContinue
  Write-Host "shim removed, original GUI restored, login entry deleted"
  exit 0
}

# ---- 1. build the shim assembly ----
$csc = "$b\..\CoherenceStabilizer\roslyn\tasks\netcore\bincore\csc.dll"
$core = Get-ChildItem "C:\Program Files\dotnet\shared\Microsoft.NETCore.App" -Directory |
  Where-Object { $_.Name -match '^8\.' -and (Test-Path (Join-Path $_.FullName "System.Runtime.dll")) } |
  Sort-Object { [version]($_.Name -replace '-.*$','') } -Descending | Select-Object -First 1
$native = '^(api-ms|Microsoft\.DiaSymReader|mscordaccore|mscordbi|msquic|clrjit|clrgc|clretwrc|mscorrc|coreclr|hostpolicy|hostfxr|System\.IO\.Compression\.Native)'
$refs = @(); Get-ChildItem $core.FullName -Filter *.dll | Where-Object { $_.Name -notmatch $native } | ForEach-Object { $refs += "-r:$($_.FullName)" }
& dotnet $csc (@("-target:winexe","-nologo","-optimize+","-deterministic","-out:$shimDll") + $refs + @("$PSScriptRoot\UxShim.cs"))
if ($LASTEXITCODE -ne 0) { throw "shim build failed" }
'{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"8.0.0"}}}' |
  Out-File (Join-Path $pen "AimForgeUxShim.runtimeconfig.json") -Encoding utf8

# ---- 2. stamp an app host for it (same procedure as AimForge.exe itself) ----
$ah = Get-ChildItem "$b\apphost\pkg" -Recurse -Filter "apphost.exe" | Select-Object -First 1
$bytes = [IO.File]::ReadAllBytes($ah.FullName)
$ph = [Text.Encoding]::UTF8.GetBytes("c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2")
$idx = -1
for ($i = 0; $i -le $bytes.Length - $ph.Length; $i++) {
  $m = $true; for ($j = 0; $j -lt $ph.Length; $j++) { if ($bytes[$i+$j] -ne $ph[$j]) { $m = $false; break } }
  if ($m) { $idx = $i; break }
}
if ($idx -lt 0) { throw "placeholder not found" }
$name = [Text.Encoding]::UTF8.GetBytes("AimForgeUxShim.dll")
for ($k = 0; $k -lt $ph.Length; $k++) { $bytes[$idx + $k] = 0 }
[Array]::Copy($name, 0, $bytes, $idx, $name.Length)
$peOff = [BitConverter]::ToInt32($bytes, 0x3C); $sub = $peOff + 24 + 68
$bytes[$sub] = 2; $bytes[$sub + 1] = 0

# ---- 3. swap: original aside (idempotent), shim in ----
if (-not (Test-Path $uxOrig)) { Move-Item $uxExe $uxOrig }
else { Remove-Item $uxExe -Force -ErrorAction SilentlyContinue }
[IO.File]::WriteAllBytes($uxExe, $bytes)

# ---- 4. daemon at login, via AimForge's silent --daemon-start (GUI exe = no console flash) ----
Set-ItemProperty -Path $runKey -Name "AimForgeDaemon" -Value "`"$env:USERPROFILE\Desktop\AimForge\AimForge.exe`" --daemon-start"

Write-Host "installed:"
Write-Host "  $uxExe  -> opens AimForge (original kept as .original.exe)"
Write-Host "  login   -> AimForge --daemon-start brings the daemon up silently"
