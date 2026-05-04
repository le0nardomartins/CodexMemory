param(
    [string]$TaskName = "CodexMemoryDaemon"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName

    Write-Host "TaskName: $TaskName"
    Write-Host "State: $($task.State)"
    Write-Host "LastRunTime: $($taskInfo.LastRunTime)"
    Write-Host "LastTaskResult: $($taskInfo.LastTaskResult)"
    Write-Host "NextRunTime: $($taskInfo.NextRunTime)"
    exit 0
}
catch {
    Write-Warning "Falha ao consultar via ScheduledTasks module. Tentando schtasks..."
}

$query = Start-Process -FilePath "schtasks.exe" `
    -ArgumentList @("/Query", "/TN", $TaskName, "/V", "/FO", "LIST") `
    -NoNewWindow `
    -Wait `
    -PassThru `
    -RedirectStandardOutput "$env:TEMP\codexmemory_schtasks_status.txt"
if ($query.ExitCode -ne 0) {
    Write-Host "Task nao encontrada: $TaskName"
    exit 1
}

Get-Content "$env:TEMP\codexmemory_schtasks_status.txt"
