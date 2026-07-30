# Operations Refresh Schedule Policy

- Task: `DLE-OS Operations Refresh`
- Local schedule: 02:00 Monday–Friday
- Timezone: America/Los_Angeles (`Pacific Standard Time`)
- Allowed automatic start: 00:00 through 04:30
- Approved quiet window: 00:00 through 05:59
- Weekend: blocked
- StartWhenAvailable: false
- Multiple instances: IgnoreNew
- Identity: `DLE-OS-HOST\DLE-OS`
- Logon type: InteractiveToken
- Run level: Limited
- Stored credentials: none

The task is designed to install disabled, then be enabled only after runtime
and live acceptance. Installation was not attempted because UAC was canceled.
