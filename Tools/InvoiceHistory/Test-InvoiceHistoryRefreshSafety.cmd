@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Test-InvoiceHistoryRefreshSafety.ps1" > "C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\REFRESH_SAFETY_QUALIFICATION.log" 2>&1
exit /b %ERRORLEVEL%
