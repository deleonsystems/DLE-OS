# CUSTOMER-FILES-002 — Customer Requirements & Compliance

## Governed location

The optional customer-level folder is:

```text
\\DeLeon-Server\Production\Customer Files\
<Customer Number> - <Canonical Customer Name>\
00 Customer Requirements & Compliance
```

The subfolder name is fixed. Browser and protocol callers provide only a
canonical six-digit Customer Number; they cannot provide a path or folder
name.

## Boundary

- The main customer folder must be `VERIFIED`.
- Only the 5053 Customer Files control service may inspect or create the
  optional folder.
- Creation is explicit and idempotent.
- No delete, rename, move, merge, permission, listing, or document-content
  operation is exposed.
- The optional folder is not created in bulk and is not required for RFQ
  validation.
- The protected `\\DeLeon-Server\Production\Drawing-Prints` directory remains
  outside the service boundary.

## States

- `NOT_CREATED`
- `AVAILABLE`
- `CUSTOMER_FOLDER_NOT_VERIFIED`
- `ACCESS_DENIED`
- `ERROR`

## Development routes

```text
GET  /api/customer-files/v1/customers/{customerNumber}/requirements-compliance
POST /api/customer-files/v1/customers/{customerNumber}/requirements-compliance
```

The POST accepts no body, query parameters, folder name, or path.

## DLE-OS-HOST protocol action

```text
dle-customer-files://open-requirements/<six-digit Customer Number>
```

The existing `dle-customer-files://open/<Customer Number>` action remains
supported.

## Rollback

1. Stop only the development 5053 process.
2. Revert the CUSTOMER-FILES-002 source changes.
3. Rebuild and restart 5053 under the normal `DLE-OS-HOST\DLE-OS` operator
   identity.
4. Re-registering the protocol is unnecessary when its existing registry
   command still points to the repository launcher script.
5. The controlled customer’s optional test folder is operational data and
   must not be removed without separate explicit approval.
