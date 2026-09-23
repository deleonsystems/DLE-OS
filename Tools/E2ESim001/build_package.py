"""Build customer source documents only. Never reads or writes application state."""
from pathlib import Path
import hashlib, json, zipfile
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.platypus import Table, TableStyle, Paragraph
from reportlab.lib.styles import ParagraphStyle
import pdfplumber

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/E2E-SIM-001'
OUT.mkdir(parents=True, exist_ok=True)
STYLE = ParagraphStyle('cell', fontName='Helvetica', fontSize=8, leading=11)
ROWS = [
 ('SIM-PCB-001','PCB1',1,'Purchased bare PCB, 80 x 50 mm, rev A'),
 ('SIM-R-1K','R1 R2',2,'1 kohm 1%, 0.25 W, 1206 SMT'),
 ('SIM-R-10K','R3 R4',2,'10 kohm 1%, 0.125 W, 0805 SMT'),
 ('SIM-C-100N','C1 C2',2,'100 nF 10%, 25 V X7R, 0805 SMT'),
 ('SIM-OPTO-4','U1 U2',2,'Phototransistor optocoupler, SMD-4'),
 ('SIM-J-4','J1 J2',2,'4-position terminal, 5.08 mm, through-hole'),
 ('SIM-LED-G','D1 D2',2,'Green LED, 0805 SMT'),
 ('SIM-D-REV','D3 D4',2,'Reverse clamp diode, SOD-123 SMT'),
 ('SIM-TP','TP1 TP2 TP3 TP4',4,'Loop test point, through-hole'),
 ('SIM-HW-M3','H1 H2 H3 H4',4,'M3 snap-in nylon standoff, 6 mm'),
 ('SIM-LABEL','LBL1',1,'Polyester assembly label, 30 x 8 mm'),
 ('SIM-BAG','PKG1',1,'ESD shielding bag, 150 x 100 mm')]
POS = [
 ('J1',10,25,0,'TH'),('J2',70,25,180,'TH'),
 ('R1',23,15,0,'SMT'),('R2',23,35,0,'SMT'),
 ('D1',30,15,0,'SMT'),('D2',30,35,0,'SMT'),
 ('D3',36,10,0,'SMT'),('D4',36,40,0,'SMT'),
 ('U1',43,15,0,'SMT'),('U2',43,35,0,'SMT'),
 ('R3',55,15,90,'SMT'),('R4',55,35,90,'SMT'),
 ('C1',60,15,90,'SMT'),('C2',60,35,90,'SMT'),
 ('TP1',53,23,0,'TH'),('TP2',53,28,0,'TH'),
 ('TP3',62,23,0,'TH'),('TP4',62,28,0,'TH'),
 ('H1',4,4,0,'MECH'),('H2',76,4,0,'MECH'),
 ('H3',76,46,0,'MECH'),('H4',4,46,0,'MECH'),
 ('LBL1',40,5,0,'LABEL')]

def page(c, title, n):
 c.setFillColor(colors.HexColor('#16364A')); c.rect(0,718,612,74,fill=1,stroke=0)
 c.setFillColor(colors.white); c.setFont('Helvetica-Bold',17); c.drawString(36,758,title)
 c.setFont('Helvetica',10); c.drawString(36,738,'E2E-SIM-001 | SIM-ASSY-001 | REV A | ORDER QTY 10')
 c.setFillColor(colors.black); c.setFont('Helvetica',8)
 c.drawString(36,25,'SYNTHETIC CUSTOMER DATA - DLE-OS workflow simulation only | Release A / 2026-09-20')
 c.drawRightString(576,25,str(n))

def para(c, text, y, size=10):
 p=Paragraph(text,ParagraphStyle('p',fontName='Helvetica',fontSize=size,leading=size+4))
 w,h=p.wrap(540,700); assert y-h>42,(text,y,h); p.drawOn(c,36,y-h); return y-h-12

def table(c, data, widths, y, size=8):
 st=ParagraphStyle('t',parent=STYLE,fontSize=size,leading=size+3)
 t=Table([[Paragraph(str(v),st) for v in row] for row in data],colWidths=widths)
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#DAE8EE')),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#9AAFB9')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
 w,h=t.wrap(540,700); assert y-h>45,('table overflow',y,h); t.drawOn(c,36,y-h); return y-h-14

def new(name):
 c=canvas.Canvas(str(OUT/name),pagesize=(612,792),invariant=1)
 c.setTitle(name.removesuffix('.pdf')); c.setAuthor('DLE-SIM-CUSTOMER'); return c

c=new('01_SIM-E2E-001_RFQ_A.pdf'); page(c,'Customer request for quotation',1)
y=para(c,'<b>RFQ reference:</b> SIM-E2E-001-RFQ<br/><b>Customer:</b> DLE-SIM-CUSTOMER (synthetic directory number 990901)<br/><b>Contact:</b> Alex Morgan, Synthetic Electronics Lab; rfq@example.invalid',692)
y=para(c,'Please quote 10 complete SIM-ASSY-001 revision A dual-channel isolated input interface assemblies, including all materials, assembly, inspection, functional test, identification and individual packaging. One configuration, no alternates, no DNP items, no customer-supplied material.',y)
y=para(c,'<b>Quote response:</b> USD unit price and extended price for quantity 10; material and labor contributions; any setup or nonrecurring charges separately; manufacturing lead time after exact award; quote validity; payment and shipping terms. Desired response: within five business days of intake. Requested delivery: four weeks after award, subject to the quoted lead time. No selling price or customer PO is established by this request.',y)
y=para(c,'<b>Scope:</b> Full turnkey. Procure the controlled finished bare PCB SIM-PCB-001 rev A from the synthetic approved manufacturer below; PCB fabrication engineering is outside this assembly purchase. Quote all BOM quantities normally. Supplier stock and internal opening inventory are not customer RFQ requirements.',y)
y=para(c,'<b>Customer commercial request:</b> Net 30, USD; one complete shipment of 10; ground transport prepaid and included in the quoted commercial definition. Synthetic bill-to and ship-to: DLE-SIM-CUSTOMER, Receiving Lab, 100 Simulation Way, Test City, CA 00000 (non-deliverable test address). Record any agreed terms in the final quotation.',y)
y=para(c,'<b>Controlling attachments:</b><br/>02_SIM-ASSY-001_BOM_A.pdf - controlled bill of materials and approved synthetic sourcing.<br/>03_SIM-ASSY-001_Technical_A.pdf - assembly drawing, placement, electrical definition, manufacturing and acceptance requirements.',y)
y=para(c,'<b>Required deliverables with shipment:</b> serial list, completed functional-test results and certificate of conformance to this package. Serial range SIM001-A-001 through SIM001-A-010. No aerospace flowdowns, firmware, programming, coating, potting, burn-in or destructive test. All documents are released together at revision A.',y)
c.save()

c=new('02_SIM-ASSY-001_BOM_A.pdf'); page(c,'Controlled BOM and sourcing',1)
y=para(c,'<b>Assembly:</b> dual-channel isolated input interface. This BOM is the sole material quantity authority. Quantities on page 2 are <b>per one finished assembly</b>, unit EA. Multiply by 10 for this RFQ. All 12 lines are required; all items are installed except the individual protective bag. No substitutions or attrition allowance are specified.',692)
y=para(c,'<b>Approved synthetic manufacturer:</b> DLE-SIM-COMPONENTS for every line; manufacturer part number equals the exact P/N on page 2. These fictional controlled catalog items provide synthetic sourcing identities, not claims about real suppliers. DLE is responsible for procuring them. Supplier pricing and lead-time evidence will be developed in Materials Quotation.',y)
y=para(c,'<b>Purchased PCB specification:</b> SIM-PCB-001 rev A is an existing supplier-controlled bare-board catalog item, not a new fabrication design. FR-4, two copper layers, 1.6 +/-0.16 mm thick, 35 um copper, green mask, white top legend, lead-free finish. Outline 80 +/-0.2 by 50 +/-0.2 mm. Four 3.2 mm mounting holes at (4,4), (76,4), (76,46), (4,46) mm. Supplier provides copper connectivity, solder lands and plated holes matching the attached electrical and placement definitions. Procurement is by this exact part/revision. Supplier-owned artwork/stencil CAD is included with the synthetic catalog supply; no customer Gerber conversion is required for this quote.',y)
y=para(c,'<b>Optocoupler SIM-OPTO-4:</b> 4-pin surface-mount gull-wing phototransistor device; pins 1 anode, 2 cathode, 3 emitter, 4 collector. Minimum CTR 50% at 5 mA; VCE rating 30 V minimum. Pin 1 is identified by a molded dot. This is a functional low-voltage interface; no safety isolation or mains rating is asserted.',y)
y=para(c,'<b>Other controlled characteristics:</b> SIM-LED-G forward voltage 1.8-2.4 V at 10 mA, cathode bar; SIM-D-REV reverse rating at least 50 V, cathode band. SIM-J-4: 4 positions, 5.08 mm pitch, 1.3 mm plated board holes, pin 1 square pad; terminal entry faces the nearest board edge. SIM-TP: single 1.0 mm plated hole, exposed loop. Standoffs snap into the four 3.2 mm holes. Label text: assembly, revision and unit serial; bag contains one finished unit.',y)
y=para(c,'<b>Technical authority:</b> 03_SIM-ASSY-001_Technical_A.pdf defines position, polarity, connectivity, process and acceptance. Designators PCB1, LBL1 and PKG1 identify the substrate, label and bag; they are genuine material requirements rather than electrical components.',y)
c.showPage(); page(c,'Bill of materials - governing table',2)
y=para(c,'Quantity is EA per assembly. RFQ quantity is 10 assemblies. All rows required.',690)
table(c,[['Line #','P/N','Quantity','Designator','Desc.']]+[[i,p,q,r,d] for i,(p,r,q,d) in enumerate(ROWS,1)],[34,103,47,119,237],y)
c.save()

c=new('03_SIM-ASSY-001_Technical_A.pdf'); page(c,'Assembly drawing - top view',1)
y=para(c,'80 x 50 mm board; all component placement is top-side. Coordinates are component centers in mm from the lower-left board corner; +X right, +Y up. Diagram is scaled for readability; coordinate table governs. LBL1 is centered along the clear lower board edge. PKG1 is packaging, not board-mounted.',692)
ox,oy,scale=66,280,6
c.setStrokeColor(colors.HexColor('#16364A')); c.setLineWidth(1.5); c.rect(ox,oy,80*scale,50*scale)
for ref,x,y,rot,kind in POS:
 px,py=ox+x*scale,oy+y*scale
 if kind=='MECH': c.circle(px,py,9.6)
 elif kind=='LABEL': c.rect(px-90,py-24,180,48)
 elif ref.startswith('J'): c.rect(px-18,py-53,36,106)
 else: c.rect(px-10,py-5,20,10)
 c.setFont('Helvetica',7); c.drawCentredString(px,py+12 if kind!='LABEL' else py-2,ref)
c.setFont('Helvetica',10); c.drawCentredString(306,260,'80 mm'); c.drawString(38,425,'50'); c.drawString(38,412,'mm')
para(c,'<b>Orientation convention:</b> zero degrees puts pin 1 or pad 1 toward -X; positive rotation is counterclockwise. At 90 degrees pad 1 faces -Y. On U1/U2 at zero degrees: pin 1 lower-left, pin 2 upper-left, pin 3 upper-right, pin 4 lower-right. LED/diode pad 1 is anode and pad 2 cathode. Connectors use pin 1 at -Y at 0 degrees and +Y at 180 degrees; pins advance along the Y axis at 5.08 mm pitch.',235)
para(c,'Install nylon standoffs without adhesive. Apply label after test. Bare PCB and footprints are supplier-controlled to this release; outline/coordinates and the net list are inspection and quotation references.',115)
c.showPage(); page(c,'Placement schedule',2)
table(c,[['Ref','X mm','Y mm','Rotation','Process']]+[[r,x,y,rot,k] for r,x,y,rot,k in POS],[130,90,90,100,130],690,8)
c.showPage(); page(c,'Electrical definition and net list',3)
y=para(c,'Two independent nominal 12 V input channels produce active-low outputs using a separate 5 V output-side supply. No firmware. Input returns are isolated from output GND and from each other. Do not connect returns to GND. Capacitors filter each output to GND. Positive input current passes through the resistor, green LED and optocoupler LED.',690)
nets=[['Net','Connected pins'],['IN1+','J1.1, R1.1'],['CH1_A','R1.2, D1.1'],['CH1_LED','D1.2, U1.1, D3.2'],['IN1-','J1.2, U1.2, D3.1'],['IN2+','J1.3, R2.1'],['CH2_A','R2.2, D2.1'],['CH2_LED','D2.2, U2.1, D4.2'],['IN2-','J1.4, U2.2, D4.1'],['V5','J2.1, R3.1, R4.1, TP1.1'],['GND','J2.2, U1.3, U2.3, C1.2, C2.2, TP2.1'],['OUT1','J2.3, U1.4, R3.2, C1.1, TP3.1'],['OUT2','J2.4, U2.4, R4.2, C2.1, TP4.1']]
y=table(c,nets,[90,450],y)
para(c,'<b>Polarity:</b> D1/D2 cathodes face their respective optocoupler anodes. D3/D4 cathodes connect to optocoupler anodes, providing antiparallel reverse clamps. R/C components are nonpolar, but numbered pads follow the placement convention for net-list inspection. Every electrical pin appears once in the net list.',y)
c.showPage(); page(c,'Manufacturing and labor requirements',4)
flow=[('Kitting','Verify all 12 BOM lines for 10 units; retain lot identity.'),('PCB Preparation','Inspect board revision, finish and holes; clean as needed.'),('SMT Setup','One top-side stencil setup and 6 component feeder types; supplier CAD with purchased PCB.'),('Solder Paste','Stencil top side using lead-free SAC305 compatible paste.'),('SMT Placement','12 SMT placements per board; 120 for the lot.'),('Reflow','One top-side pass. Record a profile compatible with component and paste limits.'),('First Piece / In-Process Inspection','Inspect first reflowed board before remaining lot; check polarity and all SMT joints.'),('Thru-Hole Assembly','Install two terminals and four test loops per board.'),('Hand Solder','Solder 12 through-hole pins per board (8 terminal + 4 loop pins).'),('Cleaning','Remove process residues using compatible cleaner; dry before power.'),('Final Inspection','Check joints, polarity, connectors, 4 standoffs and unit identity.'),('Test','Execute every functional case on page 5; retain measured results per serial.'),('Packaging','Apply unit label after passing test; bag one unit each; consolidate all 10.')]
table(c,[['Current labor operation','Required work']]+flow,[151,389],690,9)
c.showPage(); page(c,'Functional acceptance and packaging',5)
y=para(c,'<b>Equipment:</b> current-limited 5.00 +/-0.05 V supply, two isolated 12.0 +/-0.1 V input channels, DMM, mating terminal leads. Limit each input to 20 mA and output supply to 20 mA. Observe connector pinout on page 3. No high-voltage/hipot test.',690)
y=para(c,'<b>Before power:</b> verify identity and polarity, no visible solder bridges, and no continuity between any input return and output GND. Do not energize a failed unit. All ten units receive the full test. Record serial, operator, date, measured voltages/currents and pass/fail. Failed units remain nonconforming; repair/rework is outside this scenario.',y)
y=table(c,[['Case','Stimulus','Acceptance'],['T1','5 V present; both inputs disconnected','OUT1 and OUT2: 4.5-5.1 V; both LEDs off.'],['T2','CH1 = 12 V; CH2 disconnected','OUT1 <=0.4 V; OUT2 >=4.5 V; D1 on, D2 off; CH1 current 7-12 mA.'],['T3','CH2 = 12 V; CH1 disconnected','OUT2 <=0.4 V; OUT1 >=4.5 V; D2 on, D1 off; CH2 current 7-12 mA.'],['T4','Both channels = 12 V','Both outputs <=0.4 V; both LEDs on; each input 7-12 mA.'],['T5','Remove both inputs; wait 0.1 s','Both outputs return >=4.5 V; LEDs off.'],['T6','Throughout T1-T5','5 V supply current <=5 mA; no abnormal heating or damage.']],[40,180,320],y,9)
y=para(c,'<b>Shipment contents:</b> 10 passing assemblies, each with four fitted standoffs and one label, individually sealed in 10 shielding bags. Label: SIM-ASSY-001 / REV A / serial SIM001-A-001 through SIM001-A-010. One outer shipping carton and normal cushioning are shipping consumables, not additional per-unit BOM lines.',y)
para(c,'<b>Shipment evidence:</b> serial list, test results for T1-T6 and certificate of conformance. Retain the same RFQ/quote/job lineage in DLE-OS. These are acceptance requirements only; this package records no performed test, finished quantity, shipment or invoice.',y)
c.save()

# Verify source consistency and extraction without making application records.
refs={r for p,rs,q,d in ROWS for r in rs.split()}
assert all(len(rs.split())==q for p,rs,q,d in ROWS)
assert {p[0] for p in POS}==refs-{'PCB1','PKG1'}
assert len({p[0] for p in POS})==len(POS)
assert sum(p[4]=='SMT' for p in POS)==12
assert sum(p[4]=='TH' for p in POS)==6
pins=[]
for net,p in nets[1:]: pins+=p.split(', ')
expected={f'{r}.{i}' for r in ['R1','R2','R3','R4','C1','C2','D1','D2','D3','D4'] for i in (1,2)}
expected|={f'{r}.{i}' for r in ['U1','U2','J1','J2'] for i in (1,2,3,4)}
expected|={f'TP{i}.1' for i in (1,2,3,4)}
assert len(pins)==len(set(pins)) and set(pins)==expected
with pdfplumber.open(OUT/'02_SIM-ASSY-001_BOM_A.pdf') as pdf:
 tabs=pdf.pages[1].extract_tables(); assert len(tabs)==1 and len(tabs[0])==13
 assert tabs[0][0]==['Line #','P/N','Quantity','Designator','Desc.']
 for idx,row in enumerate(tabs[0][1:]):
  p,rs,q,d=ROWS[idx]; assert row[:4]==[str(idx+1),p,str(q),rs]
manifest=[]
for f in sorted(OUT.glob('*.pdf')):
 with pdfplumber.open(f) as pdf:
  assert all('SIM-ASSY-001' in p.extract_text() and 'REV A' in p.extract_text() for p in pdf.pages)
  pages=len(pdf.pages)
 manifest.append(dict(filename=f.name,sha256=hashlib.sha256(f.read_bytes()).hexdigest(),bytes=f.stat().st_size,pages=pages))
(OUT/'manifest.json').write_text(json.dumps(dict(scenario='E2E-SIM-001',assembly='SIM-ASSY-001',revision='A',quantity=10,files=manifest),indent=2))
(OUT/'consistency.json').write_text(json.dumps(dict(result='PASS',bomLines=12,smtPlacementsPerUnit=12,throughHoleComponentsPerUnit=6,throughHolePinsPerUnit=12,electricalPins=len(pins),uniqueDesignators=len(refs),optoQuantityPerUnit=2,optoQuoteDemand=20,inventoryCreated=False,canonicalIntakeId=None,checks=['BOM table round-trip 12/12 rows','BOM quantities equal reference counts','placement covers all installed items','every electrical pin appears exactly once','all PDF pages have matching assembly/revision','no quote price or PO total predetermined']),indent=2))
with zipfile.ZipFile(OUT/'E2E-SIM-001_RFQ_Package_A.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in sorted(OUT.glob('*.pdf')): z.write(f,f.name)
 z.write(OUT/'manifest.json','manifest.json')
print(json.dumps(manifest,indent=2))
