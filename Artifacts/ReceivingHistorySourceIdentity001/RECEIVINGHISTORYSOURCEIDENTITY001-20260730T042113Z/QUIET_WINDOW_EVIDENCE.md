# Quiet Window Evidence

- Host preflight: `2026-07-30T04:27:15.9440155Z`
- Full-read recheck: `2026-07-30T04:30:16.6553803Z`
- Identity: `DLE-OS-HOST\DLE-OS`
- Elevated: `False`
- Existing mapped `X:` visible: `True`
- Fixed POT sources visible: `True`
- Active VPro processes before experiments: `0`
- Overlapping Receiving identity attempts: `0`
- Source last-write times remained unchanged throughout A–G

The only process keyword hit in the initial broad search was VS Code's
unrelated `--inspect-port` argument. It was not a Receiving or Visual PRO/5
process.

Experiments ran sequentially. Each prior attempt had zero mission-owned
processes remaining before the next began.
