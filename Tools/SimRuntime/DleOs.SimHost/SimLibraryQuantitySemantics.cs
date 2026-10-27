using System.Text.RegularExpressions;
using System.Globalization;
internal sealed partial class SimLibraryBomStore {
 internal static bool OptionalNob(LibraryBomRow row)=>row.Find=="NOB" && row.Source?.RowId.StartsWith("vpro-",StringComparison.Ordinal)==true && row.Source.Extracted.GetValueOrDefault("lineNumber")=="NOB" && row.Source.Extracted.GetValueOrDefault("optionalNob")=="true";
 internal static decimal? OptionalNobDemand(LibraryBomRow row)=>OptionalNob(row)&&decimal.TryParse(row.Quantity,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var q)&&q>=0&&q<=1000000?q:null;
 // This is a per-assembly draft demand value, not a downstream kitting projection.
 private static bool ZeroOptionalNob(LibraryBomRow row)=>OptionalNobDemand(row)==0;
 // Library quantities always describe one finished assembly. Blank legacy basis means the same schema default,
 // not a historical human attestation. Explicit other bases must be resolved without converting quantities/UOM.
 private static bool SupportedBasis(string? basis)=>string.IsNullOrEmpty(basis)||basis=="PER_ASSEMBLY";
 // Preparation means exceptional row/group work, such as cutting stock into pieces.
 // The legacy PreparationAssessed field is retained for history, never required as a blanket attestation.
 private static bool VerifiedPreparationSource(LibraryBomDraft d)=>d.EvidenceHash is not null&&d.Import is not null&&string.Equals(d.Import.GoverningSha256,d.EvidenceHash,StringComparison.OrdinalIgnoreCase);
 private static bool CutNote(SimVproSourceNote n)=>Regex.IsMatch(n.Text,@"\bCUT(?:TING)?\b",RegexOptions.IgnoreCase);
 // A source cutting note is a production reference, not an unresolved material-demand group.
 // Explicit author flags and modeled preparation groups continue to block; no completion is inferred.
 internal static bool SourceInstructionApplies(LibraryBomDraft d,LibraryBomRow r)=>VerifiedPreparationSource(d)&&d.Import!.VproImport.SourceNotes?.Any(n=>CutNote(n)&&n.ComponentSequence is not null&&r.Source?.RowId=="vpro-"+n.ComponentSequence)==true;
 internal static bool PreparationApplies(LibraryBomDraft d,LibraryBomRow r)=>r.PreparationRequired||d.Import?.PreparationGroups?.Any(g=>g.ParentRowId==r.Id||g.Pieces.Any(p=>p.RowId==r.Id))==true;
 private static bool PreparationPending(LibraryBomDraft d)=>d.Rows.Any(r=>PreparationApplies(d,r))||d.Import?.PreparationGroups?.Length>0;
}