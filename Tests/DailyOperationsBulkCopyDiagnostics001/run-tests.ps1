[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$importer=Get-Content (Join-Path $repo 'Tools\DailyOperationsSync\Import-DailyOperationsSnapshot.ps1') -Raw
$passed=0

function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Check([string]$Name,[scriptblock]$Rule){& $Rule;$script:passed++;"PASS $Name"}

Check 'destination and row count precede WriteToServer' {
    $startPosition=$importer.IndexOf('Bulk copy START')
    $writePosition=$importer.IndexOf('$copy.WriteToServer($Table)')
    Require ($startPosition -ge 0 -and $startPosition -lt $writePosition) `
        'Bulk copy START is not logged before WriteToServer.'
    Require ($importer.Contains('$Destination,$rows,$startedAtUtc')) `
        'Bulk copy START omits destination, row count, or UTC start time.'
}

Check 'completion records UTC time and elapsed duration' {
    $writePosition=$importer.IndexOf('$copy.WriteToServer($Table)')
    $completePosition=$importer.IndexOf('Bulk copy COMPLETE')
    Require ($completePosition -gt $writePosition) `
        'Bulk copy COMPLETE is not logged after WriteToServer.'
    foreach($value in @('$completedAtUtc','$stopwatch.ElapsedMilliseconds','$stopwatch.Elapsed.TotalSeconds')){
        Require ($importer.Contains($value)) "Completion diagnostic omits $value."
    }
}

Check 'failure logs destination and rethrows original exception' {
    $writePosition=$importer.IndexOf('$copy.WriteToServer($Table)')
    $failedPosition=$importer.IndexOf('Bulk copy FAILED')
    Require ($failedPosition -gt $writePosition) `
        'Bulk copy FAILED is not associated with WriteToServer.'
    Require ($importer.Contains('$Destination,$rows,$startedAtUtc.ToString(''O''),$failedAtUtc.ToString(''O'')')) `
        'Failure diagnostic omits destination, row count, or UTC timestamps.'
    Require ($importer.Contains('Write-Host $message')) `
        'Failure diagnostic is not emitted to the redirected host log.'
    Require ($importer -match '(?s)catch\s*\{.*?Write-Host \$message\s+throw\s+\}') `
        'Failure does not rethrow the original exception after logging destination context.'
}

Check 'bulk execution settings remain governed' {
    Require ($importer.Contains('$copy.BatchSize=1000;$copy.BulkCopyTimeout=240')) `
        'Bulk-copy batch size or timeout changed.'
    Require (($importer|Select-String 'BulkCopyTimeout=240' -AllMatches).Matches.Count -eq 1) `
        'Bulk-copy timeout is not exactly one explicit 240-second setting.'
}

Check 'transaction and rollback boundaries remain present' {
    Require (($importer|Select-String 'BeginTransaction' -AllMatches).Matches.Count -eq 1) `
        'Importer no longer has exactly one transaction boundary.'
    Require (($importer|Select-String '\.Commit\(' -AllMatches).Matches.Count -eq 1) `
        'Importer no longer has exactly one commit.'
    Require (($importer|Select-String '\$transaction\.Rollback\(\)' -AllMatches).Matches.Count -eq 1) `
        'Importer no longer has exactly one rollback path.'
}

"PASS $passed Daily Operations bulk-copy diagnostic contract checks"
