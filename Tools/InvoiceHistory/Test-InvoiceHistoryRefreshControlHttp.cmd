@echo off
setlocal
set "SCRIPT=C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Test-InvoiceHistoryRefreshControlHttp.ps1"
set "LOG=C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\CONTROL_HOST_HTTP_QUALIFICATION.log"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%" > "%LOG%" 2>&1
endlocal
