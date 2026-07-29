# Future Dataset Qualification Work Order Template

Provide:

- mission name;
- exact approved source list;
- qualifier source file;
- expected local outputs;
- timeout profile;
- bounded dataset parameters;
- business acceptance rules.

Invoke:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  C:\DLE-OS\Repositories\DLE-OS\Tools\VProQualificationHarness\Invoke-VProQualificationHarness.ps1 `
  -ConfigurationPath <fixed-reviewed-configuration.json>
```

The dataset implementation must open every record source with
`MODE="O_RDONLY"` and emit protocol 1.0 (or use the documented migration
adapter). It must not implement its own compiler trust, attempt reuse, process
name cleanup, overlap lock, or retry loop.

The harness owns fresh directories, source/elevation preflight, variable scan,
compiler validation, supervision, exact ownership/cleanup, overlap, retry,
safety evidence, hashes, and verdict lifecycle. Vendor Master and Purchase
Order work must use this contract unless a documented unsupported requirement
is approved.
