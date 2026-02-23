# Run WebDownloader: backend + frontend from project root.
# Usage: .\run.ps1   (no dependency installing - run pip/npm install first)
$ErrorActionPreference = "Stop"
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

$python = "python"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (Test-Path $venvPython) { $python = $venvPython }

function Test-PortOpen {
  param([int]$Port, [int]$TimeoutSeconds = 30)
  $end = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $end) {
    try {
      $c = New-Object System.Net.Sockets.TcpClient("127.0.0.1", $Port)
      $c.Close()
      return $true
    } catch { }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

Write-Host "Starting backend (port 8000)..." -ForegroundColor Cyan
$backendProcess = Start-Process -FilePath $python -ArgumentList @(
  "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"
) -WorkingDirectory $backendDir -PassThru `
  -RedirectStandardOutput (Join-Path $root "backend.log") `
  -RedirectStandardError (Join-Path $root "backend_err.log")

try {
  if ($backendProcess.HasExited) {
    Write-Host "Backend exited. Check backend_err.log" -ForegroundColor Red
    Get-Content (Join-Path $root "backend_err.log") -ErrorAction SilentlyContinue
    exit 1
  }
  Write-Host "Waiting for backend to be ready..." -ForegroundColor Cyan
  if (-not (Test-PortOpen -Port 8000 -TimeoutSeconds 25)) {
    Write-Host "Backend did not start in time. Check backend_err.log" -ForegroundColor Red
    if (Test-Path (Join-Path $root "backend_err.log")) {
      Get-Content (Join-Path $root "backend_err.log")
    }
    exit 1
  }
  Write-Host "Backend ready. Starting frontend (http://localhost:5173)..." -ForegroundColor Green
  Set-Location $frontendDir
  & npm run dev
} finally {
  if ($backendProcess -and !$backendProcess.HasExited) {
    Write-Host "Stopping backend..." -ForegroundColor Yellow
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
