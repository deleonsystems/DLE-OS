[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedIdentity = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
$shortageRoot = '\\DELEON-SERVER\Production\KITTING\KIT-SHORTAGES'
$completeRoot = '\\DELEON-SERVER\Production\KITTING\KIT-COMPLETE'
$result = [ordered]@{
    ExecutedAs = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    ShortageRoot = $shortageRoot
    CompleteRoot = $completeRoot
    Scope = 'ApprovedKittingRootsOnly'
}

try {
    if ($result.ExecutedAs -ine $expectedIdentity) {
        throw "Kitting qualification must execute as $expectedIdentity."
    }
    foreach ($path in $shortageRoot,$completeRoot) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            throw "The dedicated DEV identity cannot reach $path."
        }
        $enumerator = [IO.Directory]::EnumerateFileSystemEntries($path).GetEnumerator()
        try { [void]$enumerator.MoveNext() }
        finally { $enumerator.Dispose() }
    }
    $result.ExactKittingRead = $true
    $result.Verdict = 'PASS'
}
catch {
    $result.Error = $_.Exception.Message
    $result.Verdict = 'FAIL'
    throw
}
finally {
    New-Item -ItemType Directory -Path (Split-Path -Parent $ResultPath) -Force | Out-Null
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding utf8
}
