"""배포 패키지(zip)를 만든다 — 개발자용, 패키지에는 포함하지 않는다.

    python scripts/build_release.py              → release/inventory-count-<버전>.zip
    python scripts/build_release.py --portable   → ...-portable.zip (Python·패키지 포함, 설치 없이 실행)
    python scripts/build_release.py --demo       → ...-demo.zip (포터블 + 체험판 .env + cloudflared.exe)
    python scripts/build_release.py --installer  → ...-setup.exe (포터블을 Inno Setup 설치 마법사로 감싼다)

정해 둔 파일만 담고(화이트리스트), 다음을 검사해 하나라도 걸리면 만들지 않는다.
- 운영 자료·비밀값(.env, data/, backups/, 런타임, exe, zip, db)이 섞였는지
- assets/*.xlsx 가 예시(더미) 표시(문서 속성 keywords=SAMPLE-DUMMY)를 달고 있는지
- branding/ 에 특정 기관 로고가 남았는지
- 파일 내용·엑셀 셀에 원 개발 기관을 가리키는 문자열이 남았는지
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()
SAMPLE_MARK = "SAMPLE-DUMMY"
# 패키지에 들어가면 안 되는 단어(원 개발 기관 흔적 등). 공개 저장소에 적지 않도록
# Git에서 제외한 로컬 파일(한 줄에 하나)에서 읽는다. 파일이 없으면 이 검사는 건너뛴다.
FORBIDDEN_FILE = ROOT / "scripts" / "forbidden_words.local.txt"
FORBIDDEN_TEXT = ([w.strip() for w in FORBIDDEN_FILE.read_text(encoding="utf-8").splitlines() if w.strip()]
                  if FORBIDDEN_FILE.exists() else [])

INCLUDE = [
    "app/*.py", "static/*.html", "static/default-logo.svg", "static/js/*.js",
    "static/styles/*.css", "static/fonts/*.woff2", "static/vendor/tesseract/**/*",
    "scripts/*.bat", "scripts/*.ps1", "scripts/*.vbs", "scripts/backup_data.py",
    "assets/고정자산대장.xlsx", "assets/공간목록.xlsx", "assets/재물조사표.xlsx",
    "branding/README.md", "docs/*.md", "tests/*.py",
    "start.bat", "start-external.bat", "backup.bat", "requirements.txt",
    ".env.example", ".gitignore", "README.md", "THIRD_PARTY_NOTICES.md",
    "LICENSE",
]
FORBIDDEN_PATH = re.compile(r"(^|/)(\.env|data|backups|\.runtime[^/]*|\.venv|__pycache__|release)(/|$)"
                            r"|\.(exe|zip|db|db-wal|db-shm|log)$", re.I)
TEXT_SUFFIXES = {".py", ".js", ".css", ".html", ".md", ".bat", ".ps1", ".vbs", ".txt", ".svg", ".example"}
# 포터블 패키지에만 더하는 실행 환경(검사 대상 밖). 개발 PC에서 미리 준비해 둔다.
PORTABLE = ["python/**/*", ".runtime-py312/**/*"]
DEMO_ENV = """# 재물조사 공개 체험판 설정
ORG_NAME=예시복지관 (체험판)
ACCESS_CODE=123456
ADMIN_CODE=654321
DEMO_MODE=1
V3_PORT=8300
TASK_PREFIX=InventoryDemo
FEEDBACK_URL=
BACKUP_DIR=
GOOGLE_VISION_API_KEY=
PASSKEY_RP_ID=
PASSKEY_ORIGIN=
CLOUDFLARE_TUNNEL_TOKEN=
"""


def version() -> str:
    text = (ROOT / "app" / "config.py").read_text(encoding="utf-8")
    return re.search(r'APP_VERSION = "([^"]+)"', text).group(1)


def collect() -> list[Path]:
    files: set[Path] = set()
    for pattern in INCLUDE:
        matched = [p for p in ROOT.glob(pattern) if p.is_file()]
        if not matched and "*" not in pattern:
            raise SystemExit(f"[중단] 필수 파일이 없습니다: {pattern}")
        files.update(matched)
    files.discard(SELF)
    return sorted(files)


def problems(files: list[Path], allow_real_assets: bool) -> list[str]:
    found = []
    words = FORBIDDEN_TEXT
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        if FORBIDDEN_PATH.search(rel):
            found.append(f"포함하면 안 되는 파일: {rel}")
        if path.suffix in TEXT_SUFFIXES or path.name == ".env.example":
            if "vendor/" in rel:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore").lower()
            found += [f"{rel}: 금지 문자열 '{w}'" for w in words if w.lower() in text]
        if path.suffix == ".xlsx":
            workbook = openpyxl.load_workbook(path, read_only=True)
            try:
                if not allow_real_assets and workbook.properties.keywords != SAMPLE_MARK:
                    found.append(f"{rel}: 예시(더미) 표시가 없습니다 — 실제 기관 자료일 수 있습니다.")
                cells = " ".join(str(v) for ws in workbook.worksheets
                                 for row in ws.iter_rows(values_only=True) for v in row if v is not None)
                found += [f"{rel}: 셀에 금지 문자열 '{w}'" for w in words if w in cells]
            finally:
                workbook.close()
    extra_logo = [p.name for p in (ROOT / "branding").glob("*") if p.name != "README.md"]
    if extra_logo:
        found.append(f"branding/ 에 기관 로고가 남아 있습니다: {', '.join(extra_logo)}")
    if "{{저작권자}}" in (ROOT / "LICENSE").read_text(encoding="utf-8-sig"):
        found.append("LICENSE: 저작권자 이름({{저작권자}})을 채워야 합니다.")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--allow-real-assets", action="store_true",
                        help="특정 기관용 패키지처럼 실제 자산 엑셀을 넣을 때만 사용")
    parser.add_argument("--portable", action="store_true", help="Python과 패키지를 함께 넣는다")
    parser.add_argument("--demo", action="store_true", help="체험판 패키지(포터블 + 체험 설정 + cloudflared)")
    parser.add_argument("--installer", action="store_true", help="Windows 설치 프로그램(setup.exe, Inno Setup 필요)")
    args = parser.parse_args()
    portable = args.portable or args.demo or args.installer

    files = collect()
    issues = problems(files, args.allow_real_assets)
    if issues:
        print("[중단] 배포 패키지를 만들지 않았습니다.")
        for issue in issues:
            print(" -", issue)
        return 1

    extras: list[Path] = []
    if portable:
        for pattern in PORTABLE:
            matched = [p for p in ROOT.glob(pattern) if p.is_file() and "__pycache__" not in p.parts]
            if not matched:
                print(f"[중단] 포터블 실행 환경이 없습니다: {pattern.split('/')[0]} 폴더를 먼저 준비하세요.")
                return 1
            extras += matched
    if args.demo:
        cloudflared = ROOT / "cloudflared.exe"
        if not cloudflared.exists():
            print("[중단] cloudflared.exe 가 없습니다. 배포 폴더에 넣은 뒤 다시 실행하세요.")
            return 1
        extras.append(cloudflared)

    if args.installer:
        return build_installer(files + extras)

    suffix = "-demo" if args.demo else "-portable" if portable else ""
    name = f"inventory-count-{version()}{suffix}"
    out_dir = ROOT / "release"
    out_dir.mkdir(exist_ok=True)
    target = out_dir / f"{name}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, f"{name}/{path.relative_to(ROOT).as_posix()}")
        for path in extras:
            archive.write(path, f"{name}/{path.relative_to(ROOT).as_posix()}")
        if args.demo:
            archive.writestr(f"{name}/.env", DEMO_ENV.replace("\n", "\r\n"))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out_dir / f"{name}.zip.sha256").write_text(f"{digest}  {target.name}\n", encoding="ascii")
    print(f"완료: {target} ({len(files) + len(extras)}개 파일, {target.stat().st_size / 1_048_576:.1f}MB)")
    print(f"SHA256: {digest}")
    return 0


def find_iscc() -> Path | None:
    candidates = [os.environ.get("INNO_ISCC", ""), str(ROOT.parent / ".tools" / "innosetup" / "ISCC.exe"),
                  r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe",
                  str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe")]
    return next((Path(c) for c in candidates if c and Path(c).is_file()), None)


def build_installer(files: list[Path]) -> int:
    """검사를 통과한 파일을 release/stage 에 모아 installer/inventory-count.iss 로 컴파일한다."""
    iscc = find_iscc()
    if not iscc:
        print("[중단] Inno Setup 6(ISCC.exe)을 찾지 못했습니다. 설치하거나 INNO_ISCC 환경변수로 경로를 알려 주세요.")
        return 1
    out_dir = ROOT / "release"
    stage = out_dir / "stage"
    shutil.rmtree(stage, ignore_errors=True)
    for path in files:
        target = stage / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    done = subprocess.run([str(iscc), "/Qp", f"/DAppVersion={version()}", f"/DSourceDir={stage}",
                           f"/DOutputDir={out_dir}", str(ROOT / "installer" / "inventory-count.iss")])
    shutil.rmtree(stage, ignore_errors=True)
    if done.returncode:
        print("[중단] 설치 프로그램 컴파일에 실패했습니다.")
        return 1
    target = out_dir / f"inventory-count-{version()}-setup.exe"
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out_dir / f"{target.name}.sha256").write_text(f"{digest}  {target.name}\n", encoding="ascii")
    print(f"완료: {target} ({len(files)}개 파일, {target.stat().st_size / 1_048_576:.1f}MB)")
    print(f"SHA256: {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
