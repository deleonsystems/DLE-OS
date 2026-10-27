using System.Text.Json;
internal sealed record LibraryRowAcceptance(string Hash,LibraryActor Actor);
internal sealed partial class SimLibraryBomStore {
 internal static string RowFingerprint(LibraryBomDraft d,LibraryBomRow r)=>Hash(JsonSerializer.SerializeToUtf8Bytes(new{d.AssemblyNumber,d.DrawingRevision,d.BomRevision,d.QuantityBasis,d.PreparationAssessed,d.EvidenceHash,Row=r with{Acceptance=null}},Json));
 internal static bool RowAccepted(LibraryBomDraft d,LibraryBomRow r)=>r.Acceptance is not null&&r.Acceptance.Hash==RowFingerprint(d,r);
 private static LibraryBomDraft InvalidateRows(LibraryBomDraft d)=>d with{Rows=d.Rows.Select(r=>r.Acceptance is not null&&!RowAccepted(d,r)?r with{Acceptance=null}:r).ToArray()};
}
