---
name: upload-image
description: "Uploads images to imgbb (ibb.co). Use when asked to upload, host, or share an image. Supports local files, URLs, and base64 strings."
---

# upload-image

Upload one or more images to [imgbb](https://ibb.co) and return hosted URLs.

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

- **Local image file** (png, jpg, gif, bmp, webp, tiff, heic):

  ```bash
  -F "image=@/path/to/file.png"
  ```

- **Local SVG file**: Convert to PNG first, then upload the PNG:

  ```bash
  magick /path/to/icon.svg /tmp/icon.png
  # then use -F "image=@/tmp/icon.png"
  ```

  On macOS without `ImageMagick`, use the built-in `sips`:

  ```bash
  sips -s format png /path/to/icon.svg --out /tmp/icon.png
  ```

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
curl -s -X POST "https://api.imgbb.com/1/upload" \
  -F "key=$IBB_API_KEY" \
  -F "image=@/path/to/file.png"
```

To set an expiration (TTL in seconds), add:

```bash
  -F "expiration=SECONDS"
```

Common TTL values: `3600` (1 hour), `86400` (1 day), `604800` (1 week). Omit for permanent.

### 3. Parse and present the response

Extract fields from the JSON response and present them in this format:

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
