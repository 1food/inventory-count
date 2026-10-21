"""선택적 Google Cloud Vision 라벨 인식.

키가 없으면 available()=False → 프런트가 브라우저 Tesseract로 폴백한다.
서버(사내 PC)만 인터넷이 필요하고, 스마트폰은 사내망만 있으면 된다.
"""
from __future__ import annotations

import base64
import json
import re
import urllib.request

from .config import GOOGLE_VISION_API_KEY

_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate?key="
_DASHES = "‐‑‒–—―−－・"
# 대-중-소[-일련] 형태의 코드 조각(자릿수 유연, 공백 허용).
_CODE = re.compile(r"\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,3}(?:\s*-\s*\d{1,4})?")


def available() -> bool:
    return bool(GOOGLE_VISION_API_KEY)


def extract_codes(text: str) -> list[str]:
    for dash in _DASHES:
        text = (text or "").replace(dash, "-")
    found: list[str] = []
    for match in _CODE.finditer(text):
        code = re.sub(r"\s+", "", match.group(0))
        if code not in found:
            found.append(code)
    return found


def recognize(image_bytes: bytes, timeout: int = 20) -> dict:
    if not available():
        raise RuntimeError("Google Vision API가 설정되지 않았습니다.")
    body = {"requests": [{
        "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
        "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
        "imageContext": {"languageHints": ["ko", "en"]},
    }]}
    request = urllib.request.Request(
        _ENDPOINT + GOOGLE_VISION_API_KEY,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    first = (data.get("responses") or [{}])[0]
    if first.get("error"):
        raise RuntimeError(first["error"].get("message") or "Google Vision 오류")
    text = (first.get("fullTextAnnotation") or {}).get("text", "")
    if not text and first.get("textAnnotations"):
        text = first["textAnnotations"][0].get("description", "")
    return {"text": text, "codes": extract_codes(text)}
