#!/usr/bin/env python3
"""Build the read-only data snapshot used by the GitHub Pages version."""
import json
import urllib.parse
from pathlib import Path

ACTORQUIZ = Path("/Users/sol/repo/LeaSolBok.github.io/actorquiz")
RAW = "https://raw.githubusercontent.com/LeaSolBok/LeaSolBok.github.io/main/actorquiz/"
OUT = Path(__file__).with_name("data.json")

manifest = json.loads((ACTORQUIZ / "manifest.json").read_text(encoding="utf-8"))
packages = []
for package in manifest["packages"]:
    if not package["id"].startswith("israel_") or not package.get("originalFolder"):
        continue
    package_dir = ACTORQUIZ / "packages" / package["id"]
    rows = json.loads((package_dir / "data.json").read_text(encoding="utf-8"))
    names = json.loads((package_dir / "data_he.json").read_text(encoding="utf-8"))
    people = []
    for key, row in rows.items():
        original, gemini = row[2], row[3]
        if not (ACTORQUIZ / package["originalFolder"] / original).is_file():
            original = Path(original).stem
        if not (ACTORQUIZ / package["geminiFolder"] / gemini).is_file():
            gemini = Path(gemini).stem
        url = lambda folder, name: RAW + urllib.parse.quote(folder + "/" + name)
        people.append({
            "key": key,
            "name": names.get(key, key),
            "original": url(package["originalFolder"], original),
            "gemini": url(package["geminiFolder"], gemini),
        })
    packages.append({
        "id": package["id"],
        "name": package.get("displayNames", {}).get("he", package["displayName"]),
        "count": len(people),
        "people": people,
    })

OUT.write_text(json.dumps({"packages": packages}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {OUT} with {len(packages)} packages and {sum(p['count'] for p in packages)} people")
