@echo off
setlocal
set "COMPLETION_LOG=C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\BOUNDED_PROBE_GRACEFUL_CLOSE.log"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Complete-InvoiceHistoryBoundedWindowProbe.ps1" > "%COMPLETION_LOG%" 2>&1
exit /b %ERRORLEVEL%
