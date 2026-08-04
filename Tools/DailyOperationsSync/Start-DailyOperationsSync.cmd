@echo off
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1" -Trigger Manual
