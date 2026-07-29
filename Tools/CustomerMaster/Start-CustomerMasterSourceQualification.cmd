@echo off
setlocal
set "SCRIPT=C:\DLE-OS\Repositories\DLE-OS\Tools\CustomerMaster\Invoke-CustomerMasterSourceQualification.ps1"
set "ARTIFACT_ROOT=C:\DLE-OS\Repositories\DLE-OS\Artifacts\CustomerMasterPlatform001\CUSTOMERMASTERPLATFORM001-20260729T170951Z"
set "LOG=C:\DLE-OS\Repositories\DLE-OS\Artifacts\CustomerMasterPlatform001\CUSTOMERMASTERPLATFORM001-20260729T170951Z\CUSTOMER_MASTER_OPERATOR_LAUNCH.log"
if not exist "%ARTIFACT_ROOT%" mkdir "%ARTIFACT_ROOT%"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%" > "%LOG%" 2>&1
exit /b %ERRORLEVEL%
