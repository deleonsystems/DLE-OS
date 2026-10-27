using System.Text.Json;
using System.Security.Cryptography;
internal static class VendorContractChecks{
 internal static async Task Run(string root,Action<bool,string> check){
  var isolated=Path.Combine(root,"synthetic-vendor-contract");var folder=Path.Combine(isolated,SimVendorReference.RelativeDirectory);Directory.CreateDirectory(folder);
  var document=new{schema="dle-os-sim-vendor-reference-v1",provenance=new{source="VPRO5 canonical snapshot",asOfUtc="2026-10-27T00:00:00Z",vendorCount=1,vendorMasterImportRunId="SYNTHETIC-ONLY",sourceQualificationRunId="SYNTHETIC-ONLY",reportedSourcePackageSha256=new string('A',64),sourceContractVersion="VENDOR_MASTER_1.0",retrievalFinalizedAtUtc="2026-10-27T00:00:00Z",metadataEvidence="SYNTHETIC CONTRACT TEST; not a canonical snapshot",limits="fixture only",pages=Array.Empty<object>()},vendors=new[]{new{vendorMasterId="99000001",firmId="99",vendorNumber="000001",vendorName="SYNTHETIC VENDOR"}}};
  var bytes=JsonSerializer.SerializeToUtf8Bytes(document);var hash=Convert.ToHexString(SHA256.HashData(bytes));var path=Path.Combine(folder,SimVendorReference.FileName);await File.WriteAllBytesAsync(path,bytes);
  // Existing constructor injection is used only here; runtime's pinned source is unchanged.
  var fixture=new SimVendorReference(isolated,hash,1);var found=await fixture.SearchMaterials("SYNTHETIC");check(found.Items.Length==1&&found.SnapshotSha256==hash,"synthetic injected vendor contract preserves snapshot identity");
  var vendor=await fixture.RequireMaterialVendor("99","000001",hash);check(vendor.VendorMasterId=="99000001","vendor identity requires exact firm and vendor number");
  try{await fixture.RequireMaterialVendor("98","000001",hash);throw new Exception("Wrong firm accepted");}catch(VendorReferenceProblem){check(true,"wrong vendor firm rejected");}
  try{await new SimVendorReference(isolated).SearchMaterials("");throw new Exception("Fixture accepted by pinned runtime");}catch(InvalidDataException){check(true,"synthetic reference cannot satisfy unchanged runtime pin");}
  await File.AppendAllTextAsync(path," ");try{await fixture.SearchMaterials("");throw new Exception("Altered bytes accepted");}catch(InvalidDataException){check(true,"vendor byte tampering rejected");}
 }
}
