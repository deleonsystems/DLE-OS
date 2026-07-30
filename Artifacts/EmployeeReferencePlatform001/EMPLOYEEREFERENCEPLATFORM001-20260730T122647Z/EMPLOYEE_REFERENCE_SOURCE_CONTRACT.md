# Employee Reference Source Contract

The source contract is a privacy-bounded projection, not a payroll contract.

| Source | Accepted purpose | Retained projection |
|---|---|---|
| `PRM-01` | Current employee identity | Firm, employee number, first/last/display name, department code, job-title code, derived active flag |
| `PRM-10` layout `E` | Department reference | Firm, department code, department description |
| `PRM-10` layout `F` | Job-title reference | Firm, job-title code, job-title description |
| `SYM-02` | Operator alias reference | Operator code and noncredential display name |
| `ARM-10` layout `F` | Salesperson reference | Firm, salesperson code, salesperson description |
| `IVM-10` layout `F` | Buyer reference | Firm, buyer code, buyer description |

Every source is opened using the exact qualified `X:\AON\ADATA\...` path and
`MODE="O_RDONLY"`. Directory browsing, arbitrary paths, alternate credentials,
UNC substitution, source writes, and source locks are outside the contract.

`PRM-02`, `PRM-03`, `WOM-01`, and `WOM-03` are excluded. `PRM-02` contains pay
data; `PRM-03` is a mixed duplicate/index source; WOM is non-authoritative when
Payroll is installed.

The PRM-01 termination-date bytes are examined only in VPro process memory to
derive `IsActive`; the raw value and any date are not retained.
