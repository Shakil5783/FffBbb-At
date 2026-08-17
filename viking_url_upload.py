#!/usr/bin/env python3
"""
ViKiNG FiLE URL uploader (remote-file upload) — https://vikingfile.com/api

Flow (as documented at https://vikingfile.com/api):
  1. GET  https://vikingfile.com/api/get-server
           -> {"server": "https://bp.vikingfile.com/index2.php"}   (current, don't hardcode)
  2. POST {server}  with form fields:
           link   (required)  URL of the file to fetch
           user   (required)  user hash, "" = anonymous
           name   (optional)  new filename
           path   (optional)  destination folder, e.g. "Folder/My sub folder"
           pathPublicShare (optional) token from https://vikingfile.com/public-upload/<token>
  3. The server streams NDJSON lines: progress lines first, then a final
     result line with hash/url. Errors arrive as {"error": "..."} or the
     plain strings "can not download link" / "file not saved".

Usage:
  python3 viking_url_upload.py "https://example.com/file.zip"
  python3 viking_url_upload.py "https://example.com/file.zip" \
      --user YOUR_USER_HASH --name renamed.zip --path "Folder/My sub folder"
  python3 viking_url_upload.py --file links.txt     # one URL per line

Notes:
  - The remote fetch happens server-side and can take minutes; keep the
    connection open (this script waits up to 30 min per read).
  - All endpoints answer HTTP 200 even on error: check the "error" key.
  - Requires Python 3.8+ (stdlib only, no pip dependencies).
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request

API_BASE = "https://vikingfile.com"
HEADERS = {"User-Agent": "Mozilla/5.0"}


def get_upload_server() -> str:
    req = urllib.request.Request(f"{API_BASE}/api/get-server", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    server = data.get("server")
    if not server:
        raise SystemExit(f"get-server returned no server: {data}")
    return server


def upload_remote(server, link, user="", name="", path="", path_public_share=""):
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
    return result


def main():
    ap = argparse.ArgumentParser(
        description="Upload a remote file to vikingfile.com (URL uploader API)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("links", nargs="*", help="file URL(s) to upload")
    ap.add_argument("--file", help="text file containing one URL per line")
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
    if not links:
        ap.error("provide at least one URL or --file")

    server = get_upload_server()
    print(f"Upload server: {server}\n")

    for link in links:
        print(f"Uploading: {link}")
        result = upload_remote(
            server, link, args.user, args.name, args.path, args.path_public_share
        )
        print(f"  Name : {result.get('name')}")
        print(f"  Size : {result.get('size')} bytes")
        print(f"  Hash : {result.get('hash')}")
        print(f"  URL  : {result.get('url')}")
        print()


if __name__ == "__main__":
    sys.exit(main())
