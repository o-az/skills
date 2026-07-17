#!/usr/bin/env -S uv run

import argparse
import json
import os
from pathlib import Path


def default_preferences_path() -> Path:
    config_home = Path(
        os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
    )
    return config_home / "multilingual-caption-video" / "preferences.json"


def validate_preferences(preferences: dict) -> dict:
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
        if key in preferences and (
            not isinstance(preferences[key], str)
            or not preferences[key].strip()
        ):
            raise ValueError(f"{key} must be a non-empty string")
    return dict(sorted(preferences.items()))


def load_preferences(path: Path | None = None) -> dict:
    path = path or default_preferences_path()
    if not path.exists():
        return {}
    return validate_preferences(json.loads(path.read_text(encoding="utf-8")))


def save_preferences(updates: dict, path: Path | None = None) -> dict:
    path = path or default_preferences_path()
    preferences = validate_preferences({**load_preferences(path), **updates})
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".tmp")
    temporary_path.write_text(
        f"{json.dumps(preferences, indent=2, ensure_ascii=False, sort_keys=True)}\n",
        encoding="utf-8",
    )
    os.replace(temporary_path, path)
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
