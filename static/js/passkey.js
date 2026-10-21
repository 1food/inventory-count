// 관리자 패스키(WebAuthn) 클라이언트. 서버 옵션을 브라우저 형식으로 변환한다.
import { api, deviceLabel } from "./api.js";

function decode(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0)).buffer;
}

function encode(buffer) {
  if (buffer == null) return null;
  let binary = "";
  new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function supported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export function errorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError": return "패스키 확인이 취소되었거나 시간이 초과됐습니다.";
    case "InvalidStateError": return "이 패스키는 이미 등록돼 있습니다.";
    case "SecurityError": return "설정된 고정 HTTPS 주소에서만 패스키를 사용할 수 있습니다.";
    default: return error?.message || "패스키 처리 중 오류가 발생했습니다.";
  }
}

export async function register() {
  const options = await api("/api/admin/passkeys/register/options", { method: "POST" });
  const challengeId = options.challenge_id;
  delete options.challenge_id;
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    user: { ...options.user, id: decode(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: decode(c.id) })),
  };
  const credential = await navigator.credentials.create({ publicKey });
  return api("/api/admin/passkeys/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: challengeId,
      name: deviceLabel() + " 기기",
      credential: {
        id: credential.id, rawId: encode(credential.rawId), type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: encode(credential.response.clientDataJSON),
          attestationObject: encode(credential.response.attestationObject),
          transports: credential.response.getTransports ? credential.response.getTransports() : [],
        },
      },
    }),
  });
}

export async function authenticate() {
  const options = await api("/api/admin/passkeys/authenticate/options", { method: "POST" });
  const challengeId = options.challenge_id;
  delete options.challenge_id;
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: decode(c.id) })),
  };
  const credential = await navigator.credentials.get({ publicKey });
  return api("/api/admin/passkeys/authenticate/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: challengeId,
      credential: {
        id: credential.id, rawId: encode(credential.rawId), type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: encode(credential.response.clientDataJSON),
          authenticatorData: encode(credential.response.authenticatorData),
          signature: encode(credential.response.signature),
          userHandle: encode(credential.response.userHandle),
        },
      },
    }),
  });
}
