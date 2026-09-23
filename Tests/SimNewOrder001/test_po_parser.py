import importlib.util
import io
import pathlib
import unittest
from reportlab.pdfgen.canvas import Canvas

root = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('po', root/'Tools/SimRuntime/DleOs.SimHost/sim_order_po.py')
po = importlib.util.module_from_spec(spec)
spec.loader.exec_module(po)


def document(lines):
    output = io.BytesIO()
    c = Canvas(output, pagesize=(1600, 1800))
    for i, text in enumerate(lines): c.drawString(30, 1750-i*20, text)
    c.save()
    return output.getvalue()


class ParserTests(unittest.TestCase):
    def test_actual_po(self):
        f = po.extract((root/'output/pdf/SIM-E2E-001-PO.pdf').read_bytes())['fields']
        for key, value in dict(assembly='SIM-ASSY-001', revision='A', quantity='10', currency='USD', unitPrice='70.64', extendedValue='706.40', nre='0.00', separateCharges='0.00').items():
            self.assertEqual(f[key]['value'], value)
            self.assertEqual(f[key]['page'], 1)
        self.assertNotIn('poDate', f)
        self.assertNotIn('customerDueDate', f)

    def test_explicit_contract_dates_remain_manual(self):
        f = po.extract(document(['PO DATE', '2026-09-22', 'Customer Due Date: 10/14/2026',
                                 'CUSTOMER DUE DATE', '2026-10-14', 'Currency: USD']))['fields']
        self.assertEqual(f['currency']['value'], 'USD')
        self.assertNotIn('poDate', f)
        self.assertNotIn('customerDueDate', f)

    def test_unrecognized_is_unresolved(self):
        self.assertEqual(po.extract(document(['Scanned-looking placeholder without PO facts']))['fields'], {})

    def test_conflicting_values_are_not_chosen(self):
        f = po.extract(document(['PO NUMBER', 'PO-A', 'PO NUMBER', 'PO-B', 'Currency: USD', 'Currency: EUR']))['fields']
        self.assertNotIn('poNumber', f)
        self.assertNotIn('currency', f)

    def test_no_inferred_zero_or_date(self):
        f = po.extract(document(['PO DATE', 'sometime next week', 'NRE not provided', 'Separate charges TBD']))['fields']
        self.assertNotIn('poDate', f)
        self.assertNotIn('nre', f)
        self.assertNotIn('separateCharges', f)

    def test_different_values_come_from_pdf(self):
        f = po.extract(document(['PO NUMBER', 'OTHER-PO', 'PO DATE', '2027-02-03',
          'Line Part number / Description Rev Qty / UOM Unit (EUR) Extension (EUR)',
          '1 OTHER-PART', 'Description', 'B 3 EA 12.00 36.00', 'Currency: EUR', 'NRE 5.00', 'Separate charges 2.00']))['fields']
        self.assertEqual(f['assembly']['value'], 'OTHER-PART')
        self.assertEqual(f['quantity']['value'], '3')
        self.assertEqual(f['currency']['value'], 'EUR')
        self.assertEqual(f['unitPrice']['value'], '12.00')


if __name__ == '__main__': unittest.main()
