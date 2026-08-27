[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bytes = [Text.Encoding]::UTF8.GetBytes('DLE-OS legacy SHA-256 compatibility')
$sha = New-Object Security.Cryptography.SHA256Managed
try {
    $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
}
finally {
    $sha.Clear()
    [Array]::Clear($bytes, 0, $bytes.Length)
}
if ($actual -ne '24318045594ACA3458E873694B6B5A0B8670F1EBBCA50DB0950C712E0096D598') {
    throw ('Legacy SHA-256 compatibility result changed: ' + $actual)
}
Write-Output 'CLR 2-compatible SHA256Managed ComputeHash/Clear path: PASS'
