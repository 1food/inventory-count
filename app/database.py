"""재물조사 SQLite 저장소.

- 실사 결과(results)는 현재 상태를 upsert로 유지하되,
  모든 저장/취소를 result_history에 **append-only 감사 이력**으로 남긴다.
  (누가·어떤 기기로·언제 바꿨는지 추적 가능 — 여러 직원 동시 실사의 책임성)
- device(조사자·기기 라벨)를 결과·이력에 함께 기록한다.
- meta 테이블의 스키마 버전으로 업데이트 시 MIGRATIONS를 순서대로 적용한다.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager

from . import clock
from .config import DB_PATH, SCHEMA_VERSION

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS results(
  code TEXT PRIMARY KEY,
  survey_date TEXT NOT NULL,
  actual_qty INTEGER NOT NULL,
  book_qty INTEGER NOT NULL,
  status TEXT NOT NULL,
  difference INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  confirmed_space TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'label',
  device TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  action TEXT NOT NULL,               -- 'save' | 'delete' | 'restore'
  actual_qty INTEGER, status TEXT, difference INTEGER,
  confirmed_space TEXT, reason TEXT, method TEXT,
  device TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_code_idx ON result_history(code);
CREATE TABLE IF NOT EXISTS result_undo(
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL, path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_code_idx ON photos(code);
CREATE TABLE IF NOT EXISTS passkeys(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT UNIQUE NOT NULL, public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS passkey_challenges(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge BLOB NOT NULL, expires_at INTEGER NOT NULL
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    with connect() as conn:
        has_meta = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
        found = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'").fetchone() if has_meta else None
        current = int(found[0]) if found else None
        if current is not None and current > SCHEMA_VERSION:
            raise RuntimeError(
                f"데이터(DB) 버전 {current}이 프로그램이 아는 버전 {SCHEMA_VERSION}보다 새롭습니다. "
                "최신 배포본으로 업데이트한 뒤 실행하세요.")
        conn.executescript(SCHEMA)
        # 기존 DB면 저장된 버전 다음부터 마이그레이션을 차례로 적용한다(새 DB는 SCHEMA가 최신).
        if current is not None:
            for version in range(current + 1, SCHEMA_VERSION + 1):
                for statement in MIGRATIONS.get(version, ()):
                    conn.execute(statement)
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(SCHEMA_VERSION),),
        )


# 스키마 버전 → 그 버전으로 올릴 때 실행할 SQL 목록. 스키마를 바꾸면
# config.SCHEMA_VERSION을 1 올리고 여기에 ALTER 문을 추가한다(SCHEMA에도 반영).
MIGRATIONS: dict[int, tuple[str, ...]] = {}


def _now() -> str:
    return clock.timestamp()


def reset_results(image_dir, seed: list[dict] | None = None) -> None:
    """실사 결과·이력·사진을 모두 지운다(체험판 초기화, 또는 백업 뒤 '연습 결과 지우기').

    seed를 주면 초기화 뒤 그 실사 결과를 기본값으로 다시 채운다(이력 없이).
    운영판의 append-only 감사 이력 규칙은 체험판의 가상 자료에는 적용하지 않는다.
    """
    with connect() as conn:
        for table in ("results", "result_history", "result_undo", "photos"):
            conn.execute(f"DELETE FROM {table}")
        if seed:
            now = _now()
            for item in seed:
                _write_result(conn, item, now=now)
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('demo_reset_date', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (clock.today_iso(),))
    for path in image_dir.glob("*"):
        if path.is_file():
            path.unlink()


def demo_reset_date() -> str:
    with connect() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key='demo_reset_date'").fetchone()
    return row[0] if row else ""


class ConflictError(RuntimeError):
    """화면을 연 뒤 다른 기기에서 같은 자산을 바꾸었을 때."""


class UndoUnavailableError(RuntimeError):
    """되돌리기 토큰이 없거나 만료됐을 때."""


def _row(conn: sqlite3.Connection, code: str) -> dict | None:
    found = conn.execute("SELECT * FROM results WHERE code=?", (code,)).fetchone()
    return dict(found) if found else None


def _check_expected(conn: sqlite3.Connection, codes: list[str],
                    expected: dict[str, str | None]) -> None:
    for code in codes:
        if code not in expected:
            continue
        current = _row(conn, code)
        current_stamp = current["updated_at"] if current else None
        if current_stamp != expected[code]:
            raise ConflictError(f"다른 기기에서 먼저 수정된 자산입니다: {code}")


def _write_result(conn: sqlite3.Connection, item: dict, *, now: str,
                  action: str = "save", survey_date: str | None = None) -> None:
    actual = int(item["actual_qty"])
    book = int(item["book_qty"])
    difference = actual - book
    survey_date = survey_date or clock.today_iso()
    conn.execute(
        """INSERT INTO results
             (code, survey_date, actual_qty, book_qty, status, difference,
              reason, confirmed_space, method, device, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(code) DO UPDATE SET
             survey_date=excluded.survey_date, actual_qty=excluded.actual_qty,
             book_qty=excluded.book_qty, status=excluded.status,
             difference=excluded.difference, reason=excluded.reason,
             confirmed_space=excluded.confirmed_space, method=excluded.method,
             device=excluded.device, updated_at=excluded.updated_at""",
        (item["code"], survey_date, actual, book, item["status"], difference,
         item.get("reason", ""), item.get("confirmed_space", ""),
         item.get("method", "label"), item.get("device", ""), now),
    )
    conn.execute(
        """INSERT INTO result_history
             (code, action, actual_qty, status, difference, confirmed_space,
              reason, method, device, at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (item["code"], action, actual, item["status"], difference,
         item.get("confirmed_space", ""), item.get("reason", ""),
         item.get("method", "label"), item.get("device", ""), now),
    )


def _store_undo(conn: sqlite3.Connection, undo_id: str, previous: dict[str, dict | None],
                current: dict[str, dict], ttl: int = 300) -> None:
    now_epoch = int(time.time())
    conn.execute("DELETE FROM result_undo WHERE expires_at < ?", (now_epoch,))
    payload = {
        "items": [
            {"code": code, "expected_updated_at": current[code]["updated_at"],
             "previous": previous[code]}
            for code in previous
        ]
    }
    conn.execute(
        "INSERT INTO result_undo(id, payload, expires_at) VALUES (?,?,?)",
        (undo_id, json.dumps(payload, ensure_ascii=False), now_epoch + ttl),
    )


# ── 실사 결과 ──
def all_results() -> dict[str, dict]:
    with connect() as conn:
        return {r["code"]: dict(r) for r in conn.execute("SELECT * FROM results")}


def get_result(code: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM results WHERE code=?", (code,)).fetchone()
    return dict(row) if row else None


def save_result(*, code: str, actual_qty: int, status: str, book_qty: int,
                reason: str = "", confirmed_space: str = "", method: str = "label",
                device: str = "") -> dict:
    """실사 결과 upsert + 감사 이력 append. 과부족은 실사계-장부수로 계산."""
    now = _now()
    with connect() as conn:
        _write_result(conn, {
            "code": code, "actual_qty": actual_qty, "book_qty": book_qty,
            "status": status, "reason": reason, "confirmed_space": confirmed_space,
            "method": method, "device": device,
        }, now=now)
    return get_result(code)


def save_results_atomic(entries: list[dict], *, expected: dict[str, str | None],
                        undo_id: str) -> list[dict]:
    """여러 자산을 하나의 트랜잭션으로 저장하고 되돌리기 스냅샷을 남긴다."""
    codes = [item["code"] for item in entries]
    now = _now()
    with connect() as conn:
        previous = {code: _row(conn, code) for code in codes}
        _check_expected(conn, codes, expected)
        for item in entries:
            _write_result(conn, item, now=now)
        current = {code: _row(conn, code) for code in codes}
        _store_undo(conn, undo_id, previous, current)
    return [current[code] for code in codes]


def admin_bulk_atomic(codes: list[str], *, expected: dict[str, str | None],
                      undo_id: str, device: str = "", status: str | None = None,
                      confirmed_space: str | None = None, delete: bool = False) -> list[dict]:
    """관리자 일괄 작업을 원자적으로 적용하고 되돌리기 토큰을 만든다."""
    now = _now()
    with connect() as conn:
        previous = {code: _row(conn, code) for code in codes}
        if any(previous[code] is None for code in codes):
            raise ConflictError("이미 삭제되었거나 없는 실사 결과가 있습니다.")
        _check_expected(conn, codes, expected)
        current: dict[str, dict] = {}
        if delete:
            for code in codes:
                conn.execute("DELETE FROM results WHERE code=?", (code,))
                conn.execute(
                    "INSERT INTO result_history(code, action, device, at) VALUES (?,'delete',?,?)",
                    (code, device, now),
                )
                # 삭제 후 되돌리기 충돌 검사는 현재 행의 부재(None)로 한다.
                current[code] = {"updated_at": None}
        else:
            for code in codes:
                item = dict(previous[code])
                if status is not None:
                    item["status"] = status
                if confirmed_space is not None:
                    item["confirmed_space"] = confirmed_space
                item["device"] = device
                _write_result(conn, item, now=now)
                current[code] = _row(conn, code)
        _store_undo(conn, undo_id, previous, current)
    return [] if delete else [current[code] for code in codes]


def undo_operation(undo_id: str, *, device: str = "") -> list[str]:
    """서버가 발급한 일회용 토큰으로 방금 작업의 이전 상태를 복원한다."""
    now_epoch = int(time.time())
    now = _now()
    with connect() as conn:
        record = conn.execute(
            "SELECT payload, expires_at FROM result_undo WHERE id=?", (undo_id,)
        ).fetchone()
        if not record or int(record["expires_at"]) < now_epoch:
            if record:
                conn.execute("DELETE FROM result_undo WHERE id=?", (undo_id,))
            raise UndoUnavailableError("되돌리기 가능 시간이 지났습니다.")
        items = json.loads(record["payload"])["items"]
        codes = [item["code"] for item in items]
        expected = {item["code"]: item["expected_updated_at"] for item in items}
        _check_expected(conn, codes, expected)
        for item in items:
            code = item["code"]
            previous = item["previous"]
            if previous is None:
                conn.execute("DELETE FROM results WHERE code=?", (code,))
                conn.execute(
                    "INSERT INTO result_history(code, action, device, at) VALUES (?,'restore',?,?)",
                    (code, device, now),
                )
            else:
                restored = dict(previous)
                restored["device"] = device
                _write_result(
                    conn, restored, now=now, action="restore",
                    survey_date=previous["survey_date"],
                )
        conn.execute("DELETE FROM result_undo WHERE id=?", (undo_id,))
    return codes


def delete_results(codes: list[str], *, device: str = "") -> None:
    now = _now()
    with connect() as conn:
        for code in codes:
            conn.execute("DELETE FROM results WHERE code=?", (code,))
            conn.execute(
                "INSERT INTO result_history(code, action, device, at) "
                "VALUES (?,'delete',?,?)",
                (code, device, now),
            )


def history_for(code: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM result_history WHERE code=? ORDER BY id DESC LIMIT 50", (code,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── 사진 ──
def add_photo(code: str, path: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO photos(code, path, created_at) VALUES (?,?,?)",
            (code, path, _now()),
        )


def photos_for(code: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT path, created_at FROM photos WHERE code=? ORDER BY id DESC",
            (code,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── 패스키 challenge (일회용) ──
def save_challenge(challenge_id: str, kind: str, challenge: bytes, ttl: int = 300) -> None:
    now = int(time.time())
    with connect() as conn:
        conn.execute("DELETE FROM passkey_challenges WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO passkey_challenges VALUES (?,?,?,?)",
            (challenge_id, kind, sqlite3.Binary(challenge), now + ttl),
        )


def consume_challenge(challenge_id: str, kind: str) -> bytes | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT challenge, expires_at FROM passkey_challenges WHERE id=? AND kind=?",
            (challenge_id, kind),
        ).fetchone()
        conn.execute("DELETE FROM passkey_challenges WHERE id=?", (challenge_id,))
    if not row or int(row["expires_at"]) < int(time.time()):
        return None
    return bytes(row["challenge"])


# ── 패스키 ──
def _passkey_row(row: sqlite3.Row) -> dict:
    item = dict(row)
    try:
        item["transports"] = json.loads(item.get("transports") or "[]")
    except (TypeError, ValueError):
        item["transports"] = []
    item["backed_up"] = bool(item.get("backed_up"))
    return item


def passkey_list() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM passkeys ORDER BY id").fetchall()
    return [_passkey_row(r) for r in rows]


def passkey_get(credential_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM passkeys WHERE credential_id=?", (credential_id,)
        ).fetchone()
    return _passkey_row(row) if row else None


def passkey_add(*, credential_id: str, public_key: bytes, sign_count: int,
                transports: list[str], device_type: str, backed_up: bool, name: str) -> int:
    with connect() as conn:
        cursor = conn.execute(
            """INSERT INTO passkeys
                 (credential_id, public_key, sign_count, transports, device_type,
                  backed_up, name, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (credential_id, sqlite3.Binary(public_key), int(sign_count),
             json.dumps(transports, ensure_ascii=False), device_type,
             int(bool(backed_up)), name, _now()),
        )
        return cursor.lastrowid


def passkey_touch(credential_id: str, sign_count: int, device_type: str, backed_up: bool) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE passkeys SET sign_count=?, device_type=?, backed_up=?, last_used_at=? "
            "WHERE credential_id=?",
            (int(sign_count), device_type, int(bool(backed_up)), _now(), credential_id),
        )


def passkey_delete(passkey_id: int) -> bool:
    with connect() as conn:
        return conn.execute("DELETE FROM passkeys WHERE id=?", (int(passkey_id),)).rowcount > 0
