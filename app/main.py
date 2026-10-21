"""재물조사 웹앱(기관 공용 배포판).

실행:  python -m uvicorn app.main:app --host 0.0.0.0 --port 8200
(보통은 start.bat)

설계 원칙:
- ACCESS_CODE·ADMIN_CODE가 규칙(숫자 6자리 이상, 서로 다름)에 맞아야 서버가 시작된다.
- 로그인 실패가 반복되면 접속 주소별로 잠시 잠근다.
- 실사 저장/취소에는 조사자·기기(device)를 함께 기록해 이력을 남긴다.
- 기관명·로고·공간·자산대장은 설정(.env·branding/·assets/)에서 읽는다.
"""
from __future__ import annotations

import html
import io
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from webauthn.helpers.exceptions import WebAuthnException

from . import clock, database, excel, locations, passkeys, setup, vision
from .catalog import catalog
from .config import (ACCESS_CODE, ACCESS_TOKEN, ADMIN_CODE, ADMIN_TOKEN, APP_VERSION, BACKUP_DIR,
                     DATA_DIR, DEMO_MODE, DEMO_RESET_HOUR, FEEDBACK_URL, IMAGE_DIR, IMAGE_SUFFIX,
                     LOGO_DEFAULT, LOGO_TYPES, MAX_IMAGE_BYTES, MIN_CODE_LENGTH, ORG_NAME, PORT,
                     SOURCE_MASTER, SOURCE_TEMPLATE, SOURCE_TESSERACT, STATIC_DIR, STATUSES,
                     code_problems, logo_file)

app = FastAPI(title="재물조사")

ACCESS_COOKIE = "inventory_access"
ADMIN_COOKIE = "inventory_admin"
DISPOSAL_STATUSES = ("사용가능", "폐품")
ORG_HTML = html.escape(ORG_NAME)

# ── 체험판 안내 ──
_FEEDBACK_LINK = (f' <a href="{html.escape(FEEDBACK_URL)}" target="_blank" rel="noopener">의견 남기기</a>'
                  if FEEDBACK_URL else "")
DEMO_NOTICE = (f"가상 자료로 만든 체험판입니다. 입력한 내용은 매일 새벽 {DEMO_RESET_HOUR}시에 지워집니다."
               if DEMO_MODE else "")
DEMO_BANNER = (f'<div class="demo-banner" role="note">{DEMO_NOTICE}{_FEEDBACK_LINK}</div>'
               if DEMO_MODE else "")
DEMO_LOGIN = (f'<div class="demo">체험용 접근코드 <b>{html.escape(ACCESS_CODE)}</b><br>'
              f'관리자 코드 <b>{html.escape(ADMIN_CODE)}</b><small>{DEMO_NOTICE}</small></div>'
              if DEMO_MODE else "")

_LOGIN_ALLOWED = {"/api/session", "/styles/tokens.css", "/styles/login.css",
                  "/brand/logo", "/fonts/PretendardVariable.woff2", "/api/health", "/api/setup/qr"}

# 설정 모드: 접근/관리자 코드가 규칙에 맞지 않거나 자산대장을 읽지 못하면 켜진다.
# 이때는 서버 PC(localhost)에서 /setup 화면만 열린다.
STATE = {"setup": False, "problems": []}
_SETUP_OPEN = ("/setup", "/api/setup/", "/js/", "/styles/", "/fonts/", "/brand/logo", "/api/health")
SETUP_WAIT_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>재물조사 · 설정 중</title>
<script>try{const s=localStorage.getItem('inventory-theme');document.documentElement.dataset.theme=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(_){}</script>
<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/login.css"></head>
<body><div class="card"><img class="logo" src="/brand/logo" alt=""><h1>설정 중입니다</h1>
<p>아직 처음 설정이 끝나지 않았습니다.<br>서버 PC에서 <b>http://localhost:__PORT__/setup</b> 을 열어 설정을 마쳐 주세요.</p>
</div></body></html>""".replace("__PORT__", PORT)

LOGIN_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#003b90"><title>재물조사 · __ORG__</title>
<script>(()=>{let t;try{const s=localStorage.getItem('inventory-theme');t=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(_){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;if(t==='dark')document.querySelector('meta[name="theme-color"]').content='#141416';})();</script>
<link rel="icon" href="/brand/logo">
<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/login.css"></head>
<body><form class="card" id="form">
<img class="logo" src="/brand/logo" alt="">
<h1>재물조사</h1><p>__ORG__<br>접근코드를 입력해 주세요.</p>__DEMO__
<label for="surveyor" class="sr-only">조사자 이름</label>
<input id="surveyor" maxlength="20" autocomplete="name" placeholder="조사자 이름 (선택)">
<label for="code" class="sr-only">접근코드</label>
<input id="code" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" placeholder="접근코드" aria-describedby="error">
<button>들어가기</button><div class="error" id="error" role="alert"></div></form>
<script>
// 숫자 키패드를 즉시 띄우고, 키패드가 올라오면 입력칸이 가리지 않도록 화면 중앙으로 스크롤한다.
const reveal=()=>{try{code.scrollIntoView({block:'center',behavior:'smooth'});}catch(_){window.scrollTo(0,document.body.scrollHeight);}};
try{surveyor.value=localStorage.getItem('inventory-surveyor')||'';}catch(_){}
addEventListener('load',()=>{(surveyor.value?code:surveyor).focus();setTimeout(reveal,250);});
code.addEventListener('focus',()=>setTimeout(reveal,250));
if(window.visualViewport)visualViewport.addEventListener('resize',reveal);
form.onsubmit=async e=>{e.preventDefault();const f=new FormData();f.append('code',code.value.trim());
try{localStorage.setItem('inventory-surveyor',surveyor.value.trim());}catch(_){}
const r=await fetch('/api/session',{method:'POST',body:f});
if(r.ok)location.replace('/');else{let m='접근코드가 올바르지 않습니다. 다시 입력해 주세요.';if(r.status===429){try{m=(await r.json()).detail;}catch(_){}}error.textContent=m;code.value='';code.focus();}};
</script></body></html>""".replace("__ORG__", ORG_HTML).replace("__DEMO__", DEMO_LOGIN)

# ── 로그인 실패 제한(접속 주소별, 메모리 보관) ──
FAIL_LIMIT = 10            # 이 횟수만큼 틀리면
FAIL_WINDOW = 10 * 60      # 이 시간(초) 동안 잠근다
_FAILS: dict[str, list[float]] = {}


def _client_key(request: Request, kind: str) -> str:
    host = request.client.host if request.client else ""
    # Cloudflare 터널 등 같은 PC의 프록시를 거치면 원래 접속 주소를 헤더에서 읽는다.
    if host in ("127.0.0.1", "::1", "localhost"):
        forwarded = (request.headers.get("cf-connecting-ip")
                     or request.headers.get("x-forwarded-for", "").split(",")[0]).strip()
        host = forwarded or host
    return f"{kind}:{host}"


def _ensure_not_locked(key: str) -> None:
    now = time.monotonic()
    recent = [t for t in _FAILS.get(key, []) if now - t < FAIL_WINDOW]
    if recent:
        _FAILS[key] = recent
    else:
        _FAILS.pop(key, None)
    if len(recent) >= FAIL_LIMIT:
        raise HTTPException(429, "코드를 여러 번 잘못 입력해 10분 동안 잠겼습니다. 잠시 후 다시 시도해 주세요.")


def _record_failure(key: str) -> None:
    _FAILS.setdefault(key, []).append(time.monotonic())


# 체험판을 초기화하면 이 상태로 돌아간다(활용/사용가능/폐품/망실·수량차이·위치변경·사유 예시를 한 번에 보여 준다).
_DEMO_SEED_SPEC = [
    ("08-01-001", 1, "활용", "", "", "list"),
    ("01-01-001-0001", 1, "활용", "", "", "list"),
    ("01-01-001-0002", 1, "활용", "", "", "list"),
    ("01-01-001-0003", 1, "활용", "", "", "list"),
    ("02-02-001-0001", 1, "사용가능", "노후화로 사용부서 없음", "", "manual"),
    ("03-04-001", 1, "폐품", "배관 파손으로 교체 예정", "", "manual"),
    ("07-02-001", 1, "활용", "", "3층창고", "missing"),
    ("02-01-002-0001", 0, "", "분실 확인, 경찰 신고 예정", "", "manual"),
]


def _demo_seed() -> list[dict]:
    return [{"code": code, "actual_qty": qty, "status": status, "reason": reason,
             "confirmed_space": space, "method": method, "device": "",
             "book_qty": catalog.get(code)["book_qty"]}
            for code, qty, status, reason, space, method in _DEMO_SEED_SPEC if catalog.get(code)]


@app.middleware("http")
async def access_gate(request: Request, call_next):
    path = request.url.path
    if STATE["setup"]:
        if path in ("/", "/index.html") and _is_local(request):
            return RedirectResponse("/setup")
        if path.startswith(_SETUP_OPEN):
            return await call_next(request)
        if path.startswith("/api/"):
            return JSONResponse({"detail": "처음 설정이 끝나지 않았습니다."}, status_code=503)
        return HTMLResponse(SETUP_WAIT_HTML, status_code=503)
    if path in _LOGIN_ALLOWED:
        return await call_next(request)
    if ACCESS_CODE and request.cookies.get(ACCESS_COOKIE) == ACCESS_TOKEN:
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"detail": "접근 인증이 필요합니다."}, status_code=401)
    return HTMLResponse(LOGIN_HTML)


@app.on_event("startup")
def _startup() -> None:
    problems = code_problems(ACCESS_CODE, ADMIN_CODE)
    try:
        catalog.load()
    except (OSError, ValueError) as error:
        problems.append(f"자산대장을 읽지 못했습니다: {error}")
    database.init()
    if problems:
        if DEMO_MODE:
            raise RuntimeError("체험판 설정(.env)을 확인하세요.\n- " + "\n- ".join(problems))
        STATE.update(setup=True, problems=problems)
        print("[설정 필요] " + " / ".join(problems))
        print(f"[설정 필요] 서버 PC에서 http://localhost:{PORT}/setup 을 열어 설정을 마쳐 주세요.")
        return
    print(f"[재물조사 v{APP_VERSION}] {ORG_NAME} · 자산 {len(catalog.assets)}건 · "
          f"공간 {len(locations.OFFICIAL_NAMES)}곳({locations.SOURCE}) · 포트 {PORT}")
    if catalog.duplicates:
        print(f"[주의] 자산코드가 중복된 행 {len(catalog.duplicates)}건은 첫 행만 사용합니다: "
              + ", ".join(catalog.duplicates[:10]))
    if DEMO_MODE:
        database.reset_results(IMAGE_DIR, _demo_seed())
        threading.Thread(target=_demo_reset_loop, daemon=True, name="demo-reset").start()
        print(f"[체험판] 시작하며 실사 결과를 지웠습니다. 매일 {DEMO_RESET_HOUR}시 이후 다시 지웁니다.")


def demo_reset_due(now=None, last: str | None = None) -> bool:
    """오늘 초기화 시각이 지났고 아직 오늘 초기화하지 않았으면 True."""
    now = now or clock.now()
    last = database.demo_reset_date() if last is None else last
    return now.hour >= DEMO_RESET_HOUR and last != now.strftime("%Y-%m-%d")


def _demo_reset_loop() -> None:
    while True:
        time.sleep(600)
        try:
            if demo_reset_due():
                database.reset_results(IMAGE_DIR, _demo_seed())
                print(f"[체험판] {clock.timestamp()} 정기 초기화 완료")
        except Exception as error:  # 초기화 실패가 서버를 멈추지 않게 한다.
            print(f"[체험판] 초기화 실패: {error}")


# ── 인증 ──
@app.post("/api/session")
def create_session(request: Request, code: str = Form(...)):
    key = _client_key(request, "access")
    _ensure_not_locked(key)
    if not ACCESS_CODE or not secrets.compare_digest(code.strip(), ACCESS_CODE):
        _record_failure(key)
        raise HTTPException(401, "접근코드가 올바르지 않습니다.")
    _FAILS.pop(key, None)
    response = JSONResponse({"ok": True})
    response.set_cookie(ACCESS_COOKIE, ACCESS_TOKEN, max_age=60 * 60 * 24 * 30,
                        httponly=True, samesite="lax")
    return response


def require_admin(request: Request) -> None:
    """관리자 인증. ADMIN_CODE가 설정되지 않았으면 관리 기능을 아예 잠근다."""
    if not ADMIN_CODE:
        raise HTTPException(503, "관리자 코드가 설정되지 않았습니다. .env에 ADMIN_CODE를 넣어 주세요.")
    if request.cookies.get(ADMIN_COOKIE) != ADMIN_TOKEN:
        raise HTTPException(403, "관리자 인증이 필요합니다.")


def _set_admin_cookie(response: Response, request: Request) -> None:
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    is_https = forwarded == "https" or request.url.scheme == "https"
    response.set_cookie(ADMIN_COOKIE, ADMIN_TOKEN, max_age=60 * 60 * 2,
                        httponly=True, samesite="lax", secure=is_https)


@app.post("/api/admin/session")
def create_admin_session(request: Request, code: str = Form(...)):
    if not ADMIN_CODE:
        raise HTTPException(503, "관리자 코드가 설정되지 않았습니다.")
    key = _client_key(request, "admin")
    _ensure_not_locked(key)
    if not secrets.compare_digest(code.strip(), ADMIN_CODE):
        _record_failure(key)
        raise HTTPException(403, "관리자 코드가 올바르지 않습니다.")
    _FAILS.pop(key, None)
    response = JSONResponse({"ok": True})
    _set_admin_cookie(response, request)
    return response


@app.post("/api/admin/logout")
def admin_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE)
    return response


# ── 패스키 ──
def _require_passkey_setup() -> None:
    if not passkeys.enabled():
        raise HTTPException(404, "패스키 주소가 설정되지 않아 패스키를 사용할 수 없습니다.")


@app.get("/api/admin/passkeys")
def list_passkeys(request: Request):
    require_admin(request)
    return {"enabled": passkeys.enabled(),
            "items": [passkeys.public(p) for p in database.passkey_list()]}


@app.post("/api/admin/passkeys/register/options")
def passkey_register_options(request: Request):
    require_admin(request)
    _require_passkey_setup()
    return passkeys.registration_options()


@app.post("/api/admin/passkeys/register/verify")
async def passkey_register_verify(request: Request):
    require_admin(request)
    _require_passkey_setup()
    try:
        return {"ok": True, "item": passkeys.verify_registration(await request.json())}
    except (ValueError, WebAuthnException) as error:
        raise HTTPException(400, str(error) or "패스키를 확인할 수 없습니다.")


@app.post("/api/admin/passkeys/authenticate/options")
def passkey_authenticate_options():
    _require_passkey_setup()
    try:
        return passkeys.authentication_options()
    except LookupError as error:
        raise HTTPException(404, str(error))


@app.post("/api/admin/passkeys/authenticate/verify")
async def passkey_authenticate_verify(request: Request):
    _require_passkey_setup()
    try:
        passkeys.verify_authentication(await request.json())
    except PermissionError as error:
        raise HTTPException(403, str(error))
    except (ValueError, WebAuthnException) as error:
        raise HTTPException(400, str(error) or "패스키를 확인할 수 없습니다.")
    response = JSONResponse({"ok": True})
    _set_admin_cookie(response, request)
    return response


@app.delete("/api/admin/passkeys/{passkey_id}")
def delete_passkey(passkey_id: int, request: Request):
    require_admin(request)
    if not database.passkey_delete(passkey_id):
        raise HTTPException(404, "패스키를 찾을 수 없습니다.")
    return {"ok": True}


# ── 자산/공간 조회 ──
def effective_space(asset: dict, result: dict | None) -> str:
    return (result or {}).get("confirmed_space") or asset["space"]


def public_asset(asset: dict, results: dict | None = None) -> dict:
    item = dict(asset)
    if results is not None:
        result = results.get(asset["code"])
        item["result"] = result
        item["done"] = asset["code"] in results
        item["effective_space"] = effective_space(asset, result)
    return item


def home_payload() -> dict:
    results = database.all_results()
    counts: dict[str, dict] = {}
    for asset in catalog.assets.values():
        space = effective_space(asset, results.get(asset["code"]))
        bucket = counts.setdefault(space, {"total": 0, "done": 0})
        bucket["total"] += 1
        bucket["done"] += asset["code"] in results

    official = set(locations.OFFICIAL_NAMES)
    by_floor = dict(locations.FLOORS)
    floors = []
    for floor in locations.FLOOR_ORDER:
        spaces = []
        names = list(by_floor.get(floor, []))
        if floor == locations.ETC_FLOOR:
            # 목록 밖 위치는 '기타'에 모은다(공간목록에 '기타' 구역이 있으면 함께 표시).
            names += [name for name in counts if name not in official]
        names.sort()
        for name in names:
            count = counts.get(name, {"total": 0, "done": 0})
            # 정식 공간은 0건이어도 표시. 목록 밖 위치는 자산이 있을 때만.
            if name not in official and not count["total"]:
                continue
            spaces.append({"name": name, **count})
        if spaces:
            floors.append({"floor": floor, "spaces": spaces})
    return {"summary": {"total": len(catalog.assets), "done": len(results)},
            "survey_year": clock.now().year, "floors": floors}


@app.get("/api/health")
def health():
    return {"ok": True, "version": APP_VERSION, "assets": len(catalog.assets),
            "loaded_at": catalog.loaded_at, "vision": vision.available(),
            "passkey": passkeys.enabled(), "demo": DEMO_MODE, "setup": STATE["setup"]}


@app.get("/api/home")
def home():
    return home_payload()


@app.get("/api/spaces/{space}/assets")
def space_assets(space: str):
    results = database.all_results()
    items = [public_asset(a, results) for a in catalog.assets.values()
             if effective_space(a, results.get(a["code"])) == space]
    items.sort(key=lambda x: (x["done"], x["name"], x["code"]))
    return {"space": space, "total": len(items),
            "done": sum(1 for i in items if i["done"]), "items": items}


@app.get("/api/search")
def search(q: str = "", offset: int = 0, limit: int = 40):
    query = _clean(q)
    if not query:
        return {"total": 0, "items": [], "has_more": False}
    results = database.all_results()
    matched = [public_asset(a, results) for a in catalog.assets.values() if _matches(a, query)]
    # 검색 결과도 공간 목록과 동일하게 미실사 자산을 먼저 보여준다.
    # 페이지를 자르기 전에 정렬해야 "더보기"에서도 완료 항목이 중간에 섞이지 않는다.
    matched.sort(key=lambda x: (x["done"], x["name"], x["code"]))
    offset, limit = max(0, offset), min(100, max(1, limit))
    page = matched[offset:offset + limit]
    return {"total": len(matched), "items": page, "has_more": offset + len(page) < len(matched)}


class LookupBody(BaseModel):
    code: str


@app.post("/api/lookup")
def lookup(body: LookupBody):
    asset, candidates = catalog.lookup(body.code)
    results = database.all_results()
    return {"asset": public_asset(asset, results) if asset else None,
            "candidates": [public_asset(a, results) for a in candidates]}


@app.get("/api/assets/{code}")
def asset_detail(code: str):
    asset = catalog.get(code)
    if not asset:
        raise HTTPException(404, "자산을 찾을 수 없습니다.")
    results = database.all_results()
    return {
        "asset": public_asset(asset, results),
        "group": [public_asset(a, results) for a in catalog.serial_group(code)],
        "official_groups": locations.official_groups(),
        "photos": database.photos_for(code),
    }


@app.post("/api/recognize")
async def recognize(image: UploadFile = File(...), space: str = Form("")):
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지는 8MB 이하여야 합니다.")
    if not vision.available():
        return {"ok": False, "reason": "unavailable"}
    try:
        recognized = vision.recognize(content)
    except Exception:
        return {"ok": False, "reason": "failed"}
    results = database.all_results()
    matched, candidates, read_code = None, [], ""
    for code in recognized["codes"]:
        asset, near = catalog.lookup(code)
        if asset:
            matched, read_code, candidates = asset, code, []
            break
        candidates.extend(near)
    unique = {a["code"]: a for a in candidates}
    packed = public_asset(matched, results) if matched else None
    return {"ok": True, "codes": recognized["codes"], "read_code": read_code,
            "matched": packed,
            "in_space": bool(packed and space and packed["space"] == space),
            "candidates": [public_asset(a, results) for a in list(unique.values())[:8]]}


# ── 실사 저장/취소 ──
class SurveyBody(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=1000)
    primary_code: str = ""
    actual_qty: int = Field(ge=0, le=100000)
    status: str = ""
    reason: str = Field(default="", max_length=500)
    confirmed_space: str = Field(default="", max_length=100)
    method: str = Field(default="label", pattern="^(label|manual|missing|list|admin)$")
    device: str = Field(default="", max_length=60)
    expected_updated_at: dict[str, str | None] = Field(default_factory=dict)


@app.put("/api/results")
def save_results(body: SurveyBody):
    # 실사 수량이 0이면 상태 없이 저장한다(실물 0개 = 상태 무관). 그 외에는 상태 필수.
    status = body.status if body.actual_qty > 0 else ""
    if body.actual_qty > 0 and status not in STATUSES:
        raise HTTPException(400, "올바르지 않은 실사 상태입니다.")
    codes = list(dict.fromkeys(body.codes))
    primary = body.primary_code or codes[0]
    if primary not in codes:
        raise HTTPException(400, "현재 자산이 선택 목록에 없습니다.")
    primary_asset = catalog.get(primary)
    if not primary_asset:
        raise HTTPException(404, f"자산을 찾을 수 없습니다: {primary}")

    allowed = {a["code"] for a in catalog.serial_group(primary)} or {primary}
    if any(code not in allowed for code in codes):
        raise HTTPException(400, "같은 품목이 아닌 자산은 함께 저장할 수 없습니다.")

    confirmed = body.confirmed_space.strip()
    # 수량 0(망실)은 위치 없이 저장한다. 그 외 기타 위치 자산은 확인 위치가 필수.
    if body.actual_qty > 0 and any(
            not locations.is_official(catalog.get(c)["space"]) for c in codes) and not confirmed:
        raise HTTPException(400, "기타 위치의 자산은 실제 확인 위치를 선택해 주세요.")

    # 같은 품목 일괄 완료 항목은 각 1개씩 저장하고, 현재 항목은 나머지 수량을 배정한다.
    extras = [c for c in codes if c != primary]
    extra_book = sum(catalog.get(c)["book_qty"] for c in extras)
    primary_qty = max(0, body.actual_qty - extra_book)
    device = body.device.strip()

    entries = []
    for code in codes:
        asset = catalog.get(code)
        actual = primary_qty if code == primary else asset["book_qty"]
        location = confirmed or (primary_asset["space"] if code != primary else "")
        entries.append({
            "code": code, "actual_qty": actual, "status": status,
            "book_qty": asset["book_qty"], "reason": body.reason.strip(),
            "confirmed_space": location, "method": body.method, "device": device,
        })
    expected = {code: body.expected_updated_at[code]
                for code in codes if code in body.expected_updated_at}
    undo_token = secrets.token_urlsafe(24)
    try:
        saved = database.save_results_atomic(
            entries, expected=expected, undo_id=undo_token,
        )
    except database.ConflictError as error:
        raise HTTPException(409, str(error))
    return {"ok": True, "count": len(codes), "codes": codes,
            "results": saved, "undo_token": undo_token}


class UndoBody(BaseModel):
    token: str = Field(min_length=16, max_length=200)
    device: str = Field(default="", max_length=60)


@app.post("/api/results/undo")
def undo_results(body: UndoBody):
    """저장 직후 발급한 일회용 토큰으로 이전 결과를 복원한다."""
    try:
        targets = database.undo_operation(body.token, device=body.device.strip())
    except database.UndoUnavailableError as error:
        raise HTTPException(410, str(error))
    except database.ConflictError as error:
        raise HTTPException(409, str(error))
    return {"ok": True, "count": len(targets), "codes": targets}


@app.get("/api/admin/results/{code}/history")
def admin_result_history(code: str, request: Request):
    require_admin(request)
    if not catalog.get(code):
        raise HTTPException(404, "자산을 찾을 수 없습니다.")
    return {"items": database.history_for(code)}


class AdminBulkBody(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=500)
    action: str = Field(pattern="^(status|location|delete)$")
    status: str = ""
    confirmed_space: str = Field(default="", max_length=100)
    device: str = Field(default="", max_length=60)
    expected_updated_at: dict[str, str | None] = Field(default_factory=dict)


@app.post("/api/admin/results/bulk")
def admin_bulk_results(body: AdminBulkBody, request: Request):
    require_admin(request)
    codes = list(dict.fromkeys(body.codes))
    if any(not catalog.get(code) for code in codes):
        raise HTTPException(404, "자산 목록에 없는 코드가 있습니다.")
    status = None
    confirmed_space = None
    if body.action == "status":
        if body.status not in STATUSES:
            raise HTTPException(400, "올바르지 않은 실사 상태입니다.")
        status = body.status
    elif body.action == "location":
        confirmed_space = body.confirmed_space.strip()
        if not locations.is_official(confirmed_space):
            raise HTTPException(400, "공식 확인 위치를 선택해 주세요.")
    expected = {code: body.expected_updated_at[code]
                for code in codes if code in body.expected_updated_at}
    undo_token = secrets.token_urlsafe(24)
    try:
        changed = database.admin_bulk_atomic(
            codes, expected=expected, undo_id=undo_token,
            device=body.device.strip(), status=status,
            confirmed_space=confirmed_space, delete=body.action == "delete",
        )
    except database.ConflictError as error:
        raise HTTPException(409, str(error))
    return {"ok": True, "count": len(codes), "codes": codes,
            "results": changed, "undo_token": undo_token}


@app.delete("/api/admin/results/{code}")
def admin_delete_result(code: str, request: Request, group: bool = False, device: str = ""):
    """관리자 전용 실사 삭제. 일반 화면에서는 취소할 수 없고 여기서만 삭제한다."""
    require_admin(request)
    targets = [code]
    if group:
        results = database.all_results()
        targets = [a["code"] for a in catalog.serial_group(code) if a["code"] in results]
        if code not in targets:
            targets.append(code)
    database.delete_results(targets, device=device.strip())
    return {"ok": True, "count": len(targets), "codes": targets}


@app.post("/api/photos/{code}")
async def upload_photo(code: str, image: UploadFile = File(...)):
    if DEMO_MODE:
        raise HTTPException(403, "체험판에서는 사진을 저장하지 않습니다.")
    if not catalog.get(code):
        raise HTTPException(404, "자산을 찾을 수 없습니다.")
    suffix = IMAGE_SUFFIX.get(image.content_type or "")
    if not suffix:
        raise HTTPException(400, "지원하지 않는 이미지 형식입니다.")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지는 8MB 이하여야 합니다.")
    name = f"{clock.now():%Y%m%d%H%M%S}_{secrets.token_hex(6)}{suffix}"
    (IMAGE_DIR / name).write_bytes(content)
    database.add_photo(code, name)
    return {"ok": True, "photo": name}


# ── 관리 대시보드 ──
@app.get("/api/admin/dashboard")
def admin_dashboard(request: Request):
    require_admin(request)
    results = database.all_results()
    total = len(catalog.assets)
    today = clock.today_iso()

    statuses = {s: 0 for s in STATUSES}
    issues = {"difference": 0, "shortage": 0, "surplus": 0, "moved": 0,
              "disposal": 0, "with_reason": 0, "missing_label": 0}
    recent = []
    for code, result in results.items():
        asset = catalog.get(code)
        if not asset:
            continue
        statuses[result["status"]] = statuses.get(result["status"], 0) + 1
        diff = int(result["difference"])
        issues["difference"] += diff != 0
        issues["shortage"] += diff < 0
        issues["surplus"] += diff > 0
        moved = bool(result["confirmed_space"] and result["confirmed_space"] != asset["space"])
        issues["moved"] += moved
        issues["disposal"] += result["status"] in DISPOSAL_STATUSES
        issues["with_reason"] += bool(result["reason"].strip())
        issues["missing_label"] += result["method"] == "missing"
        recent.append({**public_asset(asset), **result})
    recent.sort(key=lambda x: x["updated_at"], reverse=True)

    space_summary = {"complete": 0, "in_progress": 0, "not_started": 0}
    floor_progress = []
    for group in home_payload()["floors"]:
        floor_total = sum(s["total"] for s in group["spaces"])
        floor_done = sum(s["done"] for s in group["spaces"])
        if floor_total:
            floor_progress.append({"floor": group["floor"], "total": floor_total,
                                   "done": floor_done, "percent": round(floor_done / floor_total * 100)})
        for space in group["spaces"]:
            if not space["total"]:
                continue
            state = ("complete" if space["done"] >= space["total"]
                     else "in_progress" if space["done"] else "not_started")
            space_summary[state] += 1

    return {
        "summary": {"total": total, "done": len(results), "remaining": max(0, total - len(results)),
                    "percent": round(len(results) / total * 100) if total else 0,
                    "today": sum(1 for r in results.values() if r["survey_date"] == today)},
        "statuses": statuses, "issues": issues, "space_summary": space_summary,
        "floor_progress": floor_progress, "recent": recent[:8],
    }


@app.get("/api/admin/results")
def admin_results(request: Request, kind: str = "all", value: str = "",
                  offset: int = 0, limit: int = 20):
    require_admin(request)
    items = []
    for code, result in database.all_results().items():
        asset = catalog.get(code)
        if not asset:
            continue
        moved = bool(result["confirmed_space"] and result["confirmed_space"] != asset["space"])
        if _result_matches(kind, value, result, moved):
            items.append({**public_asset(asset), **result,
                          "effective_space": effective_space(asset, result)})
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    offset, limit = max(0, offset), min(50, max(1, limit))
    page = items[offset:offset + limit]
    return {"total": len(items), "items": page, "has_more": offset + len(page) < len(items)}


@app.get("/api/admin/locations")
def admin_locations(request: Request):
    """공식 공간 목록(일괄 위치 변경 등에서 사용)."""
    require_admin(request)
    return {"groups": locations.official_groups()}


@app.get("/api/admin/results/all")
def admin_results_all(request: Request):
    """전체 실사 내역(표 화면용). 검색·필터·정렬은 클라이언트에서 처리한다."""
    require_admin(request)
    results = database.all_results()
    items = []
    for code, result in results.items():
        asset = catalog.get(code)
        if not asset:
            continue
        items.append({**public_asset(asset), **result,
                      "effective_space": effective_space(asset, result), "surveyed": True})
    # 미실사 자산도 포함한다(표에서 '미실사 포함' 토글/필터로 노출, 실사 시작 진입용).
    for code, asset in catalog.assets.items():
        if code in results:
            continue
        items.append({**asset, "surveyed": False, "status": "미실사",
                      "actual_qty": None, "difference": None, "reason": "",
                      "confirmed_space": "", "effective_space": asset["space"],
                      "updated_at": "", "survey_date": "", "method": ""})
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return {"total": len(items), "items": items, "today": clock.today_iso()}


@app.get("/api/admin/spaces")
def admin_spaces(request: Request, state: str = "", floor: str = ""):
    require_admin(request)
    if state and state not in {"complete", "in_progress", "not_started"}:
        raise HTTPException(400, "지원하지 않는 공간 조건입니다.")
    items = []
    for group in home_payload()["floors"]:
        if floor and group["floor"] != floor:
            continue
        for space in group["spaces"]:
            if not space["total"]:
                continue
            current = ("complete" if space["done"] >= space["total"]
                       else "in_progress" if space["done"] else "not_started")
            if state and state != current:
                continue
            items.append({"floor": group["floor"], "name": space["name"], **space,
                          "remaining": max(0, space["total"] - space["done"]),
                          "percent": round(space["done"] / space["total"] * 100), "state": current})
    items.sort(key=lambda x: (x["floor"], -x["percent"], x["name"]))
    return {"total": len(items), "items": items}


@app.get("/api/admin/export")
def admin_export(request: Request, scope: str = "all"):
    require_admin(request)
    if scope not in {"all", "surveyed"}:
        raise HTTPException(400, "지원하지 않는 범위입니다.")
    results = database.all_results()
    if not results:
        raise HTTPException(400, "저장된 실사 결과가 없습니다.")
    try:
        data = excel.build(results, list(catalog.assets.values()), only_surveyed=(scope == "surveyed"))
    except ValueError as error:
        raise HTTPException(500, str(error))
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(excel.filename())}"}
    return Response(content=data, headers=headers,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/admin/reload")
def admin_reload(request: Request):
    """서버 재시작 없이 자산대장·공간목록을 다시 읽는다(파일 교체 후 사용)."""
    require_admin(request)
    try:
        catalog.load()
    except (OSError, ValueError) as error:
        raise HTTPException(400, f"자산대장을 다시 읽지 못했습니다: {error}")
    return {"ok": True, "assets": len(catalog.assets), "spaces": len(locations.OFFICIAL_NAMES),
            "duplicates": catalog.duplicates, "loaded_at": catalog.loaded_at}


# ── 정적/자산 ──
@app.get("/api/photos/view/{filename}")
def view_photo(filename: str):
    path = IMAGE_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "이미지가 없습니다.")
    return FileResponse(path)



# ── 설정 화면(첫 실행 설정 · 관리자 '기관 설정') ──
_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def _is_local(request: Request) -> bool:
    """서버 PC에서 직접 연 요청인지. Cloudflare 터널은 localhost로 들어오므로 전달 헤더로 가려낸다."""
    host = request.client.host if request.client else ""
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    return host in _LOOPBACK and not forwarded


def require_setup(request: Request) -> None:
    if DEMO_MODE:
        raise HTTPException(403, "체험판에서는 설정을 바꿀 수 없습니다.")
    if STATE["setup"]:
        if not _is_local(request):
            raise HTTPException(403, "처음 설정은 서버 PC에서만 할 수 있습니다.")
        return
    require_admin(request)


def _schedule_restart() -> None:
    """응답을 보낸 뒤 종료 코드 3으로 끝낸다. start.bat·server-start.bat가 다시 켠다."""
    threading.Timer(1.0, os._exit, args=(3,)).start()


@app.get("/setup")
def setup_page():
    page = (STATIC_DIR / "setup.html").read_text(encoding="utf-8")
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


@app.get("/api/setup/state")
def setup_state(request: Request):
    require_setup(request)
    setup.discard_uploads()   # 화면을 새로 열면 저장하지 않은 업로드는 버린다.
    env = setup.read_env()
    try:
        template = {"ok": True, **setup.check_template(SOURCE_TEMPLATE)}
    except Exception as error:
        template = {"ok": False, "error": str(error)}
    try:
        ledger = {"ok": True, **setup.check_ledger(SOURCE_MASTER)}
    except Exception as error:
        ledger = {"ok": False, "error": str(error), "locations": []}
    return {
        "setup_mode": STATE["setup"], "problems": STATE["problems"],
        "org": env.get("ORG_NAME", ""), "backup_dir": env.get("BACKUP_DIR", ""),
        "default_backup_dir": str(setup.ROOT / "backups"), "min_code": MIN_CODE_LENGTH,
        "logo_custom": logo_file() != LOGO_DEFAULT,
        "ledger": {**ledger, "sample": setup.is_sample(SOURCE_MASTER)},
        "template": {**template, "sample": setup.is_sample(SOURCE_TEMPLATE)},
        "spaces": setup.current_spaces(), "space_source": locations.SOURCE,
        "results": len(database.all_results()), "url": setup.lan_url(PORT),
    }


async def _read_upload(file: UploadFile, limit: int) -> bytes:
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"파일은 {limit // 1024 // 1024}MB 이하여야 합니다.")
    return content


@app.post("/api/setup/logo")
async def setup_logo(request: Request, image: UploadFile = File(...)):
    require_setup(request)
    try:
        setup.save_logo(image.filename, await _read_upload(image, setup.MAX_LOGO_BYTES))
    except ValueError as error:
        raise HTTPException(400, str(error))
    return {"ok": True}


@app.delete("/api/setup/logo")
def setup_logo_remove(request: Request):
    require_setup(request)
    setup.remove_logo()
    return {"ok": True}


@app.post("/api/setup/ledger")
async def setup_ledger(request: Request, file: UploadFile = File(...)):
    require_setup(request)
    content = await _read_upload(file, setup.MAX_EXCEL_BYTES)
    try:
        path = setup.save_upload("ledger", content)
        return {"ok": True, **setup.check_ledger(path, database.all_results().keys(), catalog.assets)}
    except Exception as error:   # 형식이 틀린 파일은 받아 두지 않는다.
        setup.PENDING["ledger"][0].unlink(missing_ok=True)
        raise HTTPException(400, f"고정자산대장을 읽지 못했습니다: {error}")


@app.post("/api/setup/template")
async def setup_template(request: Request, file: UploadFile = File(...)):
    require_setup(request)
    content = await _read_upload(file, setup.MAX_EXCEL_BYTES)
    try:
        path = setup.save_upload("template", content)
        return {"ok": True, **setup.check_template(path)}
    except Exception as error:
        setup.PENDING["template"][0].unlink(missing_ok=True)
        raise HTTPException(400, f"재물조사표 양식을 읽지 못했습니다: {error}")


class SpaceItem(BaseModel):
    floor: str = Field(default="", max_length=30)
    name: str = Field(min_length=1, max_length=60)


class SetupBody(BaseModel):
    org: str = Field(min_length=1, max_length=40)
    access_code: str = Field(default="", max_length=20)
    admin_code: str = Field(default="", max_length=20)
    backup_dir: str = Field(default="", max_length=200)
    spaces: list[SpaceItem] = Field(default_factory=list, max_length=500)


@app.post("/api/setup/save")
def setup_save(body: SetupBody, request: Request):
    require_setup(request)
    # 운영 중에는 코드 칸을 비우면 지금 코드를 그대로 쓴다.
    access = body.access_code.strip() or ("" if STATE["setup"] else ACCESS_CODE)
    admin = body.admin_code.strip() or ("" if STATE["setup"] else ADMIN_CODE)
    problems = code_problems(access, admin)
    if problems:
        raise HTTPException(400, " ".join(problems))
    backup_dir = body.backup_dir.strip()
    if backup_dir:
        target = Path(backup_dir)
        if not target.is_absolute():
            raise HTTPException(400, "백업 폴더는 E:\\InventoryBackup 처럼 드라이브부터 적어 주세요.")
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError:
            raise HTTPException(400, "백업 폴더를 만들 수 없습니다. 드라이브가 연결돼 있는지 확인해 주세요.")

    setup.apply_uploads()
    spaces = [{"floor": s.floor.strip() or locations.AUTO_GROUP, "name": s.name.strip()}
              for s in body.spaces if s.name.strip()]
    if spaces:
        setup.write_spaces(spaces)
    changed = setup.write_env({"ORG_NAME": body.org.strip(), "ACCESS_CODE": access,
                               "ADMIN_CODE": admin, "BACKUP_DIR": backup_dir})
    if changed or STATE["setup"]:
        _schedule_restart()
        return {"ok": True, "restart": True}
    try:
        catalog.load()
    except (OSError, ValueError) as error:
        raise HTTPException(400, f"저장했지만 자산대장을 다시 읽지 못했습니다: {error}")
    return {"ok": True, "restart": False, "assets": len(catalog.assets)}


@app.get("/api/setup/qr")
def setup_qr(request: Request):
    """직원 접속 주소 QR(SVG). 서버 PC나 관리자에게만 보여 준다.

    색은 넣지 않는다 — 화면이 SVG를 문서에 직접 넣고 .qr-line 을 tokens.css 의 --color-qr-dark 로 칠한다.
    """
    is_admin = bool(ADMIN_TOKEN) and request.cookies.get(ADMIN_COOKIE) == ADMIN_TOKEN
    if not (_is_local(request) or is_admin):
        raise HTTPException(403, "서버 PC에서만 볼 수 있습니다.")
    import segno
    buffer = io.BytesIO()
    segno.make(setup.lan_url(PORT), error="m").save(
        buffer, kind="svg", scale=6, border=2, xmldecl=False, omitsize=True,
        svgclass="qr-svg", lineclass="qr-line", title="직원 접속 주소 QR 코드")
    return Response(buffer.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


def _backup_now() -> Path:
    from scripts import backup_data   # start·backup 배치와 같은 백업 방식을 쓴다.
    target = BACKUP_DIR / clock.now().strftime("%Y%m%d_%H%M%S_%f")
    target.mkdir(parents=True)
    backup_data.copy_database(DATA_DIR, target)
    backup_data.copy_saved_files(DATA_DIR, target)
    return target


@app.post("/api/setup/backup")
def setup_backup(request: Request):
    require_setup(request)
    try:
        return {"ok": True, "path": str(_backup_now())}
    except OSError as error:
        raise HTTPException(500, f"백업하지 못했습니다: {error}")


@app.get("/api/setup/backup/download")
def setup_backup_download(request: Request):
    """지금 백업을 하나 만들고 zip으로 내려준다(백업 폴더에도 남는다)."""
    require_setup(request)
    import shutil
    import tempfile
    try:
        folder = _backup_now()
        archive = shutil.make_archive(str(Path(tempfile.mkdtemp()) / folder.name), "zip", folder)
    except OSError as error:
        raise HTTPException(500, f"백업하지 못했습니다: {error}")
    name = f"재물조사_백업_{folder.name[:15]}.zip"
    return FileResponse(archive, media_type="application/zip", filename=name,
                        background=BackgroundTask(shutil.rmtree, Path(archive).parent, True))


class ClearBody(BaseModel):
    confirm: str


@app.post("/api/setup/clear-results")
def setup_clear_results(body: ClearBody, request: Request):
    """연습으로 저장한 실사 결과를 지운다. 반드시 먼저 백업한다."""
    require_setup(request)
    if body.confirm != "지우기":
        raise HTTPException(400, "확인 문구가 맞지 않습니다.")
    try:
        path = _backup_now()
    except OSError as error:
        raise HTTPException(500, f"백업에 실패해 지우지 않았습니다: {error}")
    database.reset_results(IMAGE_DIR)
    return {"ok": True, "backup": str(path)}



@app.get("/brand/logo")
def brand_logo():
    """왼쪽 상단·파비콘 로고. branding/logo.* 가 있으면 그 파일을 쓴다."""
    path = logo_file()
    return FileResponse(path, media_type=LOGO_TYPES[path.suffix.lower()],
                        headers={"Cache-Control": "no-cache"})


@app.get("/")
@app.get("/index.html")
def index_page():
    page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    page = (page.replace("{{ORG_NAME}}", ORG_HTML).replace("{{DEMO}}", "1" if DEMO_MODE else "")
            .replace("{{DEMO_BANNER}}", DEMO_BANNER))
    return HTMLResponse(page,
                        headers={"Cache-Control": "no-cache"})


# ── 검색/필터 헬퍼 ──
_INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"


def _clean(value: str) -> str:
    import re
    return re.sub(r"[^0-9a-z가-힣ㄱ-ㅎ]", "", (value or "").lower())


def _to_initials(value: str) -> str:
    out = []
    for char in value:
        code = ord(char) - 0xAC00
        out.append(_INITIALS[code // 588] if 0 <= code <= 11171 else char)
    return "".join(out)


def _matches(asset: dict, query: str) -> bool:
    import re
    haystack = " ".join(str(asset[k]) for k in
                        ("name", "code", "category", "department", "usage", "space")).lower()
    plain = _clean(haystack)
    initials = _clean(_to_initials(haystack))
    if query in plain or query in initials:
        return True
    parts = re.findall(r"[ㄱ-ㅎ]+|[^ㄱ-ㅎ]+", query)
    return bool(parts) and all(
        part in (initials if all(c in _INITIALS for c in part) else plain) for part in parts)


def _result_matches(kind: str, value: str, result: dict, moved: bool) -> bool:
    return (
        kind == "all"
        or (kind == "status" and result["status"] == value)
        or (kind == "today" and result["survey_date"] == clock.today_iso())
        or (kind == "difference" and int(result["difference"]) != 0)
        or (kind == "moved" and moved)
        or (kind == "disposal" and result["status"] in DISPOSAL_STATUSES)
        or (kind == "reason" and bool(result["reason"].strip()))
        or (kind == "missing" and result["method"] == "missing")
    )


class RevalidateStaticFiles(StaticFiles):
    """정적 파일에 Cache-Control: no-cache를 붙여, 배포 후 새로고침하면
    항상 최신 JS/CSS를 받도록 한다(ETag로 변경 없으면 304로 가볍게 처리)."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


if SOURCE_TESSERACT.exists():
    # Tesseract 벤더 자산은 용량이 커 장기 캐시를 허용한다.
    app.mount("/vendor/tesseract", StaticFiles(directory=SOURCE_TESSERACT), name="tesseract")
app.mount("/", RevalidateStaticFiles(directory=STATIC_DIR, html=True), name="static")
