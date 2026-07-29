@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Complete-InvoiceHistoryRefreshFromLocalExtraction.ps1" -RunId "INVOICEHISTORYREFRESH-20260729T144018Z-3B2B64EE" > "C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\LOCAL_COMPLETION.log" 2>&1
exit /b %ERRORLEVEL%
