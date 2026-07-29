# Refresh Assessment

Customer Master is not included in the existing ERP Snapshot Refresh or Invoice History refresh operations. Static and browser regression checks confirm both controls remain unchanged.

The qualified population is small (380 customers and 29 physical alternate-address rows) and a complete read takes approximately ten seconds in the controlled qualifier. The recommended future design is a dedicated, full-replacement Customer Master refresh using the same two-pass read-only qualification, local staging, package hash validation, transactional SQL replacement, and atomic active-run update.

Do not add it to an existing refresh runner without a separate mission that qualifies source-change detection, failure retention, concurrency, permissions, and browser status. Until then the implemented dataset is a manual qualified baseline.
