"""재물조사표 엑셀 출력.

출력 양식(assets/재물조사표.xlsx)을 그대로 열어 서식·병합 머리글을 보존한다.
열 위치는 고정하지 않고 위쪽 10행의 머리글 이름(조사일자·자산코드·사용가능·폐품·활용·
과부족·사유 등)으로 찾는다. 데이터는 머리글 바로 아래 행부터다.

두 가지 양식을 모두 받는다.
- 채워진 양식: 자산 행이 이미 들어 있으면 자산코드로 행을 찾아 실사 결과만 채운다.
  자산분류·코드·자산명·취득일자·자산상태·장부수 등 나머지 열은 수정하지 않는다.
  양식에 없는 실사 자산은 맨 아래에 행을 추가한다.
- 빈 양식: 자산 행이 없으면 자산대장 순서대로 행을 만든다. 첫 데이터 행의 서식을 본뜬다.

조사일자는 해당 자산을 실사 등록한 날짜(YYYYMMDD)를 그 행에만 넣고, 실사하지 않은
자산은 비워 둔다. 실사상태 세 열은 0으로 두고 실사한 상태 열에만 실사 수량을 넣는다.
only_surveyed=True면 실사한 자산 행만 남긴다.
"""
from __future__ import annotations

import io
import re
from copy import copy

import openpyxl

from . import clock
from .config import SOURCE_TEMPLATE, STATUS_SCRAP, STATUS_USABLE, STATUS_UTILIZE

# 내부 키 → 머리글. 머리글은 공백·줄바꿈을 지우고, 정확히 같거나 이 글자로 시작하면 일치로 본다.
LABELS = {
    "date": "조사일자", "category": "자산분류", "system_code": "시스템자산코드",
    "code": "자산코드", "name": "자산명", "acquired": "취득일자", "asset_status": "자산상태",
    "book_qty": "장부수", "usable": "사용가능", "scrap": "폐품", "utilize": "활용",
    "difference": "과부족", "reason": "사유",
}
REQUIRED = ("code", "usable", "scrap", "utilize")
_STATUS_KEY = {STATUS_USABLE: "usable", STATUS_SCRAP: "scrap", STATUS_UTILIZE: "utilize"}


def _clean(value) -> str:
    return re.sub(r"\s+|_x000D_", "", str(value or ""))


def find_columns(sheet, scan_rows: int = 10) -> tuple[dict[str, int], int]:
    """머리글 이름으로 열 번호를 찾는다. (열 매핑, 데이터 시작 행)."""
    columns: dict[str, int] = {}
    last_header_row = 0
    for row in range(1, min(scan_rows, sheet.max_row) + 1):
        for col in range(1, sheet.max_column + 1):
            text = _clean(sheet.cell(row, col).value)
            if not text:
                continue
            for key, label in LABELS.items():
                if key in columns:
                    continue
                # '자산코드'가 '시스템자산코드'에 잡히지 않도록 정확 일치를 먼저 본다.
                exact = text == label
                prefix = key in ("book_qty", "system_code") and text.startswith(label)
                if exact or prefix:
                    columns[key] = col
                    last_header_row = max(last_header_row, row)
                    break
    missing = [LABELS[k] for k in REQUIRED if k not in columns]
    if missing:
        raise ValueError(f"재물조사표 양식에서 머리글을 찾지 못했습니다: {', '.join(missing)}")
    return columns, last_header_row + 1


def _fill_result(sheet, row: int, columns: dict[str, int], result: dict) -> None:
    def put(key, value):
        if key in columns:
            sheet.cell(row, columns[key]).value = value

    put("date", (result.get("survey_date") or "").replace("-", "") or None)
    for key in ("usable", "scrap", "utilize"):
        put(key, 0)
    target = _STATUS_KEY.get(result.get("status"))
    if target:
        put(target, result.get("actual_qty"))
    put("difference", result.get("difference"))
    put("reason", result.get("reason") or None)


def _write_asset(sheet, row: int, columns: dict[str, int], asset: dict, style_row: int | None) -> None:
    if style_row:
        for col in range(1, sheet.max_column + 1):
            source = sheet.cell(style_row, col)
            if source.has_style:
                sheet.cell(row, col)._style = copy(source._style)
    values = {
        "category": asset.get("category") or None, "code": asset["code"], "name": asset["name"],
        "acquired": asset.get("acquired") or None, "asset_status": asset.get("asset_status") or None,
        "book_qty": asset.get("book_qty", 0), "usable": 0, "scrap": 0, "utilize": 0, "difference": 0,
    }
    for key, value in values.items():
        if key in columns:
            sheet.cell(row, columns[key]).value = value


def build(results: dict[str, dict], assets: list[dict], *, only_surveyed: bool = False) -> bytes:
    """results: 자산코드 → 실사 결과, assets: 자산대장 순서의 자산 목록."""
    workbook = openpyxl.load_workbook(SOURCE_TEMPLATE)
    try:
        sheet = workbook.worksheets[0]
        columns, start = find_columns(sheet)
        code_col = columns["code"]

        rows = []  # (행번호, 코드) — 양식에 이미 있는 자산 행
        for row in range(start, sheet.max_row + 1):
            code = sheet.cell(row, code_col).value
            if code:
                rows.append((row, str(code).strip()))

        if rows:
            listed = set()
            for row, code in rows:
                listed.add(code)
                if code in results:
                    _fill_result(sheet, row, columns, results[code])
            if only_surveyed:
                drop = [row for row, code in rows if code not in results]
                for first, count in _runs_desc(drop):
                    sheet.delete_rows(first, count)
            # 양식에 없는 실사 자산은 맨 아래에 덧붙인다(마지막 자산 행 서식 사용).
            extra = [a for a in assets if a["code"] in results and a["code"] not in listed]
            if extra:
                last = max((r for r in range(start, sheet.max_row + 1)
                            if sheet.cell(r, code_col).value), default=start - 1)
                for offset, asset in enumerate(extra, 1):
                    _write_asset(sheet, last + offset, columns, asset, last if last >= start else None)
                    _fill_result(sheet, last + offset, columns, results[asset["code"]])
        else:
            # 빈 양식: 첫 데이터 행에 서식만 있으면 그 서식을 본뜬다.
            style_row = start if start <= sheet.max_row else None
            targets = [a for a in assets if not only_surveyed or a["code"] in results]
            for offset, asset in enumerate(targets):
                row = start + offset
                _write_asset(sheet, row, columns, asset, style_row)
                if asset["code"] in results:
                    _fill_result(sheet, row, columns, results[asset["code"]])

        output = io.BytesIO()
        workbook.save(output)
        return output.getvalue()
    finally:
        workbook.close()


def _runs_desc(sorted_rows: list[int]) -> list[tuple[int, int]]:
    """오름차순 행 번호를 연속 구간 (시작, 개수)로 묶어 시작이 큰 것부터 반환."""
    groups: list[list[int]] = []
    for r in sorted_rows:
        if groups and r == groups[-1][0] + groups[-1][1]:
            groups[-1][1] += 1
        else:
            groups.append([r, 1])
    return [(first, count) for first, count in reversed(groups)]


def filename() -> str:
    return f"재물조사표_{clock.now():%Y%m%d_%H%M%S}.xlsx"
