Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security

function Write-DleOsUtf8File([string]$Path,[string]$Text) {
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path,$Text,$encoding)
}

function Get-DleOsSha256Hex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','') }
    finally { $sha.Dispose() }
}

function Get-DleOsFileSha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Protect-DleOsBytes([byte[]]$Plain,[byte[]]$Entropy,
    [Security.Cryptography.DataProtectionScope]$Scope) {
    [Security.Cryptography.ProtectedData]::Protect($Plain,$Entropy,$Scope)
}

function Unprotect-DleOsBytes([byte[]]$Protected,[byte[]]$Entropy,
    [Security.Cryptography.DataProtectionScope]$Scope) {
    [Security.Cryptography.ProtectedData]::Unprotect($Protected,$Entropy,$Scope)
}

function ConvertTo-DleOsRsaParametersRecord([Security.Cryptography.RSAParameters]$Parameters,
    [switch]$IncludePrivate) {
    $record = [ordered]@{
        Modulus = [Convert]::ToBase64String($Parameters.Modulus)
        Exponent = [Convert]::ToBase64String($Parameters.Exponent)
    }
    if ($IncludePrivate) {
        foreach ($name in 'D','P','Q','DP','DQ','InverseQ') {
            $record[$name] = [Convert]::ToBase64String($Parameters.$name)
        }
    }
    [pscustomobject]$record
}

function ConvertFrom-DleOsRsaParametersRecord([object]$Record,[switch]$IncludePrivate) {
    $parameters = New-Object Security.Cryptography.RSAParameters
    $parameters.Modulus = [Convert]::FromBase64String([string]$Record.Modulus)
    $parameters.Exponent = [Convert]::FromBase64String([string]$Record.Exponent)
    if ($IncludePrivate) {
        foreach ($name in 'D','P','Q','DP','DQ','InverseQ') {
            $parameters.$name = [Convert]::FromBase64String([string]$Record.$name)
        }
    }
    $parameters
}

function New-DleOsOneTimePasswordMaterial {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@'
    $random = New-Object byte[] 48
    $chars = New-Object char[] 48
    $bytes = $null
    $secure = New-Object Security.SecureString
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($random)
    $rng.Dispose()
    try {
        for ($index=0; $index -lt $chars.Length; $index++) {
            $chars[$index] = $alphabet[$random[$index] % $alphabet.Length]
            $secure.AppendChar($chars[$index])
        }
        $secure.MakeReadOnly()
        $bytes = [Text.Encoding]::UTF8.GetBytes($chars)
        [pscustomobject]@{SecureString=$secure;Bytes=$bytes;Characters=$chars;RandomBytes=$random}
    }
    catch {
        $secure.Dispose()
        [Array]::Clear($random,0,$random.Length)
        [Array]::Clear($chars,0,$chars.Length)
        if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        throw
    }
}

function Clear-DleOsPasswordMaterial([object]$Material) {
    if ($null -eq $Material) { return }
    if ($Material.SecureString) { $Material.SecureString.Dispose() }
    foreach ($name in 'Bytes','Characters','RandomBytes') {
        $value = $Material.$name
        if ($value) { [Array]::Clear($value,0,$value.Length) }
    }
}

function Get-DleOsHmacSha256([byte[]]$Key,[byte[]]$Bytes) {
    $hmac = New-Object Security.Cryptography.HMACSHA256
    $hmac.Key = $Key
    try { ([BitConverter]::ToString($hmac.ComputeHash($Bytes))).Replace('-','') }
    finally { $hmac.Dispose() }
}

function Set-DleOsSecretFileAcl([string]$Path,[Security.Principal.SecurityIdentifier]$OwnerSid) {
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($OwnerSid)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @(
        $OwnerSid,
        (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),
        (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,[Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
