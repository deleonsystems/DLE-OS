[CmdletBinding()]
param(
    [string]$PackagePath = 'Artifacts\EmployeeReferencePlatform001\EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z\BaselinePackage',
    [switch]$ApplySchema
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$expectedIdentity = 'DLE-OS-HOST\Miguel'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $expectedIdentity) {
    throw "Employee Directory synchronization requires $expectedIdentity."
}

$connectionString = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;'
$boundary = New-Object System.Data.SqlClient.SqlConnectionStringBuilder $connectionString
if ($boundary.InitialCatalog -cne 'DLE_OS_SECURITY_DEV' -or $boundary.InitialCatalog -match 'LIVE') {
    throw 'Employee Directory synchronization database boundary is invalid.'
}

function Invoke-SqlBatchFile([System.Data.SqlClient.SqlConnection]$Connection,[string]$Path) {
    $script = [IO.File]::ReadAllText($Path)
    foreach ($batch in [regex]::Split($script,'(?im)^\s*GO\s*$')) {
        if ([string]::IsNullOrWhiteSpace($batch)) { continue }
        $command = $Connection.CreateCommand()
        try {
            $command.CommandText = $batch
            $command.CommandTimeout = 60
            [void]$command.ExecuteNonQuery()
        }
        finally { $command.Dispose() }
    }
}

function ConvertTo-UserNameToken([string]$Value) {
    $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object Text.StringBuilder
    foreach ($character in $normalized.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -eq
            [Globalization.UnicodeCategory]::NonSpacingMark) { continue }
        if ([char]::IsLetterOrDigit($character)) { [void]$builder.Append([char]::ToLowerInvariant($character)) }
    }
    return $builder.ToString()
}

$resolvedPackage = if ([IO.Path]::IsPathRooted($PackagePath)) {
    (Resolve-Path $PackagePath).Path
} else {
    (Resolve-Path (Join-Path $repository $PackagePath)).Path
}
$csvPath = Join-Path $resolvedPackage 'EmployeeReference.csv'
$metadataPath = Join-Path $resolvedPackage 'metadata.json'
$hashPath = Join-Path $resolvedPackage 'package.sha256'
foreach ($path in $csvPath,$metadataPath,$hashPath) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required package file is absent: $path" }
}

$rows = @(Import-Csv -LiteralPath $csvPath)
if ($rows.Count -eq 0) { throw 'The approved Employee Reference source contains no employees.' }
$requiredColumns = @('FirmId','EmployeeNumber','DisplayName','FirstName','LastName','DepartmentCode','DepartmentName','JobTitleCode','JobTitle','EmployeeStatus','IsActive','SourceSystem','SourceRecordIdentity')
$actualColumns = @($rows[0].PSObject.Properties.Name)
if (@($requiredColumns | Where-Object {$_ -notin $actualColumns}).Count -ne 0) {
    throw 'Employee source package does not satisfy the approved safe field contract.'
}

$reserved = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
$connection.Open()
try {
    if ($ApplySchema) {
        Invoke-SqlBatchFile $connection (Join-Path $repository 'Tools\SecurityFoundation\Database\003_AddEmployeeDirectory.sql')
    }
    if (-not $ApplySchema) {
        $exists = $connection.CreateCommand()
        try {
            $exists.CommandText = "SELECT OBJECT_ID(N'hr.usp_SyncEmployeeDirectory',N'P')"
            $procedureId = $exists.ExecuteScalar()
            if ($null -eq $procedureId -or $procedureId -is [DBNull]) {
                throw 'Employee Directory schema is absent. Run with -ApplySchema.'
            }
        }
        finally { $exists.Dispose() }
    }
    $userCommand = $connection.CreateCommand()
    try {
        $userCommand.CommandText = 'SELECT UserId,UserName FROM security.[User];'
        $reader = $userCommand.ExecuteReader()
        $miguelUserId = $null
        while ($reader.Read()) {
            [void]$reserved.Add($reader.GetString(1))
            if ($reader.GetString(1) -ceq 'Miguel') { $miguelUserId = $reader.GetGuid(0) }
        }
        $reader.Close()
        if ($null -eq $miguelUserId) { throw 'The existing Miguel security user is absent.' }
    }
    finally { $userCommand.Dispose() }

    $sourceRows = foreach ($row in ($rows | Sort-Object FirmId,EmployeeNumber)) {
        $raw = [string]$row.EmployeeNumber
        $normalizedNumber = if ($raw -cmatch '^\d{4}0{5}$') { $raw.Substring(0,4) } else { $null }
        $proposal = $null
        if ($raw -ceq '005400000') {
            $proposal = 'miguel'
        }
        elseif ($raw -cne '000100000' -and $null -ne $normalizedNumber) {
            $given = ([string]$row.FirstName -split '\s+')[0]
            $first = ConvertTo-UserNameToken $given
            $last = ConvertTo-UserNameToken ([string]$row.LastName)
            $proposal = $first
            if ($reserved.Contains($proposal)) { $proposal = "$first.$last" }
            if ($reserved.Contains($proposal)) { $proposal = "$first.$last.$normalizedNumber" }
            if (-not $reserved.Add($proposal)) { throw "Unable to generate a unique username proposal for $raw." }
        }
        [ordered]@{
            FirmId = [string]$row.FirmId
            SourceEmployeeIdRaw = $raw
            FirstName = ([string]$row.FirstName).Trim()
            LastName = ([string]$row.LastName).Trim()
            DisplayName = ([string]$row.DisplayName).Trim()
            DepartmentCode = ([string]$row.DepartmentCode).Trim()
            DepartmentName = ([string]$row.DepartmentName).Trim()
            JobTitleCode = ([string]$row.JobTitleCode).Trim()
            JobTitle = ([string]$row.JobTitle).Trim()
            EmployeeStatus = ([string]$row.EmployeeStatus).ToUpperInvariant()
            ProposedUserName = $proposal
        }
    }

    $metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
    $packageHash = ((Get-Content -Raw -LiteralPath $hashPath) -split '\s+')[0].Trim().ToUpperInvariant()
    $json = @($sourceRows) | ConvertTo-Json -Depth 5 -Compress
    $sync = $connection.CreateCommand()
    try {
        $sync.CommandType = [Data.CommandType]::StoredProcedure
        $sync.CommandText = 'hr.usp_SyncEmployeeDirectory'
        [void]$sync.Parameters.Add('@SourceSystem',[Data.SqlDbType]::VarChar,32)
        $sync.Parameters['@SourceSystem'].Value = 'VPRO5_PRM01'
        [void]$sync.Parameters.Add('@SourceQualificationRunId',[Data.SqlDbType]::NVarChar,128)
        $sync.Parameters['@SourceQualificationRunId'].Value = [string]$metadata.sourceQualificationAttemptId
        [void]$sync.Parameters.Add('@SourcePackageSha256',[Data.SqlDbType]::Char,64)
        $sync.Parameters['@SourcePackageSha256'].Value = $packageHash
        [void]$sync.Parameters.Add('@SourceRowsJson',[Data.SqlDbType]::NVarChar,-1)
        $sync.Parameters['@SourceRowsJson'].Value = $json
        [void]$sync.Parameters.Add('@MiguelUserId',[Data.SqlDbType]::UniqueIdentifier)
        $sync.Parameters['@MiguelUserId'].Value = $miguelUserId
        [void]$sync.Parameters.Add('@ExecutedBy',[Data.SqlDbType]::NVarChar,256)
        $sync.Parameters['@ExecutedBy'].Value = $identity
        $reader = $sync.ExecuteReader()
        [void]$reader.Read()
        $result = [ordered]@{
            Verdict = 'PASS'
            EmployeeSyncRunId = $reader.GetGuid(0)
            InsertedCount = $reader.GetInt32(1)
            UpdatedCount = $reader.GetInt32(2)
            EmployeeCount = $reader.GetInt32(3)
            ReviewCount = $reader.GetInt32(4)
            SourceQualificationRunId = [string]$metadata.sourceQualificationAttemptId
            SourcePackageSha256 = $packageHash
            ExecutedBy = $identity
        }
        $reader.Close()
    }
    finally { $sync.Dispose() }
}
finally { $connection.Dispose() }

$evidenceDirectory = Join-Path $repository '.tmp\employee-directory'
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'latest-sync.json') -Encoding utf8
[pscustomobject]$result
