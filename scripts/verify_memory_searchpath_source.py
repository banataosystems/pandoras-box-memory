#!/usr/bin/env python3
"""Bind MEMORY-SEARCHPATH-001 candidate and rollback to exact Pandora source bytes."""

from __future__ import annotations

import hashlib
from pathlib import Path

SNAPSHOT_ID = "9d41aa74-593c-4485-9cff-ff4aa24d5131"
FILES = {
    "supabase/recovery/20260810_memory_searchpath_001.sql": (
        372,
        "90c53a462d2774ff45165d126cd9325a0a174cc5999a9f20a93b038f4a6e056c",
    ),
    "supabase/recovery/20260810_memory_searchpath_001.rollback.sql": (
        350,
        "e4761fa87bffcd9d7642fa7853563f5622ddbe2e8b74e422dfe5fa9454964cff",
    ),
}

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

print(f"PASS exact source binding for Pandora snapshot {SNAPSHOT_ID}")
