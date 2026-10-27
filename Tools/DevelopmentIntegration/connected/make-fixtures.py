from pathlib import Path
from io import BytesIO
import struct
from reportlab.pdfgen import canvas

out=Path(__file__).parent/'fixtures';out.mkdir(exist_ok=True)
b=BytesIO();c=canvas.Canvas(b);c.drawString(50,790,'SYNTHETIC REHEARSAL ONLY - NOT CUSTOMER DATA')
c.drawString(50,760,'SYNTHETIC-49-2 Revision N - quantity 50')
c.drawString(50,730,'Controlled BOM: 1 bare board per assembly, customer supplied.')
c.save();data=b.getvalue();(out/'drawing.pdf').write_bytes(data+b' '*(3929922-len(data)))
# Minimal BIFF8 workbook in a CFB container; only synthetic labels/numbers.
def rec(t,p=b''):return struct.pack('<HH',t,len(p))+p
def bof(kind):return rec(0x809,struct.pack('<HHHHII',0x600,kind,0xdbb,0x7cc,0x41,6))
def label(row,col,value):
 return rec(0x204,struct.pack('<HHHHB',row,col,0,len(value),0)+value.encode('ascii'))
sheet=bof(0x10)+rec(0x200,struct.pack('<IIHHH',0,3,0,3,0))
for r,values in enumerate([['SYNTHETIC ONLY','Part','Quantity'],['1','SYNTHETIC-BOARD','1'],['Customer supplied','Revision N','50 assemblies']]):
 for col,v in enumerate(values):sheet+=label(r,col,v)
sheet+=rec(0xa)
bound=lambda offset:rec(0x85,struct.pack('<IBBBB',offset,0,0,3,0)+b'BOM')
global_part=bof(5)+rec(0x42,struct.pack('<H',1252))+bound(0)+rec(0xa)
global_part=bof(5)+rec(0x42,struct.pack('<H',1252))+bound(len(global_part))+rec(0xa)
workbook=(global_part+sheet).ljust(4096,b'\0')
END=0xfffffffe;FREE=0xffffffff;FAT=0xfffffffd
header=bytearray(512);header[:8]=bytes.fromhex('D0CF11E0A1B11AE1')
struct.pack_into('<HHHHH',header,24,0x3e,3,0xfffe,9,6)
struct.pack_into('<IIIIIIIII',header,40,0,1,0,0,4096,END,0,END,0)
struct.pack_into('<109I',header,76,9,*([FREE]*108))
def entry(name,kind,start,size,child=FREE):
 a=bytearray(128);n=(name+'\0').encode('utf-16le');a[:len(n)]=n
 struct.pack_into('<HBBIII',a,64,len(n),kind,1,FREE,FREE,child)
 struct.pack_into('<IQ',a,116,start,size);return a
directory=entry('Root Entry',5,END,0,1)+entry('Workbook',2,1,4096)+bytearray(256)
fat=[END]+list(range(2,9))+[END,FAT]+[FREE]*118
data=bytes(header)+directory+workbook+struct.pack('<128I',*fat)
(out/'bom.xls').write_bytes(data.ljust(50176,b'\0'))
