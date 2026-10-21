"""자산대장(읽기 전용)과 코드 색인.

- 입력은 회계 프로그램에서 내려받은 '고정자산대장' 양식(assets/고정자산대장.xlsx)이다.
  첫 시트에서 '자산코드' 머리글 행을 찾아 머리글 이름으로 열을 읽으므로 열 순서가 달라도 된다.
- 분류별 '소계'·마지막 '합계' 행처럼 자산코드가 없는 행은 건너뛴다.
- 시작 시 1회 로드해 메모리에 둔다. 자산코드가 유일키.
- 코드는 3마디(08-01-002)·4마디(03-05-012-0001)를 모두 받는다. 하이픈 유무·앞자리 0
  유무와 무관하게 대조하고, 정확 일치가 없으면 편집거리 1 이내의 근접 후보를 돌려준다.
- 같은 품목(대-중-소가 같은 4마디 코드)은 일련번호 일괄 처리에 쓴다.

내부 모델은 영문 snake_case 키를 쓴다. 한글 머리글은 로드 시점에만 참조한다.
"""
from __future__ import annotations

import datetime as dt
import re

import openpyxl

from . import clock, locations
from .config import SOURCE_MASTER

# 내부 키 → 받아들이는 머리글(앞의 것이 우선). 줄바꿈·공백은 무시하고 비교한다.
HEADERS = {
    "code": ("자산코드",),
    "name": ("자산명",),
    "category": ("자산분류",),
    "acquired": ("취득일자",),
    "book_qty": ("현재수량", "장부수"),
    "asset_status": ("자산상태",),
    "raw_location": ("자산위치", "위치명"),
    "department": ("운영부서", "운영부서명"),
    "usage": ("용도",),
}
REQUIRED = ("code", "name", "book_qty")
SUMMARY_LABELS = {"소계", "합계", "총계"}


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dt.date, dt.datetime)):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _header(value) -> str:
    return re.sub(r"\s+", "", _text(value))


def _int(value) -> int:
    try:
        return int(float(_text(value).replace(",", "")))
    except (TypeError, ValueError):
        return 0


def normalize_code(value: str) -> str:
    """마디별 앞자리 0을 제거한 비교 키. '03-05-012-0001' → '3-5-12-1'."""
    parts = re.sub(r"\s+", "", value or "").split("-")
    return "-".join(str(int(p)) if p.isdigit() else p for p in parts if p != "" or len(parts) == 1)


def compact_code(value: str) -> str:
    """하이픈·공백을 뺀 숫자 키(직접 입력 비교용)."""
    return re.sub(r"\D", "", value or "")


def _within_edit_distance_one(a: str, b: str) -> bool:
    """편집거리가 1 이하인지. 길이 차가 2 이상이면 즉시 False."""
    if abs(len(a) - len(b)) > 1:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 1


def _serial_prefix(code: str) -> str | None:
    """4마디 코드면 대-중-소 prefix, 아니면 None."""
    parts = code.split("-")
    return "-".join(parts[:3]) if len(parts) == 4 and parts[3].isdigit() else None


def read_ledger(path=SOURCE_MASTER) -> list[dict]:
    """고정자산대장 → 자산 dict 목록(소계·합계 행 제외)."""
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = workbook.worksheets[0].iter_rows(values_only=True)
        index = None
        for _ in range(10):
            cells = [_header(c) for c in next(rows, ())]
            if "자산코드" in cells:
                index = {}
                for key, names in HEADERS.items():
                    found = next((cells.index(n) for n in names if n in cells), None)
                    if found is not None:
                        index[key] = found
                break
        if index is None:
            raise ValueError(f"{path.name}: 첫 시트 위쪽 10행 안에서 '자산코드' 머리글을 찾지 못했습니다.")
        missing = [HEADERS[k][0] for k in REQUIRED if k not in index]
        if missing:
            raise ValueError(f"{path.name}: 필수 머리글이 없습니다 — {', '.join(missing)}")

        def cell(row, key):
            i = index.get(key)
            return row[i] if i is not None and i < len(row) else None

        assets = []
        for row in rows:
            code = _text(cell(row, "code"))
            name = _text(cell(row, "name"))
            if not code or name in SUMMARY_LABELS or _text(cell(row, "category")) in SUMMARY_LABELS:
                continue
            assets.append({
                "code": code,
                "name": name,
                "category": _text(cell(row, "category")),
                "acquired": _text(cell(row, "acquired"))[:10],
                "book_qty": _int(cell(row, "book_qty")),
                "asset_status": _text(cell(row, "asset_status")),
                "raw_location": _text(cell(row, "raw_location")) or locations.UNASSIGNED,
                "department": _text(cell(row, "department")),
                "usage": _text(cell(row, "usage")),
            })
        return assets
    finally:
        workbook.close()


class Catalog:
    def __init__(self) -> None:
        self.assets: dict[str, dict] = {}
        self._by_code: dict[str, list[str]] = {}       # 정규화/compact 키 → 자산코드들
        self._groups: dict[str, list[str]] = {}        # 대-중-소 → 자산코드들(일련번호 순)
        self.loaded_at: str | None = None
        self.duplicates: list[str] = []

    def load(self) -> None:
        rows = read_ledger()
        locations.load(row["raw_location"] for row in rows)

        self.assets.clear()
        self._by_code.clear()
        self._groups.clear()
        self.duplicates = []
        for asset in rows:
            if asset["code"] in self.assets:
                self.duplicates.append(asset["code"])   # 같은 코드가 또 나오면 먼저 나온 행을 쓴다.
                continue
            asset["space"] = locations.resolve(asset["raw_location"])
            self.assets[asset["code"]] = asset
            self._index(asset)

        for codes in self._groups.values():
            codes.sort(key=lambda c: int(c.split("-")[-1]))
        self.loaded_at = clock.timestamp()

    def _index(self, asset: dict) -> None:
        code = asset["code"]
        for key in (normalize_code(code), compact_code(code)):
            if key:
                self._by_code.setdefault(key, [])
                if code not in self._by_code[key]:
                    self._by_code[key].append(code)
        prefix = _serial_prefix(code)
        if prefix:
            self._groups.setdefault(prefix, []).append(code)

    # ── 조회 ──
    def get(self, code: str) -> dict | None:
        return self.assets.get(code)

    def lookup(self, raw: str) -> tuple[dict | None, list[dict]]:
        """읽은 코드로 자산을 찾는다. (정확 일치 자산 | None, 근접 후보 목록)."""
        keys = [normalize_code(raw), compact_code(raw)]
        matched = []
        for key in keys:
            matched.extend(self._by_code.get(key, []))
        unique = list(dict.fromkeys(matched))
        if len(unique) == 1:
            return self.assets[unique[0]], []
        if unique:
            return None, [self.assets[c] for c in unique[:8]]

        compact = compact_code(raw)
        if not compact:
            return None, []
        near: list[str] = []
        for key, codes in self._by_code.items():
            if key.isdigit() and _within_edit_distance_one(compact, key):
                near.extend(codes)
        return None, [self.assets[c] for c in list(dict.fromkeys(near))[:8]]

    def serial_group(self, code: str) -> list[dict]:
        """같은 대-중-소를 가진 자산들(일련번호 순). 4마디가 아니면 빈 목록."""
        prefix = _serial_prefix(code)
        return [self.assets[c] for c in self._groups.get(prefix, [])] if prefix else []


catalog = Catalog()
