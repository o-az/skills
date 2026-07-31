#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

import argparse
import datetime
import os
import re
import shutil
import sys
from pathlib import Path

LANGUAGE_CODE = re.compile(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*")
WINDOWS_DOWNLOADS_ID = "{374DE290-123F-4565-9164-39C4925E467B}"


def default_downloads_directory() -> Path:
    if sys.platform == "win32":
        import winreg

        key_path = (
            r"Software\Microsoft\Windows\CurrentVersion\Explorer"
            r"\User Shell Folders"
        )
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                value, _ = winreg.QueryValueEx(key, WINDOWS_DOWNLOADS_ID)
            downloads = Path(os.path.expandvars(value)).expanduser()
            if downloads.is_absolute():
                return downloads
        except OSError, TypeError:
            pass
        return Path.home() / "Desktop"

    if sys.platform.startswith("linux"):
        config_home = Path(
            os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
        )
        user_dirs = config_home / "user-dirs.dirs"
        if user_dirs.is_file():
            match = re.search(
                r'^XDG_DOWNLOAD_DIR="([^"\n]+)"$',
                user_dirs.read_text(encoding="utf-8"),
                re.MULTILINE,
            )
            if match:
                configured = match.group(1).replace("$HOME", str(Path.home()))
                path = Path(configured).expanduser()
                if path.is_absolute():
                    return path

    return Path.home() / "Downloads"


def normalized_language_code(language: str) -> str:
    code = language.strip().replace("_", "-").lower()
    if not LANGUAGE_CODE.fullmatch(code):
        raise ValueError("Language must be a short ISO or BCP 47 code")
    return code


def deliver_video(
    video: Path,
    language: str,
    *,
    destination: Path | None = None,
    timestamp: datetime.datetime | None = None,
) -> Path:
    video = video.resolve(strict=True)
    if not video.is_file() or video.suffix.lower() != ".mp4":
        raise ValueError("Delivered video must be a regular MP4 file")

    destination = (
        default_downloads_directory() if destination is None else destination
    ).expanduser()
    destination.mkdir(parents=True, exist_ok=True)
    destination = destination.resolve(strict=True)
    if not destination.is_dir():
        raise ValueError("Delivery destination must be a directory")

    delivered_at = (
        datetime.datetime.now().astimezone() if timestamp is None else timestamp
    )
    language_code = normalized_language_code(language)
    for second_offset in range(10_000):
        candidate_time = delivered_at + datetime.timedelta(
            seconds=second_offset
        )
        output = destination / (
            f"{language_code}_{candidate_time:%Y-%m-%d_%H.%M.%S}.mp4"
        )
        try:
            descriptor = os.open(
                output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644
            )
        except FileExistsError:
            continue
        try:
            with (
                os.fdopen(descriptor, "wb") as target,
                video.open("rb") as source,
            ):
                shutil.copyfileobj(source, target)
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        return output
    raise RuntimeError("Could not find an available delivery filename")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy a verified captioned MP4 to the Downloads directory."
    )
    parser.add_argument("video", type=Path)
    parser.add_argument("language", help="ISO or BCP 47 language code")
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    print(
        deliver_video(
            args.video,
            args.language,
            destination=args.destination,
        )
    )


if __name__ == "__main__":
    main()
