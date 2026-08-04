@echo off
setlocal
set "RUNNER=C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1"
set "LOG_ROOT=C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Logs"
if not exist "%LOG_ROOT%" mkdir "%LOG_ROOT%"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%RUNNER%" 1>>"%LOG_ROOT%\runner.stdout.log" 2>>"%LOG_ROOT%\runner.stderr.log"
exit /b %ERRORLEVEL%
