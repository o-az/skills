#!/bin/sh

uv_available=false
ffmpeg_available=false
libass_available=false
libx264_available=false
nix_available=false
mise_available=false
homebrew_available=false

if command -v uv >/dev/null 2>&1; then
	uv_available=true
fi

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
	ffmpeg_available=true
	filters="$(ffmpeg -hide_banner -filters 2>/dev/null || true)"
	encoders="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
	if printf '%s\n' "$filters" | grep -Eq '(^|[[:space:]])ass[[:space:]]'; then
		libass_available=true
	fi
	if printf '%s\n' "$encoders" | grep -Eq '(^|[[:space:]])libx264([[:space:]]|$)'; then
		libx264_available=true
	fi
fi

if command -v nix >/dev/null 2>&1; then
	nix_available=true
fi
if command -v mise >/dev/null 2>&1; then
	mise_available=true
fi
if command -v brew >/dev/null 2>&1; then
	homebrew_available=true
fi

printf '{"uv":%s,"ffmpeg":%s,"libass":%s,"libx264":%s,"nix":%s,"mise":%s,"homebrew":%s}\n' \
	"$uv_available" \
	"$ffmpeg_available" \
	"$libass_available" \
	"$libx264_available" \
	"$nix_available" \
	"$mise_available" \
	"$homebrew_available"
