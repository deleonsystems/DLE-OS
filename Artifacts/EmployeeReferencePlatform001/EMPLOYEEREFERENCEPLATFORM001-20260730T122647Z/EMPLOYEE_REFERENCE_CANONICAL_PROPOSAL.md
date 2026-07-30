# Employee Reference Canonical Proposal

The accepted additive contract is `EMPLOYEE_REFERENCE_1.0`.

## EmployeeReference

Natural key: `FirmId + EmployeeNumber`.

Members: firm, employee number, display/first/last name, department code/name,
job-title code/title, employee status, active flag, source identity, import run,
and import timestamp.

Supervisor, initials, hire date, inactive date, contact details, and payroll
attributes are absent because they were not both operationally required and
safely proven.

## EmployeeOperationalCode

Natural key: `CodeScope + CodeType + OperationalCode`.

`CodeScope` is `GLOBAL` for SYM operator aliases and `FIRM` for buyer and
salesperson references. `CodeType` is one of Buyer, Salesperson, or Operator.
Ownership is nullable and accompanied by `ResolvedUnique`, `Unresolved`,
`Ambiguous`, or `GenericSystem`.

## Supporting references

`DepartmentReference` and `JobTitleReference` use firm plus their two-character
code as natural key.
