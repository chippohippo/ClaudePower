# Portable build for AimForge. Reuses the CoherenceStabilizer project's NuGet-fetched Roslyn, so
# no .NET SDK is required - only the .NET 8 runtime + WindowsDesktop runtime already on this box.
#
#   .\build.ps1            build AimForge.exe into .\out
#   .\build.ps1 -Test      build + run --selftest, --list, --doctor, --apply feather --dry-run
#   .\build.ps1 -Shot      build + render a screenshot of the main window to out\screenshot.png
param([switch]$Test, [switch]$Shot)
$ErrorActionPreference = "Stop"
$b = $PSScriptRoot
$csc = "$b\..\CoherenceStabilizer\roslyn\tasks\netcore\bincore\csc.dll"
if (-not (Test-Path $csc)) { throw "Roslyn not found at $csc - the sibling CoherenceStabilizer folder holds the toolchain" }

function Pick-Framework($name) {
  Get-ChildItem "C:\Program Files\dotnet\shared\$name" -Directory |
    Where-Object { $_.Name -match '^8\.' -and (Get-ChildItem $_.FullName -Filter *.dll | Measure-Object).Count -gt 5 } |
    Sort-Object { [version]($_.Name -replace '-.*$','') } -Descending | Select-Object -First 1
}
$core = Pick-Framework "Microsoft.NETCore.App"
$desk = Pick-Framework "Microsoft.WindowsDesktop.App"
if (-not $core -or -not $desk) { throw "need .NET 8 NETCore.App and WindowsDesktop.App runtimes" }
Write-Host "core: $($core.Name)   desktop: $($desk.Name)"

$native = '^(api-ms|Microsoft\.DiaSymReader|mscordaccore|mscordbi|msquic|clrjit|clrgc|clretwrc|mscorrc|coreclr|hostpolicy|hostfxr|System\.IO\.Compression\.Native|D3DCompiler|PenImc|PresentationNative|vcruntime|wpfgfx|Microsoft\.VisualBasic\.Forms)'
$refs = @()
Get-ChildItem $core.FullName -Filter *.dll | Where-Object { $_.Name -notmatch $native } | ForEach-Object { $refs += "-r:$($_.FullName)" }
foreach ($d in @("System.Windows.Forms.dll","System.Windows.Forms.Primitives.dll","System.Drawing.Common.dll","Microsoft.Win32.SystemEvents.dll","Accessibility.dll")) {
  $p = Join-Path $desk.FullName $d; if (Test-Path $p) { $refs += "-r:$p" }
}

New-Item -ItemType Directory -Force "$b\out" | Out-Null
# GameFilterCore is compiled into BOTH the app (selftests drive the shipping math) and the plugin.
# The Coherence Stabilizer's core is compiled in too (2026-09-24): the Nib Twin lab and the moving-tap selftests drive the
# SHIPPING pin into the SHIPPING Cadence core.
$src = @(Get-ChildItem "$b\src" -Recurse -Filter *.cs | ForEach-Object { $_.FullName }) + @("$b\plugin\GameFilterCore.cs","$b\plugin\CadenceCore.cs","$b\plugin\NibTwinCore.cs","$b\..\CoherenceStabilizer\src\CoherenceCore.cs")
& dotnet $csc (@("-target:winexe","-nologo","-optimize+","-langversion:10","-nullable:enable","-deterministic",
  "-out:$b\out\AimForge.exe") + $refs + $src)
if ($LASTEXITCODE -ne 0) { throw "build failed" }

# ---- AimForge.Filters OTD plugin (session 3): library against the OTD reference assembly ----
$otdRef = "$b\..\CoherenceStabilizer\otd\lib\net8.0\OpenTabletDriver.Plugin.dll"
if (Test-Path $otdRef) {
  & dotnet $csc (@("-target:library","-nologo","-optimize+","-langversion:10","-deterministic",
    "-out:$b\out\AimForge.Filters.dll","-r:$otdRef") + $refs + @("$b\plugin\GameFilterCore.cs","$b\plugin\CadenceCore.cs","$b\plugin\NibTwinCore.cs","$b\plugin\AimForgeFilters.cs"))
  if ($LASTEXITCODE -ne 0) { throw "plugin build failed" }
  $plugDest = "D:\Pen\userdata\Plugins\AimForge Game Filters"
  New-Item -ItemType Directory -Force $plugDest | Out-Null
  $newHash = (Get-FileHash "$b\out\AimForge.Filters.dll").Hash
  $oldHash = if (Test-Path "$plugDest\AimForge.Filters.dll") { (Get-FileHash "$plugDest\AimForge.Filters.dll").Hash } else { "" }
  if ($newHash -ne $oldHash) {
    Copy-Item "$b\out\AimForge.Filters.dll" $plugDest -Force
    Copy-Item "$b\plugin\metadata.json" $plugDest -Force
    (Get-Item "$plugDest\AimForge.Filters.dll").LastWriteTime = Get-Date   # the install time is what the daemon-freshness check compares
    Write-Host "plugin installed -> $plugDest (restart the OTD daemon to load it: AimForge tray > Restart OTD daemon, or AimForge --daemon-restart)"
  } else { Write-Host "plugin unchanged" }
} else { Write-Host "OTD reference assembly not found - plugin skipped" }

@"
{"runtimeOptions":{"tfm":"net8.0","frameworks":[{"name":"Microsoft.NETCore.App","version":"8.0.0"},{"name":"Microsoft.WindowsDesktop.App","version":"8.0.0"}],"configProperties":{"System.GC.Concurrent":false,"System.GC.Server":false,"System.Runtime.TieredPGO":true}}}
"@ | Out-File "$b\out\AimForge.runtimeconfig.json" -Encoding utf8
Copy-Item "$b\presets.json" "$b\out\" -Force
if (Test-Path "$b\tuner.html") { Copy-Item "$b\tuner.html" "$b\out\" -Force }
if (Test-Path "$b\aimforge.config.json") { Copy-Item "$b\aimforge.config.json" "$b\out\" -Force }
Write-Host ("built: {0:N0} bytes -> out\AimForge.exe" -f (Get-Item "$b\out\AimForge.exe").Length)

# per-install state (engine/mouse/xp mode, nib calibration, the last-apply record) belongs to the deployed folder, not the dev tree: a stale copy
# in out\ made every -Test doctor report false mouse-mirror FAILs (2026-09-24 review)
if ($Test -or $Shot) { Remove-Item "$b\out\engine.txt","$b\out\mouse.txt","$b\out\xp.txt","$b\out\nibtwin.json","$b\out\lastapply.json","$b\out\tps.txt" -ErrorAction SilentlyContinue }
if ($Test) {
  Write-Host "`n=== --selftest ==="; & dotnet "$b\out\AimForge.exe" --selftest; if ($LASTEXITCODE -ne 0) { throw "selftest failed" }
  Write-Host "`n=== --list ===";     & dotnet "$b\out\AimForge.exe" --list
  Write-Host "`n=== --doctor ===";   & dotnet "$b\out\AimForge.exe" --doctor
  Write-Host "`n=== --apply feather --dry-run ==="; & dotnet "$b\out\AimForge.exe" --apply feather --dry-run
}
if ($Shot) {
  & dotnet "$b\out\AimForge.exe" --screenshot "$b\out\screenshot.png"
  Write-Host "screenshot -> out\screenshot.png"
}
