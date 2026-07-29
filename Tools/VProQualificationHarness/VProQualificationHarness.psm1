Set-StrictMode -Version Latest

$script:ProtocolVersion = '1.0'
$script:AllowedVerdicts = @('PASS', 'PASS WITH CLARIFICATIONS', 'BLOCKED', 'FAILED')

function Get-HarnessSha256 {
    param([Parameter(Mandatory)][string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-HarnessElevation {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-HarnessSourceIdentity {
    param([Parameter(Mandatory)][string[]]$Paths)
    @(
        foreach ($path in $Paths) {
            $item = Get-Item -LiteralPath $path -Force
            [ordered]@{
                Path = $item.FullName
                Length = [long]$item.Length
                LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
                Attributes = $item.Attributes.ToString()
            }
        }
    )
}

function Test-HarnessSourceIdentity {
    param([object[]]$Before, [object[]]$After)
    (($Before | ConvertTo-Json -Depth 5 -Compress) -ceq
        ($After | ConvertTo-Json -Depth 5 -Compress))
}

function Test-VProVariableNames {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [int]$EffectiveLength = 2
    )
    $text = Get-Content -Raw -LiteralPath $SourcePath
    $names = [regex]::Matches(
        $text,
        '(?im)(?<![A-Z0-9_$])([A-Z][A-Z0-9_$]{1,})(?=\s*(?:=|\[))'
    ) | ForEach-Object { $_.Groups[1].Value.ToUpperInvariant() } |
        Sort-Object -Unique
    $findings = [System.Collections.Generic.List[object]]::new()
    $truncated = @{}
    foreach ($name in $names) {
        $effective = $name.Substring(0, [Math]::Min($EffectiveLength, $name.Length))
        if ($name.StartsWith('FN', [StringComparison]::Ordinal)) {
            $findings.Add([ordered]@{
                Severity = 'ERROR'; Rule = 'RESERVED_FN_PREFIX'
                Name = $name; EffectiveName = $effective
            })
        }
        elseif ($effective -eq 'FN') {
            $findings.Add([ordered]@{
                Severity = 'ERROR'; Rule = 'TRUNCATES_TO_RESERVED_FN'
                Name = $name; EffectiveName = $effective
            })
        }
        if ($name.Length -gt $EffectiveLength) {
            $findings.Add([ordered]@{
                Severity = 'WARNING'; Rule = 'EXCEEDS_EFFECTIVE_LENGTH'
                Name = $name; EffectiveName = $effective
            })
        }
        if (-not $truncated.ContainsKey($effective)) { $truncated[$effective] = @() }
        $truncated[$effective] += $name
    }
    foreach ($entry in $truncated.GetEnumerator()) {
        if (@($entry.Value).Count -gt 1) {
            $findings.Add([ordered]@{
                Severity = 'ERROR'; Rule = 'DUPLICATE_AFTER_TRUNCATION'
                Name = ($entry.Value -join ','); EffectiveName = $entry.Key
            })
        }
    }
    @($findings)
}

function Assert-HarnessConfiguration {
    param([Parameter(Mandatory)]$Configuration, [Parameter(Mandatory)][string]$ConfigurationPath)
    foreach ($name in @(
        'ContractVersion','MissionName','RequiredIdentity','RequireNonElevated',
        'AttemptRoot','RequiredMappedPaths','RequiredSourcePaths','Compiler','Runtime'
    )) {
        if ($null -eq $Configuration.$name) { throw "Missing configuration member: $name" }
    }
    if ($Configuration.ContractVersion -ne '1.0') {
        throw 'Unsupported harness contract version.'
    }
    if ($Configuration.MissionName -notmatch '^[A-Z0-9][A-Z0-9_-]{2,80}$') {
        throw 'MissionName is invalid.'
    }
    if (-not [IO.Path]::IsPathRooted($Configuration.AttemptRoot)) {
        throw 'AttemptRoot must be absolute.'
    }
    foreach ($path in @(
        $Configuration.Compiler.Executable, $Configuration.Runtime.Executable,
        $Configuration.QualifierSource
    )) {
        if (-not [IO.Path]::IsPathRooted([string]$path)) {
            throw "Executable/source paths must be absolute: $path"
        }
    }
    foreach ($arg in @($Configuration.Compiler.Arguments) + @($Configuration.Runtime.Arguments)) {
        if ([string]$arg -match '(?i)(?:^|[ =])\\\\|EnableLinkedConnections|net\s+use|New-PSDrive') {
            throw 'UNC paths, drive remapping, and arbitrary drive commands are prohibited.'
        }
    }
    if ($Configuration.psobject.Properties.Name -contains 'TestFixture' -and
        $Configuration.TestFixture) {
        $configFull = [IO.Path]::GetFullPath($ConfigurationPath)
        if ($configFull -notlike '*\Tests\VProQualificationHarness002\*') {
            throw 'TestFixture may be used only beneath the governed harness test directory.'
        }
    }
}

function Expand-HarnessArguments {
    param([object[]]$Arguments, [hashtable]$Tokens)
    @(
        foreach ($argument in $Arguments) {
            $value = [string]$argument
            foreach ($key in $Tokens.Keys) {
                $value = $value.Replace("{$key}", [string]$Tokens[$key])
            }
            if ($value -match '\{[A-Z][A-Z0-9_]*\}') {
                throw "Unknown argument token: $value"
            }
            $value
        }
    )
}

function Write-HarnessJson {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Add-HarnessLedgerEntry {
    param([System.Collections.Generic.List[object]]$Ledger, [Diagnostics.Process]$Process,
        [string]$Role, [string]$AttemptId, [string]$Executable, [string[]]$Arguments)
    $Process.Refresh()
    $entry = [ordered]@{
        AttemptId = $AttemptId; Role = $Role; ProcessId = $Process.Id
        ParentProcessId = $PID; Executable = [IO.Path]::GetFullPath($Executable)
        Arguments = $Arguments; StartTimeUtc = $Process.StartTime.ToUniversalTime().ToString('O')
        CapturedDirectlyAtLaunch = $true
    }
    $Ledger.Add($entry)
    $entry
}

function ConvertTo-HarnessArgumentString {
    param([string[]]$Arguments)
    (@(
        foreach ($argument in $Arguments) {
            if ($argument -notmatch '[\s"]') { $argument; continue }
            '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
        }
    ) -join ' ')
}

function Start-HarnessProcess {
    param([string]$Executable,[string[]]$Arguments,[string]$WorkingDirectory)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.Arguments = ConvertTo-HarnessArgumentString $Arguments
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "Failed to launch $Executable." }
    $process
}

function Test-HarnessOwnedProcess {
    param($Entry)
    $process = Get-Process -Id $Entry.ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    try {
        $process.Refresh()
        $sameStart = $process.StartTime.ToUniversalTime().ToString('O') -eq $Entry.StartTimeUtc
        $samePath = [IO.Path]::GetFullPath($process.Path) -ieq
            [IO.Path]::GetFullPath($Entry.Executable)
        return ($sameStart -and $samePath)
    }
    catch { return $false }
}

function Stop-HarnessOwnedProcess {
    param($Entry, [int]$GracefulSeconds, [string]$GracefulSignalPath,
        [System.Collections.Generic.List[object]]$Cleanup)
    if (-not (Test-HarnessOwnedProcess $Entry)) { return }
    if ($GracefulSignalPath) {
        'STOP' | Set-Content -LiteralPath $GracefulSignalPath -Encoding ASCII
        $Cleanup.Add([ordered]@{ Action='GRACEFUL_SIGNAL'; ProcessId=$Entry.ProcessId; Result='SENT' })
    }
    else {
        try {
            $p = Get-Process -Id $Entry.ProcessId -ErrorAction Stop
            [void]$p.CloseMainWindow()
            $Cleanup.Add([ordered]@{ Action='CLOSE_MAIN_WINDOW'; ProcessId=$Entry.ProcessId; Result='ATTEMPTED' })
        } catch {}
    }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($GracefulSeconds)
    while ((Test-HarnessOwnedProcess $Entry) -and [DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (Test-HarnessOwnedProcess $Entry) {
        Stop-Process -Id $Entry.ProcessId -Force
        $Cleanup.Add([ordered]@{ Action='EXACT_PID_FORCE'; ProcessId=$Entry.ProcessId; Result='TERMINATED' })
    }
}

function Read-HarnessProtocol {
    param([string]$Path, [string]$MissionName, [string]$AttemptId)
    $records = @()
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $records }
    $lines = $null
    for ($readAttempt=0; $readAttempt -lt 5 -and $null -eq $lines; $readAttempt++) {
        try { $lines = @(Get-Content -LiteralPath $Path -ErrorAction Stop) }
        catch [IO.IOException] {
            if ($readAttempt -eq 4) { throw }
            Start-Sleep -Milliseconds 20
        }
    }
    $lineNumber = 0
    foreach ($line in $lines) {
        $lineNumber++
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $record = $line | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "Malformed JSON Lines output at line $lineNumber." }
        if ($record.protocolVersion -ne $script:ProtocolVersion -or
            $record.mission -ne $MissionName -or $record.attemptId -ne $AttemptId) {
            throw "Protocol identity mismatch at line $lineNumber."
        }
        $records += $record
    }
    $records
}

function Add-HarnessProtocolRecord {
    param([string]$Path,[string]$Mission,[string]$AttemptId,[string]$EventType,
        [hashtable]$Additional=@{})
    $record = [ordered]@{
        protocolVersion=$script:ProtocolVersion; mission=$Mission; attemptId=$AttemptId
        timestampUtc=[DateTimeOffset]::UtcNow.ToString('O'); processId=$PID
        eventType=$EventType; sourceAccessMode='O_RDONLY'; writeCount=0; lockCount=0
    }
    foreach ($key in $Additional.Keys) { $record[$key]=$Additional[$key] }
    ($record | ConvertTo-Json -Compress -Depth 8) |
        Add-Content -LiteralPath $Path -Encoding UTF8
}

function Invoke-VProQualificationHarness {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ConfigurationPath)

    $ErrorActionPreference = 'Stop'
    $configPath = (Resolve-Path -LiteralPath $ConfigurationPath).Path
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    Assert-HarnessConfiguration -Configuration $config -ConfigurationPath $configPath
    $isTestFixture = (
        $config.psobject.Properties.Name -contains 'TestFixture' -and
        [bool]$config.TestFixture)
    $attemptId = '{0}-{1}-{2}' -f $config.MissionName,
        [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'),
        ([Guid]::NewGuid().ToString('N').Substring(0,8).ToUpperInvariant())
    $attemptRoot = Join-Path $config.AttemptRoot "Attempts\$attemptId"
    $lockPath = Join-Path $config.AttemptRoot '.qualification.lock.json'
    $ledger = [System.Collections.Generic.List[object]]::new()
    $cleanup = [System.Collections.Generic.List[object]]::new()
    $started = [DateTimeOffset]::UtcNow
    $failureCategory = $null
    $errorText = $null
    $sourceBefore = @()
    $sourceAfter = @()
    $writeCount = 0
    $lockCount = 0
    $runtimeProcess = $null
    $compilerProcess = $null

    New-Item -ItemType Directory -Path $config.AttemptRoot -Force | Out-Null
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        $prior = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
        $active = @($prior.processes | Where-Object { Test-HarnessOwnedProcess $_ })
        if ($active.Count -gt 0) {
            return [pscustomobject]@{ Verdict='ALREADY_RUNNING'; AttemptId=$prior.attemptId; AttemptRoot=$prior.attemptRoot }
        }
        Move-Item -LiteralPath $lockPath -Destination (
            Join-Path $config.AttemptRoot (
                '.stale-lock-{0}.json' -f [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')))
    }
    New-Item -ItemType Directory -Path $attemptRoot -Force | Out-Null
    foreach ($name in @('Compile','Programs','Runtime')) {
        New-Item -ItemType Directory -Path (Join-Path $attemptRoot $name) | Out-Null
    }
    if ($config.Runtime.psobject.Properties.Name -contains 'Directories') {
        foreach ($directory in @($config.Runtime.Directories)) {
            if ([string]$directory -match '(^[\\/]|(^|[\\/])\.\.([\\/]|$))') {
                throw 'Runtime directory traversal is prohibited.'
            }
            New-Item -ItemType Directory -Path (
                Join-Path (Join-Path $attemptRoot 'Runtime') $directory) -Force | Out-Null
        }
    }
    $sourceCopy = Join-Path $attemptRoot ('Compile\' + [IO.Path]::GetFileName($config.QualifierSource))
    Copy-Item -LiteralPath $config.QualifierSource -Destination $sourceCopy
    $protocolPath = Join-Path $attemptRoot 'Runtime\qualifier.events.jsonl'
    $gracefulPath = Join-Path $attemptRoot 'Runtime\graceful-stop.signal'
    $compiledPath = Join-Path $attemptRoot ('Programs\' + $config.Compiler.ExpectedArtifactName)
    $vproConfigPath = Join-Path $attemptRoot 'Programs\config.aon'
    $tokens = @{
        ATTEMPT_ROOT=$attemptRoot; SOURCE=$sourceCopy; COMPILED=$compiledPath
        PROGRAMS=(Join-Path $attemptRoot 'Programs'); RUNTIME=(Join-Path $attemptRoot 'Runtime')
        PROTOCOL=$protocolPath; ATTEMPT_ID=$attemptId; MISSION=$config.MissionName
        GRACEFUL_SIGNAL=$gracefulPath
        CONFIG=$vproConfigPath
        PROGRAMS_POSIX=((Join-Path $attemptRoot 'Programs') -replace '\\','/')
    }
    if ($config.psobject.Properties.Name -contains 'SourceReplacements' -and
        $config.SourceReplacements) {
        $sourceText = Get-Content -Raw -LiteralPath $sourceCopy
        foreach ($property in $config.SourceReplacements.psobject.Properties) {
            [string]$replacement = @(Expand-HarnessArguments @(
                [string]$property.Value) $tokens)[0]
            $sourceText = $sourceText.Replace([string]$property.Name, $replacement)
        }
        $sourceText | Set-Content -LiteralPath $sourceCopy -Encoding ASCII
    }
    if ($config.Runtime.psobject.Properties.Name -contains 'ConfigurationLines' -and
        $config.Runtime.ConfigurationLines) {
        $lines = Expand-HarnessArguments @($config.Runtime.ConfigurationLines) $tokens
        $lines | Set-Content -LiteralPath $vproConfigPath -Encoding ASCII
    }
    $lock = [ordered]@{
        mission=$config.MissionName; attemptId=$attemptId; attemptRoot=$attemptRoot
        createdAtUtc=$started.ToString('O'); processes=@()
    }
    Write-HarnessJson $lock $lockPath
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $elevated = Get-HarnessElevation
        if ($isTestFixture -and
            $config.psobject.Properties.Name -contains 'TestOverrides' -and
            $config.TestOverrides) {
            if ($null -ne $config.TestOverrides.Identity) {
                $identity = [string]$config.TestOverrides.Identity
            }
            if ($null -ne $config.TestOverrides.Elevated) {
                $elevated = [bool]$config.TestOverrides.Elevated
            }
        }
        if ($identity -ine $config.RequiredIdentity) { $failureCategory='WRONG_IDENTITY'; throw 'Required Windows identity is not active.' }
        if ($config.RequireNonElevated -and $elevated) { $failureCategory='ELEVATED_TOKEN'; throw 'Source qualification must be non-elevated.' }
        foreach ($path in @($config.RequiredMappedPaths)) {
            if (-not (Test-Path -LiteralPath $path)) { $failureCategory='MISSING_MAPPING'; throw "Required mapped path unavailable: $path" }
            if ([string]$path -like '\\*') { $failureCategory='UNSAFE_PATH'; throw 'UNC source paths are prohibited.' }
        }
        foreach ($path in @($config.RequiredSourcePaths)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failureCategory='SOURCE_PREFLIGHT'; throw "Required source unavailable: $path" }
            if ([string]$path -like '\\*') { $failureCategory='UNSAFE_PATH'; throw 'UNC source paths are prohibited.' }
        }
        $sourceBefore = Get-HarnessSourceIdentity @($config.RequiredSourcePaths)
        $findings = @(Test-VProVariableNames -SourcePath $sourceCopy -EffectiveLength $config.VariableEffectiveLength)
        Write-HarnessJson $findings (Join-Path $attemptRoot 'variable-preflight.json')
        if (@($findings | Where-Object Severity -EQ 'ERROR').Count -gt 0) {
            $failureCategory='VARIABLE_PREFLIGHT'; throw 'Variable-name preflight rejected the qualifier.'
        }

        $compileStdout = Join-Path $attemptRoot 'compiler.stdout.log'
        $compileStderr = Join-Path $attemptRoot 'compiler.stderr.log'
        $compileArgs = Expand-HarnessArguments @($config.Compiler.Arguments) $tokens
        $compileStart = [DateTimeOffset]::UtcNow
        $compilerProcess = Start-HarnessProcess $config.Compiler.Executable `
            $compileArgs (Join-Path $attemptRoot 'Compile')
        $compilerOutTask = $compilerProcess.StandardOutput.ReadToEndAsync()
        $compilerErrTask = $compilerProcess.StandardError.ReadToEndAsync()
        $compileEntry = Add-HarnessLedgerEntry $ledger $compilerProcess 'COMPILER' $attemptId $config.Compiler.Executable $compileArgs
        $lock.processes = @($ledger); Write-HarnessJson $lock $lockPath
        $compilerProcess.WaitForExit()
        $compilerOutTask.Result |
            Set-Content -LiteralPath $compileStdout -Encoding UTF8
        $compilerErrTask.Result |
            Set-Content -LiteralPath $compileStderr -Encoding UTF8
        $combined = @(
            Get-Content -Raw $compileStdout -ErrorAction SilentlyContinue
            Get-Content -Raw $compileStderr -ErrorAction SilentlyContinue
        ) -join "`n"
        $combined | Set-Content (Join-Path $attemptRoot 'compiler.combined.log')
        if ($compilerProcess.ExitCode -ne 0) { $failureCategory='COMPILER_EXIT'; throw "Compiler exit code $($compilerProcess.ExitCode)." }
        foreach ($pattern in @($config.Compiler.FailurePatterns)) {
            if ($combined -match $pattern) { $failureCategory='COMPILER_TEXT'; throw "Compiler failure marker matched: $pattern" }
        }
        if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf) -and
            $config.Compiler.psobject.Properties.Name -contains 'EmittedArtifactName' -and
            $config.Compiler.EmittedArtifactName) {
            $emitted = Join-Path $attemptRoot ('Programs\' + $config.Compiler.EmittedArtifactName)
            if (Test-Path -LiteralPath $emitted -PathType Leaf) {
                Move-Item -LiteralPath $emitted -Destination $compiledPath
            }
        }
        if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf)) { $failureCategory='MISSING_ARTIFACT'; throw 'Expected compiled artifact is missing.' }
        $compiledItem = Get-Item $compiledPath
        if (-not $compiledItem.FullName.StartsWith($attemptRoot, [StringComparison]::OrdinalIgnoreCase)) {
            $failureCategory='ARTIFACT_OUTSIDE_ATTEMPT'; throw 'Compiled artifact is outside the attempt.'
        }
        if ($compiledItem.Length -lt [long]$config.Compiler.MinimumArtifactBytes -or
            $compiledItem.LastWriteTimeUtc -lt $compileStart.UtcDateTime.AddSeconds(-2)) {
            $failureCategory='STALE_ARTIFACT'; throw 'Compiled artifact is stale or implausible.'
        }
        $compiledHash = Get-HarnessSha256 $compiledPath
        if (@($config.Compiler.KnownStaleHashes) -contains $compiledHash) {
            $failureCategory='STALE_ARTIFACT'; throw 'Compiled artifact matches a known stale hash.'
        }
        Write-HarnessJson ([ordered]@{
            Verdict='PASS'; SourcePath=$sourceCopy; SourceSha256=(Get-HarnessSha256 $sourceCopy)
            ArtifactPath=$compiledPath; ArtifactSha256=$compiledHash
            ArtifactLength=$compiledItem.Length; ArtifactLastWriteTimeUtc=$compiledItem.LastWriteTimeUtc.ToString('O')
            CompilerPid=$compilerProcess.Id; CompilerExitCode=$compilerProcess.ExitCode
        }) (Join-Path $attemptRoot 'compile-metadata.json')

        $runtimeStdout = Join-Path $attemptRoot 'runtime.stdout.log'
        $runtimeStderr = Join-Path $attemptRoot 'runtime.stderr.log'
        $runtimeArgs = Expand-HarnessArguments @($config.Runtime.Arguments) $tokens
        $runtimeStarted = [DateTimeOffset]::UtcNow
        $runtimeProcess = Start-HarnessProcess $config.Runtime.Executable `
            $runtimeArgs (Join-Path $attemptRoot 'Runtime')
        $runtimeOutTask = $runtimeProcess.StandardOutput.ReadToEndAsync()
        $runtimeErrTask = $runtimeProcess.StandardError.ReadToEndAsync()
        $runtimeEntry = Add-HarnessLedgerEntry $ledger $runtimeProcess 'QUALIFIER' $attemptId $config.Runtime.Executable $runtimeArgs
        $lock.processes = @($ledger); Write-HarnessJson $lock $lockPath
        Write-HarnessJson @($ledger) (Join-Path $attemptRoot 'process-ledger.json')

        $firstObserved = $false; $progressObserved = $false
        $adapterStartedWritten = $false; $adapterProgressStamp = [DateTime]::MinValue
        $adapterProgressSignature = ''
        $lastProgress = $runtimeStarted; $records = @()
        while (-not $runtimeProcess.HasExited) {
            Start-Sleep -Milliseconds 100
            $runtimeProcess.Refresh()
            if ($config.Runtime.psobject.Properties.Name -contains 'AdapterType' -and
                $config.Runtime.AdapterType -eq 'MARKER_FILES') {
                $startedMarker = Join-Path $attemptRoot ('Runtime\' + $config.Runtime.StartedMarker)
                $progressMarker = Join-Path $attemptRoot ('Runtime\' + $config.Runtime.ProgressMarker)
                if (-not $adapterStartedWritten -and (Test-Path $startedMarker -PathType Leaf)) {
                    Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'QUALIFIER_STARTED'
                    Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'SOURCE_PREFLIGHT_COMPLETE'
                    $adapterStartedWritten=$true
                }
                if (Test-Path $progressMarker -PathType Leaf) {
                    $stamp=(Get-Item $progressMarker).LastWriteTimeUtc
                    if ($stamp -gt $adapterProgressStamp) {
                        Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'PROGRESS' @{recordsExamined=1}
                        $adapterProgressStamp=$stamp
                    }
                }
                if ($config.Runtime.psobject.Properties.Name -contains 'ProgressPattern') {
                    $items = @(Get-ChildItem -LiteralPath (Join-Path $attemptRoot 'Runtime') `
                        -Recurse -File -Filter $config.Runtime.ProgressPattern `
                        -ErrorAction SilentlyContinue | Where-Object Name -ne 'qualifier.events.jsonl')
                    $signature = (@($items | Sort-Object FullName | ForEach-Object {
                        '{0}|{1}|{2}' -f $_.FullName,$_.Length,$_.LastWriteTimeUtc.Ticks
                    }) -join "`n")
                    if ($signature -and $signature -cne $adapterProgressSignature) {
                        Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'PROGRESS' @{recordsExamined=0}
                        $adapterProgressSignature=$signature
                    }
                }
            }
            $records = @(Read-HarnessProtocol $protocolPath $config.MissionName $attemptId)
            if (@($records | Where-Object eventType -EQ 'QUALIFIER_STARTED').Count -gt 0) {
                $firstObserved = $true
            }
            $progress = @($records | Where-Object eventType -EQ 'PROGRESS')
            if ($progress.Count -gt 0) {
                $progressObserved = $true
                $latest = [DateTimeOffset]::Parse($progress[-1].timestampUtc)
                if ($latest -gt $lastProgress) { $lastProgress = $latest }
            }
            $elapsed = ([DateTimeOffset]::UtcNow - $runtimeStarted).TotalSeconds
            if (-not $firstObserved -and $elapsed -ge $config.Runtime.FirstMarkerTimeoutSeconds) {
                $failureCategory='FIRST_MARKER_TIMEOUT'; throw 'No first marker within the configured interval.'
            }
            if ($firstObserved -and $config.Runtime.RequireProgress -and
                ([DateTimeOffset]::UtcNow - $lastProgress).TotalSeconds -ge $config.Runtime.ProgressTimeoutSeconds) {
                $failureCategory='PROGRESS_TIMEOUT'; throw 'Qualifier progress stalled.'
            }
            if ($elapsed -ge $config.Runtime.HardRuntimeTimeoutSeconds) {
                $failureCategory='HARD_RUNTIME_TIMEOUT'; throw 'Qualifier exceeded the hard runtime bound.'
            }
        }
        $runtimeProcess.WaitForExit()
        $runtimeOutTask.Result |
            Set-Content -LiteralPath $runtimeStdout -Encoding UTF8
        $runtimeErrTask.Result |
            Set-Content -LiteralPath $runtimeStderr -Encoding UTF8
        if ($config.Runtime.psobject.Properties.Name -contains 'AdapterType' -and
            $config.Runtime.AdapterType -eq 'MARKER_FILES') {
            $completeMarker = Join-Path $attemptRoot ('Runtime\' + $config.Runtime.CompletionMarker)
            $completionPattern = if (
                $config.Runtime.psobject.Properties.Name -contains 'CompletionSuccessPattern'
            ) { [string]$config.Runtime.CompletionSuccessPattern } else { '(?im)^PASS\s*$' }
            if ((Test-Path $completeMarker -PathType Leaf) -and
                (Get-Content -Raw $completeMarker) -match $completionPattern) {
                Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'SOURCE_CLOSED'
                Add-HarnessProtocolRecord $protocolPath $config.MissionName $attemptId 'QUALIFIER_COMPLETE' @{
                    verdict='PASS'; sourceCounts=@{bounded=1}; sourceFingerprints=@{}
                    sourceIdentityBefore=$sourceBefore; sourceIdentityAfter=@{}
                    outputFiles=@($completeMarker); outputHashes=@{
                        completion=(Get-HarnessSha256 $completeMarker)
                    }; elapsedMilliseconds=[long](
                        ([DateTimeOffset]::UtcNow-$runtimeStarted).TotalMilliseconds)
                }
            }
        }
        $records = @(Read-HarnessProtocol $protocolPath $config.MissionName $attemptId)
        if ($runtimeProcess.ExitCode -ne 0) { $failureCategory='RUNTIME_EXIT'; throw "Qualifier exit code $($runtimeProcess.ExitCode)." }
        $complete = @($records | Where-Object eventType -EQ 'QUALIFIER_COMPLETE')
        if ($complete.Count -ne 1) { $failureCategory='COMPLETION_MARKER'; throw 'Exactly one completion record is required.' }
        $completion = $complete[0]
        $writeCount = [long]$completion.writeCount; $lockCount = [long]$completion.lockCount
        if ($writeCount -ne 0) { $failureCategory='SOURCE_WRITE'; throw 'A nonzero source write count blocks qualification.' }
        if ($lockCount -ne 0) { $failureCategory='SOURCE_LOCK'; throw 'A nonzero source lock count blocks qualification.' }
        if ($completion.sourceAccessMode -ne 'O_RDONLY') { $failureCategory='SOURCE_MODE'; throw 'Completion did not prove O_RDONLY access.' }
        $sourceAfter = Get-HarnessSourceIdentity @($config.RequiredSourcePaths)
        if (-not (Test-HarnessSourceIdentity $sourceBefore $sourceAfter)) {
            $failureCategory='SOURCE_IDENTITY_CHANGED'; throw 'A source identity changed.'
        }
        if ($completion.verdict -notin @('PASS','PASS WITH CLARIFICATIONS')) {
            $failureCategory='QUALIFIER_VERDICT'; throw "Qualifier verdict: $($completion.verdict)"
        }
        $verdict = $completion.verdict
    }
    catch {
        if (-not $failureCategory) { $failureCategory='CONTROLLED_FAILURE' }
        $errorText = ($_ | Out-String).Trim()
        $verdict = if ($failureCategory -in @(
            'WRONG_IDENTITY','ELEVATED_TOKEN','MISSING_MAPPING','SOURCE_PREFLIGHT'
        )) { 'BLOCKED' } else { 'FAILED' }
        if ($runtimeProcess -and -not $runtimeProcess.HasExited) {
            Stop-HarnessOwnedProcess $runtimeEntry $config.Runtime.GracefulCloseTimeoutSeconds `
                $gracefulPath $cleanup
        }
        if ($compilerProcess -and -not $compilerProcess.HasExited) {
            Stop-HarnessOwnedProcess $compileEntry $config.Runtime.GracefulCloseTimeoutSeconds `
                $null $cleanup
        }
        if ($sourceBefore.Count -gt 0) {
            try { $sourceAfter = Get-HarnessSourceIdentity @($config.RequiredSourcePaths) } catch {}
        }
    }
    finally {
        $remaining = @($ledger | Where-Object { Test-HarnessOwnedProcess $_ })
        Write-HarnessJson @($cleanup) (Join-Path $attemptRoot 'cleanup-evidence.json')
        $result = [ordered]@{
            Verdict=$verdict; FailureCategory=$failureCategory; Error=$errorText
            Mission=$config.MissionName; AttemptId=$attemptId; AttemptRoot=$attemptRoot
            StartedAtUtc=$started.ToString('O'); CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
            Identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
            Elevated=(Get-HarnessElevation); SourceAccessMode='O_RDONLY'
            SourceIdentityBefore=$sourceBefore; SourceIdentityAfter=$sourceAfter
            SourceIdentityStable=$(if ($sourceBefore.Count -gt 0 -and $sourceAfter.Count -gt 0) {
                Test-HarnessSourceIdentity $sourceBefore $sourceAfter
            } else { $false })
            SourceWrites=$writeCount; SourceLocks=$lockCount
            MissionOwnedProcessesRemaining=$remaining.Count
            Processes=@($ledger); Cleanup=@($cleanup)
        }
        if ($remaining.Count -gt 0) { $result.Verdict='FAILED'; $result.FailureCategory='CLEANUP_INCOMPLETE' }
        Write-HarnessJson $result (Join-Path $attemptRoot 'attempt-verdict.json')
        if (Test-Path $lockPath) { Remove-Item -LiteralPath $lockPath -Force }
    }
    [pscustomobject]$result
}

Export-ModuleMember -Function Invoke-VProQualificationHarness, Test-VProVariableNames
