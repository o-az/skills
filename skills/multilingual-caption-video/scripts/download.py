#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = ["yt-dlp[default,curl-cffi]==2026.7.4"]
# ///

import argparse
import ipaddress
import os
import re
import shutil
import socket
import unicodedata
from http.client import HTTPMessage
from pathlib import Path
from typing import IO, override
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cleanup import validate_workdir

DIRECT_VIDEO_SUFFIXES = {".mov", ".mp4"}


def validate_video_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Video URL must be an explicit HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("Video URL must not contain credentials")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = {
            str(address[4][0]).split("%", 1)[0]
            for address in socket.getaddrinfo(
                parsed.hostname,
                port,
                type=socket.SOCK_STREAM,
            )
        }
    except (OSError, ValueError) as error:
        raise ValueError("Could not resolve the video URL host") from error
    if not addresses or any(
        not ipaddress.ip_address(address).is_global for address in addresses
    ):
        raise ValueError("Video URL resolves to a non-public address")
    return url


def direct_video_suffix(url: str) -> str | None:
    suffix = Path(unquote(urlsplit(url).path)).suffix.lower()
    return suffix if suffix in DIRECT_VIDEO_SUFFIXES else None


def direct_video_stem(url: str) -> str:
    filename = Path(unquote(urlsplit(url).path)).name
    normalized = unicodedata.normalize("NFKC", Path(filename).stem)
    cleaned = "".join(
        char if char.isalnum() or char in " ._-" else "-" for char in normalized
    )
    cleaned = re.sub(r"\s+", "-", cleaned)
    cleaned = re.sub(r"-+", "-", cleaned).strip(" .-_")
    return cleaned[:120].rstrip(" .-_") or "video"


class PublicRedirectHandler(HTTPRedirectHandler):
    @override
    def redirect_request(
        self,
        req: Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> Request | None:
        validate_video_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def create_output(workdir: Path, stem: str, suffix: str) -> tuple[Path, int]:
    for number in range(1, 10_000):
        numbered = "" if number == 1 else f"-{number}"
        output = workdir / f"{stem}{numbered}{suffix}"
        try:
            descriptor = os.open(
                output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
        except FileExistsError:
            continue
        return output, descriptor
    raise RuntimeError("Could not find an available download filename")


def download_direct_video(url: str, workdir: Path, suffix: str) -> Path:
    request = Request(
        url,
        headers={"User-Agent": "multilingual-caption-video/1.1"},
    )
    opener = build_opener(PublicRedirectHandler())
    output: Path | None = None
    try:
        with opener.open(request, timeout=30) as response:
            validate_video_url(response.geturl())
            output, descriptor = create_output(
                workdir, direct_video_stem(url), suffix
            )
            with os.fdopen(descriptor, "wb") as target:
                shutil.copyfileobj(response, target)
    except BaseException:
        if output is not None:
            output.unlink(missing_ok=True)
        raise
    return output.resolve(strict=True)


def reject_live_video(
    info: dict[str, object], incomplete: bool = False
) -> str | None:
    del incomplete
    if info.get("is_live") is True or info.get("live_status") in {
        "is_live",
        "is_upcoming",
    }:
        return "Live streams are not supported"
    return None


class LiveStreamFilter:
    def __init__(self) -> None:
        self.rejected = False

    def __call__(
        self, info: dict[str, object], incomplete: bool = False
    ) -> str | None:
        reason = reject_live_video(info, incomplete)
        self.rejected = self.rejected or reason is not None
        return reason


def download_options(
    workdir: Path, match_filter: LiveStreamFilter | None = None
) -> dict[str, object]:
    options: dict[str, object] = {
        "noplaylist": True,
        "merge_output_format": "mp4",
        "outtmpl": {"default": str(workdir / "%(title).120B [%(id)s].%(ext)s")},
        "windowsfilenames": True,
        "quiet": True,
        "noprogress": True,
    }
    if match_filter is not None:
        options["match_filter"] = match_filter
    return options


def download_platform_video(url: str, workdir: Path) -> Path:
    from yt_dlp import YoutubeDL

    final_paths: list[str] = []
    live_filter = LiveStreamFilter()
    with YoutubeDL(download_options(workdir, live_filter)) as downloader:
        downloader.add_post_hook(final_paths.append)
        downloader.extract_info(url, download=True)

    if live_filter.rejected:
        raise ValueError("Live streams are not supported")

    if len(final_paths) != 1:
        raise RuntimeError("Downloader did not produce one video file")
    downloaded = Path(final_paths[0]).resolve(strict=True)
    if not downloaded.is_file() or not downloaded.is_relative_to(workdir):
        raise RuntimeError("Downloaded video is outside the work directory")
    return downloaded


def download_video(url: str, workdir: Path) -> Path:
    workdir = validate_workdir(workdir)
    url = validate_video_url(url)
    suffix = direct_video_suffix(url)
    if suffix is not None:
        return download_direct_video(url, workdir, suffix)
    return download_platform_video(url, workdir)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Download one direct MP4/MOV URL or delegate a platform page to "
            "the uv-managed yt-dlp API."
        )
    )
    parser.add_argument("url")
    parser.add_argument("workdir", type=Path)
    args = parser.parse_args()
    print(download_video(args.url, args.workdir))


if __name__ == "__main__":
    main()
