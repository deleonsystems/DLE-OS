from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT.parent / "DLE-OS-Server"

dto = (SERVER / "Contracts/Platform/CanonicalDtos.cs").read_text(encoding="utf-8")
repo = (SERVER / "Data/Platform/SalesOrderRepository.cs").read_text(encoding="utf-8")
schema = (SERVER / "Database/Scripts/018_AddSalesOrdersPlatform.sql").read_text(encoding="utf-8")
mapping = (ROOT / "Artifacts/OpenOrderFieldMap001/OPEN_ORDER_FIELD_PROVENANCE.md").read_text(encoding="utf-8")
contract = (SERVER / "Documentation/OPERATIONAL-MASTER-DATA-SQL-001_CANONICAL_QUANTITY_CONTRACT.md").read_text(encoding="utf-8")


def check(label: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS: {label}")


check("DTO preserves QuantityOrdered", "public decimal QuantityOrdered" in dto)
check("DTO adds ErpQuantityOpen", "public decimal ErpQuantityOpen" in dto)
check("repository selects both quantities", "QuantityOrdered AS ErpQuantityOpen" in repo)
check("SQL direct alias", "sol.QuantityOrdered AS ErpQuantityOpen" in schema)
check("SQL contains no open-quantity subtraction", re.search(r"QuantityOrdered\s*-\s*.*QuantityShipped", schema, re.I) is None)
check("SQL contains no shipped alias", "ErpQuantityShipped" not in schema)
check("qualified lineage identifies ARE-13A210", "ARE-13A210 QTY ORDERED" in mapping)
check("contract documents operator-confirmed invoicing behavior", "VPro5 reduces this physical field as quantities are invoiced" in contract)
check("contract preserves zero negative and fractional values", "Zero, negative, and fractional values are preserved" in contract)
check("contract keeps Pending Invoice outside canonical ERP values", "Pending Invoice quantity remains owned by DLE-OS Shipment Staging" in contract)

print("OPERATIONAL-MASTER-DATA-SQL-001 source contract: PASS")
