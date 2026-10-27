param([Parameter(Mandatory)][string]$AssemblyDirectory)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination=Join-Path $candidate 'shared-assemblies'
$manifest=Get-Content -LiteralPath (Join-Path $destination 'manifest.json') -Raw | ConvertFrom-Json
# Verify the complete allowlist before copying any file. Never read configuration,
# keys, tickets, credentials or arbitrary files from the supplied directory.
foreach($file in $manifest){
 if([IO.Path]::GetFileName($file.Name) -ne $file.Name -or !($file.Name.EndsWith('.dll'))){throw 'Invalid assembly allowlist'}
 $path=Join-Path $AssemblyDirectory $file.Name
 if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.Sha256){throw "Unqualified assembly: $($file.Name)"}
}
foreach($file in $manifest){Copy-Item -LiteralPath (Join-Path $AssemblyDirectory $file.Name) -Destination (Join-Path $destination $file.Name)}
Write-Output "Verified $($manifest.Count) external assembly inputs. No services or configuration changed."
