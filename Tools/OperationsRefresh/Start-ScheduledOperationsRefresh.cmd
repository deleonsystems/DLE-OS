@echo off
setlocal
set "RUNNER=C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Invoke-OperationsRefresh.ps1"
set "LOG_ROOT=C:\DLE-OS\Canonical\OperationsRefresh\Logs"
if not exist "%LOG_ROOT%" mkdir "%LOG_ROOT%"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%RUNNER%" -Trigger Scheduled 1>>"%LOG_ROOT%\scheduled.stdout.log" 2>>"%LOG_ROOT%\scheduled.stderr.log"
exit /b %ERRORLEVEL%
