import argparse
import random
import time
import urllib.parse
from typing import List, Tuple

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request, Response, send_from_directory

SOURCE_INDEX_URL = "http://52.33.176.184/tmdbbd/"
CACHE_TTL_SECONDS = 60 * 60  # 1 hour
REQUEST_TIMEOUT_SECONDS = 15

app = Flask(__name__, static_folder="static", static_url_path="")


class _ImageCache:
	"""Simple time-based in-memory cache of source image URLs."""

	def __init__(self) -> None:
		self._image_urls: List[str] = []
		self._last_fetch_epoch_s: float = 0.0

	def get(self, force_refresh: bool = False) -> Tuple[List[str], bool]:
		is_stale = (time.time() - self._last_fetch_epoch_s) > CACHE_TTL_SECONDS
		if force_refresh or not self._image_urls or is_stale:
			self._image_urls = _fetch_remote_image_urls()
			self._last_fetch_epoch_s = time.time()
			return list(self._image_urls), True
		return list(self._image_urls), False


_CACHE = _ImageCache()


def _fetch_remote_image_urls() -> List[str]:
	resp = requests.get(SOURCE_INDEX_URL, timeout=REQUEST_TIMEOUT_SECONDS)
	resp.raise_for_status()
	soup = BeautifulSoup(resp.text, "html.parser")
	urls: List[str] = []
	for a in soup.find_all("a", href=True):
		href = (a.get("href") or "").strip()
		if not href:
			continue
		lower = href.lower()
		if lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
			full_url = urllib.parse.urljoin(SOURCE_INDEX_URL, href)
			# Skip parent directory links or nav params
			if "?" in full_url:
				continue
			urls.append(full_url)
	# Deduplicate while preserving order
	seen = set()
	unique_urls: List[str] = []
	for u in urls:
		if u in seen:
			continue
		seen.add(u)
		unique_urls.append(u)
	return unique_urls


@app.get("/")
def index() -> Response:
	return send_from_directory(app.static_folder, "index.html")


@app.after_request
def add_cors_headers(resp: Response) -> Response:
	resp.headers["Access-Control-Allow-Origin"] = "*"
	resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
	resp.headers["Access-Control-Allow-Headers"] = "*"
	return resp


@app.get("/healthz")
def healthz() -> Response:
	return Response("ok", mimetype="text/plain")


@app.get("/api/images")
def api_images():
	limit = request.args.get("limit", default=60, type=int)
	limit = max(1, min(limit, 200))
	force = request.args.get("refresh") in ("1", "true", "yes")
	image_urls, refreshed = _CACHE.get(force_refresh=force)
	if not image_urls:
		return jsonify({"images": [], "count": 0, "refreshed": refreshed})
	# Randomize selection for inspiration variety
	randomized = list(image_urls)
	random.shuffle(randomized)
	selected = randomized[:limit]
	# Use our proxy to avoid CORS/hotlinking issues
	proxied = [f"/proxy?url={urllib.parse.quote(u, safe='')}" for u in selected]
	return jsonify({
		"images": proxied,
		"count": len(image_urls),
		"refreshed": refreshed,
	})


@app.get("/proxy")
def proxy():
	url = request.args.get("url", type=str)
	if not url:
		return Response("missing url", status=400)
	# Basic allow-list: must originate from our source index path
	parsed = urllib.parse.urlparse(url)
	allowed_prefix = urllib.parse.urlparse(SOURCE_INDEX_URL)
	if (parsed.scheme, parsed.netloc, parsed.path[:len(allowed_prefix.path)]) != (
		allowed_prefix.scheme, allowed_prefix.netloc, allowed_prefix.path
	):
		return Response("forbidden source", status=400)
	try:
		upstream = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
		upstream.raise_for_status()
		content_type = upstream.headers.get("Content-Type", "image/jpeg")
		resp = Response(upstream.content, status=200, mimetype=content_type)
		resp.headers["Cache-Control"] = "public, max-age=86400"
		# Enable download if requested
		if request.args.get("download") in ("1", "true", "yes"):
			filename = urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1] or "image")
			resp.headers["Content-Disposition"] = f"attachment; filename=\"{filename}\""
			resp.headers["X-Download-Filename"] = filename
		return resp
	except requests.RequestException as exc:
		return Response(f"fetch error: {exc}", status=502)


def _parse_cli_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Inspiration image board server")
	parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
	parser.add_argument("--port", default=5000, type=int, help="Port to bind")
	parser.add_argument("--reload", action="store_true", help="Enable Flask debug reloader")
	return parser.parse_args()


if __name__ == "__main__":
	args = _parse_cli_args()
	# Warm cache (non-blocking from request path, but nice for first load)
	try:
		_CACHE.get(force_refresh=True)
	except Exception:
		pass
	app.run(host=args.host, port=args.port, debug=args.reload)
