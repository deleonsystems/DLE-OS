using System.Security.Cryptography;

internal static class PackagedAssets {
 internal static async Task Check(Action<bool,string> check){
  if(!PackagedFrontend.Enabled)return;
  foreach(var name in new[]{"sim_bom_enrichment.py","sim_candidate_bom.py","sim_contract_review_pdf.py","sim_order_po.py","sim_pdf_page_preview.py","sim_pdf_readability.py","sim_production_pdf.py","sim_quotation_pdf.py","sim_quote_copy_pdf.py","sim_scanned_bom.py"})
   check(File.Exists(Path.Combine(AppContext.BaseDirectory,name)),"packaged worker asset: "+name);
  var projection=new{rfqReference="SYNTHETIC-PACKAGE-ONLY",preparedDate="2026-10-27",customer="Synthetic qualification customer",currency="USD",total=500m,terms="Internal fixture only",lines=new[]{new{rfqId="SYNTHETIC-PACKAGE-ONLY.2",quantity=50,assembly="SYNTHETIC",revision="N",unitPrice=10m,productTotal=500m,total=500m,charges=Array.Empty<object>(),differences=Array.Empty<object>()}}};
  var first=await SimQuotationPdf.RenderDocument(projection,"sim_quote_copy_pdf.py");
  var second=await SimQuotationPdf.RenderDocument(projection,"sim_quote_copy_pdf.py");
  check(first.AsSpan().StartsWith("%PDF-"u8)&&SHA256.HashData(first).SequenceEqual(SHA256.HashData(second)),"packaged Draft renderer produces reproducible PDF with existing Python dependency");
 }
}
