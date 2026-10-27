from pathlib import Path
import shutil,json,hashlib,sys
w=Path(sys.argv[1]).resolve();r=Path(__file__).resolve().parents[2];f=w/'fixture-ui'
f.mkdir(exist_ok=True)
for n in ['SRC','ASSETS','Tools/SimRuntime/Scenarios']:shutil.copytree(r/n,f/n,dirs_exist_ok=True)
for n in ['DLE_Work_Center_v4.0.0.html','Tools/SimRuntime/DleOs.SimHost/DleOs.SimHost.csproj']:
 (f/n).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(r/n,f/n)
p=f/'test-package';(p/'schema').mkdir(parents=True,exist_ok=True)
rows=[dict(referenceId=f'dle-customer:{i:06}',customerNumber=f'{i:06}',displayName=f'Fixture Customer {i:02}',aliases=['Shared test alias'],sourceLabels=['Customer Master']) for i in range(1,36)]
(p/'sim-customer-reference.json').write_text(json.dumps(rows))
(p/'manifest.json').write_text(json.dumps(dict(schemaVersion='DLE_SIM_CUSTOMER_REFERENCE_PACKAGE_V1',status='PASS_OPTIMISTIC_VERSION_BRACKETED',packageId='fixture-ui',customerCount=35,captureCompletedAtUtc='2026-01-01T12:00:00Z',freshness=dict(customerMaster=dict(snapshotAsOfUtc='2026-01-01T10:00:00Z'),operations=dict(snapshotAsOfUtc='2026-01-01T10:00:00Z'),invoiceHistory=dict(activatedAtUtc='2026-01-01T09:00:00Z')))))
(p/'schema/sim-customer-reference.schema.json').write_text('{}')
(p/'hashes.json').write_text(json.dumps([dict(path=x.relative_to(p).as_posix(),bytes=x.stat().st_size,sha256=hashlib.sha256(x.read_bytes()).hexdigest()) for x in p.rglob('*') if x.is_file() and x.name!='hashes.json']))
