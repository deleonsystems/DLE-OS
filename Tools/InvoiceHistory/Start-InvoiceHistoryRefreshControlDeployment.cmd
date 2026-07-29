@echo off
setlocal
set "SCRIPT=C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Deploy-InvoiceHistoryRefreshControl.ps1"
start "" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
endlocal
