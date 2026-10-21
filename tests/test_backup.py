"""저장 데이터 백업 도우미 테스트."""

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("backup_data", ROOT / "scripts" / "backup_data.py")
backup_data = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(backup_data)


class BackupDataTests(unittest.TestCase):
    def test_database_snapshot_and_photos_are_copied(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "data"
            destination = Path(temporary) / "backup"
            source.mkdir()
            images = source / "images"
            images.mkdir()
            (images / "asset.jpg").write_bytes(b"photo")
            (source / "server.log").write_text("log", encoding="utf-8")

            database = sqlite3.connect(source / "survey.db")
            try:
                database.execute("CREATE TABLE results (code TEXT)")
                database.execute("INSERT INTO results VALUES ('06-03-005-0007')")
                database.commit()
            finally:
                database.close()

            destination.mkdir()
            backup_data.copy_database(source, destination)
            backup_data.copy_saved_files(source, destination)

            database = sqlite3.connect(destination / "survey.db")
            try:
                self.assertEqual(database.execute("SELECT code FROM results").fetchone()[0], "06-03-005-0007")
            finally:
                database.close()
            self.assertEqual((destination / "images" / "asset.jpg").read_bytes(), b"photo")
            self.assertEqual((destination / "server.log").read_text(encoding="utf-8"), "log")


if __name__ == "__main__":
    unittest.main()
