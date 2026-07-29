@echo off
setlocal
"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE" -S lpc:.\SQLEXPRESS -E -b -i "C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Database\020_AddInvoiceHistoryRefresh.sql" -o "C:\DLE-OS\Repositories\DLE-OS\Artifacts\InvoiceHistoryRefresh001\INVOICEHISTORYREFRESH001-20260729T135205Z\SCHEMA_INSTALL.log"
exit /b %ERRORLEVEL%
