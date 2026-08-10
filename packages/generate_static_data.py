#!/usr/bin/env python3
"""Build the static package snapshot used by the public Packages Studio.

The Celebs app keeps each package in ``actorquiz/packages/<id>/data.json``.
Those files are intentionally not all shaped alike: most are key/value maps,
while some are lists of facts, names, or richer objects.  This script turns
them into one compact, browser-friendly format without changing app data.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
OUT = HERE / "data.json"
DEFAULT_ACTORQUIZ = Path("/Users/sol/repo/LeaSolBok.github.io/actorquiz")
ACTORQUIZ = Path(os.environ.get("ACTORQUIZ_PATH", DEFAULT_ACTORQUIZ))
RAW_ROOT = "https://raw.githubusercontent.com/LeaSolBok/LeaSolBok.github.io/main/actorquiz/"
FOLDER_OVERRIDES = {
    # The manifest predates a folder rename for this one package.
    ("comedians", "original"): "actors-comedians/comedians",
}
FOLDER_INDEX: dict[str, dict[str, str]] = {}
# This package's canonical dataset is entirely Hebrew song titles and has no
# English companion file. The public English-only studio omits it rather than
# presenting a partly translated catalog.
ENGLISH_ONLY_EXCLUDED = {"riddles_songs_rebus_he"}


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def first_text(*values: Any) -> str:
    for value in values:
        value = text(value)
        if value:
            return value
    return ""


def filename_key(value: str) -> str:
    return re.sub(r"[^\w]+", "", value.casefold(), flags=re.UNICODE)


def filenames_in(folder: str) -> dict[str, str]:
    if folder in FOLDER_INDEX:
        return FOLDER_INDEX[folder]
    directory = ACTORQUIZ / folder
    indexed: dict[str, str] = {}
    if directory.is_dir():
        for file in directory.iterdir():
            if file.is_file():
                indexed.setdefault(filename_key(file.name), file.name)
                indexed.setdefault(filename_key(file.stem), file.name)
    FOLDER_INDEX[folder] = indexed
    return indexed


def local_filename(folder: str, filename: str) -> str:
    """Return the stored filename, accounting for extensionless image files."""
    filename = text(filename)
    if not folder or not filename:
        return ""
    candidate = ACTORQUIZ / folder / filename
    if candidate.is_file():
        return filename
    if candidate.suffix and candidate.with_suffix("").is_file():
        return candidate.with_suffix("").name
    return filenames_in(folder).get(filename_key(filename), "")


def remote_image(folder: str, filename: str) -> str:
    filename = local_filename(folder, filename)
    if not filename:
        return ""
    return RAW_ROOT + urllib.parse.quote(f"{folder}/{filename}", safe="/")


def value_name(value: Any, fallback: str) -> str:
    if isinstance(value, dict):
        for key in ("name", "title", "celebrity", "anime", "movie", "show", "game", "company", "character", "country"):
            candidate = value.get(key)
            if isinstance(candidate, dict):
                candidate = candidate.get("name")
            if text(candidate):
                return text(candidate)
        celebrity, parent = value.get("celebrity"), value.get("parent")
        if isinstance(celebrity, dict) and isinstance(parent, dict):
            return " ↔ ".join(filter(None, (text(celebrity.get("name")), text(parent.get("name"))))) or fallback
    return fallback


def value_details(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    facts = value.get("facts")
    if isinstance(facts, list) and facts and text(facts[0]):
        return text(facts[0])
    for key in ("description", "known_for", "media_type", "emojis"):
        if text(value.get(key)):
            return text(value[key])
    return ""


def value_images(package_id: str, key: str, value: Any, original_folder: str, gemini_folder: str) -> tuple[str, str, str]:
    original_folder = FOLDER_OVERRIDES.get((package_id, "original"), original_folder)
    gemini_folder = FOLDER_OVERRIDES.get((package_id, "gemini"), gemini_folder)
    original_name = gemini_name = tmdb_id = ""
    if isinstance(value, (list, tuple)):
        if value:
            tmdb_id = str(value[0]) if isinstance(value[0], (int, float, str)) and str(value[0]) not in {"", "0", "-1"} else ""
        if len(value) > 2 and isinstance(value[2], str):
            original_name = value[2]
        if len(value) > 3 and isinstance(value[3], str):
            gemini_name = value[3]
    elif isinstance(value, dict):
        tmdb_id = first_text(value.get("tmdb_id"), value.get("tmdbId"), value.get("id"))
        original_name = first_text(value.get("original"), value.get("originalImage"), value.get("image"), value.get("imageUrl"), value.get("poster"))
        gemini_name = first_text(value.get("gemini"), value.get("generated"), value.get("toon"), value.get("aiImage"))
    # Most historical data files only store the key; image folders use that
    # same extensionless key as their filename.
    original_name = original_name or key
    gemini_name = gemini_name or key
    original = remote_image(original_folder, original_name)
    gemini = remote_image(gemini_folder, gemini_name)
    # A handful of historic package folders have only one of the two images.
    # Keep the available image visible instead of giving the card a broken URL.
    if not original and gemini:
        original, gemini = gemini, ""
    return original, gemini, tmdb_id


def display_name(key: str, value: Any) -> str:
    """Return the canonical English-facing label from the source data."""
    return value_name(value, key)


def parse_items(payload: Any, package: dict[str, Any]) -> list[dict[str, str]]:
    original_folder = text(package.get("originalFolder"))
    gemini_folder = text(package.get("geminiFolder"))
    people: list[dict[str, str]] = []

    if isinstance(payload, dict) and isinstance(payload.get("pairs"), list):
        payload = payload["pairs"]

    if isinstance(payload, dict):
        iterator = ((str(key), value, None) for key, value in payload.items() if key not in {"meta", "metadata"})
    elif isinstance(payload, list):
        iterator = ((str(item) if isinstance(item, str) else str(index + 1), item, index) for index, item in enumerate(payload))
    else:
        return people

    for key, value, index in iterator:
        name = display_name(key, value)
        if not name:
            continue
        original, gemini, tmdb_id = value_images(str(package.get("id", "")), key, value, original_folder, gemini_folder)
        people.append({
            "key": key,
            "name": name,
            "original": original,
            "gemini": gemini,
            "tmdbId": tmdb_id,
            "details": value_details(value),
        })
    return people


def main() -> int:
    manifest_path = ACTORQUIZ / "manifest.json"
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("packages"), list):
        print(f"Could not read Celebs manifest: {manifest_path}", file=sys.stderr)
        return 1

    packages = []
    for sort_index, package in enumerate(manifest["packages"]):
        package_id = text(package.get("id"))
        if not package_id or package_id.startswith("israel_") or package_id in ENGLISH_ONLY_EXCLUDED:
            continue
        package_dir = ACTORQUIZ / "packages" / package_id
        payload = read_json(package_dir / "data.json")
        # Do not surface a selectable empty card when a manifest package has
        # no data file in the source repository.
        if payload is None:
            continue
        people = parse_items(payload, package) if payload is not None else []
        packages.append({
            "id": package_id,
            "name": first_text(package.get("displayName"), package_id),
            "englishName": first_text(package.get("displayName"), package_id),
            "tab": first_text(package.get("tab"), "other"),
            "isVip": bool(package.get("isVip")),
            "sortOrder": package.get("sortOrder", sort_index),
            "sourceAvailable": payload is not None,
            "count": len(people),
            "people": people,
        })

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Celebs actorquiz/manifest.json (all non-Israel packages)",
        "packages": packages,
    }
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} with {len(packages)} packages and {sum(item['count'] for item in packages)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
