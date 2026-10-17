# Emberfall's static file server for Windows: nothing to install (Windows PowerShell 5.1 or
# PowerShell 7). Serves this folder on http://localhost:<port>/ to this computer only, takes the
# next port if that one's busy, and opens the start menu in your default browser. play.bat runs
# it; close its window to stop.
#
# A plain socket server (no admin rights or URL reservations needed). Browsers open sockets ahead
# of time and leave some idle, so it serves whichever connection has a request waiting and never
# blocks on a quiet one.

param([int]$Port = 8765, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$sep = [System.IO.Path]::DirectorySeparatorChar
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $root.EndsWith($sep)) { $root += $sep }
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.md' = 'text/markdown; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'; '.glb' = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'
  '.ogg' = 'audio/ogg'; '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'
}

# The first free port from $Port.
$listener = $null
foreach ($p in $Port..($Port + 19)) {
  try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p); $l.Start(); $listener = $l; $Port = $p; break } catch { }
}
if (-not $listener) { Write-Host "Emberfall: no free port from $Port to $($Port + 19)." -ForegroundColor Red; exit 1 }

$url = "http://localhost:$Port/start.html"
Write-Host ''
Write-Host "  Emberfall is running at $url" -ForegroundColor Yellow
Write-Host '  (this computer only; close this window to stop)'
Write-Host ''
if (-not $NoOpen) { Start-Process $url }

$ascii = [System.Text.Encoding]::ASCII
function Send($client, [int]$code, [string]$status, [string]$type, [byte[]]$body, [bool]$head) {
  $s = $client.GetStream()
  $h = $ascii.GetBytes("HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n")
  $s.Write($h, 0, $h.Length)
  if (-not $head -and $body.Length) { $s.Write($body, 0, $body.Length) }
  $s.Flush()
}

function Serve($client) {
  $s = $client.GetStream()
  $s.ReadTimeout = 3000
  # The request head (up to the blank line); only its first line matters.
  $buf = New-Object byte[] 16384
  $n = 0
  while ($n -lt $buf.Length) {
    $r = $s.Read($buf, $n, $buf.Length - $n)
    if ($r -le 0) { break }
    $n += $r
    if ($ascii.GetString($buf, 0, $n).Contains("`r`n`r`n")) { break }
  }
  $line = ($ascii.GetString($buf, 0, $n) -split "`r`n")[0]
  $parts = $line -split ' '
  if ($parts.Length -lt 2 -or ($parts[0] -ne 'GET' -and $parts[0] -ne 'HEAD')) { Send $client 405 'Method Not Allowed' 'text/plain' ([byte[]]@()) $false; return }
  $path = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
  if ($path.EndsWith('/')) { $path += 'index.html' }
  $file = [System.IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', $sep)))
  if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not [System.IO.File]::Exists($file)) {
    Send $client 404 'Not Found' 'text/plain; charset=utf-8' ($ascii.GetBytes('Not found')) ($parts[0] -eq 'HEAD'); return
  }
  $type = $types[[System.IO.Path]::GetExtension($file).ToLowerInvariant()]
  if (-not $type) { $type = 'application/octet-stream' }
  Send $client 200 'OK' $type ([System.IO.File]::ReadAllBytes($file)) ($parts[0] -eq 'HEAD')
}

# Connections waiting for their request: served as soon as one arrives, dropped when the browser
# closes them or after half a minute idle.
$waiting = New-Object System.Collections.ArrayList
try {
  while ($true) {
    while ($listener.Pending()) { $c = $listener.AcceptTcpClient(); $c.NoDelay = $true; [void]$waiting.Add(@{ c = $c; t = [DateTime]::UtcNow }) }
    $busy = $false
    for ($i = $waiting.Count - 1; $i -ge 0; $i--) {
      $w = $waiting[$i]; $c = $w.c
      try {
        if ($c.Available -gt 0) { $waiting.RemoveAt($i); $busy = $true; try { Serve $c } catch { } finally { $c.Close() } }
        elseif ($c.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead) -or ([DateTime]::UtcNow - $w.t).TotalSeconds -gt 30) { $waiting.RemoveAt($i); $c.Close() }
      } catch { $waiting.RemoveAt($i); try { $c.Close() } catch { } }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 2 }
  }
} finally { $listener.Stop() }
