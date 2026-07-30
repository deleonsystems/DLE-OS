# Operations Refresh Security and CORS

The implementation preserves Windows Integrated Authentication and the exact
operator allowlist `DLE-OS-HOST\DLE-OS`. CORS remains credentialed and limited
to `http://dle-os-host:5041`; wildcard origins are absent.

All launchers are compile-time fixed. The schedule uses InteractiveToken,
Limited run level, and no stored password. Every source reader rejects
elevation and requires the existing mapped X: context.

Runtime HTTP denial and CORS tests remain pending deployment.
