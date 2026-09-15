[CmdletBinding()]
param([string] $Python = (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'))
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$target = Join-Path $repository '.sim-state/analysis-python-packages'
& $Python -m pip install --disable-pip-version-check --target $target 'xlrd==2.0.2'
if ($LASTEXITCODE -ne 0) { throw 'SIM XLS reader installation failed.' }
# pip's temporary directory can carry restrictive ACLs; restore only this dependency directory's inheritance.
& icacls $target /reset /T /Q
if ($LASTEXITCODE -ne 0) { throw 'SIM XLS reader permissions could not be restored.' }
