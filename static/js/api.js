// 서버 통신과 공용 유틸리티.

export async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    // 접근 세션 만료 → 로그인 화면으로.
    location.reload();
    throw new Error("접근 인증이 필요합니다.");
  }
  // 관리자 세션 만료(403) → 로그인 화면으로 안내(각 화면이 수신해 처리).
  // 단, /api/admin/session 은 로그인(인증 시도) 엔드포인트라 403이 "코드 오류"를 뜻하므로
  // 만료 안내 대상에서 제외한다(로그인 폼이 오류 메시지를 직접 표시).
  if (response.status === 403 && path.startsWith("/api/admin/") && path !== "/api/admin/session") {
    dispatchEvent(new Event("inventory:admin-expired"));
  }
  if (!response.ok) {
    let message = `요청을 처리하지 못했습니다 (${response.status})`;
    try {
      const data = await response.json();
      const detail = data.detail;
      if (Array.isArray(detail)) {
        // FastAPI 검증 오류(422): [{loc, msg, ...}] 형태 → 사람이 읽을 문자열로.
        message = detail.map((d) => d?.msg || (typeof d === "string" ? d : JSON.stringify(d))).join("\n");
      } else if (detail && typeof detail === "object") {
        message = detail.msg || JSON.stringify(detail);
      } else if (detail) {
        message = detail;
      }
    } catch (_) { /* 본문이 JSON이 아니면 기본 메시지 사용 */ }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response;
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

// ── 조사자·기기 라벨(감사 이력용) ──
// 저장/취소 시 누가 어떤 기기로 했는지 함께 기록한다. 조사자 이름은 이 기기에만 보관한다.
const SURVEYOR_KEY = "inventory-surveyor";

export function surveyorName() {
  try { return (localStorage.getItem(SURVEYOR_KEY) || "").trim().slice(0, 20); }
  catch (_) { return ""; }
}

export function setSurveyorName(name) {
  try { localStorage.setItem(SURVEYOR_KEY, String(name || "").trim().slice(0, 20)); }
  catch (_) { /* 스토리지 불가 시 무시 */ }
}

function deviceType() {
  const ua = navigator.userAgent || "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac/i.test(ua)) return "Mac";
  return "기기";
}

export function deviceLabel() {
  const name = surveyorName();
  return name ? `${name} · ${deviceType()}` : deviceType();
}
