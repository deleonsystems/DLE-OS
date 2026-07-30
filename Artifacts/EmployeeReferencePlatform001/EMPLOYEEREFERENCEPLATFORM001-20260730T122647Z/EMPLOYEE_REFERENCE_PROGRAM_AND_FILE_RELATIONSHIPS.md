# Employee Reference Program and File Relationships

- `PRM.MA -> PRM.MB / PRM.MC` proves PRM-01 employee identity fields and
  PRM-10 department/job-title validation.
- `SYM.BA` proves the SYM-02 operator ID and noncredential name fields.
- `ARM.MA` proves ARM-10 as the customer/salesperson reference file and its
  layout-F I/O list.
- `IVM.MA -> IVM.MB` proves IVM-10 layout F and the buyer description at
  `X0$(7,20)`.
- `WOM.CA` proves that WOM employee maintenance defers to Payroll when Payroll
  is installed; WOM was therefore not selected as canonical owner.

The ARM-10F record’s first string contains the six-character physical key
followed by the 24-character salesperson description. The accepted qualifier
uses `IOLIST T0$,T1$,TN[0]` and emits `T0$(7,24)`. A prior candidate used the
second string and returned a numeric commission field; that candidate package
was rejected and never accepted as final.
