"""Draft customer quotation from a typed, customer-only projection. No live data access."""
import base64
import io
import json
import sys
from decimal import Decimal
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether


def render(data, logo, output):
    navy, blue, muted = [colors.HexColor(x) for x in ['#18334A', '#23638A', '#60717E']]
    normal = ParagraphStyle('body', fontName='Helvetica', fontSize=9, leading=13, textColor=navy)
    small = ParagraphStyle('small', parent=normal, fontSize=8, leading=11, textColor=muted)
    heading = ParagraphStyle('heading', parent=normal, fontName='Helvetica-Bold', fontSize=11, leading=15, textColor=blue, spaceAfter=8)
    right = ParagraphStyle('right', parent=normal, alignment=TA_RIGHT)
    p = lambda text, style=normal: Paragraph(escape(str(text if text is not None else '')), style)
    money = lambda x: '${:,.2f}'.format(Decimal(str(x)))
    document = SimpleDocTemplate(output, pagesize=(612, 792), leftMargin=46, rightMargin=46, topMargin=36, bottomMargin=70, title='Draft customer quotation - '+data['rfqReference'], author='De Leon Enterprises', invariant=1)
    w, h = ImageReader(logo).getSize()
    scale = min(175/w, 62/h)
    header = Table([[Image(logo, width=w*scale, height=h*scale, hAlign='LEFT'), [p('QUOTATION DRAFT', ParagraphStyle('title', parent=right, fontSize=19, leading=26, textColor=blue)), p('RFQ: '+data['rfqReference'], right), p('Prepared: '+data['preparedDate'], ParagraphStyle('date', parent=small, alignment=TA_RIGHT))]]], colWidths=[245, 275])
    header.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),0)]))
    story = [header, Spacer(1,22), p('PREPARED FOR', small), p(data['customer'], heading)]
    if data.get('reference'): story += [p('Reference: '+data['reference']), Spacer(1,8)]
    for line in data['lines']:
        story += [Spacer(1,14), p(line['rfqId'], heading)]
        rows = [[p(v,small) for v in ['Qty','Part Number / Rev','Description','Unit Price','Extension']], [p(line['quantity']),p(line['assembly']+' / Rev '+line['revision']),p(line.get('description')),p(money(line['unitPrice']),right),p(money(line['productTotal']),right)]]
        for charge in line['charges']: rows.append(['',p('NRE (one-time)' if charge['kind']=='NRE' else 'Additional charge',small),p(charge['label']),'',p(money(charge['amount']),right)])
        table = Table(rows,colWidths=[35,145,160,85,95],repeatRows=1)
        table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.8,blue),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(0,-1),0),('RIGHTPADDING',(-1,0),(-1,-1),0)]))
        story += [table,p('Line total: '+money(line['total']),right),Spacer(1,8),p('Saved estimate leads - Materials: '+(line.get('materialLead') or 'Not requested / not available')+'; Manufacturing: '+(line.get('manufacturingLead') or 'Not requested / not available'),small)]
        if line.get('customerSuppliedItems'):
            story += [p('Customer-supplied items',small)]
            story += [p('Find '+x['findNo']+' - '+x['internalPartNumber'],small) for x in line['customerSuppliedItems']]
        if line['differences']:
            story += [Spacer(1,10),p('PART DIFFERENCES - APPROVAL REQUIRED BEFORE PROCEEDING',heading)]
            flags = [[p(v,small) for v in ['Find','Specified P/N','Proposed P/N being quoted','Status']]]
            for flag in line['differences']: flags.append([p(flag['find']),p(' / '.join(flag['specifiedPartNumbers']) or 'Not established'),p(flag['proposedPartNumber']),p(flag['status'],small)])
            ft=Table(flags,colWidths=[35,170,170,145],repeatRows=1)
            ft.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#EDF2F6')),('LINEBELOW',(0,0),(-1,0),.6,blue),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            story += [ft,p('This draft does not approve the proposed part for purchasing or production.',small)]
    story += [Spacer(1,18),p('TOTAL ('+data['currency']+'): '+money(data['total']),ParagraphStyle('total',parent=right,fontName='Helvetica-Bold',fontSize=13,leading=18)),Spacer(1,16),p('Quoted delivery: '+(data.get('quotedDelivery') or 'Not set')),Spacer(1,10),p('Commercial terms',heading)]
    story += [p(text) for text in (data.get('terms') or 'Not set.').splitlines() if text.strip()]
    def footer(canvas, doc):
        canvas.saveState();canvas.setFillColor(colors.HexColor('#E1E6EA'));canvas.translate(306,396);canvas.rotate(35);canvas.setFont('Helvetica-Bold',38);canvas.drawCentredString(0,0,'DRAFT - NOT ISSUED');canvas.restoreState()
        canvas.saveState();canvas.setStrokeColor(colors.HexColor('#CFD9DF'));canvas.line(46,56,566,56);canvas.setFont('Helvetica-Bold',8);canvas.setFillColor(colors.HexColor('#9B2532'));canvas.drawString(46,43,'DRAFT - NOT ISSUED. Saving or printing does not send this quote.');canvas.setFont('Helvetica',8);canvas.setFillColor(muted);canvas.drawRightString(566,29,'Page '+str(doc.page));canvas.restoreState()
    document.build(story,onFirstPage=footer,onLaterPages=footer)


if __name__ == '__main__':
    with open(sys.argv[1],encoding='utf-8-sig') as src: data=json.load(src)
    if '--pages' in sys.argv[4:]:
        import pdfplumber
        pdf=io.BytesIO();render(data,sys.argv[2],pdf);raw=pdf.getvalue();pages=[]
        with pdfplumber.open(io.BytesIO(raw)) as doc:
            for page in doc.pages:
                png=io.BytesIO();page.to_image(resolution=144).original.save(png,format='PNG');pages.append('data:image/png;base64,'+base64.b64encode(png.getvalue()).decode('ascii'))
        with open(sys.argv[3],'w',encoding='utf-8') as dst:json.dump({'pdf':base64.b64encode(raw).decode('ascii'),'pages':pages},dst)
    else:render(data,sys.argv[2],sys.argv[3])
