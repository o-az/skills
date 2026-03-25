---
name: upload-image
description: Uploads images to imgbb (ibb.co). Use when asked to upload, host, or share an image. Also use when you receive an animated image (GIF, APNG, WebP animation) that you cannot fully analyze — upload it and share the hosted URL so the user can view it. Supports local files, URLs, and base64 strings.
license: GPL-3.0-or-Later
compatibility: Requires curl, jq, and optionally magick (ImageMagick) or rsvg-convert for SVG conversion
metadata:
  author: o-az
  version: "1.0.0"
---

# upload-image

Upload one or more images to [imgbb](https://ibb.co) and return hosted URLs.

## When to auto-trigger

If the user shares an **animated image** (GIF, animated WebP/APNG) and you cannot analyze it (e.g., `look_at` fails or you can only see the first frame), **do not complain or apologize**. Instead:

1. Immediately load this skill.
2. Upload the image to imgbb.
3. Share the hosted URL so the user (or you) can view the full animation.

## Requirements

- `IBB_API_KEY` environment variable must be set. Assume it is available — do **not** echo or print it. If the upload curl fails due to a missing key, tell the user to set `IBB_API_KEY`.

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

- **Base64 string**: Pass the base64 string directly:
  ```bash
  -F "image=BASE64_STRING_HERE"
  ```

### 2. Upload

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

### 3. Parse and present the response

Extract these fields from the response JSON:

- direct URL: `.data.url`
- viewer URL: `.data.url_viewer`
- delete URL: `.data.delete_url`

Example parser:

```bash
DIRECT_URL="$(jq -r '.data.url // empty' <<<"$RESPONSE")"
VIEWER_URL="$(jq -r '.data.url_viewer // empty' <<<"$RESPONSE")"
DELETE_URL="$(jq -r '.data.delete_url // empty' <<<"$RESPONSE")"
```

Then present the result in this format:

```
✅ Uploaded: filename.png

  URL:     https://i.ibb.co/xxxx/filename.png
  Viewer:  https://ibb.co/xxxx
  Delete:  https://ibb.co/xxxx/delete-hash
```

On failure (`"success": false`), show the error from the response body.

### 4. Multiple images

When uploading multiple images, upload them sequentially (one curl call per image) and present all results together in a summary table:

| #   | File           | URL                                  |
| --- | -------------- | ------------------------------------ |
| 1   | screenshot.png | https://i.ibb.co/xxxx/screenshot.png |
| 2   | diagram.jpg    | https://i.ibb.co/xxxx/diagram.jpg    |
