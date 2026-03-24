function Send-VisualizerHttpEvent {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Body,

        [string]$Endpoint = $env:KEY_VISUALIZER_ENDPOINT
    )

    if ([string]::IsNullOrWhiteSpace($Endpoint)) {
        $Endpoint = "http://127.0.0.1:43137/events"
    }

    $jsonBody = $Body | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType "application/json" -Body $jsonBody | Out-Null
    }
    catch {
    }
}

function Send-VisualizerCommandEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return
    }

    $cwd = $executionContext.SessionState.Path.CurrentLocation.Path

    Send-VisualizerHttpEvent -Body @{
        type    = "command.executed"
        id      = [guid]::NewGuid().ToString()
        command = $Command
        cwd     = $cwd
    }
}

function Send-VisualizerCompletionEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Before,

        [Parameter(Mandatory = $true)]
        [string]$After
    )

    if ([string]::IsNullOrWhiteSpace($Before) -or [string]::IsNullOrWhiteSpace($After)) {
        return
    }

    if ($Before -eq $After) {
        return
    }

    Send-VisualizerHttpEvent -Body @{
        type   = "completion.accepted"
        id     = [guid]::NewGuid().ToString()
        before = $Before
        after  = $After
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

if (Get-Module -Name PSReadLine) {
    Set-PSReadLineKeyHandler -Key Tab -ScriptBlock {
        param($key, $arg)

        $before = $null
        $beforeCursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState(
            [ref]$before,
            [ref]$beforeCursor
        )

        [Microsoft.PowerShell.PSConsoleReadLine]::TabCompleteNext()

        $after = $null
        $afterCursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState(
            [ref]$after,
            [ref]$afterCursor
        )

        if (
            -not [string]::IsNullOrWhiteSpace($before) -and
            -not [string]::IsNullOrWhiteSpace($after) -and
            $before -ne $after
        ) {
            Send-VisualizerCompletionEvent -Before $before -After $after
        }
    }
}