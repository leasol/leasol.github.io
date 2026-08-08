#!/usr/bin/env python3
"""Songs to Prompts Studio — a local editor for the existing songs dataset."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from flask import Flask, abort, jsonify, render_template, request, send_file

HERE = Path(__file__).resolve().parent
DATA_FILE = HERE / "data" / "songs.json"
LOCK = Lock()
app = Flask(__name__)


def read_songs():
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_songs(songs):
    DATA_FILE.parent.mkdir(exist_ok=True)
    fd, name = tempfile.mkstemp(dir=DATA_FILE.parent, prefix="songs-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(songs, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(name, DATA_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def find_song(songs, song_id):
    return next((song for song in songs if song.get("id") == song_id), None)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/songs")
def songs():
    query = request.args.get("q", "").strip().casefold()
    artist = request.args.get("artist", "").strip()
    status = request.args.get("status", "all")
    items = read_songs()
    if query:
        items = [s for s in items if query in " ".join(str(s.get(k, "")) for k in ("title", "artist", "lyrics", "prompt")).casefold()]
    if artist:
        items = [s for s in items if s.get("artist") == artist]
    if status == "prompted":
        items = [s for s in items if str(s.get("prompt") or "").strip()]
    elif status == "missing":
        items = [s for s in items if not str(s.get("prompt") or "").strip()]
    return jsonify({"songs": items, "total": len(items)})


@app.get("/api/stats")
def stats():
    items = read_songs()
    artists = sorted({s.get("artist", "") for s in items if s.get("artist")})
    prompted = sum(bool(str(s.get("prompt") or "").strip()) for s in items)
    return jsonify({"songs": len(items), "artists": artists, "prompted": prompted, "missing": len(items) - prompted})


@app.patch("/api/songs/<song_id>")
def update_song(song_id):
    payload = request.get_json(silent=True) or {}
    allowed = {"title", "artist", "lyrics", "prompt", "popularity", "links", "tab4u_url", "shironet_url"}
    changes = {key: value for key, value in payload.items() if key in allowed}
    if not changes:
        abort(400, "No editable fields supplied")
    with LOCK:
        items = read_songs()
        song = find_song(items, song_id)
        if not song:
            abort(404, "Song not found")
        song.update(changes)
        song["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_songs(items)
    return jsonify({"song": song})


@app.post("/api/songs")
def add_song():
    payload = request.get_json(silent=True) or {}
    title, artist = str(payload.get("title", "")).strip(), str(payload.get("artist", "")).strip()
    if not title or not artist:
        abort(400, "A title and artist are required")
    song_id = str(payload.get("id") or f"manual-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}")
    song = {"id": song_id, "title": title, "artist": artist, "lyrics": str(payload.get("lyrics") or ""), "prompt": str(payload.get("prompt") or ""), "popularity": payload.get("popularity", 0), "links": payload.get("links") or {}, "created_at": datetime.now(timezone.utc).isoformat()}
    with LOCK:
        items = read_songs()
        if find_song(items, song_id): abort(409, "A song with this ID already exists")
        items.append(song); save_songs(items)
    return jsonify({"song": song}), 201


@app.get("/api/export")
def export_data():
    return send_file(DATA_FILE, mimetype="application/json", as_attachment=True, download_name="songs.json")


@app.post("/api/import")
def import_data():
    uploaded = request.files.get("file")
    if not uploaded: abort(400, "Choose a JSON file first")
    try:
        items = json.load(uploaded.stream)
    except json.JSONDecodeError:
        abort(400, "That file is not valid JSON")
    if not isinstance(items, list) or not all(isinstance(item, dict) and item.get("id") for item in items):
        abort(400, "Expected a list of songs with IDs")
    with LOCK: save_songs(items)
    return jsonify({"songs": len(items)})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8766, debug=True)
