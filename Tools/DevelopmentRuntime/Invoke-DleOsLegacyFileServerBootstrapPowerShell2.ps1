[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$BootstrapRequestPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputDirectory
)

$ErrorActionPreference='Stop'
$launcherLog='C:\DLE-OS\Bootstrap\TransactionA-PowerShell2-launcher.log'
$transactionId=[IO.Path]::GetFileName($OutputDirectory.TrimEnd('\'))
$exitCodePath='C:\DLE-OS\Bootstrap\TransactionA-'+$transactionId+'-launcher.exitcode'

function Write-LauncherLog([string]$Message) {
    try {
        $encoding=New-Object System.Text.UTF8Encoding($false)
        [IO.File]::AppendAllText($launcherLog,('['+[DateTimeOffset]::Now.ToString('o')+'] '+$Message+[Environment]::NewLine),$encoding)
    }
    catch {
        [Console]::Error.WriteLine('Launcher log write failed: '+$_.Exception.Message)
    }
}

function Write-ExitCode([int]$Code) {
    $encoding=New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($exitCodePath,[string]$Code,$encoding)
}

try {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This launcher requires an already-elevated Administrator shell.'
    }
    if($env:COMPUTERNAME -ine 'DELEON-SERVER') {
        throw ('This launcher may run only on DELEON-SERVER, not '+$env:COMPUTERNAME+'.')
    }
    if(Test-Path -LiteralPath $OutputDirectory) {
        throw 'Transaction output already exists. Refusing to retry or overlay prior state.'
    }
    $packageDirectory=Split-Path -Parent $BootstrapRequestPath
    $sourcePath=Join-Path $packageDirectory 'DleOsLegacyFileServerBootstrap.cs'
    if(-not(Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw 'The sealed legacy transaction source is absent.'
    }
    Write-LauncherLog ('Compiling the sealed transaction source in memory as '+$identity.Name+'.')
    $source=[IO.File]::ReadAllText($sourcePath)
    $runtimeDirectory=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $referenceDirectory='C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\v3.5'
    $references=@(
        (Join-Path $runtimeDirectory 'System.dll'),
        (Join-Path $runtimeDirectory 'System.Security.dll'),
        (Join-Path $runtimeDirectory 'System.DirectoryServices.dll'),
        (Join-Path $runtimeDirectory 'System.Management.dll'),
        (Join-Path $referenceDirectory 'System.Core.dll'),
        (Join-Path $referenceDirectory 'System.Web.Extensions.dll'))
    foreach($reference in $references) {
        if(-not(Test-Path -LiteralPath $reference -PathType Leaf)) {
            throw ('Required CLR 2/.NET 3.5 reference is absent: '+$reference)
        }
    }
    $providerOptions=New-Object 'Collections.Generic.Dictionary[string,string]'
    $providerOptions.Add('CompilerVersion','v3.5')
    $provider=New-Object Microsoft.CSharp.CSharpCodeProvider($providerOptions)
    $compilerParameters=New-Object CodeDom.Compiler.CompilerParameters
    $compilerParameters.GenerateExecutable=$false
    $compilerParameters.GenerateInMemory=$true
    $compilerParameters.TreatWarningsAsErrors=$false
    foreach($reference in $references) { [void]$compilerParameters.ReferencedAssemblies.Add($reference) }
    $compilerResult=$provider.CompileAssemblyFromSource($compilerParameters,$source)
    if($compilerResult.Errors.HasErrors) {
        $messages=@($compilerResult.Errors|ForEach-Object {$_.ToString()})
        throw ('C# 3 in-memory compile failed: '+($messages-join' | '))
    }
    if($null -eq $compilerResult.CompiledAssembly.GetType('DleOsLegacyFileServerBootstrap',$false)) {
        throw 'The in-memory transaction type was not produced.'
    }
    $result=[int][DleOsLegacyFileServerBootstrap]::RunBootstrap($BootstrapRequestPath,$OutputDirectory)
    Write-LauncherLog ('In-memory Transaction A exit code: '+$result+'.')
    Write-ExitCode $result
    exit $result
}
catch {
    $message=$_.Exception.Message
    if($_.Exception.InnerException) { $message=$message+' | '+$_.Exception.InnerException.Message }
    Write-LauncherLog ('Launcher failure before or during Transaction A: '+$message)
    [Console]::Error.WriteLine($message)
    Write-ExitCode 10
    exit 10
}
