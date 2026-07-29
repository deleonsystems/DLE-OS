@echo off
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Get-InvoiceHistoryQualificationProcessState.ps1"
exit /b %ERRORLEVEL%
