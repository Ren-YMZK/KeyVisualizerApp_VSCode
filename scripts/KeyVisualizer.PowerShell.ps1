function Send-VisualizerCommandEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [string]$Endpoint = $env:KEY_VISUALIZER_ENDPOINT
    )

    if ([string]::IsNullOrWhiteSpace($Endpoint)) {
        $Endpoint = "http://127.0.0.1:43137/events"
    }

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return
    }

    $bodyObject = @{
        type    = "command.executed"
        id      = [guid]::NewGuid().ToString()
        command = $Command
    }

    $jsonBody = $bodyObject | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType "application/json" -Body $jsonBody | Out-Null
    }
    catch {
    }
}

$global:KeyVisualizerLastHistoryId = -1

function global:prompt {
    try {
        $lastHistory = Get-History -Count 1

        if ($lastHistory -and $lastHistory.Id -ne $global:KeyVisualizerLastHistoryId) {
            $global:KeyVisualizerLastHistoryId = $lastHistory.Id
            $commandLine = $lastHistory.CommandLine

            if (
                -not [string]::IsNullOrWhiteSpace($commandLine) -and
                $commandLine -ne "exit" -and
                $commandLine -notlike "Send-Visualizer*" -and
                $commandLine -notlike "Get-History*"
            ) {
                Send-VisualizerCommandEvent -Command $commandLine
            }
        }
    }
    catch {
    }

    "PS $($executionContext.SessionState.Path.CurrentLocation)> "
}