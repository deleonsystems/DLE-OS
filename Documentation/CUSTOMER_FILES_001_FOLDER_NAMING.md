# CUSTOMER-FILES-001 Folder Naming

The governed root is fixed at:

`\\DeLeon-Server\Production\Customer Files`

Each top-level folder is generated as:

`<six-digit canonical Customer Number> - <filesystem-safe display name>`

The canonical Customer Number and Customer Name are never changed in SQL or
RFQ state. Sanitization applies only to `folderDisplayName`.

The deterministic display-name rule is:

1. Trim leading and trailing whitespace.
2. Replace Windows-invalid characters (`\ / : * ? " < > |`) and control
   characters with `_`.
3. Collapse repeated whitespace to one space.
4. Remove trailing spaces and periods.
5. Prefix Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1` through
   `COM9`, and `LPT1` through `LPT9`) with `_`.
6. Limit the display portion to 120 characters and remove any trailing spaces
   or periods introduced by truncation.
7. Use `CUSTOMER` if the display portion is otherwise empty.

Folder discovery uses the exact canonical-number prefix
`<Customer Number> - `. A changed canonical name therefore produces
`NAME_MISMATCH`; it never causes a second folder to be created.

For CUSTOMER-FILES-001, `NAME_MISMATCH` blocks RFQ completion. This is safer
than allowing a warning because the governed folder name is part of operational
customer resolution and automatic rename is intentionally out of scope.
