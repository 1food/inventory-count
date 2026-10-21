"""공간(장소) 목록의 단일 진실 원천.

기관마다 건물 구조가 다르므로 코드에 공간을 적지 않는다.
- assets/공간목록.xlsx 가 있으면 그 목록(구역·공간명)을 '정식 공간'으로 쓴다.
- 없으면 자산대장의 '자산위치' 값을 모아 한 구역('공간')으로 자동 구성한다.

자산위치가 (공백을 무시하고) 정식 공간과 일치하면 그 공간에 속하고,
아니면 원본 위치명 그대로 '기타' 구역에 묶인다.
"""
from __future__ import annotations

import re
from typing import Iterable

import openpyxl

from .config import SOURCE_SPACES

ETC_FLOOR = "기타"
AUTO_GROUP = "공간"
UNASSIGNED = "미지정"

# load()가 채운다. main.py는 locations.FLOORS 처럼 모듈 속성으로 읽는다.
FLOORS: list[tuple[str, list[str]]] = []
FLOOR_ORDER: list[str] = []
OFFICIAL_NAMES: list[str] = []
SOURCE = ""

_WHITESPACE = re.compile(r"\s+")
_BY_NORMALIZED: dict[str, str] = {}


def normalize(name: str) -> str:
    """공백을 제거한 비교용 키."""
    return _WHITESPACE.sub("", name or "")


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def read_space_sheet(path=SOURCE_SPACES) -> list[tuple[str, list[str]]]:
    """공간목록.xlsx → [(구역, [공간명...])]. 첫 시트에서 '공간명' 머리글 행을 찾는다.

    구역 열(구역·층·건물 중 하나)은 선택이며, 비어 있으면 바로 위 행의 구역을 이어 쓴다.
    """
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = list(workbook.worksheets[0].iter_rows(values_only=True))
    finally:
        workbook.close()
    header_at, name_col, group_col = None, None, None
    for i, row in enumerate(rows[:10]):
        cells = [_text(c) for c in row]
        if "공간명" in cells:
            header_at, name_col = i, cells.index("공간명")
            group_col = next((cells.index(h) for h in ("구역", "층", "건물") if h in cells), None)
            break
    if header_at is None:
        raise ValueError(f"{path.name}: '공간명' 머리글을 찾지 못했습니다.")

    groups: dict[str, list[str]] = {}
    seen: set[str] = set()
    group = AUTO_GROUP
    for row in rows[header_at + 1:]:
        if group_col is not None and group_col < len(row) and _text(row[group_col]):
            group = _text(row[group_col])
        name = _text(row[name_col]) if name_col < len(row) else ""
        if not name or normalize(name) in seen:
            continue
        seen.add(normalize(name))
        groups.setdefault(group, []).append(name)
    return list(groups.items())


def load(raw_locations: Iterable[str]) -> None:
    """정식 공간 목록을 다시 구성한다(자산대장 로드 때마다 호출)."""
    global FLOORS, FLOOR_ORDER, OFFICIAL_NAMES, SOURCE
    if SOURCE_SPACES.exists():
        floors = read_space_sheet()
        SOURCE = SOURCE_SPACES.name
    else:
        names: dict[str, str] = {}
        for raw in raw_locations:
            if raw and raw != UNASSIGNED:
                names.setdefault(normalize(raw), raw.strip())
        floors = [(AUTO_GROUP, sorted(names.values()))] if names else []
        SOURCE = "자산위치 자동 구성"

    FLOORS = floors
    FLOOR_ORDER = [floor for floor, _ in floors]
    if ETC_FLOOR not in FLOOR_ORDER:
        FLOOR_ORDER.append(ETC_FLOOR)
    OFFICIAL_NAMES = [name for _, group in floors for name in group]
    _BY_NORMALIZED.clear()
    for name in OFFICIAL_NAMES:
        _BY_NORMALIZED[normalize(name)] = name


def resolve(raw_location: str) -> str:
    """자산위치 → 표시용 공간명. 정식 공간과 일치하면 정식명, 아니면 원본."""
    return _BY_NORMALIZED.get(normalize(raw_location), (raw_location or UNASSIGNED))


def is_official(name: str) -> bool:
    return normalize(name) in _BY_NORMALIZED


def official_groups() -> list[dict]:
    """위치 드롭다운용: 구역별 정식 공간(구역 안에서 가나다순)."""
    return [{"floor": floor, "spaces": sorted(names)} for floor, names in FLOORS]
