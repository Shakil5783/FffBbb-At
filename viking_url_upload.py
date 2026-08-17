#!/usr/bin/env python3
"""
ViKiNG FiLE uploader — https://vikingfile.com/api
Two modes:

  URL upload (remote-file upload):
    1. GET  https://vikingfile.com/api/get-server  ->  {"server": "..."}
    2. POST {server}  form fields: link (required), user, name, path, pathPublicShare
       The server fetches the URL server-side and streams NDJSON progress lines,
       then a final result line {"name","size","hash","url"}.
       NOTE: hosts with IP-locks/captchas (e.g. MediaFire direct links) will be
       rejected with "can not download link" — the fetch must be directly fetchable.

  Local file upload (legacy multipart):
    1. GET  https://vikingfile.com/api/get-server  ->  {"server": "..."}
    2. POST {server}  multipart fields in order: user, path, pathPublicShare, file

Usage:
  # URL upload (anonymous)
  python3 viking_url_upload.py "https://example.com/file.zip"
  # URL upload with account + folder + rename
  python3 viking_url_upload.py "https://example.com/file.zip" \
      --user YOUR_USER_HASH --name renamed.zip --path "Folder/My sub folder"
  # Batch: one URL per line
  python3 viking_url_upload.py --file links.txt
  # Direct file upload (anonymous or with --user/--path)
  python3 viking_url_upload.py --local /path/to/file.rar

Notes:
  - All endpoints answer HTTP 200 even on error: check the "error" key.
  - Requires Python 3.8+ (stdlib only, no pip dependencies).
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid

API_BASE = "https://vikingfile.com"
HEADERS = {"User-Agent": "Mozilla/5.0"}
RESULT_FILE = "viking_upload_result.json"


def get_upload_server() -> str:
    req = urllib.request.Request(f"{API_BASE}/api/get-server", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    server = data.get("server")
    if not server:
        raise SystemExit(f"get-server returned no server: {data}")
    return server


def save_result(result: dict) -> None:
    with open(RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f)


def print_result(result: dict) -> None:
    print(f"  Name : {result.get('name')}")
    print(f"  Size : {result.get('size')} bytes")
    print(f"  Hash : {result.get('hash')}")
    print(f"  URL  : {result.get('url')}")


def upload_remote(server, link, user="", name="", path="", path_public_share=""):
    """Server-side fetch of a remote URL (the 'URL uploader')."""
    payload = urllib.parse.urlencode(
        {
            "link": link,
            "user": user,
            "name": name,
            "path": path,
            "pathPublicShare": path_public_share,
        }
    ).encode("utf-8")
    req = urllib.request.Request(server, data=payload, headers=HEADERS)

    result = None
    with urllib.request.urlopen(req, timeout=1800) as r:  # long timeout: server-side fetch
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            if "can not download link" in line or "file not saved" in line:
                print()
                raise SystemExit(f"Error: {line}")
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue  # ignore non-JSON noise
            if "progress" in obj and "hash" not in obj:
                cur = int(obj.get("current", 0))
                tot = int(obj.get("total", 0))
                print(
                    f"\r  {obj.get('name', link)}: {obj.get('progress', '?')} "
                    f"({cur:,}/{tot:,} bytes)",
                    end="",
                    flush=True,
                )
            elif "error" in obj:
                print()
                raise SystemExit(f"Error: {obj['error']}")
            else:
                result = obj  # final line: name/size/hash/url
    print()
    if result is not None:
        save_result(result)
    return result


def upload_local(server, filepath, user="", path="", path_public_share=""):
    """Legacy multipart upload of a local file."""
    filename = os.path.basename(filepath)
    size = os.path.getsize(filepath)
    boundary = "----VikingUpload" + uuid.uuid4().hex

    def field(name, value):
        yield f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        yield str(value).encode()
        yield b"\r\n"

    chunks = []
    chunks += list(field("user", user))
    if path:
        chunks += list(field("path", path))
    if path_public_share:
        chunks += list(field("pathPublicShare", path_public_share))
    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
    )
    with open(filepath, "rb") as f:
        chunks.append(f.read())
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(chunks)

    req = urllib.request.Request(
        server,
        data=body,
        headers={**HEADERS, "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    print(f"Uploading {filename} ({size:,} bytes) ...")
    with urllib.request.urlopen(req, timeout=1800) as r:
        raw = r.read().decode("utf-8", "replace").strip()
    start = raw.find("{")
    data = json.loads(raw[start:]) if start != -1 else {}
    if "error" in data and data["error"] != "success":
        raise SystemExit(f"Error: {data['error']}")
    if not data.get("hash"):
        raise SystemExit(f"Unexpected response: {raw[:300]}")
    save_result(data)
    return data


def main():
    ap = argparse.ArgumentParser(
        description="Upload to vikingfile.com (URL uploader + direct file upload)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("links", nargs="*", help="file URL(s) to upload server-side")
    ap.add_argument("--file", help="text file containing one URL per line")
    ap.add_argument("--local", help="upload a local file instead of a URL")
    ap.add_argument("--user", default="", help="your user hash (default: anonymous)")
    ap.add_argument("--name", default="", help="rename the uploaded file")
    ap.add_argument("--path", default="", help='destination folder, e.g. "Folder/My sub folder"')
    ap.add_argument("--path-public-share", default="",
                    help="token of a public-upload page to upload into")
    args = ap.parse_args()

    links = list(args.links)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            links += [l.strip() for l in f if l.strip()]
    if args.local:
        if links:
            ap.error("--local cannot be combined with URLs")
        server = get_upload_server()
        print(f"Upload server: {server}")
        result = upload_local(server, args.local, args.user, args.path, args.path_public_share)
        print_result(result)
        return 0
    if not links:
        ap.error("provide at least one URL, --file, or --local")

    server = get_upload_server()
    print(f"Upload server: {server}\n")

    for link in links:
        print(f"Uploading: {link}")
        result = upload_remote(
            server, link, args.user, args.name, args.path, args.path_public_share
        )
        print_result(result)
        print()


if __name__ == "__main__":
    sys.exit(main())
