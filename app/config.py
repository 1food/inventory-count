"""재물조사 웹앱의 환경설정과 파일 경로를 한곳에서 관리한다.

- 모든 자산·설정은 이 실행 폴더 안에서만 읽는다(상위 폴더 폴백 없음).
- 실사 결과·사진·DB는 항상 이 실행 폴더의 ``data/``에 저장한다.
- 명시적으로 주입한 환경변수가 .env보다 우선한다.
- 기관마다 달라지는 값(기관명·로고·공간 목록·자산대장)은 .env·branding/·assets/ 로 바꾼다.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except Exception:  # python-dotenv가 없어도 앱은 동작한다.
    def load_dotenv(*_args, **_kwargs):
        return False

APP_NAME = "재물조사"
APP_VERSION = "1.0.0"
SCHEMA_VERSION = 2

ROOT = Path(__file__).resolve().parents[1]

# 명시적으로 주입한 환경변수 > 이 폴더 .env 순으로 우선한다.
load_dotenv(ROOT / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _token(namespace: str, secret: str) -> str:
    """접근/관리 코드에서 파생한 쿠키 토큰. 코드가 없으면 빈 문자열(기능 비활성)."""
    if not secret:
        return ""
    return hashlib.sha256(f"inventory-count::{namespace}::{secret}".encode()).hexdigest()


ORG_NAME = _env("ORG_NAME") or "우리 기관"
PORT = _env("V3_PORT") or "8200"

# 체험판(DEMO_MODE=1): 공개 체험용. 안내 띠·로그인 화면 코드 표시, 사진 저장 차단,
# 매일 DEMO_RESET_HOUR시(KST) 이후 첫 확인 때 실사 결과를 지운다. 서버 OCR·패스키는 끈다.
DEMO_MODE = _env("DEMO_MODE").lower() in ("1", "true", "yes", "on")
DEMO_RESET_HOUR = 4
FEEDBACK_URL = _env("FEEDBACK_URL") if _env("FEEDBACK_URL").startswith(("https://", "http://")) else ""

ACCESS_CODE = _env("ACCESS_CODE")
ADMIN_CODE = _env("ADMIN_CODE")
GOOGLE_VISION_API_KEY = "" if DEMO_MODE else _env("GOOGLE_VISION_API_KEY")

# 패스키(WebAuthn)는 고정 HTTPS 주소에 묶인다. 비워 두면 패스키 기능을 끈다.
PASSKEY_RP_ID = "" if DEMO_MODE else _env("PASSKEY_RP_ID")
PASSKEY_ORIGIN = "" if DEMO_MODE else _env("PASSKEY_ORIGIN").rstrip("/")

ACCESS_TOKEN = _token("access", ACCESS_CODE)
ADMIN_TOKEN = _token("admin", ADMIN_CODE)

MIN_CODE_LENGTH = 6


def code_problems(access: str, admin: str) -> list[str]:
    """서버를 열기 전에 막아야 할 접근/관리자 코드 설정 문제."""
    problems = []
    for key, label, value in (("ACCESS_CODE", "접근코드", access), ("ADMIN_CODE", "관리자 코드", admin)):
        if not value:
            problems.append(f".env의 {key}({label})가 비어 있습니다.")
        elif not value.isdigit() or len(value) < MIN_CODE_LENGTH:
            problems.append(f"{key}({label})는 숫자 {MIN_CODE_LENGTH}자리 이상이어야 합니다.")
    if access and access == admin:
        problems.append("ACCESS_CODE와 ADMIN_CODE는 서로 달라야 합니다.")
    return problems


# ── 기관별 자료(읽기 전용) ──
ASSETS_DIR = ROOT / "assets"
STATIC_DIR = ROOT / "static"
BRANDING_DIR = ROOT / "branding"

SOURCE_MASTER = ASSETS_DIR / "고정자산대장.xlsx"     # 자산 목록(고정자산대장 양식)
SOURCE_SPACES = ASSETS_DIR / "공간목록.xlsx"          # 공간 목록 — 없으면 자산위치로 자동 구성
SOURCE_TEMPLATE = ASSETS_DIR / "재물조사표.xlsx"      # 출력 양식
SOURCE_TESSERACT = STATIC_DIR / "vendor" / "tesseract"
BACKUP_DIR = Path(_env("BACKUP_DIR")) if _env("BACKUP_DIR") else ROOT / "backups"

# 왼쪽 상단 로고: branding/logo.(svg|png|webp|jpg) 가 있으면 그 파일, 없으면 기본 심볼.
LOGO_DEFAULT = STATIC_DIR / "default-logo.svg"
LOGO_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
              ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def logo_file() -> Path:
    for suffix in LOGO_TYPES:
        candidate = BRANDING_DIR / f"logo{suffix}"
        if candidate.is_file():
            return candidate
    return LOGO_DEFAULT


# ── 이 실행 폴더 전용 저장소 ──
DATA_DIR = ROOT / "data"
IMAGE_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "survey.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)

# 실사 상태(출력 엑셀 실사상태 열과 대응). 화면 라벨은 프런트에서 붙인다.
STATUS_UTILIZE = "활용"       # 현재 실제 사용 중
STATUS_USABLE = "사용가능"    # 불용대상 · 사용 가능
STATUS_SCRAP = "폐품"         # 불용대상 · 폐품
STATUSES = (STATUS_UTILIZE, STATUS_USABLE, STATUS_SCRAP)

# 업로드 이미지 상한.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
IMAGE_SUFFIX = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
