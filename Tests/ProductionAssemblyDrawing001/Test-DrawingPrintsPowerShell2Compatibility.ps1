[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

[void][Reflection.Assembly]::LoadWithPartialName('System.Security')

function Return-NoItems { return @() }
function Return-OneItem { return @('one') }
function Return-ManyItems { return @('one', 'two') }

$none = @(Return-NoItems)
$one = @(Return-OneItem)
$many = @(Return-ManyItems)
if ($none.Count -ne 0) { throw 'Explicit empty-array cardinality failed.' }
if ($one.Count -ne 1 -or $one[0] -ne 'one') { throw 'Explicit scalar-to-array cardinality failed.' }
if ($many.Count -ne 2) { throw 'Explicit multi-item array cardinality failed.' }

$root = Join-Path ([IO.Path]::GetTempPath()) ('DleOsPs2Preflight-' + [Guid]::NewGuid().ToString('N'))
$resolved = [IO.Path]::GetFullPath($root)
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Compatibility fixture escaped the temporary root.'
}

try {
    [void][IO.Directory]::CreateDirectory($resolved)
    [void][IO.Directory]::CreateDirectory((Join-Path $resolved 'customer'))
    [void][IO.Directory]::CreateDirectory((Join-Path $resolved 'customer\assembly'))
    [void][IO.Directory]::CreateDirectory((Join-Path $resolved 'customer\assembly\REV J'))
    [IO.File]::WriteAllText((Join-Path $resolved 'metadata-probe.txt'), 'metadata only')

    $stack = New-Object Collections.Generic.Stack[string]
    $stack.Push($resolved)
    $directoryCount = 0
    $fileCount = 0
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        foreach ($directory in [IO.Directory]::GetDirectories($current)) {
            if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Unexpected reparse point in compatibility fixture.'
            }
            $directoryCount++
            $stack.Push($directory)
        }
        foreach ($file in [IO.Directory]::GetFiles($current)) {
            $info = New-Object IO.FileInfo($file)
            if ($info.Length -lt 0) { throw 'File metadata length was invalid.' }
            $fileCount++
        }
    }
    if ($directoryCount -ne 3 -or $fileCount -ne 1) {
        throw 'Legacy directory enumeration compatibility failed.'
    }

    $bytes = [Text.Encoding]::UTF8.GetBytes('PS2 compatibility preflight')
    $sha = New-Object Security.Cryptography.SHA256Managed
    try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Clear(); [Array]::Clear($bytes, 0, $bytes.Length) }
    if ([string]::IsNullOrEmpty($hash)) { throw 'Legacy SHA-256 compatibility failed.' }

    $plain = [Text.Encoding]::UTF8.GetBytes('rollback-sddl-fixture')
    $entropy = [Text.Encoding]::UTF8.GetBytes('DLE-OS|DRAWING-PRINTS|DIRECTORY-READ|ROLLBACK-V1')
    $cipher = $null
    $roundTrip = $null
    try {
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        $roundTrip = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        if ([Text.Encoding]::UTF8.GetString($roundTrip) -ne 'rollback-sddl-fixture') {
            throw 'Legacy DPAPI rollback-state round trip failed.'
        }
    }
    finally {
        if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
        if ($null -ne $entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
        if ($null -ne $cipher) { [Array]::Clear($cipher, 0, $cipher.Length) }
        if ($null -ne $roundTrip) { [Array]::Clear($roundTrip, 0, $roundTrip.Length) }
    }
    Write-Output 'PowerShell 2 scalar/array, enumeration, SHA-256, and DPAPI preflight compatibility: PASS'
}
finally {
    if ([IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
