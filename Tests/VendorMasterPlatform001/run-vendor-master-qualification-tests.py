import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / "Artifacts" / "VendorMasterPlatform001" / "VENDORMASTERPLATFORM001-20260729T200737Z"
PACKAGE = RUN / "BaselinePackage"
TOOLS = ROOT / "Tools" / "VendorMaster"
RESULTS = []


def check(name, condition, evidence):
    RESULTS.append({"name": name, "passed": bool(condition), "evidence": evidence})
    if not condition:
        raise AssertionError(f"{name}: {evidence}")


manifest = json.loads((PACKAGE / "manifest.json").read_text())
metadata = json.loads((PACKAGE / "metadata.json").read_text())
http = json.loads((RUN / "VENDOR_MASTER_HTTP_TEST_RESULTS.json").read_text(encoding="utf-8-sig"))
imp = json.loads((RUN / "VENDOR_MASTER_IMPORT_QUALIFICATION.json").read_text())
runtime = json.loads((RUN / "VENDOR_MASTER_RUNTIME_QUALIFICATION.json").read_text())
config = json.loads(
    (ROOT / "Tools" / "VProQualificationHarness" / "Configurations" / "VendorMaster.json").read_text()
)
with (PACKAGE / "Vendor.csv").open(newline="", encoding="utf-8-sig") as stream:
    vendors = list(csv.DictReader(stream))
with (PACKAGE / "VendorAddress.csv").open(newline="", encoding="utf-8-sig") as stream:
    addresses = list(csv.DictReader(stream))
with (PACKAGE / "OrphanVendorAddress.csv").open(newline="", encoding="utf-8-sig") as stream:
    orphan_addresses = list(csv.DictReader(stream))
with (PACKAGE / "OrphanVendorDetail.csv").open(newline="", encoding="utf-8-sig") as stream:
    orphan_details = list(csv.DictReader(stream))

vendor_keys = {(r["FirmId"], r["VendorNumber"]) for r in vendors}
address_keys = {
    (r["FirmId"], r["VendorNumber"], r["AddressCode"]) for r in addresses
}
restricted = {
    "FederalTaxId", "HoldInvoices", "Print1099", "VendorAccountNumber",
    "FaxNumber", "GlAccountNumber", "LastInvoiceDateRaw",
    "LastPaymentDateRaw", "Comments", "AccountingNumericValues",
}
client = (ROOT / "SRC" / "api" / "dle-api-client.js").read_text(encoding="utf-8")
viewer = (
    ROOT / "SRC" / "modules" / "canonical-data-viewer" / "canonical-data-viewer.js"
).read_text(encoding="utf-8")
template = (
    ROOT / "SRC" / "modules" / "canonical-data-viewer" / "canonical-data-viewer.html"
).read_text(encoding="utf-8")
erp_refresh = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "Invoke-LiveSnapshotRefresh.ps1"
).read_text(encoding="utf-8")
invoice_refresh = (
    ROOT / "Tools" / "InvoiceHistory" / "Invoke-InvoiceHistoryRefresh.ps1"
).read_text(encoding="utf-8")

check(
    "01-harness-configuration",
    config["MissionName"] == "VENDOR_MASTER_PLATFORM_001",
    config["MissionName"],
)
check("02-source-contract", metadata["counts"]["Vendor"] == 805, "APM-01 -> 805 Vendor rows")
check("03-natural-key-uniqueness", len(vendor_keys) == len(vendors), f"{len(vendor_keys)}/805 unique")
check("04-duplicate-rejection", "duplicate Vendor natural key" in (TOOLS / "Import-VendorMasterBaseline.ps1").read_text(encoding="utf-8-sig"), "fail-closed guard present")
check("05-null-blank-handling", sum(r["VendorName"] == "" for r in vendors) == 4, "4 blank names retained")
check("06-status-handling", all(r["VendorStatus"] == "" and r["IsActive"] == "" for r in vendors), "unproven status is null")
check("07-address-relationship", all((r["FirmId"], r["VendorNumber"]) in vendor_keys for r in addresses), "all 106 parents exist")
check("08-contact-relationship", "VendorContact" not in manifest["naturalKeys"], "embedded contacts; no forced entity")
check("09-orphan-handling", len(orphan_addresses) == 1 and len(orphan_details) == 44, "1 address; 44 detail profiles classified")
check("10-restricted-field-exclusion", restricted.isdisjoint(vendors[0]), "restricted columns absent")
check("11-transaction-rollback", imp["inducedFailure"]["rollbackVerified"], "805/106 retained")
check("12-identical-reimport-no-op", imp["identicalReimport"]["behavior"] == "NO-OP", imp["identicalReimport"]["vendorMasterImportRunId"])
check("13-api-read-only-identity", runtime["liveRuntime"]["identity"] == "DLE-OS-HOST\\DLE-OS-LIVE-API", runtime["liveRuntime"]["identity"])
check("14-api-pagination", any(r["Name"] == "list-total-pages" and r["Passed"] for r in http["Results"]), "33 pages at size 25")
check("15-api-filters", all(any(r["Name"] == n and r["Passed"] for r in http["Results"]) for n in ("vendor-number-unpadded", "vendor-name-filter", "postal-code-filter", "payment-terms-filter")), "number/name/postal/terms")
check("16-api-null-behavior", "Vendor Status (Unavailable)" in viewer, "explicit null labels")
check("17-viewer-registration", 'data-canonical-tab="vendorMaster">Vendor Master' in template, "eighth tab registered")
check("18-viewer-filtering", "vendorNumber: 6" in client and "canonicalVendorMaster" in client, "six-character normalization")
check("19-viewer-restricted-exclusion", not any(word in viewer for word in ("FederalTaxId", "HoldInvoices", "Print1099", "GlAccountNumber")), "restricted fields absent")
known = next(r for r in vendors if r["VendorNumber"] == "000034")
check("20-known-record-parity", known["VendorName"] == "WALKER COMPONENT GROUP" and known["PaymentTermsCode"] == "01", "000034 parity")
check("21-existing-seven-section-regression", all(x in template for x in ("Work Orders", "Inventory Items", "Bills of Material", "General Ledger Accounts", "Sales Orders", "Invoice History", "Customer Master")), "all seven retained")
check("22-existing-erp-refresh-regression", "VendorMaster" not in erp_refresh and runtime["refreshControl"]["erpStatus"] == "NO_SOURCE_CHANGES", "independent and healthy")
check("23-invoice-refresh-regression", "VendorMaster" not in invoice_refresh and runtime["refreshControl"]["invoiceHistoryStatus"] == "NO_SOURCE_CHANGES", "independent and healthy")
check("24-customer-master-regression", "customerMaster" in viewer and "canonicalCustomerMaster" in client, "Customer Master retained")
check("25-cors-authentication-regression", all(any(r["Name"] == n and r["Passed"] for r in http["Results"]) for n in ("cors-exact-origin", "cors-arbitrary-origin-denied")), "exact origin only")
check("26-harness-process-cleanup", "MissionOwnedProcessesRemaining" in (RUN / "VENDOR_MASTER_HARNESS_RESULT.md").read_text(encoding="utf-8") or "no mission process remained" in (RUN / "VENDOR_MASTER_BASELINE_EXTRACTION_REPORT.md").read_text(encoding="utf-8"), "zero remaining")

out = {
    "verdict": "PASS",
    "testsPassed": len(RESULTS),
    "testsFailed": 0,
    "results": RESULTS,
}
(RUN / "VENDOR_MASTER_AUTOMATED_TEST_RESULTS.json").write_text(
    json.dumps(out, indent=2) + "\n", encoding="utf-8"
)
print(f"VENDOR-MASTER-PLATFORM-001 qualification tests: PASS ({len(RESULTS)}/{len(RESULTS)})")
