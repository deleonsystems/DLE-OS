# Local Candidate BOM enrichment v1

Execute locally only. Governing PDF rows and their customer/BOM identities remain authoritative.
Read every row of recognized BOM tables within the declared parser limits. Report table/page coverage;
do not claim that all drawing content or unrecognized tables were interpreted.
Read reviewed manufacturer-enrichment spreadsheets without executing macros, formulas or external links.
Preserve exact values and page/table or sheet/cell evidence. Require exact customer/BOM P/N agreement;
use Find/line number to disambiguate duplicate customer identities. Retain conflicting signals and multiple
manufacturer candidates for human review. Never add or remove governing rows from enrichment content.
Do not infer an absent manufacturer identity or treat an identity proposal as an approved alternate.
Unprocessed sources must be identified explicitly. Return DLE_CANDIDATE_ANALYSIS_RESULT_V2.
