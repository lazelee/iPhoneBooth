#!/usr/bin/env python3
"""iPhoneBooth local HTTPS host + print queue."""
from __future__ import annotations

import base64
import binascii
import json
import os
import random
import re
import socket
import ssl
import string
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data" / "strips"
CERT_DIR = ROOT / "certs"
PORT = int(os.environ.get("PORT", "3443"))
HTTP_PORT = int(os.environ.get("HTTP_PORT", "3080"))
MAX_STRIPS = 80
MAX_BODY = 12 * 1024 * 1024
USE_HTTP_ONLY = "--http" in sys.argv

DATA.mkdir(parents=True, exist_ok=True)
CERT_DIR.mkdir(parents=True, exist_ok=True)

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".pem": "application/x-x509-ca-cert",
    ".crt": "application/x-x509-ca-cert",
}


def lan_ips() -> list[str]:
    ips: list[str] = []
    for iface in ("en0", "en1", "en2", "wlan0"):
        try:
            result = subprocess.run(
                ["ipconfig", "getifaddr", iface],
                capture_output=True,
                text=True,
                timeout=1,
            )
            ip = (result.stdout or "").strip()
            if result.returncode == 0 and re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ip) and ip not in ips:
                ips.append(ip)
        except (OSError, subprocess.TimeoutExpired):
            continue
    if ips:
        return ips
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.4)
        sock.connect(("1.1.1.1", 80))
        ip = sock.getsockname()[0]
        sock.close()
        if not ip.startswith("127."):
            ips.append(ip)
    except OSError:
        pass
    return ips


def ensure_certs(ips: list[str]) -> tuple[Path, Path]:
    key_path = CERT_DIR / "key.pem"
    cert_path = CERT_DIR / "cert.pem"
    stamp = CERT_DIR / "sans.json"
    sans = ["localhost", "127.0.0.1", *ips]
    prev = json.loads(stamp.read_text()) if stamp.exists() else None
    if key_path.exists() and cert_path.exists() and prev == {"sans": sans}:
        return key_path, cert_path
    dns = [s for s in sans if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", s)]
    ip_sans = [s for s in sans if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", s)]
    san = ",".join([*(f"DNS:{d}" for d in dns), *(f"IP:{i}" for i in ip_sans)])
    print("  Generating local HTTPS certificate…", flush=True)
    result = subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-nodes",
            "-days",
            "825",
            "-keyout",
            str(key_path),
            "-out",
            str(cert_path),
            "-subj",
            "/CN=iPhoneBooth Local",
            "-addext",
            f"subjectAltName={san}",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or "openssl failed")
    stamp.write_text(json.dumps({"sans": sans}, indent=2))
    return key_path, cert_path


def list_strips() -> list[dict]:
    items = []
    for path in DATA.glob("*.json"):
        try:
            items.append(json.loads(path.read_text()))
        except json.JSONDecodeError:
            continue
    items.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
    return items


def prune() -> None:
    for extra in list_strips()[MAX_STRIPS:]:
        for name in (extra.get("imageFile"), extra.get("printFile"), extra.get("metaFile")):
            if name:
                (DATA / name).unlink(missing_ok=True)


def safe_public(url_path: str) -> Path | None:
    rel = unquote(url_path.split("?", 1)[0]).lstrip("/")
    if rel in ("", "join", "join/"):
        rel = "index.html"
    if rel in ("print", "print/"):
        rel = "print.html"
    full = (PUBLIC / rel).resolve()
    if PUBLIC not in full.parents and full != PUBLIC:
        return None
    return full if full.is_file() else None


class Handler(BaseHTTPRequestHandler):
    server_version = "iPhoneBooth/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj) -> None:
        raw = json.dumps(obj).encode()
        self._send(status, raw, {"Content-Type": "application/json; charset=utf-8"})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("GET", parsed)
            return
        path = safe_public(parsed.path)
        if not path:
            self._send(404, b"Not found", {"Content-Type": "text/plain; charset=utf-8"})
            return
        ext = path.suffix.lower()
        self._send(200, path.read_bytes(), {"Content-Type": MIME.get(ext, "application/octet-stream")})

    def do_DELETE(self) -> None:
        self.handle_api("DELETE", urlparse(self.path))

    def do_POST(self) -> None:
        self.handle_api("POST", urlparse(self.path))

    def handle_api(self, method: str, parsed) -> None:
        path = parsed.path
        if method == "GET" and path == "/api/health":
            self._json(200, {"ok": True})
            return
        if method == "GET" and path == "/api/info":
            ips = lan_ips()
            self._json(
                200,
                {
                    "name": "iPhoneBooth",
                    "httpsPort": PORT,
                    "httpPort": HTTP_PORT,
                    "ips": ips,
                    "urls": {
                        "local": f"https://localhost:{PORT}",
                        "lan": [f"https://{ip}:{PORT}" for ip in ips],
                    },
                },
            )
            return
        if method == "GET" and path == "/api/cert":
            cert = CERT_DIR / "cert.pem"
            if not cert.exists():
                self._json(404, {"error": "Certificate not generated yet"})
                return
            self._send(
                200,
                cert.read_bytes(),
                {
                    "Content-Type": "application/x-x509-ca-cert",
                    "Content-Disposition": 'attachment; filename="iphonebooth.crt"',
                },
            )
            return
        if method == "GET" and path == "/api/queue":
            self._json(200, {"strips": list_strips()})
            return
        if method == "POST" and path == "/api/strips":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._json(400, {"error": "Invalid Content-Length"})
                return
            if length < 0:
                self._json(400, {"error": "Invalid Content-Length"})
                return
            if length > MAX_BODY:
                self._json(413, {"error": "Payload too large"})
                return
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._json(400, {"error": "Invalid JSON"})
                return
            if not isinstance(payload, dict):
                self._json(400, {"error": "Expected a JSON object"})
                return
            strip = str(payload.get("strip") or "")
            print_data = str(payload.get("print") or strip)
            match = re.match(r"^data:image/(png|jpeg);base64,(.+)$", strip, re.I | re.S)
            if not match:
                self._json(400, {"error": "Expected a PNG or JPEG data URL"})
                return
            ext = "png" if match.group(1).lower() == "png" else "jpg"
            ident = f"{int(time.time() * 1000)}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
            image_file = f"{ident}.{ext}"
            print_file = f"{ident}-print.jpg"
            meta_file = f"{ident}.json"
            print_match = re.match(r"^data:image/(png|jpeg);base64,(.+)$", print_data, re.I | re.S)
            try:
                image_bytes = base64.b64decode(match.group(2), validate=True)
                print_bytes = base64.b64decode(print_match.group(2), validate=True) if print_match else None
            except (binascii.Error, ValueError):
                self._json(400, {"error": "Invalid base64 image data"})
                return
            (DATA / image_file).write_bytes(image_bytes)
            if print_bytes is not None:
                print_ext = "png" if print_match.group(1).lower() == "png" else "jpg"
                print_file = f"{ident}-print.{print_ext}"
                (DATA / print_file).write_bytes(print_bytes)
            else:
                print_file = image_file
            meta = {
                "id": ident,
                "createdAt": int(time.time() * 1000),
                "theme": payload.get("theme") or "classic",
                "filter": payload.get("filter") or "original",
                "caption": str(payload.get("caption") or "iPhoneBooth")[:48],
                "layout": str(payload.get("layout") or "strip")[:16],
                "imageFile": image_file,
                "printFile": print_file,
                "metaFile": meta_file,
            }
            (DATA / meta_file).write_text(json.dumps(meta, indent=2))
            prune()
            self._json(201, meta)
            return

        file_match = re.fullmatch(r"/api/strips/([^/]+)/(image|print)", path)
        if method == "GET" and file_match:
            item = next((s for s in list_strips() if s.get("id") == file_match.group(1)), None)
            if not item:
                self._json(404, {"error": "Strip not found"})
                return
            name = item["printFile"] if file_match.group(2) == "print" else item["imageFile"]
            file_path = DATA / name
            if not file_path.exists():
                self._json(404, {"error": "File missing"})
                return
            ext = file_path.suffix.lower()
            self._send(200, file_path.read_bytes(), {"Content-Type": MIME.get(ext, "application/octet-stream")})
            return

        del_match = re.fullmatch(r"/api/strips/([^/]+)", path)
        if method == "GET" and del_match:
            item = next((s for s in list_strips() if s.get("id") == del_match.group(1)), None)
            if not item:
                self._json(404, {"error": "Strip not found"})
                return
            self._json(200, item)
            return
        if method == "DELETE" and del_match:
            item = next((s for s in list_strips() if s.get("id") == del_match.group(1)), None)
            if not item:
                self._json(404, {"error": "Strip not found"})
                return
            for name in (item.get("imageFile"), item.get("printFile"), item.get("metaFile")):
                if name:
                    (DATA / name).unlink(missing_ok=True)
            self._json(200, {"ok": True})
            return
        self._json(404, {"error": "Unknown API route"})


class RedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        host = (self.headers.get("Host") or "localhost").split(":")[0]
        loc = f"https://{host}:{PORT}{self.path}"
        self.send_response(302)
        self.send_header("Location", loc)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_HEAD = do_GET

    def log_message(self, fmt: str, *args) -> None:
        return


def banner(protocol: str, port: int, extra: str = "") -> None:
    print("\n  iPhoneBooth", flush=True)
    print("  -----------", flush=True)
    print(f"  Mac preview:     {protocol}://localhost:{port}", flush=True)
    ips = lan_ips()
    if ips:
        for ip in ips:
            print(f"  iPhone / LAN:    {protocol}://{ip}:{port}", flush=True)
    else:
        print("  iPhone / LAN:    no Wi-Fi IPv4 address found", flush=True)
    print(f"  Print station:   {protocol}://localhost:{port}/print", flush=True)
    if extra:
        print(extra, flush=True)
    print("", flush=True)


def main() -> None:
    print("Starting iPhoneBooth…", flush=True)
    if USE_HTTP_ONLY:
        httpd = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
        banner("http", HTTP_PORT, "  Note: iPhone camera access usually needs HTTPS. Prefer python3 server.py")
        httpd.serve_forever()
        return

    ips = lan_ips()
    key_path, cert_path = ensure_certs(["127.0.0.1", *ips])
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    redirect = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), RedirectHandler)

    threading.Thread(target=redirect.serve_forever, daemon=True).start()
    banner(
        "https",
        PORT,
        "\n".join(
            [
                "  First iPhone visit: accept the certificate warning, then allow camera.",
                f"  If Safari blocks camera, install the cert: https://<your-ip>:{PORT}/api/cert",
                "  iOS: Settings → General → About → Certificate Trust Settings → enable iPhoneBooth Local.",
            ]
        ),
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
