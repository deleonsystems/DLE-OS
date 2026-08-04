@echo off
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Stop-StaleInvoiceHistoryQualificationWaiter.ps1"
exit /b %ERRORLEVEL%
