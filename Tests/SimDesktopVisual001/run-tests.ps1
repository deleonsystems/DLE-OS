[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

& dotnet build $project --nologo --verbosity quiet
Require ($LASTEXITCODE -eq 0) 'Phase 12 SIM host builds'

$pathNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
    $(if ($pathNode) { $pathNode.Source }),
    $env:DLE_OS_SIM_NODE_PATH,
    'C:\Program Files\nodejs\node.exe'
) + @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_.FullName '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
})
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Require (Test-Path $node) 'Node.js is available for desktop visual contracts'
& $node (Join-Path $PSScriptRoot 'run-ui-contract-tests.mjs')
Require ($LASTEXITCODE -eq 0) 'shared desktop responsive contracts remain green'

Write-Output "PASS: $($checks.Count) DLE-OS SIM desktop visual qualification checks."
$checks | ForEach-Object { Write-Output "  - $_" }
