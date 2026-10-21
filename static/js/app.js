// 재물조사 — 화면 라우터와 뷰.
// 순수 ES 모듈. 각 화면은 하나의 async 함수이며 라우터가 스택으로 관리한다.
import { api, esc, deviceLabel, surveyorName, setSurveyorName } from "./api.js";
import { icon, toast, busy, idle, choose, imageModal, selectModal, prompt } from "./ui.js";
import { matches } from "./search.js";
import { recognize } from "./ocr.js";
import * as passkey from "./passkey.js";

const app = document.querySelector("#app");
const pageTitle = document.querySelector("#pageTitle");
const backButton = document.querySelector("#backButton");
const homeButton = document.querySelector("#homeButton");
const brandMark = document.querySelector("#brandMark");
const themeToggle = document.querySelector("#themeToggle");
const themeColor = document.querySelector('meta[name="theme-color"]');
backButton.innerHTML = icon("back");
homeButton.innerHTML = icon("home");
brandMark.innerHTML = `<img src="/brand/logo" alt="" aria-hidden="true">`;
const ORG_NAME = document.body.dataset.org || "";
const DEMO = document.body.dataset.demo === "1";   // 체험판: 촬영 사진을 저장하지 않는다.

const THEME_KEY = "inventory-theme";
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const storedTheme = () => {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch (_) { return null; }
};
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  themeToggle.innerHTML = icon(isDark ? "sun" : "moon");
  themeToggle.setAttribute("aria-label", isDark ? "라이트 모드로 변경" : "다크 모드로 변경");
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.title = isDark ? "라이트 모드로 변경" : "다크 모드로 변경";
  // 브라우저 상단 색도 토큰(--color-canvas-soft)을 따른다.
  themeColor?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--color-canvas-soft").trim());
}
applyTheme(storedTheme() || (systemTheme.matches ? "dark" : "light"));
themeToggle.onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* 현재 화면에는 계속 적용한다. */ }
  applyTheme(next);
};
systemTheme.addEventListener?.("change", (event) => {
  if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
});

// ── 라우터 ──
const router = {
  stack: [{ view: "home", params: {}, scroll: 0 }],
  index: 0,
  pendingPhoto: null, // 촬영 흐름에서 넘어온 사진(저장 시 업로드)
  dirty: false,       // 저장하지 않은 입력이 있는지
};
history.replaceState({ index: 0 }, "");
history.scrollRestoration = "manual";

const VIEWS = {}; // 아래에서 채운다.

const isAdminEntry = (entry) => Boolean(entry &&
  (String(entry.view || "").startsWith("admin") || entry.params?.admin));
const keepsPendingPhoto = (view, params = {}) => Boolean(router.pendingPhoto &&
  ["confirm", "search", "asset"].includes(view) && params.method === "label" &&
  params.space === router.pendingPhoto.space);
const prepareNavigation = (view, params = {}) => {
  if (router.pendingPhoto && !keepsPendingPhoto(view, params)) router.pendingPhoto = null;
};
async function logoutAdmin() {
  try { await api("/api/admin/logout", { method: "POST" }); }
  catch (_) { /* 이동은 계속하되 서버 쿠키는 만료 시간에 자동 폐기된다. */ }
}

function rememberScroll() {
  router.stack[router.index].scroll = scrollY;
}

function restoreScroll(top = 0) {
  const apply = () => scrollTo(0, Math.max(0, Number(top) || 0));
  apply();
  requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
}

function go(view, params = {}) {
  prepareNavigation(view, params);
  rememberScroll();
  router.stack = router.stack.slice(0, router.index + 1);
  router.stack.push({ view, params, scroll: 0 });
  router.index += 1;
  history.pushState({ index: router.index }, "");
  render();
}

function replace(view, params = {}) {
  prepareNavigation(view, params);
  rememberScroll();
  router.stack[router.index] = { view, params, scroll: 0 };
  history.replaceState({ index: router.index }, "");
  render();
}

// 사진 라이트박스: 브라우저 뒤로가기로도 닫히도록 히스토리에 한 칸 얹는다.
// 라우터 popstate와 충돌하지 않게, 얹은 항목에는 overlay 표식만 두고 index는 그대로 둔다.
let closeImageOverlay = null;
function openImageOverlay(urls, i) {
  history.pushState({ ...history.state, overlay: true }, "");
  let byBack = false;
  const close = imageModal(urls, i, () => {
    closeImageOverlay = null;
    if (byBack) return;                 // 뒤로가기로 닫힘: 히스토리는 이미 빠졌다
    if (history.state?.overlay) {        // UI(X·ESC·배경)로 닫힘: 얹은 항목을 되돌린다
      closeImageOverlay = () => {};      // 뒤이어 오는 popstate 한 번은 무시(재렌더 방지)
      history.back();
    }
  });
  closeImageOverlay = () => { byBack = true; close(); };
}

function goHome() {
  router.pendingPhoto = null;
  const target = router.stack.findIndex((entry) => entry.view === "home");
  if (target >= 0) {
    history.go(target - router.index);
  } else {
    router.stack = [{ view: "home", params: {}, scroll: 0 }];
    router.index = 0;
    history.replaceState({ index: 0 }, "");
    render();
  }
}

async function confirmLeave(title) {
  if (!router.dirty) return true;
  const leave = await choose(title, "저장하지 않은 변경 내용이 있습니다.<br>이 화면에서 나갈까요?", [
    { label: "나가기", value: true, variant: "danger" },
    { label: "계속 작성", value: false, variant: "muted" },
  ]);
  if (leave) router.dirty = false;
  return leave;
}

backButton.onclick = async () => {
  if (!await confirmLeave("변경 내용 취소")) return;
  const current = router.stack[router.index];
  const previous = router.stack[Math.max(0, router.index - 1)];
  if (isAdminEntry(current) && !isAdminEntry(previous)) await logoutAdmin();
  history.back();
};
homeButton.onclick = async () => {
  if (!await confirmLeave("처음으로 돌아가기")) return;
  if (isAdminEntry(router.stack[router.index])) await logoutAdmin();
  goHome();
};
// 브라우저 뒤로가기(스와이프·물리 버튼 포함)에서도 저장 전 이탈을 확인한다.
// popstate는 이미 이동한 뒤에 발생하므로, 취소 시 더미 상태를 다시 밀어 원위치로 복구한다.
addEventListener("popstate", async (event) => {
  // 사진 오버레이가 열려 있으면 뒤로가기는 오버레이만 닫는다(라우팅 이동 없음).
  if (closeImageOverlay && !event.state?.overlay) {
    const fn = closeImageOverlay;
    closeImageOverlay = null;
    fn();
    return;
  }
  const target = Math.max(0, Math.min(event.state?.index ?? 0, router.stack.length - 1));
  if (router.dirty && target < router.index) {
    const leave = await confirmLeave("변경 내용 취소");
    if (!leave) {
      history.pushState({ index: router.index }, "");
      return;
    }
  }
  const targetEntry = router.stack[target];
  if (isAdminEntry(router.stack[router.index]) && !isAdminEntry(targetEntry)) await logoutAdmin();
  prepareNavigation(targetEntry?.view || "home", targetEntry?.params || {});
  router.index = target;
  router.dirty = false;
  render();
});
addEventListener("scroll", () => {
  if (router.stack[router.index]) router.stack[router.index].scroll = scrollY;
}, { passive: true });
addEventListener("beforeunload", (event) => {
  if (router.dirty) { event.preventDefault(); event.returnValue = ""; }
});

// 관리자 세션 만료 시(작업 중 403) 안내 후 로그인 화면으로 이동. 중복 처리 방지.
let adminExpiredHandling = false;
addEventListener("inventory:admin-expired", () => {
  const view = router.stack[router.index]?.view;
  if (!view || !view.startsWith("admin") || adminExpiredHandling) return;
  adminExpiredHandling = true;
  router.dirty = false;
  toast("관리자 인증이 만료되었어요. 다시 로그인해 주세요.", null, "warning");
  replace("adminLogin");
  setTimeout(() => { adminExpiredHandling = false; }, 1500);
});

async function render() {
  const route = router.stack[router.index];
  const atHome = route.view === "home";
  backButton.hidden = router.index === 0 || atHome;
  homeButton.hidden = atHome;
  // 홈에서는 좌측 심볼과 테마 전환, 그 외에는 뒤로/처음 버튼만 표시한다.
  brandMark.hidden = !atHome;
  themeToggle.hidden = !atHome;
  // 전체 실사 내역은 PC에서 넓게 — app-shell 폭 확장.
  app.classList.toggle("wide", route.view === "adminTable");
  const view = VIEWS[route.view] || VIEWS.home;
  try {
    await view(route.params);
  } catch (error) {
    app.innerHTML = `<div class="notice error"><b>화면을 불러오지 못했습니다.</b>
      <p>${esc(error.message)}</p><button class="text-button" id="retry">다시 시도</button></div>`;
    document.querySelector("#retry").onclick = render;
  }
  restoreScroll(route.scroll || 0);
  saveRoute(route);
}

// 새로고침 시 마지막 화면을 유지하기 위한 저장/복원.
const RESTORABLE = new Set(["home", "space", "asset", "admin", "adminTable", "adminList", "adminSpaces"]);
function saveRoute(route) {
  try {
    if (!RESTORABLE.has(route.view)) return;
    sessionStorage.setItem("inventory-route", JSON.stringify({ view: route.view, params: route.params || {} }));
  } catch (_) { /* 스토리지 불가 시 무시 */ }
}
function restoreRoute() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("inventory-route") || "null");
    if (!saved || !RESTORABLE.has(saved.view) || saved.view === "home") return;
    router.stack = [{ view: "home", params: {}, scroll: 0 }, { view: saved.view, params: saved.params || {}, scroll: 0 }];
    router.index = 1;
    history.pushState({ index: 1 }, "");   // 뒤로가기로 홈에 갈 수 있도록 항목 추가
  } catch (_) { /* 무시 */ }
}

// ── 라벨 헬퍼 ──
const STATUS_LABEL = { 활용: "활용", 사용가능: "불용대상 · 사용가능", 폐품: "불용대상 · 폐품" };
const STATUS_CLASS = { 활용: "utilize", 사용가능: "usable", 폐품: "scrap" };
const METHOD_LABEL = { label: "라벨 확인", manual: "코드 직접 입력", list: "공간 목록 선택", missing: "라벨 없음·훼손", admin: "관리 목록에서 실사" };
// 실사 수량 0(실물 없음)은 상태값이 빈 문자열 "" — 어디서나 '망실'로 표기한다.
const LOST_STATUS = "망실";
const statusLabel = (v) => v === "" ? LOST_STATUS : (STATUS_LABEL[v] || "미실사");
const statusShort = (v) => v === "" ? LOST_STATUS : (v || "미실사");
const methodLabel = (v) => METHOD_LABEL[v] || "코드 직접 입력";

function assetRow(asset) {
  const badge = asset.done
    ? `<span class="badge status-${STATUS_CLASS[asset.result.status] || ""}">${esc(statusShort(asset.result.status))}</span>`
    : `<span class="badge todo">실사하기 ${icon("chevron")}</span>`;
  return `<button class="asset-row${asset.done ? " is-done" : ""}" data-code="${esc(asset.code)}">
    <span class="asset-main">
      <b>${esc(asset.name)}</b>
      <small>${esc(asset.code)}</small>
      <small>${esc([asset.category, asset.department].filter(Boolean).join(" · ") || "분류 없음")}</small>
    </span>${badge}</button>`;
}

function bindRows(container = app) {
  container.querySelectorAll(".asset-row[data-code]:not([data-bound])").forEach((btn) => {
    btn.dataset.bound = "1";
    btn.onclick = () => go("asset", { code: btn.dataset.code, method: btn.dataset.method || "manual", space: btn.dataset.space || "" });
  });
}

// 엑셀 다운로드: raw 링크 대신 blob으로 받아 진행/오류를 처리한다(결과 없음 400 등).
async function downloadExport(scope = "all") {
  busy("엑셀을 만드는 중");
  try {
    const response = await fetch(`/api/admin/export?scope=${scope}`);
    if (response.status === 403) dispatchEvent(new Event("inventory:admin-expired"));
    if (!response.ok) {
      let message = "다운로드에 실패했습니다.";
      try { const data = await response.json(); if (data.detail) message = data.detail; } catch (_) {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : "재물조사표.xlsx";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    idle();
    toast("엑셀을 내려받았습니다.", null, "success");
  } catch (error) {
    idle();
    toast(error.message, null, "danger");
  }
}

// ── 홈 ──
VIEWS.home = async function home(params) {
  pageTitle.textContent = "재물조사";
  router.dirty = false;
  app.innerHTML = `<div class="skeleton tall"></div>`;
  const data = await api("/api/home");
  const { total, done } = data.summary;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const query = params.query || "";
  const guideSeen = localStorage.getItem("inventory-guide") === "1";

  app.innerHTML = `
    <section class="hero">
      <span class="eyebrow chip">${data.survey_year} 정기 재물조사</span>
      <div class="hero-figure"><strong>${percent}%</strong><span>${done}/${total}건</span></div>
      <div class="track"><i style="width:${percent}%"></i></div>
      <p>${total - done}건의 자산이 실사를 기다리고 있습니다.</p>
    </section>
    ${guideSeen ? "" : `<section class="guide" id="guide">
      <div class="guide-head"><b>조사 방법</b><button type="button" id="guideDismiss">확인했어요</button></div>
      <ol>
        <li><span>1</span><div><b>공간을 선택합니다.</b><small>현재 조사할 방을 먼저 찾아주세요.</small></div></li>
        <li><span>2</span><div><b>비품 라벨을 촬영합니다.</b><small>인식 결과가 맞는지 확인해 주세요.</small></div></li>
        <li><span>3</span><div><b>수량과 상태를 저장합니다.</b><small>실물과 장부가 다르면 사유를 남겨주세요.</small></div></li>
      </ol>
    </section>`}
    <label class="search-field"><span>${icon("search")}</span>
      <input id="spaceSearch" value="${esc(query)}" placeholder="공간 이름 또는 초성 검색" aria-label="공간 검색">
      <button type="button" class="search-clear" id="spaceSearchClear" aria-label="검색어 지우기" hidden>${icon("close")}</button></label>
    <div id="floors"></div>
    <footer class="site-footer">
      <p class="footer-org">${esc(ORG_NAME)}</p>
      <span class="footer-links">
        <span class="footer-admin-link" id="surveyorEntry" role="button" tabindex="0">조사자 ${esc(surveyorName() || "미입력")}</span>
        <span class="footer-admin-link" id="adminEntry" role="button" tabindex="0">관리</span>
      </span>
    </footer>`;

  const searchInput = document.querySelector("#spaceSearch");
  const clearBtn = document.querySelector("#spaceSearchClear");
  const draw = () => {
    const q = searchInput.value.trim();
    params.query = q;
    clearBtn.hidden = !searchInput.value;
    const floors = data.floors
      .map((group) => ({ ...group, spaces: group.spaces.filter((s) => matches(s.name, q)) }))
      .filter((group) => group.spaces.length);
    document.querySelector("#floors").innerHTML = floors.length ? floors.map((group) => `
      <section class="floor">
        <h2>${esc(group.floor)}</h2>
        <div class="space-grid">${group.spaces.map(spaceCard).join("")}</div>
      </section>`).join("") : `<div class="empty">일치하는 공간이 없습니다.</div>`;
    document.querySelectorAll("[data-space]").forEach((btn) => {
      btn.onclick = () => go("space", { space: btn.dataset.space });
    });
  };
  draw();
  searchInput.oninput = draw;
  clearBtn.onclick = () => { searchInput.value = ""; searchInput.focus(); draw(); };
  const guideDismiss = document.querySelector("#guideDismiss");
  if (guideDismiss) guideDismiss.onclick = () => {
    localStorage.setItem("inventory-guide", "1");
    document.querySelector("#guide").remove();
  };
  const surveyorEntry = document.querySelector("#surveyorEntry");
  const editSurveyor = async () => {
    // 브라우저 기본 대화상자 대신 앱 모달(ui.js prompt)을 쓴다.
    const name = await prompt("조사자 이름", "저장 이력에 함께 남길 이름을 입력하세요.",
      { value: surveyorName(), placeholder: "예: 홍길동", confirm: "저장" });
    if (name === null) return;
    setSurveyorName(name);
    surveyorEntry.textContent = `조사자 ${surveyorName() || "미입력"}`;
  };
  surveyorEntry.onclick = editSurveyor;
  surveyorEntry.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editSurveyor(); }
  };
  const adminEntry = document.querySelector("#adminEntry");
  adminEntry.onclick = () => go("adminLogin");
  adminEntry.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      go("adminLogin");
    }
  };
};

function spaceCard(space) {
  const percent = space.total ? Math.round((space.done / space.total) * 100) : 0;
  // 자산이 없는 공간도 자산이 있는 공간과 같은 형태(진행바·배경)로 표시한다.
  const state = space.total && space.done >= space.total ? "is-complete" : space.done ? "is-progress" : "";
  return `<button class="space-card ${state}" data-space="${esc(space.name)}">
    <span class="space-head"><b>${esc(space.name)}</b>
      <small>${space.done}/${space.total}</small></span>
    <i><em style="width:${percent}%"></em></i></button>`;
}

// ── 공간 ──
VIEWS.space = async function space({ space }) {
  pageTitle.textContent = space;
  app.innerHTML = `<div class="skeleton tall"></div>`;
  const data = await api(`/api/spaces/${encodeURIComponent(space)}/assets`);
  const pending = data.items.filter((i) => !i.done);
  const complete = data.items.filter((i) => i.done);

  app.innerHTML = `
    <section class="capture">
      <div class="capture-copy"><span class="capture-mark">${icon("camera")}</span>
        <div><b>비품 라벨을 촬영하세요</b><p>라벨의 코드번호를 자동으로 찾습니다.</p></div></div>
      <label class="primary-button"><span>라벨 촬영</span>
        <input id="camera" type="file" accept="image/*" capture="environment" hidden></label>
    </section>
    <form class="code-entry" id="codeForm">
      <label for="codeInput">코드번호 직접 입력</label>
      <div><span class="code-input-wrap"><input id="codeInput" placeholder="하이픈 없이도 검색됩니다" autocomplete="off" inputmode="numeric">
      <button type="button" class="search-clear" id="codeClear" aria-label="입력 지우기" hidden>${icon("close")}</button></span>
      <button>찾기</button></div>
    </form>
    <button class="missing" id="missing"><span>라벨이 없거나 훼손됐나요?</span>
      <b>자산명으로 찾기 ${icon("chevron")}</b></button>
    <div class="section-head"><h2>실사할 자산</h2><span>${pending.length}건</span></div>
    <div class="asset-list">${
      pending.length ? pending.map(assetRow).join("")
        : data.items.length ? `<div class="empty success">이 공간의 실사가 모두 완료됐습니다.</div>`
          : `<div class="empty">이 공간에는 등록된 자산이 없습니다.</div>`}</div>
    ${complete.length ? `<details class="completed"><summary>완료 ${complete.length}건</summary>
      <div class="asset-list">${complete.map(assetRow).join("")}</div></details>` : ""}`;

  app.querySelectorAll(".asset-row[data-code]").forEach((btn) => {
    btn.dataset.method = "list";
    btn.dataset.space = space;
  });
  bindRows();
  document.querySelector("#missing").onclick = () => go("search", { space, method: "missing" });
  const codeField = document.querySelector("#codeInput");
  const codeClear = document.querySelector("#codeClear");
  const syncCodeClear = () => { codeClear.hidden = !codeField.value; };
  codeField.oninput = syncCodeClear;
  codeClear.onclick = () => { codeField.value = ""; syncCodeClear(); codeField.focus(); };
  syncCodeClear();
  document.querySelector("#codeForm").onsubmit = async (event) => {
    event.preventDefault();
    const code = codeField.value.trim();
    if (!code) { codeField.focus(); return toast("코드번호를 입력해 주세요."); }
    await identify(code, "manual", space);
  };
  document.querySelector("#camera").onchange = (event) => onCapture(event, space);
};

async function onCapture(event, space) {
  const file = event.target.files[0];
  if (!file) return;
  router.pendingPhoto = DEMO ? null : { file, space, code: "" };
  busy("라벨을 읽는 중");
  try {
    const form = new FormData();
    form.append("image", file);
    form.append("space", space);
    const server = await api("/api/recognize", { method: "POST", body: form });
    if (server.ok && server.matched) {
      idle();
      return go("confirm", { asset: server.matched, readCode: server.read_code, method: "label", space });
    }
    if (server.ok && server.candidates?.length) {
      idle();
      return go("search", { space, method: "label", query: server.codes?.[0] || "", candidates: server.candidates });
    }
    // 서버 인식이 없으면 브라우저 Tesseract로 폴백.
    const codes = await recognize(file, (p) => {
      if (p.status === "recognizing text") {
        document.querySelector("#loadingText").textContent = `기기에서 인식 ${Math.round((p.progress || 0) * 100)}%`;
      }
    });
    idle();
    if (codes.length) await identify(codes[0], "label", space);
    // 인식 실패 시 키보드가 올라와 토스트를 가리지 않도록 자동 포커스는 하지 않는다.
    else toast("코드를 찾지 못했습니다. 아래에서 직접 입력해 주세요.");
  } catch (error) {
    idle();
    toast(error.message, null, "danger");
  }
}

async function identify(code, method, space) {
  busy("자산을 찾는 중");
  try {
    const result = await api("/api/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    idle();
    if (result.asset) return go("confirm", { asset: result.asset, readCode: code, method, space });
    if (result.candidates.length) return go("search", { space, method, query: code, candidates: result.candidates });
    toast("일치하는 자산이 없습니다.");
  } catch (error) {
    idle();
    toast(error.message, null, "danger");
  }
}

// ── 인식 결과 확인 ──
VIEWS.confirm = async function confirm(params) {
  pageTitle.textContent = "인식 결과 확인";
  router.dirty = false;
  const asset = params.asset;
  const moved = params.space && asset.space !== params.space;

  app.innerHTML = `
    <section class="confirm">
      <div class="confirm-mark">${icon("check")}</div>
      <span class="eyebrow">코드 확인됨</span>
      <h2>${esc(asset.name)}</h2>
      <div class="read-code">인식한 코드 <b>${esc(params.readCode || asset.code)}</b></div>
      <dl>
        <div><dt>자산코드</dt><dd>${esc(asset.code)}</dd></div>
        <div><dt>자산분류</dt><dd>${esc(asset.category || "-")}</dd></div>
        <div><dt>등록 위치</dt><dd>${esc(asset.space)}</dd></div>
      </dl>
      ${moved ? `<div class="notice warning"><b>현재 공간과 등록 위치가 다릅니다.</b>
        <p>${esc(params.space)}에서 확인한 것으로 저장할 수 있습니다.</p></div>` : ""}
      ${asset.done ? `<div class="notice info"><b>이미 실사를 완료한 자산입니다.</b>
        <p>기존 내용을 수정할 수 있습니다.</p></div>` : ""}
    </section>
    <button class="primary-button" id="ok">이 자산이 맞습니다</button>
    <div class="button-row">
      <button class="secondary-button" id="other">다른 자산 선택</button>
      <button class="secondary-button" id="retry">${icon("camera")}<span>다시 촬영</span></button>
    </div>`;
  document.querySelector("#ok").onclick = () => go("asset", { code: asset.code, method: params.method, space: params.space });
  document.querySelector("#other").onclick = () => go("search", { space: params.space, method: params.method || "manual", query: params.readCode || "" });
  document.querySelector("#retry").onclick = () => history.back();
};

// ── 검색 ──
VIEWS.search = async function search(params) {
  pageTitle.textContent = params.method === "missing" ? "라벨 없이 자산 찾기" : "자산 확인";
  app.innerHTML = `
    <div class="search-intro">
      <b>${params.method === "missing" ? "자산 정보를 검색하세요" : "비슷한 코드가 있습니다"}</b>
      <p>${params.method === "missing" ? "자산명·코드·분류·부서와 초성으로 찾을 수 있습니다." : "실물의 라벨과 자산 정보를 비교해 선택하세요."}</p>
    </div>
    <label class="search-field large"><span>${icon("search")}</span>
      <input id="q" value="${esc(params.query || "")}" placeholder="예: 모니터, ㅁㄴㅌ, 1002031" aria-label="자산 검색">
      <button type="button" class="search-clear" id="qClear" aria-label="검색어 지우기" hidden>${icon("close")}</button></label>
    <div id="meta" class="search-meta" aria-live="polite"></div>
    <div class="asset-list" id="results"></div>
    <button class="load-more" id="more" hidden>더보기</button>`;

  const input = document.querySelector("#q");
  const clearBtn = document.querySelector("#qClear");
  const results = document.querySelector("#results");
  const meta = document.querySelector("#meta");
  const more = document.querySelector("#more");
  let timer, offset = 0, loading = false, serial = 0;
  const syncClear = () => { clearBtn.hidden = !input.value; };

  const bind = () => results.querySelectorAll(".asset-row[data-code]").forEach((b) => {
    b.dataset.method = params.method || "manual";
    b.dataset.space = params.space || "";
  });
  const draw = (items, append) => {
    if (!append) results.innerHTML = "";
    if (items.length) results.insertAdjacentHTML("beforeend", items.map(assetRow).join(""));
    else if (!append) results.innerHTML = `<div class="empty">일치하는 자산이 없습니다.</div>`;
    bind();
    bindRows(results);
  };
  const run = async (append = false) => {
    const q = input.value.trim();
    params.query = q;
    if (!q) {
      serial += 1; offset = 0; loading = false; meta.textContent = ""; more.hidden = true;
      results.innerHTML = `<div class="empty quiet">검색어를 입력하면 결과가 표시됩니다.</div>`;
      return;
    }
    if (append && loading) return;
    if (!append) { offset = 0; serial += 1; }
    const mine = serial;
    loading = true;
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}&offset=${offset}&limit=40`);
      if (mine !== serial || input.value.trim() !== q) return;
      draw(data.items, append);
      offset += data.items.length;
      meta.textContent = data.has_more ? `검색 결과 ${data.total}건 · ${offset}건 표시` : `검색 결과 ${data.total}건`;
      more.hidden = !data.has_more;
      more.textContent = `더보기 · ${offset}/${data.total}건`;
    } finally {
      if (mine === serial) loading = false;
    }
  };
  input.oninput = () => { syncClear(); clearTimeout(timer); timer = setTimeout(() => run(false), 180); };
  clearBtn.onclick = () => { input.value = ""; syncClear(); input.focus(); run(false); };
  more.onclick = () => run(true);
  syncClear();
  if (params.candidates) { meta.textContent = `비슷한 자산 ${params.candidates.length}건`; draw(params.candidates, false); more.hidden = true; }
  else if (params.query) await run(false);
};

// ── 실사 입력 ──
VIEWS.asset = async function assetView(params) {
  pageTitle.textContent = "실사 입력";
  router.dirty = false;
  app.innerHTML = `<div class="skeleton tall"></div>`;
  const data = await api(`/api/assets/${encodeURIComponent(params.code)}`);
  const asset = data.asset;
  const historyItems = params.admin
    ? (await api(`/api/admin/results/${encodeURIComponent(asset.code)}/history`)).items
    : [];
  const prev = asset.result;
  const quantity = prev?.actual_qty ?? asset.book_qty;
  const status = prev?.status || "활용";
  // 관리 화면에서는 이동 경로가 아니라 실제 저장된 실사 방법을 그대로 표시·보존한다.
  const surveyMethod = params.admin
    ? (prev?.method || params.method || "manual")
    : (params.method || prev?.method || "manual");
  const official = data.official_groups.flatMap((g) => g.spaces);
  const isOfficial = official.includes(asset.space);
  const currentLocation = prev?.confirmed_space || (official.includes(params.space) ? params.space : "");
  if (router.pendingPhoto && keepsPendingPhoto("asset", params)) router.pendingPhoto.code = asset.code;
  else if (router.pendingPhoto) router.pendingPhoto = null;

  app.innerHTML = `
    <section class="identity">
      <span class="eyebrow">${esc(methodLabel(surveyMethod))}</span>
      <h2>${esc(asset.name)}</h2>
      <div class="code-chip">${esc(asset.code)}</div>
      <dl>
        <div><dt>자산분류</dt><dd>${esc(asset.category || "-")}</dd></div>
        <div><dt>장부 수량</dt><dd>${asset.book_qty}</dd></div>
        <div><dt>등록 위치</dt><dd>${esc(asset.space)}</dd></div>
        ${asset.department ? `<div><dt>운용부서</dt><dd>${esc(asset.department)}</dd></div>` : ""}
        ${asset.acquired ? `<div><dt>취득일자</dt><dd>${esc(asset.acquired)}</dd></div>` : ""}
      </dl>
      ${prev ? `<div class="prev-note">최근 저장 ${esc((prev.updated_at || "").slice(5, 16))}</div>` : ""}
      ${data.photos.length ? `<div class="photos">${data.photos.map((p) =>
        `<button type="button" class="photo-thumb" data-photo="${esc(p.path)}"><img src="/api/photos/view/${encodeURIComponent(p.path)}" alt="실사 사진"></button>`).join("")}</div>` : ""}
    </section>
    ${params.admin ? auditHistorySection(historyItems) : ""}
    <form id="survey">
      <section class="card">
        <div class="field-title"><b>실사 수량</b><span id="diff"></span></div>
        <div class="stepper"><button type="button" id="minus" aria-label="감소">−</button>
          <input id="qty" type="number" min="0" value="${quantity}" inputmode="numeric" aria-label="실사 수량">
          <button type="button" id="plus" aria-label="증가">＋</button></div>
      </section>
      <section class="card">
        <div class="field-title"><b>실사 상태</b><span>하나를 선택하세요</span></div>
        <div class="status-options">
          ${["활용", "사용가능", "폐품"].map((value) => `
            <label class="status ${STATUS_CLASS[value]}">
              <input type="radio" name="status" value="${value}" ${status === value ? "checked" : ""}>
              <span><b>${esc(statusLabel(value))}</b><small>${statusHint(value)}</small></span></label>`).join("")}
        </div>
      </section>
      ${data.group.length > 1 ? groupSection(data.group, asset) : ""}
      <section class="card">
        <label class="field-title" for="location"><b>확인 위치</b>
          <span>${isOfficial ? "이동했을 때만 변경" : "실제 위치 선택 필수"}</span></label>
        <select id="location">
          <option value="">${isOfficial ? "등록 위치 그대로" : "실제 확인 위치를 선택하세요"}</option>
          ${data.official_groups.map((g) => `<optgroup label="${esc(g.floor)}">${
            g.spaces.map((s) => `<option value="${esc(s)}" ${currentLocation === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <label class="field-title reason" for="reason"><b>사유</b><span>수량 차이·불용 시 작성</span></label>
        <textarea id="reason" rows="3" placeholder="필요한 경우 사유를 입력하세요">${esc(prev?.reason || "")}</textarea>
      </section>
      <button class="primary-button">${prev ? "변경 내용 저장" : "실사 완료 저장"}</button>
    </form>
    ${params.admin && prev
      ? `<p class="admin-delete-row"><span class="admin-delete-text" id="adminDeleteResult" role="button" tabindex="0">실사 결과 삭제</span></p>`
      : ""}`;

  setupSurveyForm(data, asset, prev, isOfficial, official, params, surveyMethod);
  if (params.admin && prev) setupAdminDelete(data, asset);
};

function auditHistorySection(items) {
  const actionLabel = { save: "실사 저장", delete: "실사 삭제", restore: "이전 상태 복원" };
  return `<section class="card audit-card">
    <details class="audit-history">
      <summary><span class="audit-heading"><b>변경 이력</b><small>${items.length}건</small></span>
        <span class="audit-trigger">이력 보기 ${icon("chevron")}</span></summary>
      <div class="audit-list">${items.length ? items.map((item) => {
        const fields = item.actual_qty == null ? [] : [
          ["실사 방법", methodLabel(item.method)],
          ["실사 상태", statusLabel(item.status)],
          ["실사 수량", `${item.actual_qty}`],
          ["과부족", `${item.difference > 0 ? "+" : ""}${item.difference ?? 0}`],
          ["확인 위치", item.confirmed_space || "등록 위치"],
          ["사유", item.reason || "없음"],
        ];
        return `<div class="audit-item">
          <div class="audit-item-head"><b>${esc(actionLabel[item.action] || item.action)}</b>
            <time>${esc((item.at || "").slice(0, 19))}</time></div>
          ${fields.length ? `<dl class="audit-fields">${fields.map(([label, value]) =>
            `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`
            : `<p class="audit-empty-detail">저장된 실사 결과를 삭제했습니다.</p>`}
        </div>`;
      }).join("") : `<div class="empty quiet">변경 이력이 없습니다.</div>`}</div>
    </details>
  </section>`;
}

function setupAdminDelete(data, asset) {
  const deleteText = document.querySelector("#adminDeleteResult");
  if (!deleteText) return;
  const openDelete = async () => {
    const completed = data.group.filter((item) => item.done && item.result);
    const siblings = completed.filter((item) => item.code !== asset.code);
    let codes = [asset.code];
    if (siblings.length) {
      const choice = await choose("실사 결과 삭제",
        `같은 품목 중 완료된 항목이 <b>${siblings.length}개</b> 더 있습니다.<br>삭제 범위를 선택해 주세요.`,
        [{ label: "이 항목만 삭제", value: "one", variant: "danger" },
         { label: `같은 품목 모두 삭제 (${completed.length}개)`, value: "group", variant: "danger" },
         { label: "닫기", value: null, variant: "muted" }]);
      if (!choice) return;
      if (choice === "group") codes = completed.map((item) => item.code);
    } else {
      const ok = await choose("실사 결과 삭제",
        "이 자산의 실사 결과를 삭제할까요?<br>삭제하면 다시 미실사 상태가 됩니다.",
        [{ label: "삭제", value: true, variant: "danger" },
         { label: "닫기", value: false, variant: "muted" }]);
      if (!ok) return;
    }
    const resultByCode = new Map(completed.map((item) => [item.code, item.result]));
    busy("삭제하는 중");
    try {
      const changed = await api("/api/admin/results/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codes, action: "delete", device: deviceLabel(),
          expected_updated_at: Object.fromEntries(codes.map((code) =>
            [code, resultByCode.get(code)?.updated_at || null])),
        }),
      });
      idle();
      router.dirty = false;
      toast(`${changed.count}건의 실사 결과를 삭제했습니다.`, {
        label: "취소", appearance: "success", onClick: () => restoreResults(changed.undo_token, render),
      });
      history.back();
    } catch (error) {
      idle();
      toast(error.message, null, "danger");
    }
  };
  deleteText.onclick = openDelete;
  deleteText.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDelete();
  };
}

function statusHint(value) {
  return value === "활용" ? "현재 실제로 사용 중인 물품"
    : value === "사용가능" ? "사용할 수 있지만 운용부서에 불필요한 물품"
      : "사용하지 않으며 앞으로도 사용할 수 없는 물품";
}

function groupSection(group, asset) {
  return `<section class="card">
    <div class="field-title"><b>같은 품목 함께 처리</b>
      <label class="select-all"><input type="checkbox" id="selectAll"> 전체 선택</label></div>
    <p class="field-help">수량을 늘리면 일련번호 순서대로 자동 선택됩니다. 실물로 확인한 코드만 남겨주세요.</p>
    <div class="group-codes">${group.map((item) => `
      <label class="${item.done ? "is-done" : ""}">
        <input type="checkbox" name="group" value="${esc(item.code)}" data-book="${item.book_qty}"
          ${item.done ? 'data-done="1"' : ""} ${item.code === asset.code ? "checked disabled" : ""}>
        <span>${esc(item.code)}${item.code === asset.code ? " · 현재"
          : item.done ? ` · 완료${item.effective_space ? ` · ${esc(item.effective_space)}` : ""}` : ""}</span></label>`).join("")}</div>
  </section>`;
}

function setupSurveyForm(data, asset, prev, isOfficial, official, params, surveyMethod) {
  const doneCodes = new Set(data.group.filter((i) => i.done).map((i) => i.code));
  const doneSpace = new Map(data.group.filter((i) => i.done).map((i) => [i.code, i.effective_space || ""]));
  const previousByCode = new Map([[asset.code, prev || null]]);
  data.group.forEach((item) => previousByCode.set(item.code, item.result || null));
  // 실사 사진: 팝업(라이트박스)으로 크게 본다. 여러 장이면 넘겨 볼 수 있다(검토 10).
  const photoThumbs = [...document.querySelectorAll(".photo-thumb[data-photo]")];
  const photoUrls = photoThumbs.map((b) => `/api/photos/view/${encodeURIComponent(b.dataset.photo)}`);
  photoThumbs.forEach((btn, i) => { btn.onclick = () => openImageOverlay(photoUrls, i); });
  const qty = document.querySelector("#qty");
  const diff = document.querySelector("#diff");
  const statusRadios = [...document.querySelectorAll('input[name="status"]')];
  const locationSel = document.querySelector("#location");
  const groupInputs = () => [...document.querySelectorAll('input[name="group"]')];
  const selectedCodes = () => [asset.code, ...groupInputs().filter((i) => i.checked && !i.disabled).map((i) => i.value)];
  const selectedBook = () => asset.book_qty + groupInputs().filter((i) => i.checked && !i.disabled)
    .reduce((sum, i) => sum + Number(i.dataset.book || 0), 0);

  const update = () => {
    const total = Number(qty.value || 0);
    const d = total - selectedBook();
    diff.textContent = d === 0 ? "장부 수량과 일치" : `과부족 ${d > 0 ? "+" : ""}${d}`;
    diff.className = d === 0 ? "match" : "mismatch";
    // 실사 수량이 0이면 실사 상태·확인 위치를 지정할 수 없다(위치 없이 저장).
    const noQty = total === 0;
    statusRadios.forEach((r) => {
      r.disabled = noQty;
      if (noQty) r.checked = false;
      r.closest(".status")?.classList.toggle("is-disabled", noQty);
    });
    if (locationSel) {
      locationSel.disabled = noQty;
      if (noQty) locationSel.value = "";
    }
    router.dirty = true;
  };
  const syncSelectAll = () => {
    const enabled = groupInputs().filter((i) => !i.disabled);
    const all = document.querySelector("#selectAll");
    if (all) all.checked = enabled.length > 0 && enabled.every((i) => i.checked);
  };
  const autoSelect = () => {
    const list = groupInputs();
    if (!list.length) return;
    let current = list.findIndex((i) => i.disabled);
    if (current < 0) current = 0;
    const order = [];
    for (let step = 1; step < list.length; step += 1) order.push((current + step) % list.length);
    const undone = order.filter((idx) => !list[idx].dataset.done);
    const checkedDone = list.filter((i) => !i.disabled && i.dataset.done && i.checked).length;
    const budget = Math.max(0, Math.min(Number(qty.value || 0) - 1 - checkedDone, undone.length));
    const picked = new Set(undone.slice(0, budget));
    list.forEach((input, idx) => {
      if (!input.disabled && !input.dataset.done) input.checked = picked.has(idx);
    });
    syncSelectAll();
  };

  const refresh = () => { autoSelect(); update(); };
  qty.oninput = refresh;
  document.querySelector("#minus").onclick = () => { qty.value = Math.max(0, Number(qty.value || 0) - 1); refresh(); };
  document.querySelector("#plus").onclick = () => { qty.value = Number(qty.value || 0) + 1; refresh(); };
  document.querySelectorAll("input,select,textarea").forEach((el) => { el.addEventListener("change", () => { router.dirty = true; }); });
  groupInputs().filter((i) => !i.disabled).forEach((input) => {
    input.onchange = () => { qty.value = groupInputs().filter((i) => i.checked).length; syncSelectAll(); update(); };
  });
  const selectAll = document.querySelector("#selectAll");
  if (selectAll) selectAll.onchange = async (event) => {
    if (!event.target.checked) {
      groupInputs().filter((i) => !i.disabled).forEach((i) => { i.checked = false; });
      qty.value = groupInputs().filter((i) => i.checked).length;
      syncSelectAll(); update();
      return;
    }
    // 완료 항목이 있으면 포함 여부를 묻는다.
    const hasDone = groupInputs().some((i) => !i.disabled && i.dataset.done);
    let mode = "all";
    if (hasDone) {
      mode = await choose("전체 선택", "이미 실사한 항목도 함께 선택할까요?", [
        { label: "실사한 항목은 제외하고 선택", value: "pending" },
        { label: "상관없이 모두 선택", value: "all" },
        { label: "취소", value: null, variant: "muted" },
      ]);
      if (!mode) { event.target.checked = false; return; }
    }
    groupInputs().filter((i) => !i.disabled && (mode === "all" || !i.dataset.done))
      .forEach((i) => { i.checked = true; });
    qty.value = groupInputs().filter((i) => i.checked).length;
    syncSelectAll(); update();
  };
  refresh();
  router.dirty = false;

  document.querySelector("#survey").onsubmit = async (event) => {
    event.preventDefault();
    const status = new FormData(event.currentTarget).get("status") || "";  // 미선택(수량0) → "" (망실)
    const actual = Number(qty.value || 0);
    const reason = document.querySelector("#reason").value.trim();
    const location = document.querySelector("#location").value;
    // 실사 수량이 있는데 상태를 고르지 않았으면 저장 대화상자 대신 안내만 띄운다.
    if (actual > 0 && !status) return toast("실사 상태를 선택해 주세요.");
    let codes = selectedCodes();
    // 사유는 선택 사항 — 수량 차이·불용이어도 입력하지 않고 저장할 수 있다.
    // 수량 0(망실)은 위치 없이 저장하므로 위치 필수 검사를 건너뛴다.
    if (actual > 0 && !isOfficial && !location) {
      document.querySelector("#location").focus();
      return toast("실제 확인 위치를 선택하세요.");
    }
    // 같은 품목 일괄 처리 시, 이미 완료된 항목이 포함되면 개별로 알리고 제외/덮어쓰기를 고른다.
    const includedDone = codes.filter((c) => c !== asset.code && doneCodes.has(c));
    if (includedDone.length) {
      const list = includedDone
        .map((c) => `<div><span>${esc(c)}</span><strong>${esc(doneSpace.get(c) || "위치 미상")}</strong></div>`).join("");
      const decision = await choose("이미 완료된 항목이 있습니다",
        `<p>선택한 항목 중 <b>${includedDone.length}개</b>는 이미 실사가 완료되었습니다. 확인한 위치는 다음과 같습니다.</p>
         <div class="summary">${list}</div>`,
        [{ label: "완료 항목은 제외하고 저장", value: "exclude" },
         { label: "그대로 덮어쓰기", value: "overwrite", variant: "danger" },
         { label: "닫기", value: null, variant: "muted" }]);
      if (!decision) return;
      if (decision === "exclude") codes = codes.filter((c) => !includedDone.includes(c));
    }
    const ok = await choose("실사 내용을 저장할까요?", `<div class="summary">
      <div><span>자산</span><strong>${esc(asset.name)} · ${esc(asset.code)}</strong></div>
      <div><span>수량</span><strong>${actual}</strong></div>
      <div><span>상태</span><strong>${esc(statusLabel(status))}</strong></div>
      <div><span>위치</span><strong>${esc(location || asset.space)}</strong></div>
      ${codes.length > 1 ? `<div><span>완료 항목</span><strong>${codes.length}개 자산</strong></div>` : ""}
    </div>`, [{ label: prev ? "변경 저장" : "실사 완료 저장", value: true }, { label: "다시 확인", value: false, variant: "muted" }]);
    if (!ok) return;

    busy("실사 결과를 저장하는 중");
    try {
      const expectedUpdatedAt = Object.fromEntries(codes.map((code) =>
        [code, previousByCode.get(code)?.updated_at || null]));
      const savedResult = await api("/api/results", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codes, primary_code: asset.code, actual_qty: actual, status: status || "", reason,
          confirmed_space: location, method: surveyMethod,
          device: deviceLabel(), expected_updated_at: expectedUpdatedAt,
        }),
      });
      const pendingPhoto = router.pendingPhoto;
      router.pendingPhoto = null;
      idle();
      router.dirty = false;
      const hasPhoto = pendingPhoto?.code === asset.code;
      if (hasPhoto) {
        // 핵심 실사 결과는 저장을 확인한 뒤 이동하고, 상대적으로 느린 사진만 백그라운드에서 올린다.
        toast(`${codes.length}건의 실사는 저장했습니다. 사진 업로드 중…`, {
          appearance: "info", duration: 0,
        });
      } else {
        // 서버가 발급한 일회용 토큰으로 신규 저장은 삭제하고, 수정은 이전 값으로 복원한다.
        toast(`${codes.length}건의 실사를 저장했습니다.`, {
          label: "취소", appearance: "success",
          onClick: () => undoJustSaved(savedResult.undo_token),
        });
      }
      // 촬영·코드입력 흐름은 인식 결과 확인 화면을 거치므로, 저장 후 그 화면이 아니라
      // 해당 공간의 자산 목록으로 돌아간다.
      returnToSpace(params.space);
      if (hasPhoto) {
        void uploadSavedPhoto(pendingPhoto, asset.code, codes.length, savedResult.undo_token);
      }
    } catch (error) {
      idle();
      toast(error.message, null, "danger");
    }
  };
}

// 실사 결과 저장 뒤 사진만 별도로 전송한다. 실패해도 실사 데이터는 유지하며 같은 파일로 재시도할 수 있다.
async function uploadSavedPhoto(pendingPhoto, code, savedCount, undoToken) {
  try {
    const form = new FormData();
    form.append("image", pendingPhoto.file);
    await api(`/api/photos/${encodeURIComponent(code)}`, { method: "POST", body: form });
    toast(`${savedCount}건의 실사와 사진을 저장했습니다.`, {
      label: "취소", appearance: "success",
      onClick: () => undoJustSaved(undoToken),
    });
  } catch (_) {
    toast("실사는 저장했지만 사진 업로드에 실패했습니다.", {
      label: "다시 시도", appearance: "warning", duration: 0,
      onClick: () => {
        toast("사진 업로드를 다시 시도하고 있습니다…", { appearance: "info", duration: 0 });
        void uploadSavedPhoto(pendingPhoto, code, savedCount, undoToken);
      },
    });
  }
}

// 저장 후 이동: 스택에 해당 공간 화면이 있으면 거기로(인식 결과 확인 화면은 건너뜀).
function returnToSpace(space) {
  if (space) {
    let target = -1;
    for (let i = router.index; i >= 0; i -= 1) {
      const entry = router.stack[i];
      if (entry.view === "space" && entry.params.space === space) { target = i; break; }
    }
    if (target >= 0) { history.go(target - router.index); return; }
    router.dirty = false;
    return go("space", { space });
  }
  history.back();
}

// 관리자 일괄 작업도 서버가 발급한 일회용 토큰으로 원자적으로 되돌린다.
async function restoreResults(token, done) {
  busy("되돌리는 중");
  try {
    const restored = await api("/api/results/undo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, device: deviceLabel() }),
    });
    idle();
    toast(`${restored.count}건을 이전 상태로 복구했습니다.`, null, "success");
    if (done) done();
  } catch (error) {
    idle();
    toast(error.message, null, "danger");
  }
}

// 저장 직후 토스트의 "취소" — 방금 저장한 코드들을 되돌린다.
async function undoJustSaved(token) {
  busy("되돌리는 중");
  try {
    const restored = await api("/api/results/undo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, device: deviceLabel() }),
    });
    idle();
    toast(`${restored.count}건을 저장 전 상태로 되돌렸습니다.`, null, "success");
    render();
  } catch (error) {
    idle();
    toast(error.message, null, "danger");
  }
}

// ── 관리자 로그인 ──
VIEWS.adminLogin = async function adminLogin() {
  pageTitle.textContent = "관리";
  router.dirty = false;
  let passkeyOn = false;
  if (passkey.supported()) {
    try { passkeyOn = Boolean((await api("/api/health")).passkey); } catch (_) { passkeyOn = false; }
  }
  app.innerHTML = `
    <div class="admin-login">
      <h2>관리자 확인</h2>
      <p>전체 진행 현황과 재물조사표를 확인합니다.</p>
      <form id="adminForm">
        <input id="adminCode" type="password" inputmode="numeric" placeholder="관리자 코드" aria-label="관리자 코드">
        <button class="primary-button">관리 페이지 열기</button>
      </form>
      ${passkeyOn ? `<div class="divider"><span>또는</span></div>
        <button class="secondary-button wide" id="passkeyLogin">패스키로 열기</button>` : ""}
      <div class="form-error" id="adminError" role="alert" aria-live="assertive"></div>
    </div>`;
  document.querySelector("#adminForm").onsubmit = async (event) => {
    event.preventDefault();
    const field = document.querySelector("#adminCode");
    const form = new FormData();
    form.append("code", field.value.trim());
    busy("확인하는 중");
    try {
      await api("/api/admin/session", { method: "POST", body: form });
      idle(); replace("admin");
    } catch (error) {
      idle();
      document.querySelector("#adminError").textContent = error.message;
      field.value = ""; field.focus();   // 잘못 입력한 코드를 비워 다시 입력하기 쉽게 한다.
    }
  };
  const passkeyLogin = document.querySelector("#passkeyLogin");
  if (passkeyLogin) passkeyLogin.onclick = async () => {
    busy("패스키 확인 중");
    try { await passkey.authenticate(); idle(); replace("admin"); }
    catch (error) { idle(); document.querySelector("#adminError").textContent = passkey.errorMessage(error); }
  };
};

// ── 관리 대시보드 ──
VIEWS.admin = async function admin() {
  pageTitle.textContent = "관리 현황";
  router.dirty = false;
  app.innerHTML = `<div class="skeleton tall"></div>`;
  let data, passkeys;
  try {
    [data, passkeys] = await Promise.all([api("/api/admin/dashboard"), api("/api/admin/passkeys")]);
  } catch (_) {
    return replace("adminLogin");
  }
  const s = data.summary;
  const metricCard = (label, value, detail, kind, key) =>
    `<button class="metric ${kind || ""}" ${key ? `data-filter="${key}"` : "disabled"}>
      <span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></button>`;

  app.innerHTML = `<div class="admin-dashboard">
    <div class="admin-head"><div><span class="eyebrow">관리 대시보드</span><h2>전체 재물조사</h2></div>
      <button class="ghost-button" id="refresh">새로고침</button></div>
    <button class="score" id="scoreLink" aria-label="전체 실사 내역 보기">
      <div><span>전체 진행률</span><strong>${s.percent}%</strong><small>${s.done}/${s.total}건 완료 · 전체 내역 보기 ${icon("chevron")}</small></div>
      <div class="ring" style="--percent:${s.percent}"><i>${s.remaining}</i><small>남음</small></div>
    </button>
    <div class="metrics">
      ${metricCard("오늘 실사", `${s.today}건`, "오늘 저장", "", "today")}
      ${metricCard("수량 차이", `${data.issues.difference}건`, `부족 ${data.issues.shortage} · 초과 ${data.issues.surplus}`, "warn", "difference")}
      ${metricCard("위치 변경", `${data.issues.moved}건`, "등록 위치와 다름", "", "moved")}
      ${metricCard("불용 대상", `${data.issues.disposal}건`, "사용가능·폐품", "warn", "disposal")}
      ${metricCard("사유 작성", `${data.issues.with_reason}건`, "내용 확인", "", "reason")}
      ${metricCard("라벨 없음", `${data.issues.missing_label}건`, "검색으로 확인", "", "missing")}
    </div>
    <section class="card">
      <div class="section-head"><h2>실사 상태</h2><span>${s.done}건</span></div>
      ${[["활용", "활용"], ["사용가능", "불용대상 · 사용가능"], ["폐품", "불용대상 · 폐품"],
         ...(data.statuses[""] ? [["", "망실"]] : [])].map(([value, label]) => {
        const count = data.statuses[value] || 0;
        const percent = s.done ? Math.round((count / s.done) * 100) : 0;
        return `<button class="bar-row ${STATUS_CLASS[value] || (value === "" ? "lost" : "")}" data-kind="status" data-value="${value}" data-label="${label}">
          <span><b>${label}</b><small>${count}건 · ${percent}%</small></span><i><em style="width:${percent}%"></em></i></button>`;
      }).join("")}
    </section>
    <section class="card">
      <div class="section-head"><h2>공간 진행</h2><span>공간 기준</span></div>
      <div class="space-summary">
        <button data-space-state="complete" data-label="완료 공간"><b>${data.space_summary.complete}</b><span>완료</span></button>
        <button data-space-state="in_progress" data-label="진행 중 공간"><b>${data.space_summary.in_progress}</b><span>진행 중</span></button>
        <button data-space-state="not_started" data-label="미시작 공간"><b>${data.space_summary.not_started}</b><span>미시작</span></button>
      </div>
      <div class="floor-progress">${data.floor_progress.map((f) =>
        `<button data-floor="${esc(f.floor)}"><span><b>${esc(f.floor)}</b><small>${f.done}/${f.total}건</small></span>
          <i><em style="width:${f.percent}%"></em></i><strong>${f.percent}%</strong></button>`).join("")}</div>
    </section>
    <section class="card">
      <div class="section-head"><h2>최근 실사</h2><button class="text-button" id="recentResults">더보기</button></div>
      <div class="recent">${data.recent.length ? data.recent.map((item) =>
        `<button data-recent="${esc(item.code)}"><span class="left"><b>${esc(item.name)}</b>
          <small>${esc(item.code)} · ${esc(item.confirmed_space || item.space)}</small></span>
          <span class="right"><b class="status-tag status-${STATUS_CLASS[item.status] || ""}">${esc(statusShort(item.status))}</b><small>${esc((item.updated_at || "").slice(5, 16))}</small></span></button>`).join("")
        : `<div class="empty">아직 실사 내역이 없습니다.</div>`}</div>
    </section>
    ${passkeys.enabled ? `<section class="card passkeys">
      <div class="section-head"><h2>관리자 패스키</h2><span>${passkeys.items.length}개</span></div>
      <p class="field-help">지문·Face ID 또는 기기 잠금으로 관리 페이지를 엽니다.</p>
      <div class="passkey-list">${passkeys.items.map((p) =>
        `<div><span><b>${esc(p.name)}</b><small>등록 ${esc((p.created_at || "").slice(0, 10))}</small></span>
          <button class="text-danger" data-del="${p.id}">삭제</button></div>`).join("")}</div>
      <button class="load-more" id="addPasskey">이 기기에 패스키 등록</button>
    </section>` : ""}
    ${DEMO ? "" : `<button class="secondary-button wide" id="setupBtn">기관 설정 · 백업</button>`}
    <button class="primary-button export" id="exportBtn"><span>전체 재물조사표 내려받기</span>${icon("download")}</button>
    </div>`;

  document.querySelector("#refresh").onclick = () => VIEWS.admin();
  document.querySelector("#scoreLink").onclick = () => go("adminTable", { label: "전체 실사 내역" });
  document.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => go("adminList", { kind: b.dataset.filter, label: b.querySelector("span").textContent }));
  document.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => go("adminList", { kind: b.dataset.kind, value: b.dataset.value, label: b.dataset.label }));
  document.querySelectorAll("[data-space-state]").forEach((b) => b.onclick = () => go("adminSpaces", { state: b.dataset.spaceState, label: b.dataset.label }));
  document.querySelectorAll("[data-floor]").forEach((b) => b.onclick = () => go("adminSpaces", { floor: b.dataset.floor, label: `${b.dataset.floor} 공간 진행` }));
  document.querySelectorAll("[data-recent]").forEach((b) => b.onclick = () => go("asset", { code: b.dataset.recent, admin: true }));
  document.querySelector("#recentResults").onclick = () => go("adminList", { kind: "all", label: "최근 실사" });
  const setupBtn = document.querySelector("#setupBtn");
  if (setupBtn) setupBtn.onclick = () => { location.href = "/setup"; };
  document.querySelector("#exportBtn").onclick = async () => {
    const scope = await choose("재물조사표 내려받기", "엑셀에 어떤 자산을 넣을까요?", [
      { label: "실사한 자산만", value: "surveyed" },
      { label: "전체 자산", value: "all" },
      { label: "취소", value: null, variant: "muted" },
    ]);
    if (!scope) return;
    downloadExport(scope);
  };
  const addPasskey = document.querySelector("#addPasskey");
  if (addPasskey) addPasskey.onclick = async () => {
    busy("패스키 등록 중");
    try { await passkey.register(); idle(); toast("패스키를 등록했습니다.", null, "success"); VIEWS.admin(); }
    catch (error) { idle(); toast(passkey.errorMessage(error), null, "danger"); }
  };
  document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    const ok = await choose("패스키 삭제", "이 패스키를 관리자 인증 목록에서 삭제할까요?",
      [{ label: "삭제", value: true, variant: "danger" }, { label: "닫기", value: false, variant: "muted" }]);
    if (!ok) return;
    await api(`/api/admin/passkeys/${b.dataset.del}`, { method: "DELETE" });
    toast("패스키를 삭제했습니다.", null, "success"); VIEWS.admin();
  });
};

// ── 관리 상세 목록 ──
VIEWS.adminList = async function adminList(params) {
  pageTitle.textContent = params.label || "실사 내역";
  let offset = 0, loading = false;
  app.innerHTML = `<div class="section-head"><h2>${esc(params.label || "실사 내역")}</h2><span id="total"></span></div>
    <div class="asset-list" id="items"></div><button class="load-more" id="more">더보기</button>`;
  const load = async () => {
    if (loading) return;
    loading = true;
    const data = await api(`/api/admin/results?kind=${encodeURIComponent(params.kind || "all")}&value=${encodeURIComponent(params.value || "")}&offset=${offset}&limit=20`);
    document.querySelector("#total").textContent = `${data.total}건`;
    document.querySelector("#items").insertAdjacentHTML("beforeend", data.items.map((item) => {
      const moved = item.effective_space && item.space && item.effective_space !== item.space;
      const place = moved ? `${esc(item.space)} → ${esc(item.effective_space)}` : esc(item.effective_space);
      return `<button class="admin-result admin-result-main" data-code="${esc(item.code)}"><span class="left"><b>${esc(item.name)}</b>
          <small>${esc(item.code)} · ${place}</small></span>
          <span class="right"><b class="status-tag status-${STATUS_CLASS[item.status] || ""}">${esc(statusShort(item.status))}</b><small>장부 ${item.book_qty} · 실사 ${item.actual_qty}${item.difference ? ` · ${item.difference > 0 ? "+" : ""}${item.difference}` : ""}</small></span>
          ${item.reason ? `<em>${esc(item.reason)}</em>` : ""}</button>`;
    }).join(""));
    offset += data.items.length;
    const more = document.querySelector("#more");
    more.hidden = !data.has_more;
    more.textContent = `더보기 · ${offset}/${data.total}건`;
    document.querySelectorAll(".admin-result-main:not([data-bound])").forEach((b) => {
      b.dataset.bound = "1";
      b.onclick = () => go("asset", { code: b.dataset.code, admin: true });
    });
    loading = false;
  };
  document.querySelector("#more").onclick = load;
  await load();
};

// ── 관리 공간 목록 ──
VIEWS.adminSpaces = async function adminSpaces(params) {
  pageTitle.textContent = params.label || "공간 진행";
  app.innerHTML = `<div class="section-head"><h2>${esc(params.label || "공간 진행")}</h2><span id="total"></span></div>
    <div class="asset-list" id="items"></div>`;
  const data = await api(`/api/admin/spaces?state=${encodeURIComponent(params.state || "")}&floor=${encodeURIComponent(params.floor || "")}`);
  document.querySelector("#total").textContent = `${data.total}곳`;
  const label = { complete: "완료", in_progress: "진행 중", not_started: "미시작" };
  document.querySelector("#items").innerHTML = data.items.length ? data.items.map((item) =>
    `<button class="space-admin" data-space="${esc(item.name)}"><span><small>${esc(item.floor)}</small><b>${esc(item.name)}</b></span>
      <span class="right"><b>${item.done}/${item.total}건</b><small>${label[item.state]} · ${item.percent}%</small></span>
      <i><em style="width:${item.percent}%"></em></i></button>`).join("") : `<div class="empty">해당하는 공간이 없습니다.</div>`;
  document.querySelectorAll("[data-space]").forEach((b) => b.onclick = () => go("space", { space: b.dataset.space }));
};

// ── 전체 실사 내역 (표 · 검색/필터/정렬) ──
const TABLE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "difference", label: "수량 차이" },
  { key: "moved", label: "위치 변경" },
  { key: "disposal", label: "불용 대상" },
  { key: "reason", label: "사유 작성" },
  { key: "missing", label: "라벨 없음" },
  { key: "status:활용", label: "활용" },
  { key: "status:사용가능", label: "사용가능" },
  { key: "status:폐품", label: "폐품" },
  { key: "pending", label: "미실사" },
];
// 표 컬럼 정의 — 정렬 키와 비교 함수.
// 숫자 정렬: 값이 없는(미실사) 행은 NaN 대신 한쪽 끝으로 모은다(오름차순에서 맨 앞).
const numCmp = (x, y) => (x == null && y == null) ? 0 : x == null ? -1 : y == null ? 1 : x - y;
// 확인 위치: 미실사 행은 셀이 빈칸이므로 정렬도 빈 값으로 취급(등록 위치로 끼어들지 않게).
const effLoc = (r) => r.surveyed === false ? "" : String(r.effective_space || "");
const TABLE_COLUMNS = [
  { key: "name", label: "자산명", cls: "name", get: (r) => r.name, cmp: (a, b) => String(a.name).localeCompare(String(b.name), "ko") },
  { key: "code", label: "코드", cls: "mono", get: (r) => r.code, cmp: (a, b) => String(a.code).localeCompare(String(b.code)) },
  { key: "status", label: "상태", get: (r) => r.status, cmp: (a, b) => STATUS_ORDER(a.status) - STATUS_ORDER(b.status) },
  { key: "book_qty", label: "장부", cls: "num", get: (r) => r.book_qty, cmp: (a, b) => a.book_qty - b.book_qty },
  { key: "actual_qty", label: "실사", cls: "num", get: (r) => r.actual_qty, cmp: (a, b) => numCmp(a.actual_qty, b.actual_qty) },
  { key: "difference", label: "과부족", cls: "num", get: (r) => r.difference, cmp: (a, b) => numCmp(a.difference, b.difference) },
  { key: "space", label: "등록 위치", get: (r) => r.space, cmp: (a, b) => String(a.space).localeCompare(String(b.space), "ko") },
  { key: "effective_space", label: "확인 위치", get: (r) => r.effective_space, cmp: (a, b) => effLoc(a).localeCompare(effLoc(b), "ko") },
  { key: "reason", label: "사유", cls: "reason", get: (r) => r.reason, cmp: (a, b) => String(a.reason).localeCompare(String(b.reason), "ko") },
  { key: "updated_at", label: "저장 시각", cls: "mono", get: (r) => r.updated_at, cmp: (a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) },
];
const STATUS_ORDER = (s) => ({ 활용: 0, 사용가능: 1, 폐품: 2 }[s] ?? 9);
const PAGE_SIZES = [25, 50, 100, 0]; // 0 = 전체

VIEWS.adminTable = async function adminTable(params) {
  pageTitle.textContent = params.label || "전체 실사 내역";
  router.dirty = false;
  app.innerHTML = `<div class="skeleton tall"></div>`;
  let data, locationData;
  try {
    [data, locationData] = await Promise.all([api("/api/admin/results/all"), api("/api/admin/locations")]);
  } catch (_) {
    return replace("adminLogin");
  }
  const rows = data.items;
  const locationGroups = locationData.groups;
  const today = data.today;

  // 화면 상태(정렬·페이지·검색·필터·선택)는 라우트 파라미터(params)에 얹어 보존한다.
  // 자산 상세로 들어갔다 뒤로 나와도 지정했던 페이지·검색·정렬이 초기화되지 않는다.
  // sort가 비어 있으면 최신 저장순(updated_at desc)이 기본. 헤더를 처음 누르면 그 열이 1순위가 된다.
  const saved = params._table;
  const state = {
    sort: Array.isArray(saved?.sort) ? saved.sort : [],
    page: saved?.page || 1,
    pageSize: saved?.pageSize ?? 50,
    search: saved?.search || "",
    filter: saved?.filter || "all",
    includePending: Boolean(saved?.includePending),  // 미실사 자산 포함 여부
    // 새로고침(sessionStorage 직렬화) 후에는 Set이 사라지므로 안전하게 복구한다.
    selected: saved?.selected instanceof Set ? saved.selected : new Set(),
  };
  params._table = state; // 이후 이 객체를 그대로 갱신 → 뒤로가기 시 같은 상태로 복원

  app.innerHTML = `
    <div class="section-head"><h2>${esc(params.label || "전체 실사 내역")}</h2><span id="tableCount"></span></div>
    <div class="table-toolbar">
      <div class="table-controls">
        <label class="search-field"><span>${icon("search")}</span>
          <input id="tableSearch" placeholder="자산명·코드·규격·위치·사유 검색" autocomplete="off" aria-label="실사 내역 검색">
          <button type="button" class="search-clear" id="tableSearchClear" aria-label="검색어 지우기" hidden>${icon("close")}</button></label>
        <div class="control-group">
          <select id="tableFilter" aria-label="보기">${TABLE_FILTERS.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}</select>
          <select id="tablePageSize" aria-label="표시 개수">${PAGE_SIZES.map((n) => `<option value="${n}"${n === 50 ? " selected" : ""}>${n ? `${n}개씩` : "전체"}</option>`).join("")}</select>
          <label class="pending-toggle"><input type="checkbox" id="tablePending"> 미실사 포함</label>
        </div>
      </div>
      <div class="bulk-bar" id="bulkBar" hidden>
        <span id="bulkCount"></span>
        <div class="bulk-actions">
          <button type="button" class="secondary-button" id="bulkStatus">상태 변경</button>
          <button type="button" class="secondary-button" id="bulkLocation">위치 변경</button>
          <button type="button" class="secondary-button danger" id="bulkDelete">${icon("trash")}<span>삭제</span></button>
        </div>
      </div>
    </div>
    <div class="table-scroll">
      <table class="result-table">
        <thead><tr>
          <th class="check"><input type="checkbox" id="checkAll" aria-label="현재 페이지 모두 선택"></th>
          ${TABLE_COLUMNS.map((c) => `<th class="sortable ${c.cls || ""}" data-key="${c.key}"><button type="button" class="sort-button" aria-label="${c.label} 정렬">${c.label}<i class="sort-ind"></i></button></th>`).join("")}
          <th class="act">삭제</th>
        </tr></thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>
    <div class="empty" id="tableEmpty" hidden>조건에 맞는 실사 내역이 없습니다.</div>
    <div class="pager" id="pager"></div>`;

  const search = document.querySelector("#tableSearch");
  const searchClear = document.querySelector("#tableSearchClear");
  const filter = document.querySelector("#tableFilter");
  const pageSizeSel = document.querySelector("#tablePageSize");
  const body = document.querySelector("#tableBody");
  const count = document.querySelector("#tableCount");
  const empty = document.querySelector("#tableEmpty");
  const pager = document.querySelector("#pager");
  const checkAll = document.querySelector("#checkAll");
  const bulkBar = document.querySelector("#bulkBar");
  const pendingToggle = document.querySelector("#tablePending");

  // 보존된 상태를 입력 요소에 반영(뒤로가기·새로고침 복원).
  search.value = state.search;
  filter.value = state.filter;
  pageSizeSel.value = String(state.pageSize);
  pendingToggle.checked = state.includePending;

  const passesFilter = (r) => {
    const key = filter.value;
    if (key === "pending") return r.surveyed === false;
    if (key === "all") return true;
    if (key.startsWith("status:")) return r.status === key.slice(7);
    if (key === "difference") return r.difference !== 0;
    if (key === "moved") return r.effective_space && r.space && r.effective_space !== r.space;
    if (key === "disposal") return r.status === "사용가능" || r.status === "폐품";
    if (key === "reason") return Boolean((r.reason || "").trim());
    if (key === "missing") return r.method === "missing";
    return true;
  };
  const matchesSearch = (r, q) => !q ||
    [r.name, r.code, r.category, r.department, r.space, r.effective_space, r.reason]
      .some((v) => String(v || "").toLowerCase().includes(q));

  const sortedFiltered = () => {
    const q = search.value.trim().toLowerCase();
    // 미실사 행은 토글이 켜졌거나 '미실사' 필터를 골랐을 때만 보인다.
    const showPending = state.includePending || filter.value === "pending";
    const list = rows.filter((r) =>
      (showPending || r.surveyed !== false) && passesFilter(r) && matchesSearch(r, q));
    if (state.sort.length) {
      const cols = state.sort.map((s) => ({ cmp: TABLE_COLUMNS.find((c) => c.key === s.key).cmp, sign: s.dir === "desc" ? -1 : 1 }));
      list.sort((a, b) => {
        for (const { cmp, sign } of cols) { const d = cmp(a, b) * sign; if (d) return d; }
        return 0;
      });
    } else {
      // 기본 정렬: 최신 저장순.
      list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }
    return list;
  };

  // 같은 품목(같은 이름 + 코드 앞부분)이 함께 실사됐는지 — 삭제 시 안내용.
  const siblingsOf = (r) => {
    const base = r.code.replace(/-\d+$/, "");
    return rows.filter((x) => x.code !== r.code && x.name === r.name && x.code.replace(/-\d+$/, "") === base);
  };

  const expectedFor = (codes) => Object.fromEntries(codes.map((code) => {
    const row = rows.find((item) => item.code === code);
    return [code, row?.updated_at || null];
  }));
  const applyBulk = (action, codes, extra = {}) => api("/api/admin/results/bulk", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      codes, action, device: deviceLabel(), expected_updated_at: expectedFor(codes), ...extra,
    }),
  });

  const deleteOne = async (r) => {
    const sibs = siblingsOf(r);
    let codes = [r.code];
    if (sibs.length) {
      const choice = await choose("실사 삭제",
        `같은 품목 중 함께 실사된 항목이 <b>${sibs.length}개</b> 더 있습니다.<br>삭제 범위를 선택해 주세요.`,
        [{ label: `같은 품목 모두 삭제 (${sibs.length + 1}개)`, value: "group", variant: "danger" },
         { label: "이 항목만 삭제", value: "one" },
         { label: "닫기", value: null, variant: "muted" }]);
      if (!choice) return null;
      if (choice === "group") codes = [r.code, ...sibs.map((item) => item.code)];
    } else {
      const ok = await choose("실사 삭제", "이 자산의 실사 결과를 삭제할까요?<br>삭제하면 다시 미실사 상태가 됩니다.",
        [{ label: "삭제", value: true, variant: "danger" }, { label: "닫기", value: false, variant: "muted" }]);
      if (!ok) return null;
    }
    return applyBulk("delete", codes);
  };

  // 데이터 변경 후 다시 불러오기 — 정렬·페이지·검색·필터는 유지하되 선택은 해제한다.
  const refresh = () => { state.selected.clear(); return VIEWS.adminTable(params); };

  const drawPager = (total) => {
    const size = state.pageSize;
    if (!size || total <= size) { pager.innerHTML = ""; return; }
    const pages = Math.ceil(total / size);
    state.page = Math.min(state.page, pages);
    const btn = (p, label = p, cls = "") => `<button class="page-btn ${cls}" data-page="${p}"${p === state.page ? ' aria-current="page"' : ""}>${label}</button>`;
    const nums = [];
    const span = 2;
    for (let p = 1; p <= pages; p += 1) {
      if (p === 1 || p === pages || (p >= state.page - span && p <= state.page + span)) nums.push(p);
      else if (nums[nums.length - 1] !== "…") nums.push("…");
    }
    pager.innerHTML =
      btn(Math.max(1, state.page - 1), "‹", state.page === 1 ? "disabled" : "") +
      nums.map((p) => p === "…" ? `<span class="page-gap">…</span>` : btn(p)).join("") +
      btn(Math.min(pages, state.page + 1), "›", state.page === pages ? "disabled" : "");
    pager.querySelectorAll(".page-btn[data-page]").forEach((b) => {
      b.onclick = () => { state.page = Number(b.dataset.page); draw(); };
    });
  };

  const controls = document.querySelector(".table-controls");
  const syncBulk = () => {
    const active = state.selected.size > 0;
    // 선택 중일 때는 검색/필터 줄 자리를 일괄 작업 바가 대체한다(표가 밀리지 않도록).
    bulkBar.hidden = !active;
    controls.hidden = active;
    document.querySelector("#bulkCount").textContent = `${state.selected.size}건 선택됨`;
  };

  const draw = () => {
    const list = sortedFiltered();
    count.textContent = `${list.length}건`;
    searchClear.hidden = !search.value;
    empty.hidden = list.length > 0;
    // 정렬 표시
    document.querySelectorAll("th.sortable").forEach((th) => {
      const idx = state.sort.findIndex((s) => s.key === th.dataset.key);
      const ind = th.querySelector(".sort-ind");
      th.classList.toggle("sorted", idx >= 0);
      th.setAttribute("aria-sort", idx < 0 ? "none"
        : state.sort[idx].dir === "asc" ? "ascending" : "descending");
      ind.innerHTML = idx >= 0 ? icon(state.sort[idx].dir === "asc" ? "sortAsc" : "sortDesc") + (state.sort.length > 1 ? `<b>${idx + 1}</b>` : "") : "";
    });
    const size = state.pageSize || list.length || 1;
    const start = (state.page - 1) * size;
    const pageRows = state.pageSize ? list.slice(start, start + size) : list;
    body.innerHTML = pageRows.map((r) => {
      const moved = r.effective_space && r.space && r.effective_space !== r.space;
      // 미실사 행: 결과가 없어 선택·삭제 불가. 클릭하면 실사 입력으로 진입한다.
      const pending = r.surveyed === false;
      const cls = pending ? "is-pending" : (r.survey_date === today ? "is-today" : "");
      return `<tr data-code="${esc(r.code)}"${cls ? ` class="${cls}"` : ""}>
        <td class="check">${pending ? "" : `<input type="checkbox" class="row-check" data-code="${esc(r.code)}"${state.selected.has(r.code) ? " checked" : ""} aria-label="${esc(r.code)} 선택">`}</td>
        <td class="name" data-go>${esc(r.name)}</td>
        <td class="mono" data-go>${esc(r.code)}</td>
        <td data-go>${pending ? "" : `<span class="status-tag status-${STATUS_CLASS[r.status] || ""}">${esc(statusShort(r.status))}</span>`}</td>
        <td class="num" data-go>${r.book_qty}</td>
        <td class="num" data-go>${pending ? "" : r.actual_qty}</td>
        <td class="num ${!pending && r.difference ? "diff" : ""}" data-go>${pending ? "" : (r.difference ? (r.difference > 0 ? "+" : "") + r.difference : "0")}</td>
        <td data-go>${esc(r.space)}</td>
        <td class="${moved ? "moved" : ""}" data-go>${pending ? "" : esc(r.effective_space)}</td>
        <td class="reason" data-go>${esc(r.reason || "")}</td>
        <td class="mono" data-go>${esc((r.updated_at || "").slice(5, 16))}</td>
        <td class="act">${pending ? `<span class="row-del-spacer" aria-hidden="true"></span>` : `<button type="button" class="row-del" data-code="${esc(r.code)}" aria-label="${esc(r.code)} 삭제">${icon("trash")}</button>`}</td>
      </tr>`;
    }).join("");
    // 셀 클릭 → 수정 이동(체크박스·삭제 제외)
    body.querySelectorAll("td[data-go]").forEach((td) => {
      // 표에서 실사 진입: 미실사 자산은 method="admin"으로 저장(코드 직접 입력이 아님).
      // 이미 실사된 자산을 다시 열면 기존 method가 유지된다(setupSurveyForm에서 prev.method 우선).
      td.onclick = () => go("asset", { code: td.parentElement.dataset.code, admin: true, method: "admin" });
    });
    body.querySelectorAll(".row-check").forEach((cb) => {
      cb.onchange = () => { cb.checked ? state.selected.add(cb.dataset.code) : state.selected.delete(cb.dataset.code); syncSelectAll(); syncBulk(); };
    });
    body.querySelectorAll(".row-del").forEach((b) => {
      b.onclick = async () => {
        const r = rows.find((x) => x.code === b.dataset.code);
        try {
          const changed = await deleteOne(r);
          if (changed) {
            toast(`${changed.count}건의 실사 결과를 삭제했습니다.`,
              { label: "취소", appearance: "success", onClick: () => restoreResults(changed.undo_token, refresh) });
            refresh();
          }
        } catch (error) { toast(error.message, null, "danger"); }
      };
    });
    syncSelectAll();
    drawPager(list.length);
    syncBulk();
  };

  const syncSelectAll = () => {
    const boxes = [...body.querySelectorAll(".row-check")];
    checkAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
    checkAll.indeterminate = boxes.some((b) => b.checked) && !checkAll.checked;
  };

  // 헤더 클릭 정렬: 오름차순 → 내림차순 → 해제 (여러 열 동시 지원)
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.querySelector(".sort-button").onclick = () => {
      const key = th.dataset.key;
      const cur = state.sort.find((s) => s.key === key);
      if (!cur) state.sort.push({ key, dir: "asc" });
      else if (cur.dir === "asc") cur.dir = "desc";
      else state.sort = state.sort.filter((s) => s.key !== key);
      draw();
    };
  });

  checkAll.onchange = () => {
    body.querySelectorAll(".row-check").forEach((cb) => {
      cb.checked = checkAll.checked;
      cb.checked ? state.selected.add(cb.dataset.code) : state.selected.delete(cb.dataset.code);
    });
    syncBulk();
  };

  document.querySelector("#bulkDelete").onclick = async () => {
    const codes = [...state.selected];
    if (!codes.length) return;
    const ok = await choose("일괄 삭제", `선택한 <b>${codes.length}건</b>의 실사 결과를 삭제할까요?<br>삭제하면 다시 미실사 상태가 됩니다.`,
      [{ label: `${codes.length}건 삭제`, value: true, variant: "danger" }, { label: "닫기", value: false, variant: "muted" }]);
    if (!ok) return;
    busy("삭제하는 중");
    try {
      const changed = await applyBulk("delete", codes);
      idle();
      toast(`${codes.length}건을 삭제했습니다.`, { label: "취소", appearance: "success", onClick: () => restoreResults(changed.undo_token, refresh) });
      refresh();
    } catch (error) { idle(); toast(error.message, null, "danger"); }
  };
  document.querySelector("#bulkStatus").onclick = async () => {
    const codes = [...state.selected];
    if (!codes.length) return;
    const status = await choose("일괄 상태 변경", `선택한 <b>${codes.length}건</b>의 실사 상태를 바꿉니다.`,
      [{ label: "활용", value: "활용" }, { label: "사용가능", value: "사용가능", variant: "warning" },
       { label: "폐품", value: "폐품", variant: "danger" }, { label: "닫기", value: null, variant: "muted" }]);
    if (!status) return;
    busy("변경하는 중");
    try {
      const changed = await applyBulk("status", codes, { status });
      idle();
      toast(`${codes.length}건의 상태를 변경했습니다.`, { label: "취소", appearance: "success", onClick: () => restoreResults(changed.undo_token, refresh) });
      refresh();
    } catch (error) { idle(); toast(error.message, null, "danger"); }
  };
  document.querySelector("#bulkLocation").onclick = async () => {
    const codes = [...state.selected];
    if (!codes.length) return;
    const place = await selectModal("일괄 위치 변경",
      `선택한 <b>${codes.length}건</b>의 확인 위치를 바꿉니다.`, locationGroups,
      { confirm: "위치 변경", placeholder: "변경할 위치를 선택하세요" });
    if (!place) return;
    busy("변경하는 중");
    try {
      const changed = await applyBulk("location", codes, { confirmed_space: place });
      idle();
      toast(`${codes.length}건의 위치를 변경했습니다.`, { label: "취소", appearance: "success", onClick: () => restoreResults(changed.undo_token, refresh) });
      refresh();
    } catch (error) { idle(); toast(error.message, null, "danger"); }
  };

  search.oninput = () => { state.search = search.value; state.page = 1; draw(); };
  searchClear.onclick = () => { search.value = ""; state.search = ""; search.focus(); state.page = 1; draw(); };
  filter.onchange = () => { state.filter = filter.value; state.page = 1; draw(); };
  pageSizeSel.onchange = () => { state.pageSize = Number(pageSizeSel.value); state.page = 1; draw(); };
  pendingToggle.onchange = () => { state.includePending = pendingToggle.checked; state.page = 1; draw(); };
  draw();
};

restoreRoute();
render();
