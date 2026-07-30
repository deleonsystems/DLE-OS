# Supporting Code Tables Source Contract

- Qualified root: `X:\AON\ADATA`
- Access: exact-file allowlist, `MODE="O_RDONLY"` on every record-file open
- Accepted attempt: `SUPPORTING_CODE_TABLES_PLATFORM_001-20260730T134103634Z-A0F9F84F`
- Harness commit: `0f252d9b1578221947b7cb8f9fbab3e8fe0ba966`
- Canonical natural key: `FirmId + CodeDomain + CodeType + CodeValue`
- Source values are case-sensitive and are never trimmed, padded, recased, or inferred.
- Empty source keys are excluded. Restricted fields are not projected.
- No source writes, locks, report execution, or live-program modification are allowed.

Approved source files are `ARM-10`, `APM-10`, `IVM-10`, `IVM-13`,
`POM-02`, `POM-03`, `PRM-10`, `SYM-02`, and `WOM-10`.

The qualifier produces only operational code, description, source identity,
layout, and ordinal evidence. Payroll amounts, deductions, tax, contribution,
union, credential, password, security-role, and security-level content is
outside the contract.
