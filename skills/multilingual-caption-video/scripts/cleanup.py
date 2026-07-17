#!/usr/bin/env -S uv run

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MARKER = ".multilingual-caption-video-workdir"
KEEP = ".keep"


def create_workdir(parent: Path | None = None) -> Path:
    workdir = Path(tempfile.mkdtemp(prefix="caption-video.", dir=parent)).resolve()
    (workdir / MARKER).write_text(f"{workdir}\n", encoding="utf-8")
    return workdir


def validate_workdir(path: Path) -> Path:
    if path.is_symlink():
        raise ValueError("Refusing a symlinked work directory")
    resolved = path.resolve(strict=True)
    marker = resolved / MARKER
    if not resolved.name.startswith("caption-video.") or not marker.is_file():
        raise ValueError("Refusing an unmarked work directory")
    if marker.read_text(encoding="utf-8").strip() != str(resolved):
        raise ValueError("Work directory marker does not match its path")
    return resolved


def keep_workdir(path: Path) -> None:
    workdir = validate_workdir(path)
    (workdir / KEEP).write_text("keep\n", encoding="utf-8")


def delete_workdir(path: Path) -> bool:
    workdir = validate_workdir(path)
    if (workdir / KEEP).exists():
        return False
    shutil.rmtree(workdir)
    return True


def schedule_cleanup(path: Path, delay: float = 300) -> int:
    workdir = validate_workdir(path)
    if delay < 0:
        raise ValueError("Cleanup delay cannot be negative")
    process = subprocess.Popen(
        [
            sys.executable,
            str(Path(__file__).resolve()),
            "delete",
            str(workdir),
            "--delay",
            str(delay),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return process.pid


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create and safely clean caption-video work directories."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    create_parser = subparsers.add_parser("create")
    create_parser.add_argument("--parent", type=Path)
    schedule_parser = subparsers.add_parser("schedule")
    schedule_parser.add_argument("path", type=Path)
    schedule_parser.add_argument("--delay", type=float, default=300)
    keep_parser = subparsers.add_parser("keep")
    keep_parser.add_argument("path", type=Path)
    delete_parser = subparsers.add_parser("delete")
    delete_parser.add_argument("path", type=Path)
    delete_parser.add_argument("--delay", type=float, default=0)
    args = parser.parse_args()

    if args.command == "create":
        print(create_workdir(args.parent))
    elif args.command == "schedule":
        print(
            json.dumps(
                {"pid": schedule_cleanup(args.path, args.delay), "delay": args.delay}
            )
        )
    elif args.command == "keep":
        keep_workdir(args.path)
        print(args.path)
    else:
        if args.delay < 0:
            parser.error("--delay cannot be negative")
        time.sleep(args.delay)
        delete_workdir(args.path)


if __name__ == "__main__":
    main()
