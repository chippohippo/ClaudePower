# Builds the portable AimForge folder with a real double-click AimForge.exe.
#
# The exe is the stock .NET app host (Microsoft.NETCore.App.Host.win-x64, fetched from NuGet),
# stamped the same way the SDK does it: the placeholder string inside it is replaced with the
# managed assembly's file name, and the PE subsystem is flipped to GUI so no console appears.
#
#   .\package.ps1                      -> %USERPROFILE%\Desktop\AimForge\
#   .\package.ps1 -Dest D:\Apps\AimForge
param([string]$Dest = (Join-Path ([Environment]::GetFolderPath("Desktop")) "AimForge"))
$ErrorActionPreference = "Stop"
$b = $PSScriptRoot

& "$b\build.ps1" | Out-Null
if (-not (Test-Path "$b\out\AimForge.exe")) { throw "build did not produce out\AimForge.exe" }

$ah = Get-ChildItem "$b\apphost\pkg" -Recurse -Filter "apphost.exe" | Select-Object -First 1
if (-not $ah) { throw "apphost.exe not found - download Microsoft.NETCore.App.Host.win-x64 into apphost\pkg" }

New-Item -ItemType Directory -Force $Dest | Out-Null

# ---- 1. managed assembly goes in as AimForge.dll (same bytes the compiler produced) ----
Copy-Item "$b\out\AimForge.exe" "$Dest\AimForge.dll" -Force
Copy-Item "$b\out\AimForge.runtimeconfig.json" "$Dest\AimForge.runtimeconfig.json" -Force
Copy-Item "$b\presets.json" $Dest -Force
Copy-Item "$b\tuner.html" $Dest -Force
Get-ChildItem "$b\*.md" | Copy-Item -Destination $Dest -Force   # README + every feature note (XP_TOGGLES.md, CADENCE_LOCK.md, ...)
if (Test-Path "$b\evidence") { New-Item -ItemType Directory -Force "$Dest\evidence" | Out-Null; Copy-Item "$b\evidence\*" "$Dest\evidence\" -Force }
if (Test-Path "$b\aimforge.config.json") { Copy-Item "$b\aimforge.config.json" $Dest -Force }

# ---- 2. stamp the app host ----
$bytes = [IO.File]::ReadAllBytes($ah.FullName)
# The app-path placeholder is the FULL 64-char SHA-256 hex. The host also contains a different
# 32-char marker that begins with the same characters - searching for the short prefix stamps
# the wrong one and the host then looks for a file named after the untouched placeholder.
$ph = [Text.Encoding]::UTF8.GetBytes("c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2")
$idx = -1
for ($i = 0; $i -le $bytes.Length - $ph.Length; $i++) {
  $m = $true; for ($j = 0; $j -lt $ph.Length; $j++) { if ($bytes[$i+$j] -ne $ph[$j]) { $m = $false; break } }
  if ($m) { $idx = $i; break }
}
if ($idx -lt 0) { throw "placeholder not found in apphost.exe" }
$name = [Text.Encoding]::UTF8.GetBytes("AimForge.dll")
# Exactly what the SDK's HostWriter does: overwrite the 32-byte placeholder, NUL-padded to ITS
# length - never beyond it. (A first version zeroed 1024 bytes and corrupted adjacent static
# data in the host, which segfaulted before the runtime even loaded.)
if ($name.Length -ge $ph.Length) { throw "assembly name longer than the placeholder" }
for ($k = 0; $k -lt $ph.Length; $k++) { $bytes[$idx + $k] = 0 }
[Array]::Copy($name, 0, $bytes, $idx, $name.Length)

# PE: e_lfanew at 0x3C -> PE signature (4) + COFF header (20) -> optional header; Subsystem is at +68
$peOff = [BitConverter]::ToInt32($bytes, 0x3C)
$optOff = $peOff + 4 + 20
$subsysOff = $optOff + 68
$subsys = [BitConverter]::ToUInt16($bytes, $subsysOff)
if ($subsys -ne 2 -and $subsys -ne 3) { throw "unexpected PE subsystem $subsys" }
$bytes[$subsysOff] = 2; $bytes[$subsysOff + 1] = 0      # IMAGE_SUBSYSTEM_WINDOWS_GUI
[IO.File]::WriteAllBytes("$Dest\AimForge.exe", $bytes)

# ---- 3. convenience launchers for the headless modes ----
@"
@echo off
cd /d "%~dp0"
"%~dp0AimForge.exe" --doctor
pause
"@ | Out-File "$Dest\doctor.cmd" -Encoding ascii
@"
@echo off
cd /d "%~dp0"
"%~dp0AimForge.exe" --list
pause
"@ | Out-File "$Dest\list-presets.cmd" -Encoding ascii

Write-Host "packaged -> $Dest"
Get-ChildItem $Dest | Select-Object Name, Length | Format-Table -AutoSize
