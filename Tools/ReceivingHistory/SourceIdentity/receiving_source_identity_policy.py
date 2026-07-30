"""Fail-closed comparison for a file-specific Visual PRO/5 identity policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class SourceIdentityPolicy:
    approved_fin_offsets: Mapping[str, frozenset[int]]


RECEIVING_HISTORY_POLICY = SourceIdentityPolicy(
    {
        r"X:\AON\ADATA\POT-03": frozenset({14, 15, 16, 17}),
        r"X:\AON\ADATA\POT-04": frozenset({14, 15, 16, 17}),
        r"X:\AON\ADATA\POT-14": frozenset({14, 15, 16, 17}),
    }
)


REQUIRED_STABLE_FIELDS = (
    "path",
    "length",
    "creation_time_utc",
    "last_write_time_utc",
    "attributes",
    "fid_hex",
    "record_count",
    "first_key_hex",
    "last_key_hex",
    "ordered_key_sha256",
    "ordered_key_record_sha256",
    "source_layout_sha256",
)


def compare_fin_bytes(
    path: str,
    left_hex: str,
    right_hex: str,
    *,
    policy: SourceIdentityPolicy,
) -> tuple[bool, tuple[int | str, ...]]:
    try:
        left = bytes.fromhex(left_hex)
        right = bytes.fromhex(right_hex)
    except ValueError:
        return False, ("INVALID_HEX",)
    if len(left) != len(right):
        return False, ("LENGTH",)
    allowed = policy.approved_fin_offsets.get(path, frozenset())
    disallowed = tuple(
        offset
        for offset, (old, new) in enumerate(zip(left, right))
        if old != new and offset not in allowed
    )
    return not disallowed, disallowed


def compare_source_identity(
    before: Mapping[str, object],
    after: Mapping[str, object],
    *,
    policy: SourceIdentityPolicy,
) -> tuple[bool, tuple[str, ...]]:
    """Compare a source pair and return a fail-closed verdict and reasons."""

    reasons: list[str] = []
    path = str(before.get("path", ""))
    if not path or str(after.get("path", "")) != path:
        reasons.append("PATH")

    for field in REQUIRED_STABLE_FIELDS[1:]:
        if field not in before or field not in after:
            reasons.append(f"MISSING_{field.upper()}")
        elif before[field] != after[field]:
            reasons.append(field.upper())

    for side, identity in (("BEFORE", before), ("AFTER", after)):
        if identity.get("write_count") != 0:
            reasons.append(f"{side}_WRITE_COUNT")
        if identity.get("lock_count") != 0:
            reasons.append(f"{side}_LOCK_COUNT")
        if identity.get("source_mode") != "O_RDONLY":
            reasons.append(f"{side}_SOURCE_MODE")

    if "fin_hex" not in before or "fin_hex" not in after:
        reasons.append("MISSING_FIN_HEX")
    else:
        passed, differences = compare_fin_bytes(
            path,
            str(before["fin_hex"]),
            str(after["fin_hex"]),
            policy=policy,
        )
        if not passed:
            for difference in differences:
                if difference == "LENGTH":
                    reasons.append("FIN_LENGTH")
                elif difference == "INVALID_HEX":
                    reasons.append("INVALID_FIN_HEX")
                else:
                    reasons.append(f"FIN_OFFSET_{difference}")

    return not reasons, tuple(dict.fromkeys(reasons))
