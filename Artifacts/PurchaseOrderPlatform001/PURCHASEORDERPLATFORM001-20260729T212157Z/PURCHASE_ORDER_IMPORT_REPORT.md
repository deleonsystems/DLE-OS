# Purchase Order Import Report

ImportRunId: 7f8e76b9-7489-41ef-8128-fcd23270efdd

The importer validates the package manifest, file hashes, counts, natural keys,
parent integrity, and open-quantity formula before mutation. Header and line
replacement occurs in one serializable transaction. Identical current package
returns NO-OP; the induced failure after delete must roll back before this
report is finalized.
