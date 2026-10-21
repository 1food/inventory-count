"""디자인 시스템 지키기 검사.

AGENTS.md '디자인 시스템 규칙'을 기계적으로 확인한다. 화면(CSS·JS·HTML)을 고치면 이 테스트가 통과해야 한다.
예외는 아래 ALLOWED_* 에만 적고, 왜 예외인지 한 줄로 남긴다.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
STYLES = [STATIC / "styles" / "app.css", STATIC / "styles" / "login.css"]   # tokens.css만 색을 정의한다
SCRIPTS = sorted((STATIC / "js").glob("*.js"))
PAGES = sorted(STATIC.glob("*.html")) + [ROOT / "app" / "main.py"]          # main.py: 로그인·설정 중 화면 HTML

COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
TOKEN_RADIUS = re.compile(r"((var\(--radius-[a-z0-9]+\)|0)\s*)+|inherit")
# 동그란 아이콘 전용 버튼(글자 없는 44px 원형)은 원래 디자인이다. 글자 버튼은 알약 금지.
ALLOWED_ROUND_BUTTONS = {".icon-button", ".home-button"}
# 포커스 표시를 부모(:focus-within)나 자식 요소에 맡기는 곳, 어두운 토스트 위 전용 링.
ALLOWED_FOCUS = {".search-field input:focus", ".audit-history > summary:focus-visible",
                 ".toast-action:focus-visible", ".code-entry input:focus, .code-entry input:focus-visible"}


def blocks(path: Path):
    text = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
        yield " ".join(selector.split()), " ".join(body.split())


class DesignSystemTests(unittest.TestCase):
    def test_colors_come_only_from_tokens(self):
        found = []
        for path in STYLES + SCRIPTS:
            for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if COLOR.search(re.sub(r"/\*.*?\*/|//.*$", "", line)):
                    found.append(f"{path.relative_to(ROOT)}:{no}: {line.strip()[:90]}")
        for path in PAGES:
            for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                # <meta name="theme-color"> 는 CSS 변수를 읽기 전에 정해져야 해서 예외(토큰과 같은 값).
                if COLOR.search(line) and "theme-color" not in line:
                    found.append(f"{path.relative_to(ROOT)}:{no}: {line.strip()[:90]}")
        self.assertEqual(found, [], "색은 tokens.css 의 토큰(var(--color-…))으로만 쓴다")

    def test_radius_uses_tokens_and_text_buttons_are_not_pills(self):
        found = []
        for path in STYLES:
            for selector, body in blocks(path):
                for value in re.findall(r"border-radius\s*:\s*([^;]+)", body):
                    if not TOKEN_RADIUS.fullmatch(value.strip()):
                        found.append(f"{selector}: border-radius {value}")
                if "radius-full" in body and re.search(r"button|btn", selector) \
                        and selector not in ALLOWED_ROUND_BUTTONS:
                    found.append(f"{selector}: 버튼에 --radius-full(알약)")
        self.assertEqual(found, [], "모서리는 --radius-* 토큰, 버튼은 --radius-lg/--radius-md")

    def test_focus_ring_is_consistent(self):
        found = []
        for path in STYLES:
            for selector, body in blocks(path):
                if ":focus" in selector and "outline: none" in body.replace("outline:none", "outline: none") \
                        and "var(--ring-focus)" not in body and selector not in ALLOWED_FOCUS:
                    found.append(selector)
        self.assertEqual(found, [], "outline:none 을 쓰면 box-shadow: var(--ring-focus) 로 대신 표시한다")

    def test_typography_and_assets_stay_in_house(self):
        found = []
        for path in STYLES:
            for selector, body in blocks(path):
                for value in re.findall(r"font-family\s*:\s*([^;]+)", body):
                    if value.strip() not in ("var(--font-sans)", "inherit"):
                        found.append(f"{selector}: font-family {value}")
                # 오렌지(accent)는 제한된 포인트(배경·선·장식)에만. 글자색으로 쓰지 않는다.
                if re.search(r"(^|;)\s*color\s*:\s*var\(--color-accent(-strong)?\)", body):
                    found.append(f"{selector}: accent 글자색")
        for path in STYLES + SCRIPTS + PAGES:
            text = path.read_text(encoding="utf-8")
            for cdn in ("cdn.jsdelivr", "fonts.googleapis", "unpkg.com", "cdnjs"):
                if cdn in text:
                    found.append(f"{path.relative_to(ROOT)}: 외부 CDN {cdn} (글꼴·스크립트는 앱에 포함)")
        self.assertEqual(found, [])

    def test_pages_apply_theme_before_paint(self):
        # 링크 기본색이 브라우저 파랑·보라로 보이지 않게 app.css 가 a 색을 Primary 로 정한다.
        self.assertRegex((STATIC / "styles" / "app.css").read_text(encoding="utf-8"),
                         r"(?m)^a \{ color: var\(--color-primary\); \}")
        for path in sorted(STATIC.glob("*.html")):
            text = path.read_text(encoding="utf-8")
            self.assertIn("inventory-theme", text, f"{path.name}: 다크 모드 테마 초기화 스크립트가 없습니다")
            self.assertIn("/styles/tokens.css", text, f"{path.name}: tokens.css 를 먼저 불러와야 합니다")

    def test_no_native_dialogs(self):
        # alert/confirm/prompt 창은 앱 디자인 밖이다. ui.js 의 choose()·prompt()·toast() 를 쓴다.
        found = []
        call = re.compile(r"(?<![.\w])(window\.)?(alert|confirm|prompt)\(")
        ui_prompt = re.compile(r"import \{[^}]*\bprompt\b[^}]*\} from \"\./ui\.js\"")
        for path in SCRIPTS:
            text = path.read_text(encoding="utf-8")
            uses_ui_prompt = path.name == "ui.js" or ui_prompt.search(text)
            for no, line in enumerate(text.splitlines(), 1):
                code = re.sub(r"//.*$", "", line)
                for match in call.finditer(code):
                    if code[:match.start()].rstrip().endswith("function"):
                        continue   # 함수 정의(VIEWS.confirm = async function confirm(...))
                    if match.group(2) == "prompt" and not match.group(1) and uses_ui_prompt:
                        continue   # ui.js 의 prompt 모달
                    found.append(f"{path.name}:{no}: {line.strip()[:80]}")
        self.assertEqual(found, [])

if __name__ == "__main__":
    unittest.main()
