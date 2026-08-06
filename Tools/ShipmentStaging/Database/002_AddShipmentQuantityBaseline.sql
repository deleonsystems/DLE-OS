SET XACT_ABORT ON;
SET NOCOUNT ON;

IF COL_LENGTH(N'operational.ShipmentStaging', N'CanonicalOpenQuantityAtShipment') IS NULL
BEGIN
    ALTER TABLE operational.ShipmentStaging
        ADD CanonicalOpenQuantityAtShipment decimal(19,6) NULL;
END;

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.ShipmentStaging')
      AND name=N'CK_ShipmentStaging_CanonicalOpenQuantity'
)
BEGIN
    ALTER TABLE operational.ShipmentStaging WITH CHECK
        ADD CONSTRAINT CK_ShipmentStaging_CanonicalOpenQuantity CHECK
        (CanonicalOpenQuantityAtShipment IS NULL OR CanonicalOpenQuantityAtShipment >= QuantityProcessed);
END;
GO

CREATE OR ALTER VIEW operational.vw_CurrentShipmentStaging
AS
SELECT s.*,
       p.ShipmentInvoiceMatchProposalId AS ProposedMatchId,
       p.InvoiceHistoryLineId AS ProposedInvoiceHistoryLineId,
       p.InvoiceNumber AS ProposedInvoiceNumber,
       p.InvoiceLineNumber AS ProposedInvoiceLineNumber,
       p.InvoiceDate AS ProposedInvoiceDate,
       p.InvoiceQuantity AS ProposedInvoiceQuantity,
       p.MatchClassification,
       p.MatchScore,
       p.EvidenceSummary,
       p.ContradictionSummary
FROM operational.ShipmentStaging s
OUTER APPLY
(
    SELECT TOP (1) proposal.*
    FROM operational.ShipmentInvoiceMatchProposal proposal
    WHERE proposal.ShipmentStagingId=s.ShipmentStagingId
      AND proposal.ReconciliationRunId=s.CurrentProposalRunId
    ORDER BY proposal.MatchScore DESC, proposal.CreatedAtUtc, proposal.ShipmentInvoiceMatchProposalId
) p;
GO
