@echo off
setlocal
set "QUALIFICATION_SCRIPT=C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Invoke-InvoiceHistoryBoundedWindowQualification.ps1"
set "QUALIFICATION_LOG=C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\BOUNDED_PROBE_OPERATOR_LAUNCH.log"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%QUALIFICATION_SCRIPT%" > "%QUALIFICATION_LOG%" 2>&1
exit /b %ERRORLEVEL%
