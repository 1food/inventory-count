// 기관 설정 화면 — 처음 실행할 때(설정 모드)와 관리자 '기관 설정'에서 함께 쓴다.
import { api, esc } from "./api.js";
import { icon, toast, busy, idle, prompt } from "./ui.js";

const root = document.querySelector("#app");
const FLOORS = ["1층", "2층", "3층", "4층", "지하", "별관", "외부", "기타"];
const $ = (sel) => document.querySelector(sel);
let state;
let spaceRows = [];   // [{name, floor, assets}]

const key = (name) => name.replace(/\s+/g, "");

function spaceRowsFrom(spaces, ledgerLocations) {
  const rows = new Map();
  for (const s of spaces) rows.set(key(s.name), { name: s.name, floor: s.floor, assets: 0 });
  for (const l of ledgerLocations || []) {
    const row = rows.get(key(l.name)) || { name: l.name, floor: "", assets: 0 };
    row.assets = l.assets;
    rows.set(key(l.name), row);
  }
  return [...rows.values()];
}

function codeHints() {
  const a = $("#access").value.trim();
  const m = $("#admin").value.trim();
  const keep = !state.setup_mode;
  const rule = (v) => (keep && !v) || (/^\d+$/.test(v) && v.length >= state.min_code);
  const hints = [
    [rule(a), keep && !a ? "접근코드: 지금 코드 유지" : `접근코드: 숫자 ${state.min_code}자리 이상`],
    [rule(m), keep && !m ? "관리자 코드: 지금 코드 유지" : `관리자 코드: 숫자 ${state.min_code}자리 이상`],
    [!(a && m && a === m), "두 코드는 서로 달라야 합니다"],
  ];
  $("#codeHints").innerHTML = hints.map(([ok, text]) =>
    `<li class="${ok ? "ok" : ""}">${ok ? icon("check") : '<span class="hint-dot" aria-hidden="true"></span>'}<span>${esc(text)}</span>${ok ? '<span class="sr-only">충족</span>' : ""}</li>`).join("");
  return hints.every(([ok]) => ok);
}

function ledgerSummary(info) {
  if (!info.ok) return `<div class="notice warning"><b>자산대장을 읽지 못했습니다.</b><p>${esc(info.error)}</p></div>`;
  const parts = [`자산 <b>${info.assets.toLocaleString()}</b>건`, `위치 <b>${info.locations.length}</b>곳`];
  if (info.unassigned) parts.push(`위치 없는 자산 ${info.unassigned}건`);
  let warn = "";
  if (info.duplicates?.length) warn += `<p>같은 자산코드가 두 번 이상 나옵니다(첫 행만 사용): ${esc(info.duplicates.join(", "))}</p>`;
  if (info.missing_results) warn += `<p>이미 저장한 실사 결과 ${info.missing_results}건의 자산코드가 새 대장에 없습니다(예: ${esc(info.missing_examples.join(", "))}). 그 결과는 화면과 엑셀에서 빠집니다.</p>`;
  const sample = info.sample ? "<p>지금은 예시(가상) 자료입니다. 우리 기관 대장으로 바꿔 주세요.</p>" : "";
  return `<div class="notice info"><b>${parts.join(" · ")}</b>${sample}</div>` + diffSummary(info.diff) +
    (warn ? `<div class="notice warning">${warn}</div>` : "");
}

// 지금 대장과 비교해 바뀌는 내용(추가·빠짐·바뀜)을 미리 보여 준다.
function diffSummary(diff) {
  if (!diff) return "";
  if (!diff.added && !diff.removed && !diff.changed) return '<p class="field-help">지금 대장과 내용이 같습니다.</p>';
  const groups = [["added", "새로 추가"], ["removed", "대장에서 빠짐"], ["changed", "이름·위치·수량 바뀜"]]
    .filter(([k]) => diff[k])
    .map(([k, label]) => `<li><b>${label} ${diff[k]}건</b> — ${esc(diff.examples[k].join(", "))}${diff[k] > diff.examples[k].length ? " 외" : ""}</li>`);
  return `<details><summary>바뀌는 내용: 추가 ${diff.added} · 빠짐 ${diff.removed} · 바뀜 ${diff.changed}</summary><ul>${groups.join("")}</ul></details>`;
}

function templateSummary(info) {
  if (!info.ok) return `<div class="notice warning"><b>양식을 읽지 못했습니다.</b><p>${esc(info.error)}</p></div>`;
  const mode = info.filled_rows ? `자산 ${info.filled_rows}행이 채워진 양식 — 그 행에 결과만 채웁니다.` : "빈 양식 — 자산대장 순서대로 행을 만듭니다.";
  return `<div class="notice info"><b>${info.sample ? "기본 양식" : "기관 양식"} · 머리글 확인됨</b><p>${esc(info.columns.join(", "))}</p><p>${mode}</p></div>`;
}

function renderSpaces() {
  const box = $("#spaces");
  box.innerHTML = spaceRows.length ? spaceRows.map((row, i) => `
    <div class="space-row">
      <span class="space-name"><b>${esc(row.name)}</b><small>${row.assets ? `자산 ${row.assets}건` : "자산 없음"}</small></span>
      <input list="floorList" data-floor="${i}" value="${esc(row.floor)}" placeholder="구역(예: 1층)" aria-label="${esc(row.name)} 구역">
      <button type="button" class="text-button" data-remove="${i}" aria-label="${esc(row.name)} 빼기">빼기</button>
    </div>`).join("") : `<div class="empty">자산대장에 위치(자산위치)가 없습니다. 아래에서 공간을 추가하세요.</div>`;
  box.querySelectorAll("[data-floor]").forEach((input) => {
    input.oninput = () => { spaceRows[input.dataset.floor].floor = input.value; };
  });
  box.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.onclick = () => { spaceRows.splice(Number(btn.dataset.remove), 1); renderSpaces(); };
  });
}

async function upload(path, file, field = "file") {
  if (!file) return null;
  const form = new FormData();
  form.append(field, file);
  busy("파일을 확인하는 중");
  try { return await api(path, { method: "POST", body: form }); }
  finally { idle(); }
}

// 파일 고르기 버튼: 진짜 input은 sr-only로 남겨 키보드로도 고를 수 있게 한다. 끌어다 놓아도 된다.
const fileButton = (id, label, accept, extra = "") =>
  `<label class="secondary-button file-button drop-zone ${extra}" data-drop="${id}">${label}<input id="${id}" class="sr-only" type="file" accept="${accept}"></label>`;

function bindFile(id, handler) {
  const input = $(`#${id}`);
  const zone = document.querySelector(`[data-drop="${id}"]`);
  input.onchange = () => { const file = input.files[0]; input.value = ""; handler(file); };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("is-dragover"); };
  zone.ondragleave = () => zone.classList.remove("is-dragover");
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("is-dragover"); handler(e.dataTransfer.files[0]); };
}

// QR은 SVG를 문서에 직접 넣어 토큰 색(--color-qr-dark)으로 칠한다.
const qr = () => '<div class="qr" data-qr role="img" aria-label="직원 접속 주소 QR 코드"></div>';
async function fillQr() {
  for (const box of document.querySelectorAll("[data-qr]")) {
    try {
      const response = await fetch("/api/setup/qr", { cache: "no-store" });
      if (response.ok) box.innerHTML = await response.text();
    } catch (_) { /* QR이 없어도 주소 글자는 보인다 */ }
  }
}

function render() {
  const s = state;
  const first = s.setup_mode;
  $("#toApp").hidden = first;
  const problems = first && s.problems.length
    ? `<div class="notice warning"><b>확인이 필요한 항목</b>${s.problems.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : "";
  const qrCard = first ? "" : `<section class="card setup-qr"><div><b>직원 접속 주소</b>
      <p>같은 와이파이에서 휴대폰 카메라로 찍으면 바로 열립니다.</p><code>${esc(s.url)}</code></div>${qr()}</section>`;
  const tools = first ? "" : `<section class="card setup-step tools"><h3>관리 도구</h3>
      <button type="button" class="secondary-button wide" id="backupNow">지금 백업하기</button>
      <a class="secondary-button wide" id="backupDownload" href="/api/setup/backup/download" download>백업 파일 내려받기(zip)</a>
      <p class="field-help">실사 결과 ${s.results}건. 연습으로 저장한 결과를 지우고 실제 조사를 시작할 때만 쓰세요. 지우기 전에 자동으로 백업합니다.</p>
      <button type="button" class="text-danger" id="clearResults">실사 결과 모두 지우기</button></section>`;

  root.innerHTML = `
    <section class="setup-intro">
      <h2>${first ? "처음 설정" : "기관 설정"}</h2>
      <p>${first ? "아래 내용을 채우고 맨 아래 [저장하고 시작하기]를 누르세요. 이 화면은 서버 PC에서만 열립니다." : "바꿀 항목만 고치고 [저장]을 누르세요."}</p>
      ${problems}
    </section>
    ${qrCard}
    <section class="card setup-step"><h3><span>1</span>기관 정보</h3>
      <label class="field-title" for="org"><b>기관명</b><span>로그인 화면과 화면 아래쪽에 보입니다</span></label>
      <input id="org" maxlength="40" value="${esc(s.org)}" placeholder="예: ○○장애인복지관">
      <div class="field-title"><b>로고</b><span>svg·png·webp·jpg, 2MB 이하</span></div>
      <div class="logo-row drop-zone" data-drop="logoFile"><img id="logoPreview" src="/brand/logo?${Date.now()}" alt="현재 로고">
        ${fileButton("logoFile", "로고 파일 고르기", ".svg,.png,.webp,.jpg,.jpeg")}
        ${s.logo_custom ? '<button type="button" class="text-button" id="logoReset">기본 아이콘으로</button>' : ""}
        <small>로고 파일을 이 칸에 끌어다 놓아도 됩니다.</small></div>
    </section>
    <section class="card setup-step"><h3><span>2</span>접근 코드</h3>
      <p class="field-help">직원은 접근코드로 앱에 들어오고, 관리자 코드로 관리 화면과 엑셀 다운로드를 엽니다. 꼭 메모해 두세요.</p>
      <label class="field-title" for="access"><b>접근코드(직원용)</b></label>
      <input id="access" inputmode="numeric" maxlength="20" autocomplete="off" placeholder="${first ? "숫자 6자리 이상" : "바꾸지 않으려면 비워 두세요"}">
      <label class="field-title" for="admin"><b>관리자 코드</b></label>
      <input id="admin" inputmode="numeric" maxlength="20" autocomplete="off" placeholder="${first ? "숫자 6자리 이상, 접근코드와 다르게" : "바꾸지 않으려면 비워 두세요"}">
      <ul class="hints" id="codeHints"></ul>
    </section>
    <section class="card setup-step"><h3><span>3</span>고정자산대장</h3>
      <p class="field-help">희망이음 ERP에서 내려받은 고정자산대장(.xlsx)을 그대로 올리세요. 열 순서는 달라도 되지만 자산코드·자산명·현재수량 열은 있어야 합니다.</p>
      <div id="ledgerInfo">${ledgerSummary(s.ledger)}</div>
      ${fileButton("ledgerFile", "고정자산대장 올리기 (끌어다 놓아도 됩니다)", ".xlsx", "wide")}
      ${s.results ? `<p class="field-help">이미 저장한 실사 결과가 ${s.results}건 있습니다. 조사 도중 대장을 바꾸면 코드가 달라진 결과는 빠질 수 있습니다.</p>` : ""}
    </section>
    <section class="card setup-step"><h3><span>4</span>공간(장소)</h3>
      <p class="field-help">대장의 자산위치를 모았습니다. 각 공간의 구역(층·건물)을 적으면 홈 화면에서 구역별로 묶입니다. 비워 두면 '공간' 한 묶음이 됩니다.</p>
      <datalist id="floorList">${FLOORS.map((f) => `<option value="${f}">`).join("")}</datalist>
      <div id="spaces" class="space-list"></div>
      <div class="add-space"><input id="newSpace" maxlength="60" placeholder="자산 없는 공간 추가(예: 옥상정원)"><button type="button" class="secondary-button" id="addSpace">추가</button></div>
    </section>
    <section class="card setup-step"><h3><span>5</span>재물조사표 양식</h3>
      <p class="field-help">기관에서 쓰는 양식이 있으면 올리세요. 없으면 기본 양식을 그대로 씁니다.</p>
      <div id="templateInfo">${templateSummary(s.template)}</div>
      ${fileButton("templateFile", "양식 올리기 (끌어다 놓아도 됩니다)", ".xlsx", "wide")}
    </section>
    <section class="card setup-step"><h3><span>6</span>백업 폴더</h3>
      <p class="field-help">외장 드라이브나 NAS 폴더를 적어 두면 PC가 고장 나도 실사 자료를 지킬 수 있습니다. 비우면 프로그램 폴더 안 backups에 저장합니다.</p>
      <input id="backupDir" maxlength="200" value="${esc(s.backup_dir)}" placeholder="${esc(s.default_backup_dir)}">
    </section>
    <button class="primary-button" id="save">${first ? "저장하고 시작하기" : "저장"}</button>
    <div class="form-error" id="saveError" role="alert"></div>
    ${tools}`;

  spaceRows = spaceRowsFrom(s.spaces, s.ledger.locations);
  renderSpaces();
  codeHints();
  bind();
  fillQr();
}

function bind() {
  $("#access").oninput = codeHints;
  $("#admin").oninput = codeHints;
  // 로고는 칸 전체(.logo-row, 문서에서 먼저 나오는 data-drop)가 끌어다 놓기 영역이 된다.
  bindFile("logoFile", async (file) => {
    try {
      if (!(await upload("/api/setup/logo", file, "image"))) return;
      const src = `/brand/logo?${Date.now()}`;
      $("#logoPreview").src = src;
      $("#topLogo").src = src;
      toast("로고를 바꿨습니다.", null, "success");
    } catch (error) { toast(error.message, null, "danger"); }
  });
  const logoReset = $("#logoReset");
  if (logoReset) logoReset.onclick = async () => {
    await api("/api/setup/logo", { method: "DELETE" });
    state.logo_custom = false;
    render();
  };
  bindFile("ledgerFile", async (file) => {
    try {
      const info = await upload("/api/setup/ledger", file);
      if (!info) return;
      $("#ledgerInfo").innerHTML = ledgerSummary({ ...info, sample: false }) + '<p class="field-help">[저장]을 누르면 적용됩니다.</p>';
      // 구역을 적어 둔 공간과 자산 없는 공간은 남기고, 새 대장의 위치를 더한다.
      spaceRows = spaceRowsFrom(spaceRows.filter((r) => r.floor || !r.assets), info.locations);
      renderSpaces();
    } catch (error) {
      $("#ledgerInfo").innerHTML = ledgerSummary({ ok: false, error: error.message });
    }
  });
  bindFile("templateFile", async (file) => {
    try {
      const info = await upload("/api/setup/template", file);
      if (!info) return;
      $("#templateInfo").innerHTML = templateSummary({ ...info, sample: false }) + '<p class="field-help">[저장]을 누르면 적용됩니다.</p>';
    } catch (error) {
      $("#templateInfo").innerHTML = templateSummary({ ok: false, error: error.message });
    }
  });
  $("#addSpace").onclick = () => {
    const name = $("#newSpace").value.trim();
    if (!name || spaceRows.some((r) => key(r.name) === key(name))) return;
    spaceRows.push({ name, floor: "", assets: 0 });
    $("#newSpace").value = "";
    renderSpaces();
  };
  $("#save").onclick = save;

  const backupNow = $("#backupNow");
  if (backupNow) backupNow.onclick = async () => {
    busy("백업하는 중");
    try { const r = await api("/api/setup/backup", { method: "POST" }); idle(); toast(`백업했습니다: ${r.path}`, null, "success"); }
    catch (error) { idle(); toast(error.message, null, "danger"); }
  };
  const clearResults = $("#clearResults");
  if (clearResults) clearResults.onclick = async () => {
    const typed = await prompt("실사 결과 모두 지우기",
      "저장한 실사 결과·이력·사진을 모두 지웁니다. 먼저 백업 폴더에 백업합니다. 계속하려면 '지우기'를 입력하세요.",
      { placeholder: "지우기", confirm: "지우기" });
    if ((typed || "").trim() !== "지우기") return;
    busy("백업하고 지우는 중");
    try {
      const r = await api("/api/setup/clear-results", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "지우기" }),
      });
      idle(); toast(`지웠습니다. 백업: ${r.backup}`, null, "success"); load();
    } catch (error) { idle(); toast(error.message, null, "danger"); }
  };
}

async function save() {
  const error = $("#saveError");
  error.textContent = "";
  const org = $("#org").value.trim();
  if (!org) { error.textContent = "기관명을 적어 주세요."; $("#org").focus(); return; }
  if (!codeHints()) { error.textContent = "접근 코드 규칙을 확인해 주세요."; $("#access").focus(); return; }
  const body = {
    org, access_code: $("#access").value.trim(), admin_code: $("#admin").value.trim(),
    backup_dir: $("#backupDir").value.trim(),
    spaces: spaceRows.map((r) => ({ name: r.name, floor: r.floor.trim() })),
  };
  busy("저장하는 중");
  let result;
  try {
    result = await api("/api/setup/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) { idle(); error.textContent = e.message; return; }
  if (!result.restart) { idle(); toast("저장했습니다.", null, "success"); return load(); }
  busy("서버를 다시 시작하는 중");
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 30; i++) {
    try {
      const health = await (await fetch("/api/health", { cache: "no-store" })).json();
      if (!health.setup) { idle(); return done(body.access_code); }
    } catch (_) { /* 다시 켜지는 중 */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  idle();
  error.textContent = "서버가 다시 켜지지 않았습니다. 프로그램 폴더의 start.bat을 다시 실행해 주세요.";
}

function done(accessCode) {
  root.innerHTML = `
    <section class="card setup-done">
      <h2>설정을 마쳤습니다</h2>
      <p>직원 휴대폰을 서버 PC와 같은 와이파이에 연결한 뒤, 카메라로 아래 QR 코드를 찍으세요.</p>
      ${qr()}
      <code>${esc(state.url)}</code>
      ${accessCode ? `<p>접근코드 <b>${esc(accessCode)}</b></p>` : ""}
      <p class="field-help">이 화면을 인쇄해 붙여 두면 편합니다. 접속이 안 되면 같은 와이파이인지, Windows 방화벽에서 허용했는지 확인하세요.</p>
      <div class="button-row"><button class="secondary-button" id="print">인쇄</button><a class="primary-button" href="/">앱 열기</a></div>
    </section>`;
  $("#print").onclick = () => window.print();
  fillQr();
}

async function load() {
  try {
    state = await api("/api/setup/state");
    render();
  } catch (error) {
    root.innerHTML = `<div class="notice error"><b>설정 화면을 열 수 없습니다.</b><p>${esc(error.message)}</p>
      <p><a href="/">앱에서 관리자 로그인</a> 뒤 관리 화면의 [기관 설정]으로 들어오세요.</p></div>`;
  }
}

load();
