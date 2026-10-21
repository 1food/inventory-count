// 아이콘과 공용 UI 헬퍼(토스트·로딩·모달).
import { esc } from "./api.js";

const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  camera: '<path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z"/><circle cx="12" cy="13" r="3.2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  close: '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  sortAsc: '<path d="m6 15 6-6 6 6"/>',
  sortDesc: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  moon: '<path d="M20.7 15.1A9 9 0 0 1 8.9 3.3 9 9 0 1 0 20.7 15.1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M10.3 3.7 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
};

export function icon(name, label = "") {
  const path = ICONS[name];
  if (!path) return "";
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${path}</svg>`;
}

const toastEl = () => document.querySelector("#toast");
const loadingEl = () => document.querySelector("#loading");

let toastTimer;
// action: { label?, onClick?, appearance?, duration? }. duration이 0이면 다음 알림 전까지 유지한다.
export function toast(message, action, appearance = "info") {
  const el = toastEl();
  const allowed = new Set(["info", "success", "warning", "danger"]);
  const tone = allowed.has(action?.appearance) ? action.appearance : (allowed.has(appearance) ? appearance : "info");
  const statusIcon = tone === "success" ? "check" : tone === "info" ? "info" : "alert";
  const hasAction = Boolean(action?.label && typeof action.onClick === "function");
  el.className = `toast toast-${tone}`;
  el.innerHTML = `<span class="toast-icon">${icon(statusIcon)}</span><span class="toast-text">${esc(message)}</span>`;
  if (hasAction) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.onclick = () => { el.hidden = true; clearTimeout(toastTimer); action.onClick(); };
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  const duration = Number.isFinite(action?.duration) ? Math.max(0, action.duration) : (hasAction ? 6000 : 3000);
  toastTimer = duration ? setTimeout(() => { el.hidden = true; }, duration) : null;
}

export function busy(message = "불러오는 중") {
  document.querySelector("#loadingText").textContent = message;
  document.querySelector("#app").setAttribute("aria-busy", "true");
  loadingEl().hidden = false;
}

export function idle() {
  document.querySelector("#app").setAttribute("aria-busy", "false");
  loadingEl().hidden = true;
}

// 모달 안에서 Tab 포커스가 배경으로 빠져나가지 않도록 가둔다. 해제 함수를 반환(검토 8).
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function trapFocus(container) {
  const onKey = (event) => {
    if (event.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  addEventListener("keydown", onKey, true);
  return () => removeEventListener("keydown", onKey, true);
}

// 확인/선택 모달. buttons: [{label, value, variant?}]. 반환: 선택한 value 또는 null.
export function choose(title, message, buttons) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    box.innerHTML = `<div class="modal-title">${esc(title)}</div>` +
      (message ? `<div class="modal-message">${message}</div>` : "");

    let done = false;
    let untrap = () => {};
    const finish = (value) => {
      if (done) return;
      done = true;
      removeEventListener("keydown", onKey);
      untrap();
      backdrop.remove();
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") finish(null); };

    for (const button of buttons) {
      const el = document.createElement("button");
      el.className = `modal-button ${button.variant || ""}`.trim();
      el.textContent = button.label;
      el.onclick = () => finish(button.value);
      box.appendChild(el);
    }
    backdrop.appendChild(box);
    backdrop.onclick = (event) => { if (event.target === backdrop) finish(null); };
    document.body.appendChild(backdrop);
    addEventListener("keydown", onKey);
    untrap = trapFocus(box);
    box.querySelector("button")?.focus();
  });
}

// 선택 모달(드롭다운). groups: [{floor, spaces:[...]}]. 반환: 선택 값 또는 null.
export function selectModal(title, message, groups, { confirm = "적용", placeholder = "선택하세요" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const options = groups.map((g) =>
      `<optgroup label="${esc(g.floor)}">${g.spaces.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</optgroup>`).join("");
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-title">${esc(title)}</div>
      ${message ? `<div class="modal-message">${message}</div>` : ""}
      <select class="modal-select"><option value="">${esc(placeholder)}</option>${options}</select>
      <button class="modal-button">${esc(confirm)}</button>
      <button class="modal-button muted" data-cancel>취소</button>
    </div>`;
    const select = backdrop.querySelector("select");
    let untrap = () => {};
    const done = (value) => { removeEventListener("keydown", onKey); untrap(); backdrop.remove(); resolve(value); };
    const onKey = (event) => { if (event.key === "Escape") done(null); };
    backdrop.querySelector(".modal-button:not(.muted)").onclick = () => {
      // 선택하지 않고 확인을 누르면 닫지 않고 토스트로 안내한다.
      if (!select.value) { toast("변경할 위치를 선택해 주세요."); select.focus(); return; }
      done(select.value);
    };
    backdrop.querySelector("[data-cancel]").onclick = () => done(null);
    backdrop.onclick = (event) => { if (event.target === backdrop) done(null); };
    document.body.appendChild(backdrop);
    addEventListener("keydown", onKey);
    untrap = trapFocus(backdrop.querySelector(".modal"));
    select.focus();
  });
}

// 이미지 라이트박스(검토 10). src는 문자열 또는 배열(여러 장). 이미지를 누르면 확대/축소,
// 여러 장이면 ‹ › 또는 ←/→ 로 넘긴다. 배경/닫기/ESC로 닫는다.
export function imageModal(src, start = 0, onClose) {
  const list = Array.isArray(src) ? src : [src];
  let index = Math.max(0, Math.min(start, list.length - 1));
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop image-backdrop";
  backdrop.innerHTML = `<div class="image-modal">
    <button class="image-close" aria-label="닫기">${icon("close")}</button>
    ${list.length > 1 ? `<button class="image-nav prev" aria-label="이전">${icon("back")}</button>
    <button class="image-nav next" aria-label="다음">${icon("chevron")}</button>` : ""}
    <img alt="실사 사진">
    ${list.length > 1 ? `<div class="image-count"></div>` : ""}
  </div>`;
  const img = backdrop.querySelector("img");
  const counter = backdrop.querySelector(".image-count");
  // 확대(zoomed) 상태에서 드래그로 사진 위치를 옮긴다(패닝).
  let panX = 0, panY = 0, dragging = false, moved = false, startX = 0, startY = 0, originX = 0, originY = 0;
  const applyPan = () => { img.style.transform = `translate(${panX}px, ${panY}px)`; };
  const resetPan = () => { panX = 0; panY = 0; img.style.transform = ""; };
  const renderImg = () => {
    img.src = list[index];
    img.classList.remove("zoomed");
    resetPan();
    if (counter) counter.textContent = `${index + 1} / ${list.length}`;
  };
  const step = (delta) => { index = (index + delta + list.length) % list.length; renderImg(); };
  let untrap = () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", onKey);
    untrap();
    backdrop.remove();
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowLeft" && list.length > 1) step(-1);
    else if (event.key === "ArrowRight" && list.length > 1) step(1);
  };
  img.onclick = (event) => {
    event.stopPropagation();
    if (moved) { moved = false; return; }   // 드래그였으면 확대 토글하지 않는다
    img.classList.toggle("zoomed");
    resetPan();
  };
  img.addEventListener("pointerdown", (event) => {
    if (!img.classList.contains("zoomed")) return;   // 확대 상태에서만 이동
    dragging = true; moved = false;
    startX = event.clientX; startY = event.clientY;
    originX = panX; originY = panY;
    img.setPointerCapture(event.pointerId);
  });
  img.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    panX = originX + (event.clientX - startX);
    panY = originY + (event.clientY - startY);
    if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) moved = true;
    applyPan();
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    try { img.releasePointerCapture(event.pointerId); } catch (_) { /* 캡처 없으면 무시 */ }
  };
  img.addEventListener("pointerup", endDrag);
  img.addEventListener("pointercancel", endDrag);
  backdrop.querySelector(".prev")?.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
  backdrop.querySelector(".next")?.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
  backdrop.onclick = (event) => { if (event.target === backdrop || event.target.closest(".image-close")) close(); };
  document.body.appendChild(backdrop);
  addEventListener("keydown", onKey);
  untrap = trapFocus(backdrop.querySelector(".image-modal"));
  renderImg();
  backdrop.querySelector(".image-close").focus();
  return close;
}

// 텍스트 입력 모달(작성자 이름 등). 반환: 입력 문자열 또는 null.
export function prompt(title, message, { placeholder = "", value = "", confirm = "확인" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<div class="modal-title">${esc(title)}</div>` +
      (message ? `<div class="modal-message">${message}</div>` : "") +
      `<input class="modal-input" value="${esc(value)}" placeholder="${esc(placeholder)}">` +
      `<button class="modal-button">${esc(confirm)}</button>`;
    const input = box.querySelector("input");
    const submit = () => { backdrop.remove(); resolve(input.value.trim() || null); };
    box.querySelector("button").onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    backdrop.onclick = (event) => { if (event.target === backdrop) { backdrop.remove(); resolve(null); } };
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    input.focus();
  });
}
