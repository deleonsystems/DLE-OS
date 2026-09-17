"""Customer-only projection renderer. No access to live RFQ records."""
import json
import sys
from decimal import Decimal
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
from reportlab.lib.enums import TA_RIGHT


def render(data, logo, output):
    navy = colors.HexColor('#18334A')
    blue = colors.HexColor('#23638A')
    grey = colors.HexColor('#60717E')
    normal = ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=15, textColor=navy)
    small = ParagraphStyle('small', parent=normal, fontSize=9, leading=13, textColor=grey)
    heading = ParagraphStyle('heading', parent=normal, fontName='Helvetica-Bold', fontSize=12, spaceAfter=10, textColor=blue)
    right = ParagraphStyle('right', parent=normal, alignment=TA_RIGHT)
    p = lambda value, style=normal: Paragraph(escape(str(value or '')), style)
    money = lambda v: '${:,.2f}'.format(Decimal(str(v)))
    doc = SimpleDocTemplate(output, pagesize=(612, 792), leftMargin=46, rightMargin=46,
                            topMargin=42, bottomMargin=65, title='Quotation '+data['quoteNumber'],
                            author='De Leon Enterprises', invariant=1)
    w, h = ImageReader(logo).getSize()
    scale = min(175 / w, 62 / h)
    brand = Image(logo, width=w*scale, height=h*scale, hAlign='LEFT')
    quote_identity = [p('QUOTATION', ParagraphStyle('title', parent=right, fontSize=23, leading=30, textColor=blue)),
                      p(data['quoteNumber'], right), p('Quote date: '+data['quoteDate'], ParagraphStyle('date', parent=small, alignment=TA_RIGHT))]
    header = Table([[brand, quote_identity]], colWidths=[255,265])
    header.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
    story = [header, Spacer(1,28), p('PREPARED FOR', small), p(data['customer'], heading), Spacer(1,25)]
    # Contact/address/terms are omitted: they are not present in the approved V1 projection.
    columns = ['Qty','Part Number / Rev','Description','Unit Price','Extension']
    rows = [[p(x, ParagraphStyle('column'+str(i),parent=small,alignment=TA_RIGHT if i>2 else 0)) for i,x in enumerate(columns)],
            [p(data['quantity']), p(data['assembly']+' / Rev '+data['revision']), p(data.get('description','')), p(money(data['unitPrice']),right),p(money(data['productTotal']),right)]]
    for charge in data['nreLines']:
        rows.append(['',p('NRE',small),p(charge['label']+' (one-time)'),'',p(money(charge['amount']),right)])
    for charge in data.get('materialCharges', []):
        rows.append(['',p('Material NRE' if charge['treatment']=='NRE' else 'Charge',small),p(charge['label']),'',p(money(charge['amount']),right)])
    table = Table(rows, colWidths=[35,145,160,85,95], repeatRows=1)
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),0.8,blue),
                              ('LINEBELOW',(0,-1),(-1,-1),0.4,colors.HexColor('#CFD9DF')),
                              ('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11),
                              ('LEFTPADDING',(0,0),(0,-1),0),('RIGHTPADDING',(-1,0),(-1,-1),0)]))
    story.extend([table,Spacer(1,22)])
    callout_rows = [[p('LEAD TIME: '+data['delivery'])]]
    if data['customerSuppliedItems']:
        callout_rows.append([p('CUSTOMER-SUPPLIED MATERIAL',small)])
        for row in data['customerSuppliedItems']:
            callout_rows.append([p('Find No. '+row['findNo']+' - Internal P/N '+row['internalPartNumber'])])
        callout_rows.append([p('To be provided by the customer in support of the order upon PO award.',small)])
    callout=Table(callout_rows,colWidths=[520])
    callout.setStyle(TableStyle([('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#BCCFD9')),('LEFTPADDING',(0,0),(-1,-1),12),
                                ('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story.extend([callout,Spacer(1,26)])
    if data.get('materialSeparateTotal') or data.get('materialNreTotal'):
        story.extend([p('Separate Material Charges: '+money(data.get('materialSeparateTotal',0)),right),p('Material NRE: '+money(data.get('materialNreTotal',0)),right)])
    total_label=ParagraphStyle('total-label',parent=right,fontName='Helvetica-Bold',fontSize=12,textColor=blue)
    total_value=ParagraphStyle('total-value',parent=total_label,fontSize=14,leading=18)
    totals = Table([[p('Product Total',right),p(money(data['productTotal']),right)],
                    [p('One-Time Charges',right),p(money(data['nreTotal']),right)],
                    [p('Grand Quote Total',total_label),p(money(data['grandTotal']),total_value)]],colWidths=[180,125],hAlign='RIGHT')
    totals.setStyle(TableStyle([('LINEABOVE',(0,2),(-1,2),1,blue),('TOPPADDING',(0,0),(-1,-1),9),
                               ('BOTTOMPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(-1,0),(-1,-1),0)]))
    story.append(KeepTogether(totals))
    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#CFD9DF'));canvas.line(46,51,566,51)
        canvas.setFont('Helvetica',8);canvas.setFillColor(grey)
        canvas.drawString(46,37,'Thank you for the opportunity to quote.')
        canvas.drawRightString(566,37,data['quoteNumber']+'  |  Page '+str(document.page))
        canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)


if __name__ == '__main__':
    with open(sys.argv[1],encoding='utf-8-sig') as source:
        render(json.load(source),sys.argv[2],sys.argv[3])
