# Canonical Viewer Security Boundary

## Trusted boundary

The viewer trusts only canonical JSON returned by the configured DLE-OS API
under `/api/platform/v1`. The existing API base URL configuration remains the
single host authority.

## Request rules

- Canonical methods issue GET only.
- List query names are fixed per entity.
- Page and pageSize are validated and pageSize cannot exceed 200.
- Identifiers are encoded as complete URI path segments, including `+`, `*`,
  `/`, spaces, and other reserved characters.
- `AbortSignal` is propagated through the shared API client.
- No arbitrary URL, method, body, header, or SQL input is accepted from the
  workspace.
- Canonical methods never call `getJsonWithFallback`.

## Rendering rules

API values are placed into DOM nodes with `textContent`. They are not
interpolated into HTML. Null and empty values remain distinct in state and
share only the neutral visual marker `—`.

Errors are reduced to safe status-specific messages. Responses never display
stack traces, raw server errors, SQL, connection strings, server paths,
legacy source identifiers, or provenance.

## Prohibited boundaries

The module has no direct SQL client, local file API, mirror CSV request,
project business-data JSON request, Add+ON access, network-drive access,
Visual PRO/5 integration, importer call, mirror-engine call, write request,
or data-changing control.

Template HTML and module CSS are static application assets, not business-data
fallbacks.

## Verification

The automated audit checks request methods, endpoint paths, source text,
field labels, API-client encoding, page-size enforcement, template
registration, cleanup hooks, and the absence of prohibited paths or legacy
field names. Browser qualification confirms the network request set consists
only of static module assets and canonical API GET requests.
