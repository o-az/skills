#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = ["yt-dlp[default,curl-cffi]==2026.7.4"]
# ///

import argparse
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urlsplit

from cleanup import validate_workdir


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


def download_options(workdir: Path) -> dict[str, object]:
    return {
        "noplaylist": True,
        "merge_output_format": "mp4",
        "outtmpl": {"default": str(workdir / "source.%(ext)s")},
        "quiet": True,
        "noprogress": True,
    }


def download_video(url: str, workdir: Path) -> Path:
    from yt_dlp import YoutubeDL

    workdir = validate_workdir(workdir)
    final_paths: list[str] = []
    with YoutubeDL(download_options(workdir)) as downloader:
        downloader.add_post_hook(final_paths.append)
        downloader.extract_info(validate_video_url(url), download=True)

    if len(final_paths) != 1:
        raise RuntimeError("Downloader did not produce one video file")
    downloaded = Path(final_paths[0]).resolve(strict=True)
    if not downloaded.is_file() or not downloaded.is_relative_to(workdir):
        raise RuntimeError("Downloaded video is outside the work directory")
    return downloaded


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download one public video with the uv-managed yt-dlp API."
    )
    parser.add_argument("url")
    parser.add_argument("workdir", type=Path)
    args = parser.parse_args()
    print(download_video(args.url, args.workdir))


if __name__ == "__main__":
    main()
