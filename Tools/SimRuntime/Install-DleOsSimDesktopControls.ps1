[CmdletBinding()]
param([string[]] $OpenShortcutPath, [string] $SimHome = (Join-Path $env:USERPROFILE '.dle-os\SIM'))
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'DesktopControls'
# LOCALAPPDATA is virtualized inside packaged Codex. This user-home path is shared with Explorer.
$destination = Join-Path $SimHome 'Controls'
$stableProfile = Join-Path $SimHome 'sim-profile.json'
$profileSource = $null
if (-not (Test-Path -LiteralPath $stableProfile)) {
    $profileSource = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
    if (-not (Test-Path -LiteralPath $profileSource)) { throw 'Configure a SIM profile before installing Desktop controls.' }
    New-Item -ItemType Directory -Path $SimHome -Force | Out-Null
    # The profile is nonsecret. Credentials remain in the existing User environment.
    Copy-Item -LiteralPath $profileSource -Destination $stableProfile
}
$desktop = [Environment]::GetFolderPath('Desktop')
$simDesktop = Join-Path $desktop 'DLE-OS SIM'
$shortcuts = @($OpenShortcutPath) + @(
    (Join-Path $simDesktop 'Start SIM.lnk'),
    (Join-Path $simDesktop 'Start and Open SIM.lnk'),
    (Join-Path $simDesktop 'Open SIM.lnk'),
    (Join-Path $simDesktop 'Stop SIM.lnk'),
    (Join-Path $desktop 'Open DLE-OS SIM.lnk')
)
$shortcuts = @($shortcuts | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique)
foreach ($path in $OpenShortcutPath) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or [IO.Path]::GetExtension($path) -ne '.lnk') { throw 'Provide existing SIM .lnk paths.' }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$backup = Join-Path $destination ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
if (Test-Path -LiteralPath (Join-Path $destination 'installation.json')) { Copy-Item -LiteralPath (Join-Path $destination 'installation.json') -Destination $backup }
$manifest = foreach ($name in 'Start-DleOsSimServer.ps1','Open-DleOsSimServer.ps1','Stop-DleOsSimServer.ps1') {
    $target = Join-Path $destination $name
    if (Test-Path $target) { Copy-Item -LiteralPath $target -Destination $backup }
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target -Force
    [pscustomobject]@{name=$name;sha256=(Get-FileHash $target).Hash}
}
$shell = New-Object -ComObject WScript.Shell
$index=0
$linkManifest = foreach ($path in $shortcuts) {
    $index++
    $backupPath=Join-Path $backup "shortcut-$index.lnk"
    Copy-Item -LiteralPath $path -Destination $backupPath
    $shortcut=$shell.CreateShortcut($path)
    $before=@{target=$shortcut.TargetPath;arguments=$shortcut.Arguments;workingDirectory=$shortcut.WorkingDirectory}
    $isStop=[IO.Path]::GetFileName($path) -eq 'Stop SIM.lnk'
    $entry=if($isStop){'Stop-DleOsSimServer.ps1'}else{'Open-DleOsSimServer.ps1'}
    $shortcut.TargetPath='C:\Program Files\PowerShell\7\pwsh.exe'
    $shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $destination $entry)+'" -SimHome "'+$SimHome+'"'
    $shortcut.WorkingDirectory=$destination
    $shortcut.Description=if($isStop){'Stop the configured DLE-OS SIM safely'}else{'Start or verify DLE-OS SIM, then open it in Edge'}
    $shortcut.Save()
    $finalPath=$path
    if ($path -eq (Join-Path $simDesktop 'Start SIM.lnk') -and -not (Test-Path -LiteralPath (Join-Path $simDesktop 'Start and Open SIM.lnk'))) {
        $finalPath=Join-Path $simDesktop 'Start and Open SIM.lnk'
        Move-Item -LiteralPath $path -Destination $finalPath
    }
    [pscustomobject]@{originalPath=$path;installedPath=$finalPath;backup=$backupPath;before=$before;sha256=(Get-FileHash -LiteralPath $finalPath).Hash}
}
@{installedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');simHome=$SimHome;profileSource=$profileSource;source=$source;backup=$backup;files=@($manifest);shortcuts=@($linkManifest)} |
    ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $destination 'installation.json') -Encoding UTF8
[pscustomobject]@{simHome=$SimHome;backup=$backup;shortcuts=@($linkManifest | Select-Object originalPath,installedPath)}
