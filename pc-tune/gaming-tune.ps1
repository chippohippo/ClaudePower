<#
  gaming-tune.ps1 - safe Windows tweaks for smoother gaming.
  Run from an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File .\gaming-tune.ps1
  Use -ReportOnly to change nothing.
#>
param([switch]$ReportOnly)

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $ReportOnly) { Write-Warning "Run as Administrator (or use -ReportOnly)."; exit 1 }

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

if (-not $ReportOnly) {
    Section "Power plan"
    # Enable and select Ultimate Performance; fall back to High Performance.
    $ult = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
    $out = powercfg -duplicatescheme $ult 2>$null
    if ($out -match '([0-9a-f-]{36})') { powercfg -setactive $Matches[1]; "Ultimate Performance enabled." }
    else { powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; "High Performance enabled." }

    Section "Game Mode on, background capture off"
    New-Item -Path 'HKCU:\Software\Microsoft\GameBar' -Force | Out-Null
    Set-ItemProperty 'HKCU:\Software\Microsoft\GameBar' AutoGameModeEnabled 1 -Type DWord
    New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -Force | Out-Null
    Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' AppCaptureEnabled 0 -Type DWord
    Set-ItemProperty 'HKCU:\System\GameConfigStore' GameDVR_Enabled 0 -Type DWord -ErrorAction SilentlyContinue
    "Done."

    Section "Hardware-accelerated GPU scheduling"
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' HwSchMode 2 -Type DWord
    "Enabled (takes effect after reboot)."

    Section "Temp file cleanup"
    Remove-Item "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
    "User temp folder cleared."
}

Section "Top CPU/memory processes"
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name,
    @{n='RAM(MB)';e={[int]($_.WorkingSet64/1MB)}}, @{n='CPU(s)';e={[int]$_.CPU}} | Format-Table -AutoSize

Section "Startup apps (disable unneeded ones in Task Manager > Startup)"
Get-CimInstance Win32_StartupCommand | Select-Object Name, Location | Format-Table -AutoSize

Section "Disk free space"
Get-PSDrive -PSProvider FileSystem | Where-Object Used | ForEach-Object {
    $pct = [math]::Round($_.Free / ($_.Used + $_.Free) * 100)
    "{0}: {1} GB free ({2}%){3}" -f $_.Name, [int]($_.Free/1GB), $pct, $(if ($pct -lt 15) {'  <-- LOW'} else {''})
}

Section "RAM speed (should match your kit's rated speed; else enable XMP/EXPO in BIOS)"
Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,
    @{n='GB';e={$_.Capacity/1GB}}, Speed, ConfiguredClockSpeed | Format-Table -AutoSize

Section "GPU driver"
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate | Format-Table -AutoSize

Write-Host "`nFinished. Reboot to apply everything. For temps, use HWiNFO (keep CPU/GPU under ~90C)." -ForegroundColor Green
