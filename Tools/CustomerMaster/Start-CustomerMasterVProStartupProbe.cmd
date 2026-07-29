@echo off
setlocal
set "SCRIPT=C:\DLE-OS\Repositories\DLE-OS\Tools\CustomerMaster\Test-CustomerMasterVProStartup.ps1"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"
exit /b %ERRORLEVEL%
