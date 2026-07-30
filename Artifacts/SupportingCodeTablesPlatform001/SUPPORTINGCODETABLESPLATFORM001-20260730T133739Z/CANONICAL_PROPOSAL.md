# Canonical Proposal

`ReferenceCode` is an additive shared canonical reference entity with identity:

`FirmId + CodeDomain + CodeType + CodeValue`

Core attributes include description, short description, optional parent, sort
order, optional active state, source type, access classification, resolution
status, source identity, usage count, import run, and import timestamp.

The baseline does not invent hierarchy, effective dates, inactive state, or
descriptions. `ReferenceCodeRelationship` is retained in the package/schema for
future proven relationships; its qualified baseline count is zero.

Consumer enrichment is additive. A transaction’s original code remains the
canonical fact; a description and resolution status are supplementary.
