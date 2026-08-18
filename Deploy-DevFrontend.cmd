@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\DevelopmentRuntime\Deploy-DevFrontend.ps1"
exit /b %ERRORLEVEL%
