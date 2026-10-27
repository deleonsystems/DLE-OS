# Path B: current authorization through the existing frontend

Status: isolated implementation on published f018f92; not activated or live qualified.

## Threat and trust review

The frontend already owns OIDC cookies, server tickets, account resolution and the
ES256 issuer. This change deliberately makes it authoritative for current permissions
and approved reviewer eligibility too. A compromised frontend can now lie about those
facts; the backend no longer independently rereads SQL. The frontend's existing local
SQL settings are inherited, not relaxed here and not certified as secure by this work.
The backend has no SQL configuration, registration or fallback.
The shared DleOs.Security assembly remains for the established DTO/interface types;
its dormant SQL implementation is neither constructed nor registered in the backend.
SqlClient remains a packaged binary dependency of those preserved shared assemblies;
its presence does not require or grant a SQL connection. Removing that binary would
require splitting the established shared assemblies and is outside this change.

## Exact exchange

1. Existing cookie handler, ticket store and antiforgery checks admit the browser
request. The BFF creates its usual signed identity assertion and a process-memory
pending entry keyed by assertion SHA256. The entry binds immutable subject, exact
roles/permissions, HTTP method/path/query/content-type/body hash, cancellation and a
10-second deadline. Capacity is 256; no persistent ticket or extra key is created.
2. The quoting backend verifies the ordinary trusted frontend Windows caller and
existing assertion, then asks the configured frontend loopback authorization path
with that assertion, request digest and a fresh random challenge. No browser cookie
or credentials are forwarded. Redirects/cookie handling and proxy use are disabled explicitly. Callback URLs require numeric 127.0.0.1; environment/default proxy settings cannot redirect transport.
3. The internal path explicitly requires HTTP.sys Windows authentication as
NT SERVICE\DleOsDevelopmentQuoting, its exact PrimarySid S-1-5-80-2215837332-1385069786-3903630375-3118558622-574371864, and a loopback peer. Both name and SID come from the explicit HTTP.sys authentication result, never request headers. It does not accept browser
cookie authority. Only a currently pending request can consume an entry, exactly once.
4. A new handler scope rereads the existing session ticket; logout/revocation/expiry
before this point denies. The existing IUserAuthorizationResolver performs fresh
lookups for the subject and at most 32 explicitly configured reviewer IDs. Changed
roles/permissions deny the admitted request. Disabled/ineligible reviewers are omitted.
5. The frontend serializes a bounded snapshot and uses the existing ES256 issuer to
sign its domain-separated SHA256 commitment in the correlation field, with a dedicated
authorization audience. It binds subject, original assertion, request, challenge,
issue/deadline, current permissions and reviewer allowlist/results. No new crypto
algorithm or independent trust key is introduced.
6. The backend validates signature, audience, commitment, challenge, subject, request,
time and reviewer allowlist, then applies existing QuotingPolicy and original-assertion
role consistency. It uses the response only in this request. No cross-request cache,
SQL fallback or unbounded user directory lookup exists. A repeat exchange fails closed.

Revocation cannot undo a business request already admitted. The fresh decision has a
maximum 10-second window; the backend rejects expired reuse. Changes after the fresh
lookup have the same transactional time-of-check race as any authorization check.
Navigation cancellation propagates, but cannot roll back a mutation already committed.
The frontend pending map is process-local: restart/load balancing loses admission and
fails closed. No automatic retry of writes or consumed authorizations is permitted.

## Remaining live gates

The exact existing frontend loopback URL remains unset. No frontend URLACL is proposed.
The service proposal remains NT SERVICE\DleOsDevelopmentQuoting on 127.0.0.1:5060,
with the same dedicated release/data roots and no SQL grants. Final service Windows outbound identity MUST still be established in separately authorized SCM/HTTP.sys staging. It must not be assumed to appear as its local service name: virtual accounts
can use the machine identity for network access. Current exact-caller enforcement
intentionally fails closed if that occurs. Do not broaden acceptance to all machine
processes; a different service credential/transport boundary needs specific review.
Synthetic transport tests do not qualify this gate. Existing frontend signer public-key
binding, role application, accounts (ray/michelle/adan), real reviewer IDs/references,
OIDC dependency compatibility, paused browser acceptance and 49.2 provenance remain
separate gates. Current Miguel SUPER_ADMIN is unchanged; Miguel Jr. stays deferred.

Installation and rollback scripts remain review-only. Coordinated frontend/backend
activation is required; a mixed protocol fails closed. Rollback preserves all records,
roles and accounts and never silently restores direct SQL or relaxes validation.

## Verified synthetic transport evidence, 2026-10-27

Run e3542c80-659e-4ca7-8af8-64cf86107d31 used temporary
NT SERVICE\DleOsQuotingIdentityProbe and numeric loopback port 51328.
The observer recorded that exact name and registered service SID via Negotiate,
returning 200; independently authenticated Miguel received 403 and anonymous 401.
Observer lifetime was 90.008 seconds. Service, URL reservation, files and listener
were removed. Probe source checkpoint a446134cd3c0d91a65000e813df3ff2109c071aa;
package manifest A5796DA79C543C10568F76829001641535B09BF52482F990DF790B6BA4E5168B.
This proves the local transport mechanism, not the eventual service or application.
No probe identity/port is accepted by the installable callback gate.

Read-only sc.exe showsid DleOsDevelopmentQuoting returned the deterministic SID
S-1-5-80-2215837332-1385069786-3903630375-3118558622-574371864, status Inactive.
The candidate pins that SID plus service name; it neither registers nor grants it.
Final registration must verify the resolved identity/SID before acceptance.
The production proposal remains DleOsDevelopmentQuoting at 127.0.0.1:5060.
The frontend authorization endpoint remains unset until approved binding discovery.
No SQL connection/grant is required by quoting; the inherited frontend resolver and
its SQL security posture are unchanged. Actual frontend HTTP.sys integration,
final service identity, real bindings, and browser acceptance remain live gates.