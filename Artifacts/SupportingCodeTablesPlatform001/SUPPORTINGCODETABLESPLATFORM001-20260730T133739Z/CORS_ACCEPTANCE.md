# CORS Acceptance

Verdict: **PASS**

- Exact allowed origin: `http://dle-os-host:5041`
- Allowed-origin GET: HTTP 200 with matching
  `Access-Control-Allow-Origin`
- Allowed-origin preflight: HTTP 204; method `GET`
- Unapproved origin `http://evil.example`: no
  `Access-Control-Allow-Origin`
- Wildcard origin: not enabled
- Credential broadening: not enabled
