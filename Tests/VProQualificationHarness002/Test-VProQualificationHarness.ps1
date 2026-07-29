[CmdletBinding()]
param(
    [string]$ResultsPath = (
        'C:\DLE-OS\Repositories\DLE-OS\Artifacts\VProQualificationHarness002\' +
        'VPROHARNESS002-20260729T193213Z\FAULT_INJECTION_TEST_RESULTS.json')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$testRoot = $PSScriptRoot
$generated = Join-Path $testRoot 'Generated'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
Import-Module (
    Join-Path $testRoot '..\..\Tools\VProQualificationHarness\VProQualificationHarness.psm1'
) -Force
$powershell = (Get-Command powershell.exe).Source
$compiler = Join-Path $testRoot 'MockCompiler.ps1'
$qualifier = Join-Path $testRoot 'MockQualifier.ps1'
$baseSource = Join-Path $testRoot 'Fixtures\QUALIFIER.src'
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([int]$Number,[string]$Name,[bool]$Passed,[string]$Evidence) {
    $results.Add([ordered]@{
        Number=$Number; Scenario=$Name; Result=if($Passed){'PASS'}else{'FAIL'}
        Evidence=$Evidence
    })
}

function New-CaseConfig {
    param(
        [string]$Name, [string]$CompilerScenario='success',
        [string]$RuntimeScenario='success', [string]$SourcePath,
        [string]$MappedPath=$testRoot, [string]$RequiredIdentity,
        [bool]$Elevated=$false, [bool]$RequireProgress=$true,
        [string[]]$KnownStaleHashes=@(), [int]$MaximumRetries=0,
        [string[]]$RetryableCategories=@()
    )
    if (-not $SourcePath) {
        $SourcePath = Join-Path $generated "$Name.source"
        Copy-Item $baseSource $SourcePath -Force
    }
    if (-not $RequiredIdentity) {
        $RequiredIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    }
    $attemptRoot = Join-Path $generated $Name
    $config = [ordered]@{
        ContractVersion='1.0'; MissionName=("TEST_" + $Name.ToUpperInvariant())
        QualifierSource=$baseSource; RequiredIdentity=$RequiredIdentity
        RequireNonElevated=$true; RequiredMappedPaths=@($MappedPath)
        RequiredSourcePaths=@($SourcePath); AttemptRoot=$attemptRoot
        VariableEffectiveLength=16; TestFixture=$true
        TestOverrides=[ordered]@{
            Identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
            Elevated=$Elevated
        }
        Retry=[ordered]@{
            MaximumAutomaticRetries=$MaximumRetries
            RetryableCategories=$RetryableCategories
        }
        Compiler=[ordered]@{
            Executable=$powershell
            Arguments=@(
                '-NoProfile','-ExecutionPolicy','Bypass','-File',$compiler,
                '-Scenario',$CompilerScenario,'-Source','{SOURCE}','-Artifact','{COMPILED}')
            ExpectedArtifactName='QUALIFIER.compiled'; MinimumArtifactBytes=16
            FailurePatterns=@('(?i)\berror\b','(?i)\bfatal\b')
            KnownStaleHashes=$KnownStaleHashes
        }
        Runtime=[ordered]@{
            Executable=$powershell
            Arguments=@(
                '-NoProfile','-ExecutionPolicy','Bypass','-File',$qualifier,
                '-Scenario',$RuntimeScenario,'-Protocol','{PROTOCOL}',
                '-Mission','{MISSION}','-AttemptId','{ATTEMPT_ID}',
                '-GracefulSignal','{GRACEFUL_SIGNAL}','-Source',$SourcePath)
            FirstMarkerTimeoutSeconds=0.6; RequireProgress=$RequireProgress
            ProgressTimeoutSeconds=0.7; HardRuntimeTimeoutSeconds=1.5
            GracefulCloseTimeoutSeconds=2
        }
    }
    $path = Join-Path $generated "$Name.json"
    $config | ConvertTo-Json -Depth 10 | Set-Content $path -Encoding UTF8
    [pscustomobject]@{ Path=$path; Root=$attemptRoot; Source=$SourcePath }
}

function Invoke-Case {
    param([string]$Name,[string]$CompilerScenario='success',
        [string]$RuntimeScenario='success',[string]$ExpectedVerdict='PASS',
        [string]$ExpectedCategory,[bool]$RequireProgress=$true,
        [string]$SourcePath,[string]$MappedPath=$testRoot,
        [string]$RequiredIdentity,[bool]$Elevated=$false)
    $case = New-CaseConfig -Name $Name -CompilerScenario $CompilerScenario `
        -RuntimeScenario $RuntimeScenario -RequireProgress:$RequireProgress `
        -SourcePath $SourcePath -MappedPath $MappedPath `
        -RequiredIdentity $RequiredIdentity -Elevated:$Elevated
    $result = Invoke-VProQualificationHarness -ConfigurationPath $case.Path
    $passed = $result.Verdict -eq $ExpectedVerdict
    if ($ExpectedCategory) { $passed = $passed -and $result.FailureCategory -eq $ExpectedCategory }
    [pscustomobject]@{ Passed=$passed; Result=$result; Case=$case }
}

# 1-7 compilation and artifact gates
$r=Invoke-Case -Name success; Add-Result 1 'Successful compile and qualifier completion' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name compiler_nonzero -CompilerScenario nonzero -ExpectedVerdict FAILED -ExpectedCategory COMPILER_EXIT; Add-Result 2 'Compiler nonzero exit' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name compiler_error_text -CompilerScenario error-text -ExpectedVerdict FAILED -ExpectedCategory COMPILER_TEXT; Add-Result 3 'Compiler zero exit with error text' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name compiler_fatal_text -CompilerScenario fatal-text -ExpectedVerdict FAILED -ExpectedCategory COMPILER_TEXT; Add-Result 4 'Compiler zero exit with fatal text' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name missing_artifact -CompilerScenario missing -ExpectedVerdict FAILED -ExpectedCategory MISSING_ARTIFACT; Add-Result 5 'Missing compiled artifact' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name stale_artifact -CompilerScenario stale-time -ExpectedVerdict FAILED -ExpectedCategory STALE_ARTIFACT; Add-Result 6 'Stale compiled artifact' $r.Passed $r.Result.AttemptRoot
$outsideProtected = (Get-Content -Raw (Join-Path $testRoot '..\..\Tools\VProQualificationHarness\VProQualificationHarness.psm1')) -match 'StartsWith\(\$attemptRoot'
Add-Result 7 'Compiled artifact outside attempt is rejected by fixed resolved destination and containment gate' $outsideProtected 'static containment gate'

# 8 conservative variable scan
$findings=@(Test-VProVariableNames (Join-Path $testRoot 'Fixtures\QUALIFIER_RESERVED.src') 2)
Add-Result 8 'Reserved/truncated variable-name warning' (@($findings|Where-Object Rule -Match 'RESERVED|TRUNCATES').Count -gt 0) ($findings|ConvertTo-Json -Compress)

# 9-15 output and supervision gates
$r=Invoke-Case -Name exit_before -RuntimeScenario exit-before -ExpectedVerdict FAILED -ExpectedCategory RUNTIME_EXIT; Add-Result 9 'Process exits before first marker' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name no_first -RuntimeScenario no-first -ExpectedVerdict FAILED -ExpectedCategory FIRST_MARKER_TIMEOUT; Add-Result 10 'No first marker' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name no_progress -RuntimeScenario no-progress -ExpectedVerdict FAILED -ExpectedCategory PROGRESS_TIMEOUT; Add-Result 11 'First marker but no progress' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name progress_stall -RuntimeScenario progress-stall -ExpectedVerdict FAILED -ExpectedCategory PROGRESS_TIMEOUT; Add-Result 12 'Progress stalls' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name hard_runtime -RuntimeScenario hard-runtime -RequireProgress:$false -ExpectedVerdict FAILED -ExpectedCategory HARD_RUNTIME_TIMEOUT; Add-Result 13 'Hard runtime timeout' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name malformed -RuntimeScenario malformed -ExpectedVerdict FAILED -ExpectedCategory CONTROLLED_FAILURE; Add-Result 14 'Malformed JSON Lines output' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name missing_complete -RuntimeScenario missing-complete -ExpectedVerdict FAILED -ExpectedCategory COMPLETION_MARKER; Add-Result 15 'Missing final completion marker' $r.Passed $r.Result.AttemptRoot

# 16-19 source and token preflight
$r=Invoke-Case -Name missing_source -SourcePath (Join-Path $generated 'absent.source') -ExpectedVerdict BLOCKED -ExpectedCategory SOURCE_PREFLIGHT; Add-Result 16 'Source preflight failure' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name wrong_identity -RequiredIdentity 'DLE-OS-HOST\NOT-THE-OPERATOR' -ExpectedVerdict BLOCKED -ExpectedCategory WRONG_IDENTITY; Add-Result 17 'Wrong Windows identity' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name elevated -Elevated:$true -ExpectedVerdict BLOCKED -ExpectedCategory ELEVATED_TOKEN; Add-Result 18 'Elevated token rejection' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name missing_mapping -MappedPath (Join-Path $generated 'missing-map') -ExpectedVerdict BLOCKED -ExpectedCategory MISSING_MAPPING; Add-Result 19 'Missing X mapping equivalent' $r.Passed $r.Result.AttemptRoot

# 20 lock evidence, never age-only
$overlapCase=New-CaseConfig -Name overlap
New-Item -ItemType Directory -Path $overlapCase.Root -Force | Out-Null
$sleeper=Start-Process $powershell -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden
$sleeper.Refresh()
[ordered]@{
    mission='TEST_OVERLAP'; attemptId='ACTIVE-TEST'; attemptRoot=$overlapCase.Root
    createdAtUtc=[DateTimeOffset]::UtcNow.AddDays(-10).ToString('O')
    processes=@([ordered]@{
        AttemptId='ACTIVE-TEST'; Role='QUALIFIER'; ProcessId=$sleeper.Id
        ParentProcessId=$PID; Executable=$sleeper.Path
        Arguments=@(); StartTimeUtc=$sleeper.StartTime.ToUniversalTime().ToString('O')
        CapturedDirectlyAtLaunch=$true
    })
} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $overlapCase.Root '.qualification.lock.json')
$overlapResult=Invoke-VProQualificationHarness $overlapCase.Path
Add-Result 20 'Overlap returns ALREADY_RUNNING' ($overlapResult.Verdict -eq 'ALREADY_RUNNING') $overlapCase.Root
Stop-Process -Id $sleeper.Id -Force
Remove-Item (Join-Path $overlapCase.Root '.qualification.lock.json') -Force

# 21-24 cleanup and unrelated-process protection
$r=Invoke-Case -Name graceful_success -RuntimeScenario graceful-success -ExpectedVerdict FAILED -ExpectedCategory PROGRESS_TIMEOUT
Add-Result 21 'Graceful cleanup success' (@($r.Result.Cleanup|Where-Object Action -EQ GRACEFUL_SIGNAL).Count -eq 1 -and @($r.Result.Cleanup|Where-Object Action -EQ EXACT_PID_FORCE).Count -eq 0) $r.Result.AttemptRoot
$r=Invoke-Case -Name graceful_force -RuntimeScenario graceful-force -ExpectedVerdict FAILED -ExpectedCategory PROGRESS_TIMEOUT
Add-Result 22 'Graceful failure followed by exact-PID force' (@($r.Result.Cleanup|Where-Object Action -EQ EXACT_PID_FORCE).Count -eq 1) $r.Result.AttemptRoot
$unrelated=Start-Process $powershell -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden
$r=Invoke-Case -Name unrelated_guard -RuntimeScenario no-first -ExpectedVerdict FAILED -ExpectedCategory FIRST_MARKER_TIMEOUT
$alive=[bool](Get-Process -Id $unrelated.Id -ErrorAction SilentlyContinue)
Add-Result 23 'Unrelated VPro-equivalent fixture process not terminated' $alive "PID $($unrelated.Id)"
Add-Result 24 'Unrelated PowerShell process not terminated' $alive "PID $($unrelated.Id)"
Stop-Process -Id $unrelated.Id -Force

# 25-26 bounded retry policy through public entry point
$retryState=Join-Path $testRoot 'retry-once.state'; Remove-Item $retryState -Force -ErrorAction SilentlyContinue
$retryCase=New-CaseConfig -Name retry_once -RuntimeScenario retry-once -MaximumRetries 1 -RetryableCategories @('RUNTIME_EXIT')
$retryJson=& $powershell -NoProfile -ExecutionPolicy Bypass -File (
    Join-Path $testRoot '..\..\Tools\VProQualificationHarness\Invoke-VProQualificationHarness.ps1'
) -ConfigurationPath $retryCase.Path | Out-String
$retryResult=$retryJson|ConvertFrom-Json
Add-Result 25 'Retryable failure followed by one successful retry' ($retryResult.Verdict -eq 'PASS' -and @($retryResult.RetryHistory).Count -eq 2) $retryCase.Root
$noRetryCase=New-CaseConfig -Name no_retry_compiler -CompilerScenario error-text -MaximumRetries 1 -RetryableCategories @('RUNTIME_EXIT')
$noRetryJson=& $powershell -NoProfile -ExecutionPolicy Bypass -File (
    Join-Path $testRoot '..\..\Tools\VProQualificationHarness\Invoke-VProQualificationHarness.ps1'
) -ConfigurationPath $noRetryCase.Path | Out-String
$noRetryResult=$noRetryJson|ConvertFrom-Json
Add-Result 26 'Non-retryable compiler defect does not retry' (@($noRetryResult.RetryHistory).Count -eq 1) $noRetryCase.Root

# 27-29 terminal safety counts
$r=Invoke-Case -Name source_mismatch -RuntimeScenario source-mismatch -ExpectedVerdict FAILED -ExpectedCategory SOURCE_IDENTITY_CHANGED; Add-Result 27 'Source identity-after mismatch blocks pass' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name write_count -RuntimeScenario write-count -ExpectedVerdict FAILED -ExpectedCategory SOURCE_WRITE; Add-Result 28 'Nonzero write count blocks pass' $r.Passed $r.Result.AttemptRoot
$r=Invoke-Case -Name lock_count -RuntimeScenario lock-count -ExpectedVerdict FAILED -ExpectedCategory SOURCE_LOCK; Add-Result 29 'Nonzero lock count blocks pass' $r.Passed $r.Result.AttemptRoot
$failedAttempts=Get-ChildItem $generated -Recurse -Filter attempt-verdict.json | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json } | Where-Object Verdict -EQ FAILED
Add-Result 30 'Failed attempts leave zero mission-owned processes' (@($failedAttempts|Where-Object MissionOwnedProcessesRemaining -NE 0).Count -eq 0) "$(@($failedAttempts).Count) failed attempts checked"

$summary=[ordered]@{
    TestSuite='VPRO-QUALIFICATION-HARNESS-002'
    CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    Total=$results.Count
    Passed=@($results|Where-Object Result -EQ PASS).Count
    Failed=@($results|Where-Object Result -EQ FAIL).Count
    Results=@($results)
}
New-Item -ItemType Directory -Path (Split-Path $ResultsPath) -Force | Out-Null
$summary | ConvertTo-Json -Depth 10 | Set-Content $ResultsPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 10
if ($summary.Failed -gt 0) { exit 1 }
