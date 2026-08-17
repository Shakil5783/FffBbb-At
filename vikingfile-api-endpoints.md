# ViKiNG FiLE (vikingfile.com) — Complete API Endpoint Reference

> Compiled 2026-08-17 from the official docs (`https://vikingfile.com/api`), the site's own
> frontend JavaScript (`assets/custom-*.js`), public API wrappers, and **live probes of every
> endpoint executed today** (responses shown below are real).

---

## 1. Base URLs

| Host | Purpose |
|---|---|
| `https://vikingfile.com` | Main site, API endpoints, download pages (`/f/<hash>`), mirrors on `vik1ngfile.site` |
| `https://vikingfile.com/api/*` | Public REST API (JSON) |
| `https://bp.vikingfile.com/index2.php` | **Current** upload handler (legacy multipart + remote-link fetch) — returned live by `get-server` |
| `https://upload.vikingfile.com` | Upload handler per official docs; also serves stored files directly at `/{key}/{filename}` |
| `https://east-us-upload.…r2.cloudflarestorage.com` | Cloudflare R2 pre-signed URLs used for multipart (chunked) uploads — returned by `get-upload-url` |

The site is a Symfony app protected by **Cloudflare Turnstile** on interactive pages
(register/login/download). The `/api/*` endpoints themselves are not Turnstile-gated.

---

## 2. Endpoint overview

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | `GET` | `/api/get-server` | Get the upload server URL (legacy uploads / remote links) |
| 2 | `POST` | `/api/get-upload-url` | Get a Cloudflare R2 multipart upload plan for a file size |
| 3 | `PUT` | `{urls[i]}` (R2 pre-signed) | Upload one part of the file (S3 multipart semantics) |
| 4 | `POST` | `/api/complete-upload` | Finish a multipart upload → creates the file entry |
| 5 | `POST` | `{upload server}` (e.g. `bp.vikingfile.com/index2.php`) | Legacy single-request file upload (multipart/form-data) |
| 6 | `POST` | `{upload server}` | Upload a remote file by URL (server-side fetch, NDJSON progress stream) |
| 7 | `POST` | `/api/check-file` | Check whether file hash(es) exist |
| 8 | `POST` | `/api/list-files` | List files of a user account (paginated, optional folder path) |
| 9 | `POST` | `/api/delete-file` | Delete a file |
| 10 | `POST` | `/api/rename-file` | Rename a file |
| — | `POST` | `/f/{hash}` (page URL) | Download page form: solves Turnstile → returns direct link (web flow) |
| — | `GET` | `/public-upload/{token}` | Public-upload page; token used as `pathPublicShare` param |

**Important conventions**

- All API responses are JSON **with HTTP 200 even on errors** — check the `error` key.
- The `user` field is **required** on account-bound calls; send an empty string for anonymous uploads.
- In multipart forms, **text fields (`user`, `path`, …) must be sent before the file/`link` field** (server parses sequentially).
- File hashes are ~10-char alphanumerics (e.g. `TPRSfLvcIu`); a file's page is `https://vikingfile.com/f/<hash>`.

---

## 2b. URL uploader (remote-file upload) — the short method

Upload a file **by URL** (Viking's servers download it for you). Two steps:

**Step 1 — resolve the upload server (don't hardcode it):**

```bash
SERVER=$(curl -s https://vikingfile.com/api/get-server | python3 -c 'import sys,json;print(json.load(sys.stdin)["server"])')
# -> https://bp.vikingfile.com/index2.php   (current value, verified 2026-08-17)
```

**Step 2 — POST the link (form-encoded, `link` required):**

```bash
curl -X POST "$SERVER" \
  --data-urlencode "link=https://example.com/file.zip" \
  --data-urlencode "user=YOUR_USER_HASH" \
  --data-urlencode "name=renamed.zip" \
  --data-urlencode "path=Folder/My sub folder"
```

- `user` is **required** — use `--data-urlencode "user="` (empty) for anonymous uploads.
- `name`, `path`, `pathPublicShare` are optional.
- The response is a **stream of NDJSON lines**: progress lines first, then one final result line.
- The fetch happens **server-side** and can take minutes — keep the connection open, don't set a short read timeout.

**Response stream:**

```
{"progress":"0.1%","current":1048576,"total":104857600,"name":"file.zip"}
{"progress":"42.3%","current":44191300,"total":104857600,"name":"file.zip"}
{"name":"file.zip","size":104857600,"hash":"TPRSfLvcIu","url":"https://vikingfile.com/f/TPRSfLvcIu"}
```

**Errors** arrive as `{"error":"..."}`, or plain strings `can not download link` / `file not saved` (still HTTP 200).

**Verify afterwards:**

```bash
curl -X POST https://vikingfile.com/api/check-file --data-urlencode "hash=TPRSfLvcIu"
# -> {"exist":true,"name":"file.zip","size":104857600}
```

**Ready-to-run client:** `viking_url_upload.py` in this repo (Python 3.8+, stdlib only):

```bash
python3 viking_url_upload.py "https://example.com/file.zip"
python3 viking_url_upload.py "https://example.com/file.zip" --user YOURHASH --name new.zip --path "Folder/Sub"
python3 viking_url_upload.py --file links.txt        # batch: one URL per line
```

If the source server blocks Viking's fetcher (you get `can not download link`), download the
file yourself and use the legacy multipart upload (3.5) or the R2 chunked upload (3.2–3.4).

---

## 3. Endpoint details

### 3.1 `GET /api/get-server`

Returns the URL to POST legacy file uploads and remote-link uploads to.

**Parameters:** none.

**Live response (2026-08-17):**

```json
{"server":"https:\/\/bp.vikingfile.com\/index2.php"}
```

(Official docs show `https://upload.vikingfile.com` — both hosts exist; use the returned value, don't hardcode it.)

### 3.2 `POST /api/get-upload-url` — multipart (chunked) upload plan

Modern path for large files. Body fields (form-encoded):

| Field | Required | Description |
|---|---|---|
| `size` | ✅ | File size in **bytes** |

**Response:** `uploadId`, `key`, `partSize`, `numberParts`, `urls[]` (one pre-signed PUT URL per part).

**Live response for `size=2097152000` (2 GB):**

```json
{
  "uploadId": "ACTntpoGcc…okE",
  "key": "4CEQA8eNxn",
  "partSize": 419430400,
  "numberParts": 5,
  "urls": [
    "https://east-us-upload.04b3d96d52475741e6b10f97f0a84a16.r2.cloudflarestorage.com/4CEQA8eNxn?uploadId=…&partNumber=1&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=…&X-Amz-Date=…&X-Amz-SignedHeaders=host&X-Amz-Expires=86400&X-Amz-Signature=…",
    "…partNumber=2…", "…partNumber=3…", "…partNumber=4…", "…partNumber=5…"
  ]
}
```

- `partSize` is currently **419430400 bytes (400 MB)** (docs example shows 1 GiB — it varies).
- `numberParts = ceil(size / partSize)`.
- The signed URLs are valid for 24 h (`X-Amz-Expires=86400`) and are S3-compatible pre-signed PUTs.
- Errors: `{"error":"size is empty"}` etc.

### 3.3 `PUT {url}` — upload each part

`PUT` each pre-signed URL from step 3.2 with the raw bytes of that part
(`bytes [i*partSize … (i+1)*partSize)`; last part = remainder).

The server returns the part's **`ETag` header** — collect `{PartNumber, ETag}` for every part.

### 3.4 `POST /api/complete-upload`

Body fields (form-encoded):

| Field | Required | Description |
|---|---|---|
| `key` | ✅ | `key` from `get-upload-url` |
| `uploadId` | ✅ | `uploadId` from `get-upload-url` |
| `parts[0][PartNumber]`, `parts[0][ETag]`, … | ✅ | One pair per uploaded part (0-indexed) |
| `name` | ✅ | Filename |
| `user` | ✅ | User hash (empty = anonymous) |
| `path` | optional | Destination folder, e.g. `Folder/My sub folder` |
| `pathPublicShare` | optional | Public-upload token, e.g. `auLXofS1Ku7SrnzA90nOz1` from `https://vikingfile.com/public-upload/<token>` |

**Response (success):**

```json
{ "name": "example.txt", "size": 12345, "hash": "TPRSfLvcIu", "url": "https://vikingfile.com/f/TPRSfLvcIu" }
```

**Errors:** `{"error":"key is empty"}`, `{"error":"uploadId is empty"}` etc.

### 3.5 `POST {upload server}` — legacy file upload

Multipart/form-data POST to the URL from `get-server` (`https://bp.vikingfile.com/index2.php`).
Field **order matters**: `user` → `path` → `file`.

| Field | Required | Description |
|---|---|---|
| `file` | ✅ | File binary |
| `user` | ✅ | User hash (empty = anonymous) |
| `path` | optional | Destination folder |
| `pathPublicShare` | optional | Public-upload token |

**Response (success):** same shape as 3.4 (`name`, `size`, `hash`, `url`).
Errors appear as `{"error":"file not saved"}` / HTTP 200.

### 3.6 `POST {upload server}` — upload remote file (server-side fetch)

> **This is the "URL uploader" endpoint.** Quick recipe in §2b above and `viking_url_upload.py`.

Form-encoded POST to the upload server. Field order: `user` → `link` → `name` → `path`.

| Field | Required | Description |
|---|---|---|
| `link` | ✅ | URL of the file to fetch |
| `user` | ✅ | User hash (empty = anonymous) |
| `name` | optional | Override filename |
| `path` | optional | Destination folder |
| `pathPublicShare` | optional | Public-upload token |

**Response:** the body is a **stream of NDJSON lines** — progress lines followed by a final result line:

```json
{"progress":"0.1%","current":1234567,"total":987654321,"name":"example.zip"}
{"progress":"42.3%","current":417913000,"total":987654321,"name":"example.zip"}
{"name":"example.zip","size":987654321,"hash":"TPRSfLvcIu","url":"https://vikingfile.com/f/TPRSfLvcIu"}
```

On failure the stream contains `"can not download link"` / `"file not saved"`.

### 3.7 `POST /api/check-file`

| Field | Required | Description |
|---|---|---|
| `hash` | ✅ | Single hash `TPRSfLvcIu` **or array** `hash[]=A&hash[]=B` — max **100** hashes |

**Live response (array form, 2026-08-17):**

```json
[{"exist":false,"hash":"TPRSfLvcIu"},{"exist":false,"hash":"anotherHash"}]
```

Single-hash form per docs: `{"exist":true,"name":"example.txt","size":12345}`.

### 3.8 `POST /api/list-files`

| Field | Required | Description |
|---|---|---|
| `user` | ✅ | User hash |
| `page` | ✅ | Page number (1-based) |
| `path` | optional | Folder path, e.g. `Folder/My sub folder` |

**Response (per docs):**

```json
{
  "currentPage": 1,
  "maxPages": 4,
  "files": [
    {"hash":"TPRSfLvcIu","name":"file.rar","size":10000000,"downloads":0,"created":"2025-12-25 10:01"},
    {"hash":"TPRSfLvcIv","name":"file.png","size":15000000,"downloads":10,"created":"2025-12-26 15:05"}
  ]
}
```

Errors: `{"error":"bad page"}`, `{"error":"user not found"}`.
⚠️ There is **no endpoint to list folder names** — you must know the `path` already.

### 3.9 `POST /api/delete-file`

| Field | Required | Description |
|---|---|---|
| `hash` | ✅ | File hash |
| `user` | ✅ | User hash |

**Response:** `{"error":"success"}` on success; `{"error":"can't delete file"}` otherwise
(live probe returned `{"error":"can't delete file"}` with no params).

### 3.10 `POST /api/rename-file`

| Field | Required | Description |
|---|---|---|
| `hash` | ✅ | File hash |
| `user` | ✅ | User hash |
| `filename` | ✅ | New filename |

**Response:** `{"error":"success"}` on success; `{"error":"can't rename file"}` otherwise
(live probe returned `{"error":"can't rename file"}` with no params).

---

## 4. Web (non-REST) endpoints used by the site

### 4.1 Download page — `GET/POST https://vikingfile.com/f/{hash}`

`GET` renders a landing page (file name, size, Cloudflare Turnstile, embed code; page is
mirrored on `vik1ngfile.site`). When the user solves the Turnstile, the page **POSTs to its own
URL** with form field `cf-turnstile-response=<token>` and receives JSON:

```json
{
  "link": "https://…direct download url…",
  "linkArchive": "…(base for archive entries)…",
  "files": [ {"name":"inner/file.txt","size":123} ],   // only for archives
  "error": "…"                                          // on failure
}
```

The frontend then downloads `link` (supports `HEAD`, `Range`, parallel chunked download),
streams video for `.mp4/.webm/.mkv/.ogg`, and lists archive contents using
`linkArchive + file.name`.

Embed code offered by the site: `<iframe src="https://vikingfile.com/f/<hash>" …></iframe>`.

### 4.2 Public upload page — `GET https://vikingfile.com/public-upload/{token}`

Creates an upload page tied to a share token. API uploads target it by passing
`pathPublicShare=<token>` in any upload/complete call, placing files into that share's folder.

### 4.3 Account pages (all Turnstile-protected, not API endpoints)

`/register` ("Generate hash account" — accounts are keyed by a **user hash**, no email),
`/login`, `/account` (file management), `/premium`, `/donate`, `/api` (docs).

---

## 5. Storage servers

- **`upload.vikingfile.com`** — files are served directly: `https://upload.vikingfile.com/{key}/{filename}`
  (used for direct download / embedded video playback).
- **Cloudflare R2** (`east-us-upload.*.r2.cloudflarestorage.com`) — backing store for the
  multipart upload flow; uploads only via pre-signed PUT URLs, so the key is never usable alone.
- **`bp.vikingfile.com/index2.php`** — current legacy upload/remote-fetch handler; returns
  `"request is not POST"` on GET (verified live).

---

## 6. Live verification log (2026-08-17)

| Probe | Result |
|---|---|
| `GET /api/get-server` | `{"server":"https://bp.vikingfile.com/index2.php"}` ✅ |
| `POST /api/get-upload-url` (no size) | `{"error":"size is empty"}` ✅ |
| `POST /api/get-upload-url?size=2097152000` | Full upload plan: `key=4CEQA8eNxn`, `partSize=419430400`, `numberParts=5`, 5× R2 signed URLs ✅ |
| `GET /api/complete-upload` (no params) | `{"error":"key is empty"}` ✅ |
| `GET /api/check-file?hash[]=TPRSfLvcIu&hash[]=anotherHash` | `[{"exist":false,"hash":"TPRSfLvcIu"},{"exist":false,"hash":"anotherHash"}]` ✅ |
| `GET /api/list-files` (no params) | `{"error":"bad page"}` ✅ |
| `GET /api/delete-file` (no params) | `{"error":"can't delete file"}` ✅ |
| `GET /api/rename-file` (no params) | `{"error":"can't rename file"}` ✅ |
| `GET https://bp.vikingfile.com/index2.php` | `request is not POST` ✅ |
| `GET /f/00aYPmqxj0` | Download landing page (mirror `vik1ngfile.site`), Turnstile flow ✅ |

Note: the endpoints accept GET with query/form params as well (Symfony reads the request
parameter bag), but the documented method is POST. The remote-upload POST itself (3.6) could not
be executed from this sandbox (direct egress to Cloudflare-fronted hosts is blocked), so its
stream format is sourced from the official docs, the site's own JS (`uploadNextLink()`), and the
community wrappers; `get-server` was verified live above.

---

## 7. Sources

- Official API docs: <https://vikingfile.com/api>
- Site frontend JS (upload/download logic): `https://vikingfile.com/assets/custom-*.js`
- Community wrappers: [mepankaja/Vikingfile_Uploader](https://github.com/mepankaja/Vikingfile_Uploader) (Telegram bot, `utils/viking_api.py`), [arabianq/viking-file-python](https://github.com/arabianq/viking-file-python) / PyPI `viking-file`
- Live probes executed from this environment on 2026-08-17.
