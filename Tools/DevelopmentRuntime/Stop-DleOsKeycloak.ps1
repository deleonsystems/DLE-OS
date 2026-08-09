[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Keycloak's kc.bat has no server-side `stop` command. This service owns the
# loopback-only 8180 listener, which gives the stop hook an exact process target
# without requiring system-wide process command-line inspection.
$listenerLines = @(netstat.exe -ano -p tcp |
    Select-String -Pattern '^\s*TCP\s+127\.0\.0\.1:8180\s+\S+\s+LISTENING\s+\d+\s*$')
$serverProcessIds = @($listenerLines |
    ForEach-Object { [int]((-split $_.Line)[-1]) } |
    Sort-Object -Unique)

if ($serverProcessIds.Count -gt 1) {
    throw "Refusing to stop Keycloak because $($serverProcessIds.Count) processes own its governed listener."
}

if ($serverProcessIds.Count -eq 1) {
    $serverProcessId = $serverProcessIds[0]
    Stop-Process -Id $serverProcessId -Force
    Wait-Process -Id $serverProcessId -Timeout 20 -ErrorAction SilentlyContinue
}

exit 0
