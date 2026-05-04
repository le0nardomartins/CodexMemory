param(
    [string]$TaskName = "CodexMemoryDaemon"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task removida com sucesso: $TaskName"
    exit 0
}
catch {
    Write-Warning "Falha ao remover com ScheduledTasks module. Tentando schtasks..."
}

& schtasks.exe /Delete /TN $TaskName /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Task nao encontrada ou sem permissao para remover: $TaskName"
    exit 1
}

Write-Host "Task removida com sucesso: $TaskName"
