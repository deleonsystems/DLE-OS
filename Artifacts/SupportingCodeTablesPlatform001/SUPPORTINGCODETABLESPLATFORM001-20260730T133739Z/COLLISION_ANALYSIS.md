# Collision Analysis

The four-part canonical key is mandatory. Fifty-three code values recur in
more than one domain/type namespace and remain separate records. A value-only
lookup is therefore unsafe and is not exposed as a canonical identity.

Source case is significant. For example, `cpn` and `CPN` are distinct qualified
codes. SQL key columns use `Latin1_General_100_BIN2`; the importer and API do not
recase values. Duplicate full natural keys: **0**.
