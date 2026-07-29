# Import Report

- Behavior: `IMPORTED`
- ImportRunId: `b3ec1b7c-7806-49f5-b589-62ddb093e6a8`
- Package SHA-256: `926160D5BFBEAD171BE6DA481016B6810DF20BE6CA7577EF82AA8421C173D608`
- Customer rows: 380
- CustomerAddress rows: 28
- Identical re-import: `NO-OP`, same ImportRunId
- Induced failure: raised after transactional deletes; rollback retained 380/28 and the same active ImportRunId

Only `DLE_OS_CANONICAL_LIVE` Customer Master objects were mutated. Existing canonical snapshot counts and historical database behavior remained unchanged.
