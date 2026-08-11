#!/usr/bin/env python3
"""Fail-closed verifier for the isolated MEMORY-SEARCHPATH-001 advisor proof.

Usage:
  python scripts/verify_memory_searchpath_advisor.py BASELINE.json CANDIDATE.json

The candidate passes only if exactly the four targeted mutable-search-path lint
identifiers disappear and every unrelated baseline lint identifier remains.
No provider credentials or network access are required.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

TARGETS = {
    "function_search_path_mutable_public_set_pandora_promotion_executions_updated_at_9b1889f56258bf9d6554213c05019c76",
    "function_search_path_mutable_public_set_updated_at_9b1889f56258bf9d6554213c05019c76",
    "function_search_path_mutable_public_set_pandora_shadow_context_pack_updated_at_0ba6f773f96de69f495a97d9964f12ef",
    "function_search_path_mutable_public_set_pandora_promotion_requests_updated_at_9b1889f56258bf9d6554213c05019c76",
}


def load_lints(path: str) -> dict[str, tuple[str, str]]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = raw.get("lints")
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: expected top-level lints array")
    result: dict[str, tuple[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise SystemExit(f"{path}: lint entry is not an object")
        key = row.get("cache_key")
        name = row.get("name")
        level = row.get("level")
        if not all(isinstance(value, str) and value for value in (key, name, level)):
            raise SystemExit(f"{path}: every lint needs cache_key/name/level")
        if key in result:
            raise SystemExit(f"{path}: duplicate cache_key {key}")
        result[key] = (name, level)
    return result


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify_memory_searchpath_advisor.py BASELINE.json CANDIDATE.json", file=sys.stderr)
        return 2

    baseline = load_lints(sys.argv[1])
    candidate = load_lints(sys.argv[2])

    missing_targets_at_baseline = TARGETS - baseline.keys()
    if missing_targets_at_baseline:
        print("FAIL baseline does not contain all four target lints:", sorted(missing_targets_at_baseline))
        return 1

    surviving_targets = TARGETS & candidate.keys()
    if surviving_targets:
        print("FAIL target mutable-search-path lints still present:", sorted(surviving_targets))
        return 1

    baseline_other = {k: v for k, v in baseline.items() if k not in TARGETS}
    candidate_other = {k: v for k, v in candidate.items() if k not in TARGETS}

    missing_unrelated = baseline_other.keys() - candidate_other.keys()
    new_unrelated = candidate_other.keys() - baseline_other.keys()
    changed_unrelated = {
        key
        for key in baseline_other.keys() & candidate_other.keys()
        if baseline_other[key] != candidate_other[key]
    }

    if missing_unrelated or new_unrelated or changed_unrelated:
        print("FAIL isolated-proof requirement violated")
        if missing_unrelated:
            print("unrelated baseline lints disappeared:", sorted(missing_unrelated))
        if new_unrelated:
            print("new unrelated lints appeared:", sorted(new_unrelated))
        if changed_unrelated:
            print("unrelated lint name/level changed:", sorted(changed_unrelated))
        return 1

    print(
        "PASS: exactly four MEMORY-SEARCHPATH-001 target lints disappeared; "
        f"{len(candidate_other)} unrelated lint identifiers are unchanged"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
