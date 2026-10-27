"""Install ONE synthetic demo from WorkflowChecks output while normal SIM is stopped.

Never completes or changes an existing review. State-root and source fixture root
must be supplied explicitly; existing SIM records and document bytes are preserved.
"""
import hashlib
import json
from pathlib import Path
import shutil
import socket
import sys

state, fixture = map(lambda s: Path(s).resolve(), sys.argv[1:3])
with socket.socket() as probe:
    if probe.connect_ex(('192.168.0.201', 5177)) == 0:
        raise RuntimeError('Stop normal SIM before installing the isolated demo.')
path = state / 'data/rfq-intakes.json'
data = json.loads(path.read_text(encoding='utf-8-sig'))
existing = next((r for r in data['records'] if r['customer']['customerName'] == 'Synthetic RFQs Phase 1'), None)
if existing:
    print(existing['intakeId'])
    sys.exit(0)
record = json.loads((fixture / 'data/rfq-intakes.json').read_text(encoding='utf-8-sig'))['records'][0]
assert record['status'] == 'READY_FOR_RFQ_WORKING_QUEUE'
assert record['technicalReview']['workflow']['outputs']['status'] == 'READY'
assert record['customer']['resolutionSource'] == 'fixture'
sequence = data['lastIntakeSequence'] + 1
intake_id = f'RFQI-SIM-{sequence:04}'
assert not any(r['intakeId'] == intake_id for r in data['records'])
record = json.loads(json.dumps(record).replace(record['intakeId'], intake_id))
record['customer'] = dict(customerId='SIM-RFQS-PHASE1', customerNumber='SYNTHETIC', customerName='Synthetic RFQs Phase 1', resolutionSource='isolated qualification fixture')
draft = record['requestCorrelationId']
source = (fixture / 'intake-documents' / draft).resolve()
target = (state / 'intake-documents' / draft).resolve()
assert source.is_relative_to(fixture / 'intake-documents')
assert target.is_relative_to(state / 'intake-documents') and not target.exists()
shutil.copytree(source, target)
for original in source.rglob('*'):
    if original.is_file():
        assert hashlib.sha256(original.read_bytes()).digest() == hashlib.sha256((target / original.relative_to(source)).read_bytes()).digest()
data['records'].append(record)
data['lastIntakeSequence'] = sequence
temporary = path.with_suffix('.rfqs-demo-write')
text = json.dumps(data, ensure_ascii=False, indent=2)
temporary.write_text(text, encoding='utf-8')
assert json.loads(temporary.read_text(encoding='utf-8')) == data
temporary.replace(path)
print(intake_id)
