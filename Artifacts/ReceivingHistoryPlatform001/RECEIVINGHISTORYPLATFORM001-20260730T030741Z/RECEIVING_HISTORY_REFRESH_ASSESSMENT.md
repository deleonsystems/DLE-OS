# Receiving History Refresh Assessment

## Initial recommendation

Use a complete governed read for the baseline and defer recurring refresh to
`RECEIVING-HISTORY-REFRESH-001`.

No safe monotonic transaction sequence or immutable receiver watermark is
proven. Receipt dates can be backdated, negative correction/reversal
transactions can appear later, QA/rejection state is separate, and purge
programs prove records may be removed. Receiver number alone and receipt date
alone are therefore unsafe watermarks.

## Candidate follow-on design

The simplest safe incremental design is an overlapping receipt-date window
with natural-key upsert, deletion/reversal detection inside the overlap, and a
periodic complete reconciliation. The overlap size must be measured against
late postings and corrections before qualification. A complete governed read
remains the fallback and periodic reconciliation mechanism.

Any Receiving History refresh must remain independent of both:

- the existing governed ERP Snapshot Refresh;
- the Invoice History refresh.

It must preserve the same two-pass identity/fingerprint check, candidate
validation, transactional import, no-op behavior, rollback, and qualified
promotion rules. No refresh integration is implemented in this milestone.
