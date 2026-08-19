$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$shadow = Get-Content -Raw -LiteralPath (Join-Path $root 'Tools\OperationsRefresh\bounded_sales_order_shadow.py')
$routine = Get-Content -Raw -LiteralPath (Join-Path $root 'Tools\OperationsRefresh\focused_sales_order_refresh.py')
$passed = 0

function Require([bool]$Value, [string]$Message) {
    if (-not $Value) { throw $Message }
}

function Check([string]$Name, [scriptblock]$Rule) {
    & $Rule
    $script:passed++
    "PASS $Name"
}

Check 'routine extractor defaults to qualified bounded ARE-13 with full fallback' {
    Require $routine.Contains('from bounded_sales_order_shadow import') `
        'routine extraction does not use the qualified bounded generator'
    Require $routine.Contains('choices=("bounded", "full"), default="bounded"') `
        'routine extraction does not default to bounded with full fallback'
    Require $routine.Contains('OPEN_SALES_ORDER_BASE_QUALIFIER.src') `
        'routine authoritative full-scan fallback is absent'
    foreach ($value in @('eligible_header_prefixes(',
            'bounded_are13_source(eligible_order_prefixes, runtime)',
            'single_file_full_source(', 'are13ExtractionMode',
            'eligibleOrderPrefixCount', 'are13RecordsRead')) {
        Require $routine.Contains($value) "normal integration missing: $value"
    }
}

Check 'ARE-03 eligibility rules are preserved' {
    foreach ($value in @('key[2:4] != "  "', 'key[17:20] != "000"',
            'text[21:22] == b"I"', 'text[20:21] in (b"V", b"P")',
            'text[100:101] == b"C"')) {
        Require $shadow.Contains($value) "eligibility rule missing: $value"
    }
}

Check 'ARE-13 candidate is prefix-bounded and read-only' {
    foreach ($value in @('key[:17] in prefix_set', 'READ (10,KEY=REQ$',
            'REQ$=P$[X]', 'K$=KEY(10,END=',
            'K$(1,17)<>P$[X]', 'MODE="O_RDONLY"', 'OTYPE<>6',
            'ORLEN<>224', 'OKLEN<>20', 'FID1$<>FID2$',
            'ACTIVE1<>ACTIVE2')) {
        Require $shadow.Contains($value) "bounded/source-identity contract missing: $value"
    }
}

Check 'strict ordering and exact canonical parity remain required' {
    foreach ($value in @('key <= previous', 'SalesOrder.csv',
            'SalesOrderLine.csv', 'SalesOrderWorkOrderRelationship.csv',
            'counts_match', 'validation_match', 'fullSha256', 'shadowSha256')) {
        Require $shadow.Contains($value) "parity contract missing: $value"
    }
}

Check 'RMA positive and negative lines are explicit acceptance criteria' {
    foreach ($value in @('("100", "6")', '("105", "-6")',
            'H24589', 'BomRevision', '"J"')) {
        Require $shadow.Contains($value) "RMA acceptance criterion missing: $value"
    }
}

Check 'bounded VPro preserves authoritative numeric precision' {
    Require $shadow.Contains('PRECISION 16') `
        'bounded ARE-13 source does not preserve authoritative precision'
}

Check 'phase timings are durable and routine adoption is prohibited' {
    foreach ($value in @('are03ScanMs', 'prefixDerivationMs',
            'boundedAre13EvidenceMs', 'localPostProcessingMs',
            'boundedAre13CompileMs', 'packageConstructionMs',
            'woeSeekExecutionMs', 'candidateQualificationMs',
            'normalSyncPathChanged')) {
        Require $shadow.Contains($value) "shadow diagnostic missing: $value"
    }
}

"OPEN-SALES-ORDER-BOUNDED-SHADOW-001: PASS ($passed checks)"
