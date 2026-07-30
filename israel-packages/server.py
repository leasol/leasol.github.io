#!/usr/bin/env python3
import json, mimetypes, os, re, shutil, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
ACTORQUIZ = Path(os.environ.get("ACTORQUIZ_PATH", "/Users/sol/repo/LeaSolBok.github.io/actorquiz"))
MANIFEST = ACTORQUIZ / "manifest.json"
TEMP = HERE / "temp"
IMAGES = TEMP / "images"
TEMP.mkdir(exist_ok=True)
IMAGES.mkdir(exist_ok=True)

def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def safe_name(value):
    value = re.sub(r"[^\w\u0590-\u05ff .'-]+", "", value, flags=re.UNICODE).strip()
    return re.sub(r"\s+", " ", value)[:100]

def packages():
    manifest = read_json(MANIFEST, {"packages": []})
    result = []
    for package in manifest.get("packages", []):
        if not package.get("id", "").startswith("israel_") or not package.get("originalFolder"):
            continue
        pkg_dir = ACTORQUIZ / "packages" / package["id"]
        data = read_json(pkg_dir / "data.json", {})
        names = read_json(pkg_dir / "data_he.json", {})
        people = []
        for key, row in data.items():
            if not isinstance(row, list):
                continue
            original = row[2] if len(row) > 2 else ""
            gemini = row[3] if len(row) > 3 else original
            people.append({
                "key": key, "name": names.get(key, key),
                "original": f"/media/{urllib.parse.quote(package['originalFolder'])}/{urllib.parse.quote(original)}",
                "gemini": f"/media/{urllib.parse.quote(package['geminiFolder'])}/{urllib.parse.quote(gemini)}",
            })
        result.append({
            "id": package["id"],
            "name": package.get("displayNames", {}).get("he", package.get("displayName", package["id"])),
            "count": len(people), "people": people,
            "originalFolder": package["originalFolder"], "geminiFolder": package["geminiFolder"],
        })
    custom = read_json(TEMP / "packages.json", [])
    additions = read_json(TEMP / "additions.json", [])
    for p in custom:
        p["people"] = []
        p["count"] = 0
        p["custom"] = True
        result.append(p)
    return {"packages": result, "additions": additions, "actorquiz": str(ACTORQUIZ)}

def wikipedia_search(name):
    query = urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": name,
        "gsrnamespace": 0, "gsrlimit": 5, "prop": "pageimages|extracts|info",
        "inprop": "url", "piprop": "thumbnail|original", "pithumbsize": 900,
        "exintro": 1, "explaintext": 1, "format": "json", "origin": "*",
    })
    req = urllib.request.Request("https://he.wikipedia.org/w/api.php?" + query,
                                 headers={"User-Agent": "LeaSol-Israel-Package-Editor/1.0"})
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = json.load(res)
    pages = list(raw.get("query", {}).get("pages", {}).values())
    pages.sort(key=lambda x: x.get("index", 999))
    return [{
        "title": p.get("title", ""), "description": p.get("extract", "")[:240],
        "pageUrl": p.get("fullurl", ""),
        "imageUrl": (p.get("original") or p.get("thumbnail") or {}).get("source", "")
    } for p in pages if (p.get("original") or p.get("thumbnail"))]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def json_response(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/data":
            return self.json_response(packages())
        if parsed.path == "/api/wikipedia":
            name = urllib.parse.parse_qs(parsed.query).get("name", [""])[0].strip()
            try:
                return self.json_response({"results": wikipedia_search(name)})
            except Exception as e:
                return self.json_response({"error": f"החיפוש בוויקיפדיה נכשל: {e}"}, 502)
        if parsed.path.startswith("/media/"):
            rel = urllib.parse.unquote(parsed.path[len("/media/"):])
            candidate = (ACTORQUIZ / rel).resolve()
            # The manifest keeps the original file extensions, while several
            # image folders intentionally store the same files without them.
            if not candidate.is_file() and candidate.suffix:
                candidate = candidate.with_suffix("")
            if ACTORQUIZ.resolve() not in candidate.parents or not candidate.is_file():
                self.send_error(404); return
            kind = mimetypes.guess_type(rel)[0] or "image/jpeg"
            data = candidate.read_bytes()
            self.send_response(200); self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data))); self.end_headers()
            self.wfile.write(data); return
        return super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/packages":
                name = safe_name(body.get("name", ""))
                if not name: return self.json_response({"error": "יש להזין שם לחבילה"}, 400)
                rows = read_json(TEMP / "packages.json", [])
                slug = "custom_" + re.sub(r"\W+", "_", name.lower(), flags=re.UNICODE).strip("_")
                if any(x["id"] == slug for x in rows): return self.json_response({"error": "החבילה כבר קיימת"}, 409)
                row = {"id": slug, "name": name, "originalFolder": "", "geminiFolder": ""}
                rows.append(row)
                (TEMP / "packages.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
                return self.json_response(row, 201)
            if self.path == "/api/additions":
                name = safe_name(body.get("name", "")); package_id = safe_name(body.get("packageId", ""))
                image_url = body.get("imageUrl", "")
                if not name or not package_id or not image_url:
                    return self.json_response({"error": "חסרים שם, חבילה או תמונה"}, 400)
                ext = Path(urllib.parse.urlparse(image_url).path).suffix.lower()
                if ext not in {".jpg", ".jpeg", ".png", ".webp"}: ext = ".jpg"
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                filename = f"{package_id}__{safe_name(name).replace(' ', '_')}__{stamp}{ext}"
                req = urllib.request.Request(image_url, headers={"User-Agent": "LeaSol-Israel-Package-Editor/1.0"})
                with urllib.request.urlopen(req, timeout=30) as res, open(IMAGES / filename, "wb") as out:
                    shutil.copyfileobj(res, out)
                rows = read_json(TEMP / "additions.json", [])
                row = {"id": stamp + "_" + str(len(rows)), "packageId": package_id, "name": name,
                       "image": f"temp/images/{filename}", "wikipediaUrl": body.get("wikipediaUrl", ""),
                       "createdAt": datetime.now(timezone.utc).isoformat()}
                rows.append(row)
                (TEMP / "additions.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
                return self.json_response(row, 201)
        except Exception as e:
            return self.json_response({"error": str(e)}, 500)
        self.send_error(404)

if __name__ == "__main__":
    if not MANIFEST.exists():
        sys.exit(f"לא נמצא manifest: {MANIFEST}")
    port = int(os.environ.get("PORT", "8765"))
    print(f"עורך החבילות פתוח בכתובת http://localhost:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
