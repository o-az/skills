---
name: upload-image
description: Uploads images to a shareable host. Prefer imgbb (ibb.co) when `IBB_API_KEY` is available, then fall back to paste.rs, catbox.moe, 0x0.st, and file.io in that order. Use when asked to upload, host, or share an image. Supports local files, URLs, and base64 strings.
license: GPL-3.0-or-Later
compatibility: Requires curl, jq, and optionally magick (ImageMagick) or rsvg-convert for SVG conversion
metadata:
  author: o-az
  version: "1.0.0"
---

# upload-image

Upload one or more images to a shareable host and return hosted URLs.

## When to auto-trigger

Load this skill automatically when the user asks to upload, host, share, or generate a URL for an image.

If the user provides an **animated image** (GIF, animated WebP, APNG) and local analysis is limited, do not automatically upload it unless one of these is true:

1. The user explicitly asked for hosting or sharing.
2. The user explicitly approved uploading as a fallback so the full animation can be viewed.

If fallback hosting is approved, then:

1. Upload the image using the best available host.
2. Share the hosted URL.
3. Include any viewer, delete, or host-specific URLs when available.

## Requirements

- `IBB_API_KEY` is optional. If it is set, prefer imgbb because it returns direct, viewer, and delete URLs.
- If `IBB_API_KEY` is unavailable or imgbb upload fails because the key is missing or invalid, fall back in this order: `paste.rs`, `catbox.moe`, `0x0.st`, `file.io`.
- Do **not** echo or print `IBB_API_KEY`.

## Input Formats

The skill accepts any of these as input:

| Format           | Example                                              |
| ---------------- | ---------------------------------------------------- |
| Local image file | `/path/to/screenshot.png`, `./diagram.jpg`           |
| Local SVG file   | `/path/to/icon.svg` (converted to PNG before upload) |
| URL to an image  | `https://example.com/photo.png`                      |
| Base64 string    | Raw base64-encoded image data                        |

## Instructions

### 1. Prepare the image

Determine the input type and prepare the curl `-F` flag accordingly:

`@` in `-F "image=@/path/to/file.png"` means "upload file contents". Without `@`, curl sends the literal path string and the upload fails.

- **Local image file** (png, jpg, gif, bmp, webp, tiff, heic):

  ```bash
  -F "image=@/path/to/file.png"
  ```

- **Local SVG file**: Convert to PNG first, then upload the PNG. Try `magick` first; if it fails (e.g., missing fonts for `<text>` elements), fall back to `sips` on macOS:

  ```bash
  CONVERTED=false
  if command -v magick >/dev/null 2>&1; then
    if magick /path/to/icon.svg /tmp/icon.png 2>/dev/null && test -f /tmp/icon.png; then
      CONVERTED=true
    fi
  fi
  if [ "$CONVERTED" = false ]; then
    if command -v rsvg-convert >/dev/null 2>&1; then
      rsvg-convert /path/to/icon.svg -o /tmp/icon.png 2>/dev/null
      test -f /tmp/icon.png && CONVERTED=true
    fi
  fi
  if [ "$CONVERTED" = false ]; then
    if command -v sips >/dev/null 2>&1; then
      sips -s format png /path/to/icon.svg --out /tmp/icon.png 2>/dev/null
      test -f /tmp/icon.png && CONVERTED=true
    fi
  fi
  # then use -F "image=@/tmp/icon.png"
  ```

  If both converters fail, return a clear error instead of uploading the raw SVG.

- **URL**: Pass the URL string directly:

  ```bash
  -F "image=https://example.com/photo.png"
  ```

  For anonymous fallback hosts, prefer downloading the URL to a temp local file first so all backends can use the same file-upload path.

- **Base64 string**: Pass the base64 string directly:

  ```bash
  -F "image=BASE64_STRING_HERE"
  ```

  For anonymous fallback hosts, decode the base64 to a temp local file first. Preserve the file extension when possible so hosts like `paste.rs` can return the correct content type.

### 2. Choose the upload backend

Use this backend order:

1. **imgbb** if `IBB_API_KEY` is set.
2. **paste.rs**
3. **catbox.moe**
4. **0x0.st**
5. **file.io**

Stop at the first successful upload.

When using anonymous fallback hosts, prefer uploading a local file path. Normalize URLs and base64 input to a temp file first when needed.

### 3. Upload

#### imgbb (preferred when `IBB_API_KEY` is set)

```bash
RESPONSE="$(curl -s -X POST "https://api.imgbb.com/1/upload" \
  -F "key=$IBB_API_KEY" \
  -F "image=@/path/to/file.png")"
```

To set an expiration (TTL in seconds), add:

```bash
  -F "expiration=SECONDS"
```

Common TTL values: `3600` (1 hour), `86400` (1 day), `604800` (1 week). Omit for permanent.

#### paste.rs

```bash
PASTE_URL="$(curl -s --data-binary @/path/to/file.png https://paste.rs)"
EXT="png"
DIRECT_URL="$PASTE_URL.$EXT"
```

Preserve the original file extension when building the direct URL, for example `png`, `jpg`, `gif`, or `webp`.

#### catbox.moe

```bash
DIRECT_URL="$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@/path/to/file.png" https://catbox.moe/user/api.php)"
```

#### 0x0.st

Upload a local file:

```bash
DIRECT_URL="$(curl -s -F "file=@/path/to/file.png" https://0x0.st)"
```

Upload by URL:

```bash
DIRECT_URL="$(curl -s -F "url=https://example.com/photo.png" https://0x0.st)"
```

If the response does not start with `http`, treat it as a failure and continue to the next fallback. `0x0.st` may temporarily reject uploads.

#### file.io

```bash
RESPONSE="$(curl -s -F "file=@/path/to/file.png" https://file.io)"
DIRECT_URL="$(jq -r '.link // empty' <<<"$RESPONSE")"
```

`file.io` is ephemeral. Links are typically deleted after download or expiration.

### 4. Parse and present the response

If using imgbb, extract these fields from the response JSON:

- direct URL: `.data.url`
- viewer URL: `.data.url_viewer`
- delete URL: `.data.delete_url`

Example parser:

```bash
DIRECT_URL="$(jq -r '.data.url // empty' <<<"$RESPONSE")"
VIEWER_URL="$(jq -r '.data.url_viewer // empty' <<<"$RESPONSE")"
DELETE_URL="$(jq -r '.data.delete_url // empty' <<<"$RESPONSE")"
```

For anonymous fallback hosts, return what the backend supports:

- `paste.rs`: direct image URL plus the base paste URL
- `catbox.moe`: direct URL only
- `0x0.st`: direct URL only
- `file.io`: share URL only, plus a note that it is temporary

Present the result in this format:

```
✅ Uploaded: filename.png

  Host:    imgbb
  URL:     https://i.ibb.co/xxxx/filename.png
  Viewer:  https://ibb.co/xxxx
  Delete:  https://ibb.co/xxxx/delete-hash
```

Include only the fields the selected backend provides. On failure, show the error from the response body or the raw response text and continue to the next fallback when applicable.

### 5. Multiple images

When uploading multiple images, upload them sequentially (one curl call per image) and present all results together in a summary table:

| #   | File           | URL                                  |
| --- | -------------- | ------------------------------------ |
| 1   | screenshot.png | https://i.ibb.co/xxxx/screenshot.png |
| 2   | diagram.jpg    | https://i.ibb.co/xxxx/diagram.jpg    |
