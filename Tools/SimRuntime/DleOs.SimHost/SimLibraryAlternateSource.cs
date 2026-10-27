internal sealed record LibraryAlternateSourceDecision(string Kind,string SourceHash,string DocumentId,string SourceRowId,string Find,string SourcePartNumber,string AlternateId,string PartNumber,string Assembly,string BomRevision,string DrawingRevision,string SourceDrawing);
internal sealed partial class SimLibraryBomStore
{
 private async Task<LibraryAlternateSourceDecision> VerifyAlternateSource(LibraryBomDraft d,LibraryBomRow row,LibraryAlternate alternate){
  Require(d.Import is not null&&d.EvidenceHash is not null&&row.Source is not null,"This alternate needs its own evidence; it is not a verified VPRO5 source alternate.");
  Require(alternate.Status is "PROPOSED" or "APPROVED" or "STALE","This alternate is stale or rejected. Review its identity and evidence before approving it.");
  Require(ManufacturerRole(row,alternate),"Choose Manufacturer P/N for this number before approval.");
  await VerifyEvidence(d);var bytes=Convert.FromBase64String(await EvidenceBase64(d));var imported=d.Import!.VproImport;var literal=SimVproParser.Describe(bytes).Drawing;
  Require(imported.DocumentId=="library-"+d.EvidenceHash&&imported.Sha256==DleAnalysisContract.Hash(bytes),"The imported source identity changed; reopen and reconcile the source.");
  if(imported.IdentityConfirmation is {} confirmation)Require(confirmation.DocumentId==imported.DocumentId&&confirmation.Sha256==DleAnalysisContract.Hash(bytes)&&confirmation.SourceDrawing==literal&&confirmation.Assembly==d.AssemblyNumber&&confirmation.Revision==d.BomRevision&&!string.IsNullOrWhiteSpace(confirmation.Reason)&&!string.IsNullOrWhiteSpace(confirmation.Reviewer),"Source reconciliation no longer applies to this assembly and revision.");
  var parsed=SimVproParser.Parse(bytes,imported.DocumentId,d.AssemblyNumber,d.BomRevision,"Source verification",imported.IdentityConfirmation,libraryOptionalNob:true);
  var source=parsed.Rows.SingleOrDefault(r=>r.RowId==row.Id);Require(source is not null&&row.Source!.RowId==row.Id&&row.Find==source.Values.GetValueOrDefault("lineNumber")&&row.SourcePartNumber==source.Values.GetValueOrDefault("partNumber")&&!row.Dnp,"The row identity no longer matches the imported source. Review its evidence before approving an alternate.");
  var original=source!.Alternates?.SingleOrDefault(a=>a.Id==alternate.Id);Require(original is not null&&original.PartNumber==alternate.PartNumber&&(original.ManufacturerName??"")==alternate.Manufacturer&&row.Source!.Alternates.Any(a=>a.Id==alternate.Id&&a.PartNumber==alternate.PartNumber),"The alternate identity does not match this source row. Add evidence for this alternate instead.");
  return new("USER_ACCEPTED_VPRO5_ALTERNATE",d.EvidenceHash!,imported.DocumentId,row.Id,row.Find,row.SourcePartNumber,alternate.Id,alternate.PartNumber,d.AssemblyNumber,d.BomRevision,d.DrawingRevision,literal);
 }
}
