import importlib.util,pathlib,unittest
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('reader',root/'Tools/SimRuntime/DleOs.SimHost/sim_scanned_bom.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class StructureTests(unittest.TestCase):
 def test_blank_ocr_keeps_positions(self):
  rows=sum([reader.structure([],p) for p in (3,4,5)],[])
  self.assertEqual([r['position'] for r in rows],list(range(1,107)))
  self.assertEqual(rows[27]['rowType'],'CONTINUATION')
  self.assertEqual(rows[46]['cells']['FIND_NUMBER']['value'],'**47')
  self.assertEqual(rows[97]['cells']['QUANTITY']['status'],'NOT_READ')
 def test_source_bounds_retained_for_not_read(self):
  for page in (3,4,5):
   for row in reader.structure([],page):
    for cell in row['cells'].values():
     b=cell['sourceBounds']
     self.assertGreater(b['width'],0)
     self.assertGreater(b['height'],0)
     self.assertLessEqual(b['x']+b['width'],1)
     self.assertLessEqual(b['y']+b['height'],1)
  self.assertAlmostEqual(reader.structure([],5)[0]['cells']['MANUFACTURER_PART_NUMBER_1']['sourceBounds']['x'],929/1836)
 def test_columns_and_ambiguous_boxes(self):
  # Same physical row, distinct MFG slots; ambiguous boundary-spanning token discarded.
  words=[dict(text='FIRST',x=1540,y=240,w=100,h=20),dict(text='PN-FIRST',x=1860,y=240,w=200,h=20),dict(text='SECOND',x=2180,y=240,w=100,h=20),dict(text='CROSS',x=2150,y=240,w=100,h=20),dict(text='ROW-CROSS',x=1550,y=262,w=100,h=40)]
  rows=reader.structure(words,4)
  self.assertEqual(rows[0]['cells']['MANUFACTURER_1']['value'],'FIRST')
  self.assertEqual(rows[0]['cells']['MANUFACTURER_PART_NUMBER_1']['value'],'PN-FIRST')
  self.assertEqual(rows[0]['cells']['MANUFACTURER_2']['value'],'SECOND')
  self.assertNotIn('CROSS',' '.join(c['value'] for r in rows for c in r['cells'].values()))
if __name__=='__main__':unittest.main()
