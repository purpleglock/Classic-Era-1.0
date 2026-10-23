# Классическая эра 1.0 — локальный сервер без установки чего-либо.
# Отдаёт файлы проекта на http://localhost:8000. Закройте окно, чтобы остановить.
param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
# Если порт занят — пробуем следующие.
for ($p = $Port; $p -lt $Port + 10; $p++) {
  try {
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add("http://localhost:$p/")
    $listener.Start()
    $Port = $p
    break
  } catch { $listener = New-Object System.Net.HttpListener }
}
if (-not $listener.IsListening) { Write-Host 'Не удалось занять порт 8000-8009.' -ForegroundColor Red; Read-Host 'Enter — закрыть'; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Классическая эра 1.0 — локальный сайт' -ForegroundColor Yellow
Write-Host "  Адрес: $url"
Write-Host '  Не закрывайте это окно, пока смотрите сайт.'
Write-Host ''
Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $path.StartsWith($root)) { $res.StatusCode = 403 }
    elseif (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
    if ($res.StatusCode -ne 403 -and (Test-Path $path -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      $res.Headers['Cache-Control'] = 'no-store'
      $bytes = [IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } elseif ($res.StatusCode -ne 403) {
      $res.StatusCode = 404
    }
    Write-Host ("  {0} {1}" -f $res.StatusCode, $ctx.Request.Url.AbsolutePath)
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
