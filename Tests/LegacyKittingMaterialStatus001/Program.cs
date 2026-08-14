static LegacyKittingEvidenceFile Pdf(string wo, string type, DateTime time) =>
    new(wo, type, $@"\\deleon-server\Production\KITTING\{type}\{wo}.pdf", $"{wo}.pdf", 1,
        time, time, "HIGH", "EXACT_NUMERIC_STEM");
static LegacyManualDisposition Manual(string wo, string status, DateTime time) =>
    new(Guid.NewGuid(), wo, status, time, "Miguel", "VERIFIED", status == "KIT_COMPLETE" ? wo + ".pdf" : null,
        status == "KIT_SHORT" ? wo + ".pdf" : null);
static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var now = DateTime.UtcNow;
var shortOnly = LegacyKittingMaterialStatusService.Reconcile("0001001", Manual("0001001", "KIT_SHORT", now),
    [], [Pdf("0001001", "KIT_SHORT", now)], false, false);
Require(shortOnly.Candidate?.MaterialStatus == "KIT_SHORT", "Short-only evidence must project KIT_SHORT.");
Require(shortOnly.Candidate?.EvidenceSource == "LEGACY_KITTING_PDF_WITH_VERIFIED_DISPOSITION",
    "Matching manual evidence must be retained as support.");

var completed = LegacyKittingMaterialStatusService.Reconcile("0001002", Manual("0001002", "KIT_SHORT", now),
    [Pdf("0001002", "KIT_COMPLETE", now.AddDays(1))], [Pdf("0001002", "KIT_SHORT", now)], false, false);
Require(completed.Candidate?.MaterialStatus == "KIT_COMPLETE", "Later Complete must supersede older Short.");
Require(completed.Candidate?.Classification == "SHORT_THEN_COMPLETE",
    "Later Complete evidence must preserve the Short-then-Complete chronology in audit classification.");

var chronologyConflict = LegacyKittingMaterialStatusService.Reconcile("0001003", null,
    [Pdf("0001003", "KIT_COMPLETE", now)], [Pdf("0001003", "KIT_SHORT", now.AddDays(1))], false, false);
Require(chronologyConflict.Candidate is null && chronologyConflict.Reconciliation.Category == "CONFLICT",
    "An older Complete and newer Short must fail closed.");

var manualOnly = LegacyKittingMaterialStatusService.Reconcile("0001004", Manual("0001004", "KIT_COMPLETE", now),
    [], [], false, false);
Require(manualOnly.Candidate is null && manualOnly.Reconciliation.Category == "MANUAL_WITHOUT_PDF",
    "Manual-only evidence must not be blindly backfilled.");

var persistent = LegacyKittingMaterialStatusService.Reconcile("0001005", Manual("0001005", "KIT_COMPLETE", now),
    [Pdf("0001005", "KIT_COMPLETE", now)], [], true, false);
Require(persistent.Candidate is null && persistent.Reconciliation.Category == "PERSISTENT_KITTING_CASE",
    "Persistent Kitting Case history must suppress legacy evidence.");

var duplicate = LegacyKittingMaterialStatusService.Reconcile("0001006", null,
    [Pdf("0001006", "KIT_COMPLETE", now), Pdf("0001006", "KIT_COMPLETE", now.AddMinutes(1))], [], false, false);
Require(duplicate.Candidate is null && duplicate.Reconciliation.Category == "AMBIGUOUS_EVIDENCE",
    "Duplicate same-type evidence must require review.");

var pdfOnly = LegacyKittingMaterialStatusService.Reconcile("0001007", null,
    [Pdf("0001007", "KIT_COMPLETE", now)], [], false, false);
Require(pdfOnly.Candidate is null && pdfOnly.Reconciliation.Category == "PDF_WITHOUT_MANUAL_DISPOSITION",
    "PDF-only evidence must remain inventoried but outside the smallest verified-disposition backfill.");

Console.WriteLine("LEGACY-KITTING-MATERIAL-STATUS-001: PASS");
