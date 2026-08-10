[CmdletBinding()]
param([switch]$RequireLegacyReferenceCompile)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$sourcePath=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsLegacyFileServerBootstrap.cs'
$manifestPath=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsLegacyFileServerBootstrap.manifest'
$powerShell2Path=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsLegacyFileServerBootstrapPowerShell2.ps1'
$requestSource=Get-Content -Raw (Join-Path $repository 'Tools\DevelopmentRuntime\New-DleOsDevelopmentFrontendFileServerBootstrapRequest.ps1')
$source=Get-Content -Raw $sourcePath
$manifest=Get-Content -Raw $manifestPath
$powerShell2=Get-Content -Raw $powerShell2Path
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Name){if(-not$Condition){throw "FAILED: $Name"};$checks.Add($Name)}

Check (-not($source-match'WindowsPrincipal\]::new|Get-LocalUser|New-LocalUser|Remove-LocalUser|Get-SmbShare|Set-SmbShare|Grant-SmbShareAccess|Revoke-SmbShareAccess|Get-FileHash|Convert(To|From)-Json|\$PSScriptRoot')) 'server transaction has no PowerShell 3/5 or Server 2012 module dependency'
Check ($source.Contains('System.DirectoryServices')-and$source.Contains('WinNT://')) 'local account management uses legacy ADSI'
Check ($source.Contains('Win32_LogicalShareSecuritySetting')-and$source.Contains('GetSecurityDescriptor')-and$source.Contains('SetSecurityDescriptor')) 'share DACL management uses the Server 2008 R2 WMI provider'
Check ($source.Contains('DirectorySecurity')-and$source.Contains('FileSystemRights.ReadAndExecute')) 'NTFS management uses .NET Framework ACL APIs'
Check ($source.Contains('LsaAddAccountRights')-and$source.Contains('LsaRemoveAccountRights')) 'deny-logon rights use legacy LSA APIs'
Check ($source.Contains('RSACryptoServiceProvider')-and$source.Contains('HMACSHA256')-and$source.Contains('ProtectedData.Protect')) 'legacy CSP, SHA-256 HMAC, and DPAPI protect the handoff and rollback'
Check ($source.Contains('return 1;')-and$requestSource.Contains('Transaction A exit code: %TRANSACTION_EXIT%')) 'native failure and launcher exit codes are explicit'
Check ($manifest.Contains('requireAdministrator')) 'the executable requests elevation through a Windows manifest'
Check ($requestSource.Contains("'DleOsLegacyFileServerBootstrap.exe'")-and-not($requestSource-match"'Invoke-DleOsDevelopmentFrontendFileServerBootstrapLocal.ps1'|'Undo-DleOsDevelopmentFrontendFileServerBootstrapLocal.ps1'")) 'sealed server package excludes the superseded PowerShell transaction'
Check ($requestSource.Contains("'Invoke-DleOsLegacyFileServerBootstrapPowerShell2.ps1'")-and$requestSource.Contains('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass')) 'sealed launcher uses Microsoft-signed PowerShell rather than direct EXE execution'
Check ($powerShell2.Contains('New-Object Security.Principal.WindowsPrincipal($identity)')-and$powerShell2.Contains("CSharpCodeProvider(`$providerOptions)")-and$powerShell2.Contains("CompilerVersion','v3.5")-and$powerShell2.Contains('[DleOsLegacyFileServerBootstrap]::RunBootstrap($BootstrapRequestPath,$OutputDirectory)')) 'PowerShell 2 launcher verifies elevation and invokes the public two-string bridge with the C# 3 provider'
Check ($source.Contains('public static int RunBootstrap(string requestPath, string outputDirectory)')-and-not($powerShell2-match'GetMethod|\.Invoke\(')) 'PowerShell 2 invocation contains no reflection or array marshaling'
Check ($powerShell2.Contains("launcher.exitcode")-and$requestSource.Contains('set /p TRANSACTION_EXIT=<"%EXIT_MARKER%"')) 'PowerShell 2 exit status is carried through a required transaction-specific marker'
Check (-not($powerShell2-match'::new\s*\(|\[ordered\]|Get-FileHash|Get-Content\s+-Raw|\$PSScriptRoot|Get-LocalUser|Get-SmbShare')) 'PowerShell 2 launcher contains no newer syntax or module dependency'

$compiler=@(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1
Check ([bool]$compiler) '.NET Framework 4 compiler baseline is available for qualification'
$output=Join-Path $repository ('.tmp\legacy-compatibility-test\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output -Force|Out-Null
$testExecutable=Join-Path $output 'DleOsLegacyFileServerBootstrap.ExitTest.exe'
& $compiler /nologo /target:exe /platform:anycpu /optimize+ "/out:$testExecutable" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Security.dll `
    /reference:System.DirectoryServices.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll $sourcePath
Check ($LASTEXITCODE-eq 0-and(Test-Path -LiteralPath $testExecutable)) 'source compiles against the .NET Framework 4 reference surface'
$stderr=Join-Path $output 'expected-failure.stderr.txt'
$processInfo=[Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName=$testExecutable
$processInfo.Arguments='invalid'
$processInfo.UseShellExecute=$false
$processInfo.CreateNoWindow=$true
$processInfo.RedirectStandardError=$true
$process=[Diagnostics.Process]::Start($processInfo)
$failureText=$process.StandardError.ReadToEnd()
$process.WaitForExit()
[IO.File]::WriteAllText($stderr,$failureText)
Check ($process.ExitCode-eq 1) 'compiled transaction returns exit code 1 for a governed failure'
$process.Dispose()
$references=[Reflection.Assembly]::ReflectionOnlyLoadFrom($testExecutable).GetReferencedAssemblies()
$allowed='mscorlib','System','System.Core','System.Security','System.DirectoryServices','System.Management','System.Web.Extensions'
Check (@($references|Where-Object{$allowed-notcontains$_.Name}).Count-eq 0) 'compiled transaction references only installed Windows/.NET framework assemblies'

$serverFramework='\\DELEON-SERVER\C$\Windows\Microsoft.NET\Framework64\v2.0.50727'
$serverReferences='\\DELEON-SERVER\C$\Program Files (x86)\Reference Assemblies\Microsoft\Framework\v3.5'
$clr2Executable=Join-Path $output 'DleOsLegacyFileServerBootstrap.Clr2.dll'
$legacyReferences=@(
    "$serverFramework\mscorlib.dll","$serverFramework\System.dll",
    "$serverFramework\System.Security.dll","$serverFramework\System.DirectoryServices.dll",
    "$serverFramework\System.Management.dll","$serverReferences\System.Core.dll",
    "$serverReferences\System.Web.Extensions.dll")
function Test-ReadableLegacyReference([string]$Path) {
    try { return Test-Path -LiteralPath $Path -PathType Leaf -ErrorAction Stop }
    catch { return $false }
}
if ($RequireLegacyReferenceCompile) {
    Check (@($legacyReferences|Where-Object{-not(Test-ReadableLegacyReference $_)}).Count-eq 0) 'DELEON-SERVER CLR 2/.NET 3.5 reference assemblies are readable'
    & $compiler /nologo /noconfig /nostdlib+ /langversion:3 /target:library /platform:anycpu /optimize+ "/out:$clr2Executable" `
        "/reference:$serverFramework\mscorlib.dll" "/reference:$serverFramework\System.dll" `
        "/reference:$serverFramework\System.Security.dll" "/reference:$serverFramework\System.DirectoryServices.dll" `
        "/reference:$serverFramework\System.Management.dll" "/reference:$serverReferences\System.Core.dll" `
        "/reference:$serverReferences\System.Web.Extensions.dll" $sourcePath
    Check ($LASTEXITCODE-eq 0-and(Test-Path -LiteralPath $clr2Executable)) 'transaction compiles as C# 3 against DELEON-SERVER CLR 2 and .NET 3.5 references'
    Check (([Reflection.Assembly]::ReflectionOnlyLoadFrom($clr2Executable).ImageRuntimeVersion)-eq'v2.0.50727') 'in-memory transaction targets the PowerShell 2 CLR generation'
}
else {
    Write-Output 'SKIP: remote CLR 2/.NET 3.5 compile is opt-in; static Server 2008 R2 compatibility checks still ran.'
}

Write-Output "PASS: $($checks.Count) Windows Server 2008 R2 / legacy PowerShell compatibility checks."
$checks|ForEach-Object{Write-Output "  $_"}
