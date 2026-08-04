@echo off
setlocal
set "RUNNER=C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Invoke-OperationsRefresh.ps1"
set "LOG_ROOT=C:\DLE-OS\Canonical\OperationsRefresh\Logs"
if not exist "%LOG_ROOT%" mkdir "%LOG_ROOT%"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%RUNNER%" -Trigger Manual -QuietWindowReady 1>>"%LOG_ROOT%\manual.stdout.log" 2>>"%LOG_ROOT%\manual.stderr.log"
exit /b %ERRORLEVEL%
