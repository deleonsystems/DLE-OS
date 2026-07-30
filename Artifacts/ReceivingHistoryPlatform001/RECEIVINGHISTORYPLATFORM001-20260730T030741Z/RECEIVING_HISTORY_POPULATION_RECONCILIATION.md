# Receiving History Population Reconciliation

The physical two-pass counts were stable:

- receipt headers (`POT-04`): 39,564
- receipt lines (`POT-14`): 189,272
- retained rejection events (`POT-03`): 0

The source record streams were row-for-row identical, with no duplicate stream
keys and stable first/last keys reported by the qualifier. The source was not
accepted as a canonical baseline because cross-pass FIN identity changed for
the header and line files.

Therefore canonical null/blank totals, quantity totals, headers-without-lines,
and current-master resolution counts are intentionally not reported as
qualified results. Producing those totals from a rejected baseline would imply
qualification that did not occur.
