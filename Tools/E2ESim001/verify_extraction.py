"""Exercise the existing local enriched parser on customer files, without an intake."""
from pathlib import Path
import base64, json, subprocess, sys
root=Path(__file__).resolve().parents[2]
out=root/'output/pdf/E2E-SIM-001'
payload={'job':{'governingDocumentId':'offline-source-check'},'documents':[{'source':{'documentId':'offline-source-check','mimeType':'application/pdf'},'binary':base64.b64encode((out/'02_SIM-ASSY-001_BOM_A.pdf').read_bytes()).decode()}]}
result=subprocess.run([sys.executable,str(root/'Tools/SimRuntime/DleOs.SimHost/sim_bom_enrichment.py')],input=json.dumps(payload),capture_output=True,text=True,check=True)
data=json.loads(result.stdout)
assert data['outcome']=='EXTRACTED' and len(data['rows'])==12
assert data['coverage']=='TABLES_COMPLETE'
assert [r['fields']['lineNumber']['value'] for r in data['rows']]==list(map(str,range(1,13)))
opto=data['rows'][4]['fields']
assert opto['partNumber']['value']=='SIM-OPTO-4' and opto['quantity']['value']=='2'
(out/'extraction-validation.json').write_text(json.dumps({'result':'PASS','parser':'existing sim_bom_enrichment.py','rows':12,'coverage':data['coverage'],'coverageReason':data['coverageReason'],'applicationIntakeCreated':False,'limitation':'Offline parser verification; human Technical Review and row identity approval still required.'},indent=2))
print('PASS: existing enriched parser extracted all 12 rows; optocoupler demand 2 x 10 = 20; no intake created.')
