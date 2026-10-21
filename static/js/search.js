// 홈 공간 목록의 초성 검색(클라이언트). 서버 자산 검색과 같은 규칙을 쓴다.

const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

export function toInitials(value) {
  return Array.from(String(value || "")).map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00;
    return code >= 0 && code <= 11171 ? INITIALS[Math.floor(code / 588)] : ch;
  }).join("");
}

const clean = (text) => String(text || "").toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎ]/g, "");

export function matches(value, query) {
  const q = clean(query);
  if (!q) return true;
  const plain = clean(value);
  const initials = clean(toInitials(value));
  if (plain.includes(q) || initials.includes(q)) return true;
  const parts = q.match(/[ㄱ-ㅎ]+|[^ㄱ-ㅎ]+/g) || [];
  return parts.length > 0 && parts.every((part) => {
    const useInitials = Array.from(part).every((c) => INITIALS.includes(c));
    return (useInitials ? initials : plain).includes(part);
  });
}
