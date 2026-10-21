"""재물조사 전체에서 사용하는 한국 표준시(KST) 기준 시계."""
from __future__ import annotations

import datetime as dt


KST = dt.timezone(dt.timedelta(hours=9), name="KST")


def now() -> dt.datetime:
    return dt.datetime.now(KST)


def today_iso() -> str:
    return now().date().isoformat()


def timestamp() -> str:
    """동시 수정 감지에 충분하도록 마이크로초까지 보존한다."""
    return now().strftime("%Y-%m-%d %H:%M:%S.%f")
