[CmdletBinding()]
param(
    [switch]$QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$packageRoot = Join-Path $repository (
    'Artifacts\EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z\BaselinePackage')
$database = 'DLE_OS_CANONICAL_LIVE'
$server = 'lpc:.\SQLEXPRESS'
$manifestPath = Join-Path $packageRoot 'manifest.json'
$metadataPath = Join-Path $packageRoot 'metadata.json'
$packageHashPath = Join-Path $packageRoot 'package.sha256'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json

if (
    $manifest.schema -cne 'dle-employee-reference-manifest' -or
    $manifest.schemaVersion -cne '1.0' -or
    $metadata.schema -cne 'dle-employee-reference-package' -or
    $metadata.schemaVersion -cne '1.0' -or
    $metadata.contractVersion -cne 'EMPLOYEE_REFERENCE_1.0' -or
    $metadata.privacyBoundary -cne 'ALLOWLIST_ONLY' -or
    [int]$metadata.prohibitedFieldsPresent -ne 0
) {
    throw 'The package is outside the qualified Employee Reference boundary.'
}

$expectedHeaders = [ordered]@{
    'EmployeeReference.csv' = @(
        'FirmId', 'EmployeeNumber', 'DisplayName', 'FirstName', 'LastName',
        'DepartmentCode', 'DepartmentName', 'JobTitleCode', 'JobTitle',
        'EmployeeStatus', 'IsActive', 'SourceSystem', 'SourceRecordIdentity')
    'EmployeeOperationalCode.csv' = @(
        'CodeScope', 'FirmId', 'EmployeeNumber', 'CodeType', 'OperationalCode',
        'CodeDescription', 'ResolutionStatus', 'IsActive', 'SourceSystem',
        'SourceRecordIdentity')
    'DepartmentReference.csv' = @(
        'FirmId', 'DepartmentCode', 'DepartmentName', 'SourceSystem',
        'SourceRecordIdentity')
    'JobTitleReference.csv' = @(
        'FirmId', 'JobTitleCode', 'JobTitle', 'SourceSystem',
        'SourceRecordIdentity')
}
$prohibited = (
    'ssn|socialsecurity|taxid|payrate|salary|bank|routing|deduction|' +
    'withholding|birthdate|homeaddress|password|pin|garnish|benefit|' +
    'insurance|medical|emergency|immigration|citizenship|disciplin|' +
    'attendance|payrollhistory'
)
$manifestEntries = @{}
foreach ($entry in $manifest.files) {
    $manifestEntries[[string]$entry.name] = [string]$entry.sha256
}
foreach ($name in @($expectedHeaders.Keys) + @('metadata.json')) {
    if (-not $manifestEntries.ContainsKey($name)) {
        throw "Package manifest file entry is missing: $name"
    }
    $path = Join-Path $packageRoot $name
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -cne $manifestEntries[$name]) {
        throw "Package file hash mismatch: $name"
    }
}
$manifestHash = (
    Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$declaredPackageHash = (
    Get-Content -Raw -LiteralPath $packageHashPath).Trim()
if (
    $declaredPackageHash -notmatch '^[0-9A-F]{64}$' -or
    $declaredPackageHash -cne $manifestHash
) {
    throw 'The package SHA-256 does not match the manifest.'
}

$datasets = @{}
foreach ($pair in $expectedHeaders.GetEnumerator()) {
    $path = Join-Path $packageRoot $pair.Key
    $header = (Get-Content -LiteralPath $path -TotalCount 1).Split(',')
    if (($header -join '|') -cne ($pair.Value -join '|')) {
        throw "Package allowlist mismatch: $($pair.Key)"
    }
    if ($header | Where-Object { $_ -match $prohibited }) {
        throw "Prohibited Employee Reference package column: $($pair.Key)"
    }
    $datasets[$pair.Key] = @(Import-Csv -LiteralPath $path)
}

$employees = @($datasets['EmployeeReference.csv'])
$codes = @($datasets['EmployeeOperationalCode.csv'])
$departments = @($datasets['DepartmentReference.csv'])
$titles = @($datasets['JobTitleReference.csv'])
if (
    $employees.Count -ne [int]$metadata.counts.EmployeeReference -or
    $codes.Count -ne [int]$metadata.counts.EmployeeOperationalCode -or
    $departments.Count -ne [int]$metadata.counts.DepartmentReference -or
    $titles.Count -ne [int]$metadata.counts.JobTitleReference
) {
    throw 'Employee Reference entity counts do not match metadata.'
}

function Assert-UniqueKey {
    param([object[]]$Rows, [scriptblock]$Key, [string]$Label)
    $keys = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal)
    foreach ($row in $Rows) {
        $value = & $Key $row
        if ([string]::IsNullOrWhiteSpace($value) -or -not $keys.Add($value)) {
            throw "Invalid or duplicate $Label natural key: $value"
        }
    }
}
Assert-UniqueKey $employees {
    param($row) "$($row.FirmId)|$($row.EmployeeNumber)"
} 'EmployeeReference'
Assert-UniqueKey $codes {
    param($row)
    "$($row.CodeScope)|$($row.CodeType)|$($row.OperationalCode)"
} 'EmployeeOperationalCode'
Assert-UniqueKey $departments {
    param($row) "$($row.FirmId)|$($row.DepartmentCode)"
} 'DepartmentReference'
Assert-UniqueKey $titles {
    param($row) "$($row.FirmId)|$($row.JobTitleCode)"
} 'JobTitleReference'

$employeeKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($employee in $employees) {
    [void]$employeeKeys.Add("$($employee.FirmId)|$($employee.EmployeeNumber)")
}
foreach ($code in $codes) {
    if ($code.EmployeeNumber) {
        $key = "$($code.FirmId)|$($code.EmployeeNumber)"
        if (-not $employeeKeys.Contains($key)) {
            throw "Operational code references an unknown employee: $key"
        }
    }
}

$connectionString = (
    "Server=$server;Database=$database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Employee Reference Baseline Importer'
)
$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()

function New-Command {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $connection.CreateCommand()
    $command.CommandText = $Text
    $command.CommandTimeout = 180
    $command.Transaction = $Transaction
    return $command
}

function New-DataTable {
    param(
        [object[]]$Rows,
        [Collections.Specialized.OrderedDictionary]$Columns,
        [Guid]$RunId,
        [switch]$OperationalCode
    )
    $table = [Data.DataTable]::new()
    foreach ($name in $Columns.Keys) {
        [void]$table.Columns.Add($name, $Columns[$name])
    }
    [void]$table.Columns.Add('EmployeeReferenceImportRunId', [Guid])
    foreach ($source in $Rows) {
        $row = $table.NewRow()
        foreach ($name in $Columns.Keys) {
            $value = $source.$name
            if ($null -eq $value -or $value -eq '') {
                $row[$name] = [DBNull]::Value
            }
            elseif ($Columns[$name] -eq [bool]) {
                $row[$name] = [bool]::Parse($value)
            }
            else {
                $row[$name] = $value
            }
        }
        $row.EmployeeReferenceImportRunId = $RunId
        [void]$table.Rows.Add($row)
    }
    return ,$table
}

function Write-Bulk {
    param(
        [Data.DataTable]$Table,
        [string]$Destination,
        [Data.SqlClient.SqlTransaction]$Transaction
    )
    $bulk = [Data.SqlClient.SqlBulkCopy]::new(
        $connection,
        [Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,
        $Transaction)
    $bulk.DestinationTableName = $Destination
    foreach ($column in $Table.Columns) {
        [void]$bulk.ColumnMappings.Add(
            $column.ColumnName, $column.ColumnName)
    }
    $bulk.WriteToServer($Table)
    $bulk.Dispose()
}

$transaction = $connection.BeginTransaction(
    [Data.IsolationLevel]::Serializable)
$runId = [Guid]::NewGuid()
try {
    $existingCommand = New-Command -Transaction $transaction -Text @'
SELECT TOP (1) EmployeeReferenceImportRunId
FROM platform.EmployeeReferenceImportRun
WHERE PackageSha256 = @PackageSha256
  AND ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
'@
    [void]$existingCommand.Parameters.AddWithValue(
        '@PackageSha256', $declaredPackageHash)
    $existing = $existingCommand.ExecuteScalar()
    if ($null -ne $existing -and -not $QualificationInduceFailure) {
        $transaction.Rollback()
        $connection.Dispose()
        [ordered]@{
            Verdict = 'PASS'
            Behavior = 'NO-OP'
            EmployeeReferenceImportRunId = $existing
            PackageSha256 = $declaredPackageHash
            EmployeeCount = $employees.Count
            OperationalCodeCount = $codes.Count
        } | ConvertTo-Json
        exit 0
    }

    $unresolved = @($codes | Where-Object {
        $_.ResolutionStatus -eq 'Unresolved'
    }).Count
    $ambiguous = @($codes | Where-Object {
        $_.ResolutionStatus -eq 'Ambiguous'
    }).Count
    $generic = @($codes | Where-Object {
        $_.ResolutionStatus -eq 'GenericSystem'
    }).Count
    $start = New-Command -Transaction $transaction -Text @'
INSERT platform.EmployeeReferenceImportRun
(
    EmployeeReferenceImportRunId, SourceQualificationRunId,
    PackageSha256, ManifestSha256, PackageSchema, PackageSchemaVersion,
    ContractVersion, StartedAtUtc, ImportStatus, IsCommitted, IsNoOp,
    EmployeeCount, OperationalCodeCount, DepartmentCount, JobTitleCount,
    ActiveEmployeeCount, InactiveEmployeeCount, UnresolvedCodeCount,
    AmbiguousCodeCount, GenericSystemCodeCount
)
VALUES
(
    @RunId, @SourceQualificationRunId, @PackageSha256, @ManifestSha256,
    @PackageSchema, @PackageSchemaVersion, @ContractVersion,
    SYSUTCDATETIME(), N'PENDING', 0, 0, @EmployeeCount,
    @OperationalCodeCount, @DepartmentCount, @JobTitleCount,
    @ActiveEmployeeCount, @InactiveEmployeeCount, @UnresolvedCodeCount,
    @AmbiguousCodeCount, @GenericSystemCodeCount
);
'@
    $parameters = @{
        '@RunId' = $runId
        '@SourceQualificationRunId' = [string](
            $metadata.sourceQualificationAttemptId)
        '@PackageSha256' = $declaredPackageHash
        '@ManifestSha256' = $manifestHash
        '@PackageSchema' = [string]$metadata.schema
        '@PackageSchemaVersion' = [string]$metadata.schemaVersion
        '@ContractVersion' = [string]$metadata.contractVersion
        '@EmployeeCount' = $employees.Count
        '@OperationalCodeCount' = $codes.Count
        '@DepartmentCount' = $departments.Count
        '@JobTitleCount' = $titles.Count
        '@ActiveEmployeeCount' = [int]$metadata.counts.ActiveEmployees
        '@InactiveEmployeeCount' = [int]$metadata.counts.InactiveEmployees
        '@UnresolvedCodeCount' = $unresolved
        '@AmbiguousCodeCount' = $ambiguous
        '@GenericSystemCodeCount' = $generic
    }
    foreach ($pair in $parameters.GetEnumerator()) {
        [void]$start.Parameters.AddWithValue($pair.Key, $pair.Value)
    }
    [void]$start.ExecuteNonQuery()
    [void](New-Command -Transaction $transaction -Text @'
DELETE FROM canonical.EmployeeOperationalCode;
DELETE FROM canonical.EmployeeReference;
DELETE FROM canonical.DepartmentReference;
DELETE FROM canonical.JobTitleReference;
'@).ExecuteNonQuery()
    if ($QualificationInduceFailure) {
        throw 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
    }

    $employeeColumns = [ordered]@{
        FirmId = [string]; EmployeeNumber = [string]; DisplayName = [string]
        FirstName = [string]; LastName = [string]; DepartmentCode = [string]
        DepartmentName = [string]; JobTitleCode = [string]; JobTitle = [string]
        EmployeeStatus = [string]; IsActive = [bool]; SourceSystem = [string]
        SourceRecordIdentity = [string]
    }
    $codeColumns = [ordered]@{
        CodeScope = [string]; FirmId = [string]; EmployeeNumber = [string]
        CodeType = [string]
        OperationalCode = [string]; CodeDescription = [string]
        ResolutionStatus = [string]; IsActive = [bool]; SourceSystem = [string]
        SourceRecordIdentity = [string]
    }
    $departmentColumns = [ordered]@{
        FirmId = [string]; DepartmentCode = [string]
        DepartmentName = [string]; SourceSystem = [string]
        SourceRecordIdentity = [string]
    }
    $titleColumns = [ordered]@{
        FirmId = [string]; JobTitleCode = [string]; JobTitle = [string]
        SourceSystem = [string]; SourceRecordIdentity = [string]
    }
    Write-Bulk `
        (New-DataTable $departments $departmentColumns $runId) `
        'canonical.DepartmentReference' $transaction
    Write-Bulk `
        (New-DataTable $titles $titleColumns $runId) `
        'canonical.JobTitleReference' $transaction
    Write-Bulk `
        (New-DataTable $employees $employeeColumns $runId) `
        'canonical.EmployeeReference' $transaction
    Write-Bulk `
        (New-DataTable $codes $codeColumns $runId -OperationalCode) `
        'canonical.EmployeeOperationalCode' $transaction

    $complete = New-Command -Transaction $transaction -Text @'
UPDATE platform.EmployeeReferenceImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'SUCCESS',
    IsCommitted = 1
WHERE EmployeeReferenceImportRunId = @RunId;
'@
    [void]$complete.Parameters.AddWithValue('@RunId', $runId)
    [void]$complete.ExecuteNonQuery()
    $transaction.Commit()
}
catch {
    if ($transaction.Connection) {
        $transaction.Rollback()
    }
    $connection.Dispose()
    throw
}

$counts = New-Command -Text @'
SELECT
    (SELECT COUNT_BIG(*) FROM canonical.EmployeeReference),
    (SELECT COUNT_BIG(*) FROM canonical.EmployeeOperationalCode),
    (SELECT COUNT_BIG(*) FROM canonical.DepartmentReference),
    (SELECT COUNT_BIG(*) FROM canonical.JobTitleReference);
'@
$reader = $counts.ExecuteReader()
[void]$reader.Read()
$result = [ordered]@{
    Verdict = 'PASS'
    Behavior = 'IMPORTED'
    EmployeeReferenceImportRunId = $runId
    PackageSha256 = $declaredPackageHash
    EmployeeCount = $reader.GetInt64(0)
    OperationalCodeCount = $reader.GetInt64(1)
    DepartmentCount = $reader.GetInt64(2)
    JobTitleCount = $reader.GetInt64(3)
}
$reader.Close()
$connection.Dispose()
$result | ConvertTo-Json
