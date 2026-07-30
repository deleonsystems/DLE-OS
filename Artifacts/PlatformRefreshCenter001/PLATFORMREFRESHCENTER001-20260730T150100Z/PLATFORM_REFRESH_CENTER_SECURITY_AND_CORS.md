# Security and CORS

- Allowed browser origin: exactly `http://dle-os-host:5041`.
- Allowed methods: GET and POST.
- Allowed headers: `Accept` and `Content-Type`.
- Credentials: allowed for Windows Integrated Authentication.
- Wildcard or arbitrary origins: prohibited.
- All Refresh Center routes require the exact operator policy.
- Fixed registry, runner, state, and audit paths are compiled/configured by governance rather than accepted from requests.
- The control host itself performs no VPro, SQL, mirror, or backup access.

Live qualification:

- Allowed exact-origin preflight: HTTP 204; ACAO `http://dle-os-host:5041`; credentials `true`; methods `GET,POST`; headers `Accept,Content-Type`.
- Unapproved origin: HTTP 204 without ACAO or credential response headers.
- Anonymous GET: HTTP 401.
- Authorized operator GET/POST: accepted.
- Unsupported action: bounded HTTP 409.
- Force-full without all three confirmations: HTTP 400 and no runner launch.

The active control-host owner and authenticated requester were both `DLE-OS-HOST\DLE-OS`.
