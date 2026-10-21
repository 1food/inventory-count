"""Create a consistent copy of the application's saved data.

This helper is invoked by ``backup.bat``.  SQLite's backup API is used so a
manual backup made while the server is running still contains a valid database
snapshot.  Photos and other data files are copied alongside it.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path


SQLITE_SIDE_FILES = {"survey.db", "survey.db-shm", "survey.db-wal"}


def copy_database(source: Path, destination: Path) -> None:
    """Copy the SQLite database through its online backup interface."""
    database = source / "survey.db"
    if not database.exists():
        return

    reader = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    writer = sqlite3.connect(destination / database.name)
    try:
        reader.backup(writer)
    finally:
        writer.close()
        reader.close()


def copy_saved_files(source: Path, destination: Path) -> None:
    """Copy photos, logs, and any future data files without raw SQLite side files."""
    for item in source.iterdir():
        if item.name in SQLITE_SIDE_FILES:
            continue
        target = destination / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)


def main() -> int:
    parser = argparse.ArgumentParser(description="재물조사 저장 데이터를 백업합니다.")
    parser.add_argument("source", type=Path, help="data 폴더 경로")
    parser.add_argument("destination", type=Path, help="새 백업 폴더 경로")
    args = parser.parse_args()

    source = args.source.resolve()
    destination = args.destination.resolve()
    if not source.is_dir():
        print(f"[ERROR] Data folder was not found: {source}", file=sys.stderr)
        return 1
    if destination.exists():
        print(f"[ERROR] Backup destination already exists: {destination}", file=sys.stderr)
        return 1

    try:
        destination.mkdir(parents=True)
        copy_database(source, destination)
        copy_saved_files(source, destination)
    except Exception as error:
        print(f"[ERROR] Backup failed: {error}", file=sys.stderr)
        return 1

    print(f"Backup completed: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
