param(
    [int]$RefreshSec = 300,
    [int]$RestartDelaySec = 5,
    [int]$MaxRestarts = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$ts] [DAEMON-LAUNCHER] $Message"
}

function Resolve-Node {
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeExe) {
        return "node"
    }

    throw "Node.js nao encontrado no PATH. Instale Node.js 18+ antes de iniciar o daemon."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $repoRoot "server.js"
$logDir = Join-Path $repoRoot "logs"
$logFile = Join-Path $logDir "codexmemory-daemon.log"

if (-not (Test-Path $serverPath)) {
    throw "Arquivo server.js nao encontrado em: $serverPath"
}

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$nodeCmd = Resolve-Node
$env:DAEMON_REFRESH_SEC = [string]$RefreshSec

Write-Log "Repositorio: $repoRoot"
Write-Log "Server: $serverPath"
Write-Log "Node: $nodeCmd"
Write-Log "RefreshSec: $RefreshSec"
Write-Log "Log: $logFile"

$restartCount = 0
while ($true) {
    Write-Log "Iniciando processo daemon..."
    & $nodeCmd $serverPath --mode daemon --refresh-sec $RefreshSec 2>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE
    $restartCount += 1

    Write-Log "Processo encerrado (exit=$exitCode)."

    if ($MaxRestarts -gt 0 -and $restartCount -ge $MaxRestarts) {
        Write-Log "MaxRestarts atingido ($MaxRestarts). Encerrando launcher."
        break
    }

    Write-Log "Reiniciando em $RestartDelaySec segundo(s)..."
    Start-Sleep -Seconds $RestartDelaySec
}
