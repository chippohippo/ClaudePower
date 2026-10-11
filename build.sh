#!/usr/bin/env bash
# Headless cloud/Linux build: compiles the same sources as build.ps1 and runs the selftests.
# Needs the .NET 8 SDK (apt: dotnet-sdk-8.0). WinForms reference assemblies and the OTD plugin reference
# are fetched from NuGet into .cache/. The window cannot run here; the selftests, --qc and --list can.
#   ./build.sh          build out-linux/AimForge.dll (+ AimForge.Filters.dll)
#   ./build.sh --test   build + --selftest + --qc
set -euo pipefail
b="$(cd "$(dirname "$0")" && pwd)"; cache="$b/.cache"; out="$b/out-linux"
mkdir -p "$cache" "$out"
fetch() { # id version -> dir
  local d="$cache/$1.$2"
  if [ ! -d "$d" ]; then curl -fsSL -o "$d.nupkg" "https://api.nuget.org/v3-flatcontainer/$1/$2/$1.$2.nupkg"; mkdir -p "$d"; (cd "$d" && unzip -qo "$d.nupkg"); rm "$d.nupkg"; fi
  echo "$d"
}
desk="$(fetch microsoft.windowsdesktop.app.ref 8.0.10)/ref/net8.0"
otd="$(fetch opentabletdriver.plugin 0.6.7)/lib/net8.0/OpenTabletDriver.Plugin.dll"
sdk="$(dirname "$(readlink -f "$(command -v dotnet)")")"
csc="$(ls -d "$sdk"/sdk/8.*/Roslyn/bincore/csc.dll | sort -V | tail -1)"
coreref="$(ls -d "$sdk"/packs/Microsoft.NETCore.App.Ref/8.*/ref/net8.0 | sort -V | tail -1)"
refs=(); for f in "$coreref"/*.dll; do refs+=("-r:$f"); done
for d in System.Windows.Forms System.Windows.Forms.Primitives System.Drawing.Common Microsoft.Win32.SystemEvents Accessibility System.Drawing; do
  [ -f "$desk/$d.dll" ] && refs+=("-r:$desk/$d.dll"); done
coh="$b/../CoherenceStabilizer/src/CoherenceCore.cs"; [ -f "$coh" ] || coh="$b/vendor/CoherenceCore.recovered.cs"
mapfile -t src < <(find "$b/src" -name '*.cs' | sort)
src+=("$b/plugin/GameFilterCore.cs" "$b/plugin/CadenceCore.cs" "$b/plugin/NibTwinCore.cs" "$coh")
dotnet "$csc" -target:exe -nologo -optimize+ -langversion:10 -nullable:enable -deterministic -nowarn:CA1416 \
  -out:"$out/AimForge.dll" "${refs[@]}" "${src[@]}"
dotnet "$csc" -target:library -nologo -optimize+ -langversion:10 -deterministic -nowarn:CA1416 \
  -out:"$out/AimForge.Filters.dll" "-r:$otd" "${refs[@]}" \
  "$b/plugin/GameFilterCore.cs" "$b/plugin/CadenceCore.cs" "$b/plugin/NibTwinCore.cs" "$b/plugin/AimForgeFilters.cs"
# NETCore.App only: the selftests never touch a WinForms type, so the desktop runtime is not needed to run them
echo '{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"8.0.0"}}}' > "$out/AimForge.runtimeconfig.json"
cp "$b/presets.json" "$out/"; [ -f "$b/tuner.html" ] && cp "$b/tuner.html" "$out/"
echo "built -> $out (stabilizer source: ${coh#$b/})"
if [ "${1:-}" = "--test" ]; then
  echo "=== --selftest ==="; dotnet "$out/AimForge.dll" --selftest
  echo "=== --qc ===";       dotnet "$out/AimForge.dll" --qc | tail -3
fi
