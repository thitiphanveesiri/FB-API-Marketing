#!/usr/bin/env python3
"""Audit creative_ref / creative_url relationships in an ads export.

Accepts CSV, TSV, or JSON (row objects, or a Google Sheets-style {"ads": [[headers], ...]} export).
URL query strings and fragments are removed before grouping and are never printed.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def header_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


ALIASES = {
    "ad_id": ("ad_id", "id"),
    "ad_name": ("ad_name", "name"),
    "creative_ref": ("creative_ref", "creative_reference", "creative_id"),
    "creative_url": ("creative_url", "image_url", "creative_image_url"),
}


def normalize_row(row: dict) -> dict[str, str]:
    keyed = {header_key(key): str(value or "").strip() for key, value in row.items()}
    out: dict[str, str] = {}
    for field, names in ALIASES.items():
        out[field] = next((keyed[name] for name in names if keyed.get(name)), "")
    return out


def json_rows(payload: object) -> list[dict]:
    if isinstance(payload, dict):
        match = next((value for key, value in payload.items() if header_key(key) in {"ads", "rows", "data"}), None)
        if match is None:
            raise ValueError("JSON must be a row array or contain an 'ads', 'rows', or 'data' array")
        payload = match
    if not isinstance(payload, list) or not payload:
        raise ValueError("JSON input must contain a non-empty array of rows")
    if isinstance(payload[0], dict):
        return payload
    if isinstance(payload[0], list):
        headers = [str(item) for item in payload[0]]
        return [dict(zip(headers, row)) for row in payload[1:] if isinstance(row, list)]
    raise ValueError("JSON rows must be objects or arrays with a header row")


def load_rows(path: Path) -> list[dict[str, str]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return [normalize_row(row) for row in json_rows(json.loads(path.read_text(encoding="utf-8-sig")))]
    if suffix not in {".csv", ".tsv", ".txt"}:
        raise ValueError("Supported input formats are .csv, .tsv, .txt, and .json")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(8192)
        handle.seek(0)
        delimiter = "\t" if suffix == ".tsv" else ","
        if suffix == ".txt":
            try:
                delimiter = csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
            except csv.Error:
                pass
        return [normalize_row(row) for row in csv.DictReader(handle, delimiter=delimiter)]


def url_key(value: str) -> str:
    """Return a display/grouping URL without signed query parameters or fragments."""
    if not value:
        return ""
    parts = urlsplit(value.strip())
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, "", ""))


def distinct_ads(rows: list[tuple[int, dict[str, str]]]) -> list[tuple[int, dict[str, str]]]:
    seen: set[str] = set()
    result = []
    for row_number, row in rows:
        identity = row["ad_id"] or f"row-{row_number}"
        if identity not in seen:
            seen.add(identity)
            result.append((row_number, row))
    return result


def describe_ad(row_number: int, row: dict[str, str]) -> str:
    ad_id = row["ad_id"] or f"(row {row_number})"
    name = f" — {row['ad_name']}" if row["ad_name"] else ""
    ref = f" [creative_ref={row['creative_ref']}]" if row["creative_ref"] else " [creative_ref missing]"
    return f"  ad_id={ad_id}{name}{ref}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Find repeated creative refs/URLs in an ads export.")
    parser.add_argument("input", type=Path, help="CSV, TSV, or JSON export of the ads data")
    parser.add_argument("--fail-on-findings", action="store_true", help="Exit with status 1 if duplicate groups are found")
    args = parser.parse_args()

    try:
        rows = load_rows(args.input)
    except (OSError, json.JSONDecodeError, ValueError, csv.Error) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if not rows:
        print("No data rows found.", file=sys.stderr)
        return 2

    by_ref: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    by_url: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    for row_number, row in enumerate(rows, start=2):
        if row["creative_ref"]:
            by_ref[row["creative_ref"]].append((row_number, row))
        key = url_key(row["creative_url"])
        if key:
            by_url[key].append((row_number, row))

    missing_ref = sum(not row["creative_ref"] for row in rows)
    missing_url = sum(not row["creative_url"] for row in rows)
    print(f"Input: {args.input} | rows: {len(rows)} | missing creative_ref: {missing_ref} | missing creative_url: {missing_url}")
    print("URL grouping ignores query strings and fragments; signed URL parameters are not displayed.")

    duplicate_groups = 0
    print("\n=== Same creative_ref on multiple ads ===")
    found = False
    for ref, members in sorted(by_ref.items()):
        ads = distinct_ads(members)
        if len(ads) < 2:
            continue
        found = True
        duplicate_groups += 1
        print(f"creative_ref={ref} | {len(ads)} distinct ads")
        for row_number, row in ads:
            print(describe_ad(row_number, row))
    if not found:
        print("None found.")

    print("\n=== Same creative_url base on multiple ads ===")
    found = False
    for key, members in sorted(by_url.items()):
        ads = distinct_ads(members)
        if len(ads) < 2:
            continue
        found = True
        duplicate_groups += 1
        refs = sorted({row["creative_ref"] or "(missing)" for _, row in ads})
        note = "CHECK: URL is associated with different refs" if len(refs) > 1 else ""
        print(f"URL base={key} | {len(ads)} distinct ads | refs={', '.join(refs)}" + (f" | {note}" if note else ""))
        for row_number, row in ads:
            print(describe_ad(row_number, row))
    if not found:
        print("None found.")

    print(f"\nDuplicate groups found: {duplicate_groups}")
    return 1 if args.fail_on_findings and duplicate_groups else 0


if __name__ == "__main__":
    raise SystemExit(main())
