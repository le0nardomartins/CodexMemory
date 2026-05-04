param(
    [string]$TaskName = "CodexMemoryDaemon",
    [int]$RefreshSec = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $repoRoot "scripts\start-daemon.ps1"

if (-not (Test-Path $launcherPath)) {
    throw "Launcher nao encontrado: $launcherPath"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`" -RefreshSec $RefreshSec"
$runCommand = "`"$psExe`" $psArgs"

try {
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $psArgs
    $triggerStartup = New-ScheduledTaskTrigger -AtStartup
    $triggerLogon = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -RestartCount 10 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger @($triggerStartup, $triggerLogon) `
        -Settings $settings `
        -Principal $principal `
        -Description "CodexMemory daemon autostart for AGENTS.md sync" `
        -Force | Out-Null

    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Task instalada com ScheduledTasks module: $TaskName"
}
catch {
    Write-Warning "Falha ao registrar com ScheduledTasks module. Tentando fallback com schtasks (ONLOGON)."

    & schtasks.exe /Create /TN $TaskName /SC ONLOGON /RL LIMITED /TR $runCommand /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar task com schtasks (exit=$LASTEXITCODE)."
    }

    & schtasks.exe /Run /TN $TaskName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Task criada, mas nao foi possivel iniciar agora (exit=$LASTEXITCODE)."
    }

    Write-Host "Task instalada com fallback schtasks: $TaskName"
}

Write-Host "Task instalada com sucesso: $TaskName"
Write-Host "Usuario: $currentUser"
Write-Host "Comando: $psExe $psArgs"
Write-Host "Use scripts/status-autostart.ps1 para verificar o estado."
