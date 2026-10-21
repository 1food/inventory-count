# 함께 배포하는 오픈소스 구성요소

이 프로그램은 아래 오픈소스 구성요소를 포함하거나 설치 시 내려받습니다. 각 구성요소의 저작권은 원저작자에게 있습니다.

| 구성요소 | 위치 | 라이선스 |
| --- | --- | --- |
| Pretendard (글꼴, Copyright © 2021 Kil Hyung-jin, Reserved Font Name "Pretendard") | static/fonts/PretendardVariable.woff2 | SIL Open Font License 1.1 — https://openfontlicense.org |
| Tesseract.js / tesseract.js-core (브라우저 문자 인식) | static/vendor/tesseract/ | Apache License 2.0 |
| Tesseract 영어 학습 데이터(eng.traineddata) | static/vendor/tesseract/lang/ | Apache License 2.0 |
| FastAPI, Starlette, Pydantic, Uvicorn, python-multipart, python-dotenv, httpx | 설치 시 내려받음(requirements.txt) | MIT / BSD-3-Clause / Apache-2.0 |
| openpyxl | 설치 시 내려받음 | MIT |
| py_webauthn | 설치 시 내려받음 | BSD-3-Clause |
| cloudflared (외부 접속을 쓸 때만 내려받음) | cloudflared.exe | Apache License 2.0 |

글꼴은 원본 Pretendard Variable을 웹 형식(woff2)으로 변환만 했으며 글리프는 수정하지 않았습니다.
