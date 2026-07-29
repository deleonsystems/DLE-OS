import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = (
    ROOT
    / "Artifacts"
    / "VendorMasterPlatform001"
    / "VENDORMASTERPLATFORM001-20260729T200737Z"
    / "BaselinePackage"
)


def read_csv(name):
    with (PACKAGE / name).open(newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def test_manifest_and_hashes():
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    assert manifest["schema"] == "dle-vendor-master-package"
    assert manifest["contractVersion"] == "VENDOR_MASTER_1.0"
    assert manifest["restrictedFieldsExcludedFromDataFiles"] is True
    lines = []
    for name in sorted(manifest["files"]):
        expected = manifest["files"][name]
        actual = hashlib.sha256((PACKAGE / name).read_bytes()).hexdigest().upper()
        assert actual == expected
        lines.append(f"{name}:{actual}\n")
    aggregate = hashlib.sha256("".join(lines).encode("ascii")).hexdigest().upper()
    assert aggregate == manifest["packageSha256"]


def test_counts_keys_and_relationships():
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    vendors = read_csv("Vendor.csv")
    addresses = read_csv("VendorAddress.csv")
    assert len(vendors) == manifest["counts"]["Vendor"] == 805
    assert len(addresses) == manifest["counts"]["VendorAddress"] == 106
    vendor_keys = {(r["FirmId"], r["VendorNumber"]) for r in vendors}
    address_keys = {
        (r["FirmId"], r["VendorNumber"], r["AddressCode"])
        for r in addresses
    }
    assert len(vendor_keys) == len(vendors)
    assert len(address_keys) == len(addresses)
    assert all((r["FirmId"], r["VendorNumber"]) in vendor_keys for r in addresses)


def test_restricted_fields_and_explicit_unavailable_values():
    vendors = read_csv("Vendor.csv")
    restricted = {
        "FederalTaxId", "HoldInvoices", "Print1099", "VendorAccountNumber",
        "FaxNumber", "GlAccountNumber", "LastInvoiceDateRaw",
        "LastPaymentDateRaw", "Comments", "AccountingNumericValues",
    }
    assert restricted.isdisjoint(vendors[0].keys())
    assert all(r["VendorStatus"] == "" for r in vendors)
    assert all(r["IsActive"] == "" for r in vendors)
    assert all(r["ApprovedSupplierStatus"] == "" for r in vendors)


def test_representative_records_and_payment_terms():
    vendors = read_csv("Vendor.csv")
    addresses = read_csv("VendorAddress.csv")
    by_number = {r["VendorNumber"]: r for r in vendors}
    assert by_number["000002"]["PrimaryContactName"] == ""
    assert by_number["000003"]["VendorName"] == "3S INDUSTRIES,CO.,INC."
    assert by_number["000007"]["PrimaryPhone"]
    assert by_number["000034"]["PaymentTermsCode"] == "01"
    assert sum(r["VendorNumber"] == "000034" for r in addresses) > 1
