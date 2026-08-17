#!/usr/bin/env python3
"""Bind MEMORY-SEARCHPATH-001 candidate/rollback to exact Pandora bytes and scope."""

from __future__ import annotations

import hashlib
from pathlib import Path

SNAPSHOT_ID = "9d41aa74-593c-4485-9cff-ff4aa24d5131"
CANDIDATE = "supabase/recovery/20260810_memory_searchpath_001.sql"
ROLLBACK = "supabase/recovery/20260810_memory_searchpath_001.rollback.sql"
FILES = {
    CANDIDATE: (
        372,
        "90c53a462d2774ff45165d126cd9325a0a174cc5999a9f20a93b038f4a6e056c",
    ),
    ROLLBACK: (
        350,
        "e4761fa87bffcd9d7642fa7853563f5622ddbe2e8b74e422dfe5fa9454964cff",
    ),
}
FUNCTIONS = (
    "public.set_updated_at()",
    "public.set_pandora_shadow_context_pack_updated_at()",
    "public.set_pandora_promotion_requests_updated_at()",
    "public.set_pandora_promotion_executions_updated_at()",
)


def executable_statements(filename: str) -> list[str]:
    statements: list[str] = []
    for raw in Path(filename).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("--"):
            continue
        statements.append(line)
    return statements


for filename, (expected_bytes, expected_sha256) in FILES.items():
    data = Path(filename).read_bytes()
    actual_bytes = len(data)
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if actual_bytes != expected_bytes or actual_sha256 != expected_sha256:
        raise SystemExit(
            f"FAIL {filename}: expected {expected_bytes} bytes/{expected_sha256}, "
            f"got {actual_bytes} bytes/{actual_sha256}"
        )
    print(f"PASS {filename}: {actual_bytes} bytes sha256={actual_sha256}")

expected_candidate = [
    f"ALTER FUNCTION {name} SET search_path = '';" for name in FUNCTIONS
]
expected_rollback = [
    f"ALTER FUNCTION {name} RESET search_path;" for name in FUNCTIONS
]

actual_candidate = executable_statements(CANDIDATE)
actual_rollback = executable_statements(ROLLBACK)
if actual_candidate != expected_candidate:
    raise SystemExit(
        f"FAIL candidate scope drift: expected only four SET search_path statements, got {actual_candidate!r}"
    )
if actual_rollback != expected_rollback:
    raise SystemExit(
        f"FAIL rollback scope drift: expected only four RESET search_path statements, got {actual_rollback!r}"
    )

print("PASS candidate scope: exactly four ALTER FUNCTION ... SET search_path statements")
print("PASS rollback scope: exactly four matching ALTER FUNCTION ... RESET search_path statements")
print("PASS no CREATE/REPLACE, DROP, GRANT/REVOKE, table/RLS/Auth, or function-body statements are present")
print(f"PASS exact source and scope binding for Pandora snapshot {SNAPSHOT_ID}")
