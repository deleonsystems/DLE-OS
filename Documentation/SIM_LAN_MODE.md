# DLE-OS SIM private-LAN mode

## Address model

Use one hostname per developer workstation:

- `sim-miguel.dle-os.internal.dlemfg.com` -> Miguel's assigned private address
- `sim-adan.dle-os.internal.dlemfg.com` -> Adan's assigned private address

Do not use one universal `sim.dle-os.internal.dlemfg.com` for independent local
SIMs. Each clone retains its own `.sim-state`, database, branch, process, and
host. A universal name is appropriate only for a future centralized SIM host,
which Phase 13 does not create.

## Observed DEV architecture (2026-09-02)

`dev.dle-os.internal.dlemfg.com` resolves to `192.168.0.105`, including through
the public authoritative DNS path. The address is private and is not publicly
routable. The DLE-OS Development Frontend registers the exact
`HTTPS://DEV.DLE-OS.INTERNAL.DLEMFG.COM:443/` URL directly with HTTP.sys; no
reverse proxy was observed. HTTP.sys binds an exact-name Let's Encrypt
certificate from `LocalMachine\My`. The certificate SAN contains only
`dev.dle-os.internal.dlemfg.com`; it cannot authenticate a SIM hostname.

The certificate is publicly trusted, so iPad/iPhone needs no private root CA.
LAN reachability comes from local Wi-Fi routing, or from a VPN route/policy to
the workstation's private subnet. DNS resolution alone does not prove that a
VPN permits client-to-workstation traffic.

## Required administrator boundary

No DNS, certificate, HTTP.sys, SonicWall, VPN, or firewall change was made by
Phase 13. Before physical-device use, an administrator must:

1. Reserve or confirm the workstation's stable private address.
2. Create an `A` record for the developer-specific SIM hostname targeting that
   address. Prefer internal/split DNS scoped to trusted LAN/VPN clients. If DLE
   intentionally follows the existing public-DNS/private-address pattern, the
   record is globally visible but remains privately routed.
3. Issue an exact-SAN, publicly trusted certificate for that hostname, add its
   renewal identifier to the governed ACME allowlist, install it in the
   developer's `CurrentUser\My` or `LocalMachine\My` store, and grant only that
   developer and the renewal identity read access to the private key.
4. Confirm the trusted VPN resolves the name and routes only the intended VPN
   clients to the workstation and SIM port. Do not add router forwarding or a
   public tunnel.

The SIM uses Kestrel directly on its non-governed port. It does not add an
HTTP.sys URL or certificate binding and does not reuse the DEV hostname or DEV
certificate.

## Firewall boundary

There was no enabled inbound firewall rule for TCP 5177 at inspection time.
Do not create a rule until the iPad/iPhone private addresses are known and the
user explicitly approves it. The proposed rule is:

```powershell
$dotnetPath = (Get-Command dotnet -ErrorAction Stop).Source
New-NetFirewallRule `
  -DisplayName 'DLE-OS SIM LAN 5177 (Private devices only)' `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalAddress 192.168.0.105 -LocalPort 5177 `
  -RemoteAddress <IPAD_PRIVATE_IP>,<IPHONE_PRIVATE_IP> `
  -Profile Private -Program $dotnetPath
```

If stable device addresses cannot be reserved, `LocalSubnet` is the broader
fallback and must be an explicit user decision. Never include the Public
profile. No outbound rule is needed: LAN mode adds no downstream client and
preserves the SIM isolation boundary.

## Start and stop

After the administrator boundary is complete:

```powershell
& .\Tools\SimRuntime\Start-DleOsSim.ps1 -Lan `
  -LanAddress 192.168.0.105 `
  -LanHostName sim-miguel.dle-os.internal.dlemfg.com `
  -CertificateThumbprint <SIM_CERTIFICATE_THUMBPRINT>
```

The launcher rejects a public/non-private/unassigned address and a non-Private
Windows network profile. The runtime independently rejects unsafe addresses,
missing LAN settings, unreadable/expired/wrong-SAN certificates, unexpected
Host headers, and requests without its one-run access session. Ctrl+C stops the
single process and removes the listener; there is no companion proxy or
service to leave running.
