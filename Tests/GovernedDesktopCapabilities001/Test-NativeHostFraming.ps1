[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $NativeHostExecutable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-NativeHostMessage {
    param(
        [Parameter(Mandatory)][string] $Origin,
        [Parameter(Mandatory)][hashtable] $Message
    )
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = [IO.Path]::GetFullPath($NativeHostExecutable)
    $start.Arguments = '"' + $Origin.Replace('"', '') + '"'
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        $payload = [Text.Encoding]::UTF8.GetBytes(($Message | ConvertTo-Json -Compress))
        $header = [BitConverter]::GetBytes([int]$payload.Length)
        $process.StandardInput.BaseStream.Write($header, 0, $header.Length)
        $process.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        $responseHeader = [byte[]]::new(4)
        $read = $process.StandardOutput.BaseStream.Read($responseHeader, 0, 4)
        if ($read -ne 4) { throw 'Native host did not return a complete frame header.' }
        $length = [BitConverter]::ToInt32($responseHeader, 0)
        if ($length -le 0 -or $length -gt 65536) { throw 'Native host returned an invalid frame length.' }
        $responseBytes = [byte[]]::new($length)
        $offset = 0
        while ($offset -lt $length) {
            $count = $process.StandardOutput.BaseStream.Read($responseBytes, $offset, $length - $offset)
            if ($count -eq 0) { throw 'Native host response frame ended early.' }
            $offset += $count
        }
        $process.WaitForExit(10000) | Out-Null
        [Text.Encoding]::UTF8.GetString($responseBytes) | ConvertFrom-Json
    } finally {
        if (-not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}

$validEnvelope = @{
    version = 1
    operation = 'open-drawing-folder'
    capability = 'dlecap1_' + ('A' * 43)
    correlationId = 'native-framing-qualification'
}
$unapproved = Invoke-NativeHostMessage `
    -Origin 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' `
    -Message $validEnvelope
if ($unapproved.success -ne $false -or $unapproved.category -ne 'UnapprovedExtension') {
    throw 'Unapproved extension origin was not rejected.'
}

$wrongOperation = @{} + $validEnvelope
$wrongOperation.operation = 'run-command'
$rejectedOperation = Invoke-NativeHostMessage `
    -Origin 'chrome-extension://gappmnmcjliadjleocigmndgalflgffd/' `
    -Message $wrongOperation
if ($rejectedOperation.success -ne $false -or $rejectedOperation.category -ne 'InvalidMessage') {
    throw 'Unsupported native operation was not rejected.'
}

$unknownCapability = Invoke-NativeHostMessage `
    -Origin 'chrome-extension://gappmnmcjliadjleocigmndgalflgffd/' `
    -Message $validEnvelope
if ($unknownCapability.success -ne $false -or
    $unknownCapability.category -notin @('CapabilityRejected', 'UnexpectedFailure')) {
    throw 'Unknown capability did not fail closed.'
}

Write-Output 'Native Messaging framing, origin, operation, and unknown-capability rejection: PASS'
