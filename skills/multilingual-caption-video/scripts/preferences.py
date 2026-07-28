#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

import argparse
import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import cast

type Preferences = dict[str, str | int]


def default_preferences_path() -> Path:
    default_config_home = Path.home() / ".config"
    configured = os.environ.get("XDG_CONFIG_HOME")
    config_home = Path(configured) if configured else default_config_home
    if not config_home.is_absolute():
        config_home = default_config_home
    return config_home / "multilingual-caption-video" / "preferences.json"


def validate_preferences(preferences: Mapping[str, object]) -> Preferences:
    allowed = {"delivery", "font", "font_size", "language"}
    unknown = set(preferences) - allowed
    if unknown:
        raise ValueError(f"Unknown preferences: {', '.join(sorted(unknown))}")
    if "delivery" in preferences and preferences["delivery"] not in {
        "file",
        "url",
    }:
        raise ValueError("delivery must be 'file' or 'url'")
    if "font_size" in preferences and (
        not isinstance(preferences["font_size"], int)
        or isinstance(preferences["font_size"], bool)
        or preferences["font_size"] <= 0
    ):
        raise ValueError("font_size must be a positive integer")
    for key in ("font", "language"):
        value = preferences.get(key)
        if key in preferences and (
            not isinstance(value, str) or not value.strip()
        ):
            raise ValueError(f"{key} must be a non-empty string")
    return cast(Preferences, dict(sorted(preferences.items())))


def load_preferences(path: Path | None = None) -> Preferences:
    path = path or default_preferences_path()
    try:
        serialized = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    return validate_preferences(json.loads(serialized))


def save_preferences(
    updates: Mapping[str, object], path: Path | None = None
) -> Preferences:
    path = path or default_preferences_path()
    preferences = validate_preferences({**load_preferences(path), **updates})
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    serialized = f"{json.dumps(preferences, indent=2, ensure_ascii=False, sort_keys=True)}\n"
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(serialized)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return preferences


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read or save caption-video preferences."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("show")
    set_parser = subparsers.add_parser("set")
    set_parser.add_argument("--delivery", choices=("file", "url"))
    set_parser.add_argument("--language")
    set_parser.add_argument("--font")
    set_parser.add_argument("--font-size", type=int)
    args = parser.parse_args()

    if args.command == "show":
        preferences = load_preferences()
    else:
        preferences = {
            key: value
            for key, value in {
                "delivery": args.delivery,
                "language": args.language,
                "font": args.font,
                "font_size": args.font_size,
            }.items()
            if value is not None
        }
        if not preferences:
            parser.error("set requires at least one preference")
        preferences = save_preferences(preferences)
    print(json.dumps(preferences, indent=2, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
