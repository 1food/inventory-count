"""체험판(DEMO_MODE) 테스트 — 설정이 import 시점에 정해지므로 별도 프로세스로 실행한다."""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = textwrap.dedent('''
    import datetime as dt, sys
    from pathlib import Path
    from unittest import mock
    sys.path[:0] = [r"{runtime}", r"{root}"]
    from fastapi.testclient import TestClient
    from app import database, main
    from app.catalog import catalog
    database.DB_PATH = Path(r"{tmp}") / "demo.db"
    image_dir = Path(r"{tmp}") / "images"; image_dir.mkdir()
    main.IMAGE_DIR = image_dir
    catalog.load(); database.init()
    database.save_results_atomic([dict(code="08-01-001", actual_qty=1, status="활용", book_qty=1,
        reason="", confirmed_space="", method="list", device="")], expected={{}}, undo_id="x" * 20)
    (image_dir / "old.jpg").write_bytes(b"x")
    with TestClient(main.app) as client:              # 시작 이벤트에서 초기화된다.
        seeded = database.all_results()
        assert len(seeded) == len(main._DEMO_SEED_SPEC), "startup reset applies baseline seed"
        assert seeded["08-01-001"]["status"] == "활용", "seed status"
        assert seeded["02-01-002-0001"]["actual_qty"] == 0, "seed missing asset"
        assert not list(image_dir.iterdir()), "images removed"
        login = client.get("/").text
        assert "123456" in login and "654321" in login and "새벽 4시" in login, "login codes"
        assert client.post("/api/session", data={{"code": "123456"}}).status_code == 200
        index = client.get("/").text
        assert 'data-demo="1"' in index and "demo-banner" in index and "의견 남기기" in index, "banner"
        assert client.post("/api/photos/08-01-001", files={{"image": ("a.jpg", b"x", "image/jpeg")}}).status_code == 403
        health = client.get("/api/health").json()
        assert health["demo"] and not health["vision"] and not health["passkey"], "vision/passkey off"
    kst = dt.timezone(dt.timedelta(hours=9))
    assert main.demo_reset_due(dt.datetime(2026, 10, 14, 4, 5, tzinfo=kst), "2026-10-13")
    assert not main.demo_reset_due(dt.datetime(2026, 10, 14, 3, 59, tzinfo=kst), "2026-10-13")
    assert not main.demo_reset_due(dt.datetime(2026, 10, 14, 9, 0, tzinfo=kst), "2026-10-14")
    print("DEMO-OK")
''')


class DemoModeTests(unittest.TestCase):
    def test_demo_mode(self):
        runtime = ROOT / f".runtime-py{sys.version_info.major}{sys.version_info.minor}"
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "DEMO_MODE": "1", "ACCESS_CODE": "123456", "ADMIN_CODE": "654321",
                   "ORG_NAME": "체험 기관", "FEEDBACK_URL": "https://example.org/form",
                   "GOOGLE_VISION_API_KEY": "should-be-ignored", "PASSKEY_RP_ID": "a.example",
                   "PASSKEY_ORIGIN": "https://a.example", "PYTHONIOENCODING": "utf-8"}
            code = SCRIPT.format(runtime=runtime, root=ROOT, tmp=tmp)
            done = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True,
                                  text=True, encoding="utf-8", timeout=120)
            self.assertIn("DEMO-OK", done.stdout, done.stdout + done.stderr)


if __name__ == "__main__":
    unittest.main()
