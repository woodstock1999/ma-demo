import { sceneCards, fillFrames, revisionEditor, bindComposition, readComposition, seconds, formatSeconds } from "./revise.js";
import { timelineHtml, mountTimeline } from "./timeline.js";
// 間 —ma—（内見動画メーカー）フロント。デザイン M2（2026-10-22 東さん選定）。フレームワークなし。文字は必ず esc() を通して表示する。
// 1問ずつのカード: a 動画を入れる → b 読み取り → c 物件 → d 誰に → e 編集 → f 会社・ロゴ →「動画を作る」→ 構成の確認 → 書き出し → 完成
// ロジックは 1ページ版（ui-onepage-20261022）と同じ: 選んだらすぐアップ／終わったらAIが自動で読む／空欄にだけAI案／課金前にロゴ確認／連打しても1回／動画を変えたら確認してから読み直す
const $app = document.getElementById("app");
const $bg = document.getElementById("bgimg");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const v = (x) => esc(x ?? "");
const uniq = (a) => [...new Set(a)];
const STATUS = { draft: "動画アップ待ち", analyzing: "AIが読み取り中", needs_input: "入力中", planning: "構成を作成中", plan_ready: "構成の確認待ち", rendering: "書き出し中", reviewing: "仕上がりを確認中", done: "完成", failed: "止まりました" };
const RUNNING = new Set(["analyzing", "planning", "rendering", "reviewing"]);
const EDITABLE = new Set(["draft", "analyzing", "needs_input"]);
const CUR = "rt_cur_job";
const HOUSE = [["single", "単身"], ["couple", "夫婦・カップル"], ["family", "子育てファミリー"], ["senior", "シニア"]];
// 編集バリエーション → 既存の catch_strength（バックエンドは変えない）
const VARS = [["strong", "テンポよく"], ["soft", "落ち着いて"], ["normal", "上質に"]];
const QSTEPS = ["b", "c", "d", "e", "f"];   // 点と「n / 5」
let timer = null;

async function api(path, opt = {}) {
  const r = await fetch(path, { credentials: "same-origin", ...opt, headers: { ...(opt.body && !(opt.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...(opt.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.endsWith("./login")) { location.href = "./login"; throw new Error(d.error || "ログインしてください"); }
  if (!r.ok) { const e = new Error(d.error || `エラー（${r.status}）`); e.status = r.status; throw e; }
  return d;
}
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
const put = (p, b) => api(p, { method: "PUT", body: JSON.stringify(b || {}) });
function toast(msg, bad) { document.querySelectorAll(".toast").forEach((x) => x.remove()); const d = document.createElement("div"); d.className = `toast ${bad ? "bad" : ""}`; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 4200); }

// ---------------- 背景の写真（最初の動画の1コマ。どの画面も同じ1枚） ----------------
const DEFAULT_BG = "./assets/bg-default.webp";
const frames = new Map();
const frameQueues = Array.from({length:4},()=>Promise.resolve()); let frameSlot=0;
const frameSources = new Map();
function frameSource(url) {
  if (!frameSources.has(url)) {
    frameSources.set(url, fetch(url).then(r => { if (!r.ok) throw Error('frame source'); return r.blob(); }).then(b => URL.createObjectURL(b)));
    if (frameSources.size > 12) { const key = frameSources.keys().next().value; frameSources.get(key).then(URL.revokeObjectURL).catch(() => {}); frameSources.delete(key); }
  }
  return frameSources.get(url);
}
// 動画の t 秒目を JPEG にする（同じオリジンの動画かローカルのファイルだけ）。失敗したら null
function grabFrame(url, at = 0.35, w = 720, exact = false) {
  const key = `${url}@${at}@${w}@${exact}`;
  if (frames.has(key)) return frames.get(key);
  const slot=frameSlot++ % frameQueues.length; const p = (frameQueues[slot] = frameQueues[slot].then(() => new Promise((res) => {
    const el = document.createElement("video");
    let done = false; const fin = (x) => { if (done) return; done = true; el.removeAttribute("src"); el.load(); res(x); };
    el.muted = true; el.playsInline = true; el.preload = "auto"; el.crossOrigin = "anonymous";
    el.onloadedmetadata = () => { const d = el.duration || 1; el.currentTime = !exact && at < 1 ? Math.min(d * at, Math.max(0, d - 0.1)) : Math.min(at, d - 0.1); };
    let retried = false;
    const draw = () => {
      try {
        const h = Math.round((w * el.videoHeight) / (el.videoWidth || 1)) || Math.round(w * 16 / 9);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d"); x.drawImage(el, 0, 0, w, h);
        // 位置を移した直後は黒いコマが返る事がある。真っ黒なら少しずらして 1 回撮り直す
        const d = x.getImageData(0, 0, w, h).data; let l = 0; for (let i = 0; i < d.length; i += 400) l += d[i] + d[i + 1] + d[i + 2];
        if (!retried && l / (d.length / 400) < 24) { retried = true; el.currentTime = Math.min(el.currentTime + 0.12, Math.max(0, (el.duration || 1) - 0.05)); return; }
        c.toBlob((b) => fin(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.86);
      } catch { fin(null); }
    };
    el.onseeked = () => { if (el.requestVideoFrameCallback) { let go = false; const once = () => { if (!go) { go = true; draw(); } }; el.requestVideoFrameCallback(once); setTimeout(once, 120); } else setTimeout(draw, 60); };
    el.onerror = () => fin(null);
    setTimeout(() => fin(null), 15000);
    frameSource(url).then(src => { if (!done) el.src = src; }).catch(() => fin(null));
  })));
  frames.set(key, p);
  return p;
}
let bgUrl = "";
function setBg(url) { const u = url || DEFAULT_BG; if (u === bgUrl) return; bgUrl = u; const im = new Image(); im.onload = () => { $bg.src = u; }; im.src = u; }
async function bgFromJob(j) {
  setBg(null);
}

// ---------------- 画面の切り替え ----------------
// #/                 … a（作りかけがあれば続きから）
// #/job/<id>/<b..f|more> … 質問カード
// #/job/<id>         … 構成の確認・書き出し・完成（入力中ならカードへ）
// #/list             … これまでの動画
window.addEventListener("hashchange", route);
let me = null;
async function route() {
  clearTimeout(timer); timer = null;
  const h = location.hash || "#/";
  if (h === "#/login") { location.replace("./login"); return; }
  if (!me) { try { me = (await api("/api/me")).client; } catch { return; } }
  if (h === "#/list") { S = null; return listView(); }
  if (h === "#/new") { localStorage.removeItem(CUR); S = null; history.replaceState(null, "", "#/"); return editor(window.maDemo.job(), "c"); }
  const m = h.match(/^#\/job\/(j_[a-f0-9]+)(?:\/([a-f]|more|edit))?/);
  if (m) {
    if (S && S.job && S.job.id === m[1] && m[2] && m[2] !== "edit") return show(m[2]);   // 同じ物件のカード間の移動
    const j = await api(`/api/jobs/${m[1]}`).catch(() => null);
    if (!j) { location.hash = "#/"; return; }
    if (m[2] || EDITABLE.has(j.status) || (j.status === "failed" && !j.plan)) return editor(j, m[2] === "edit" ? "f" : m[2] || firstStep(j));
    return jobView(j);
  }
  const cur = localStorage.getItem(CUR);
  if (cur) {
    const j = await api(`/api/jobs/${cur}`).catch(() => null);
    if (j && (EDITABLE.has(j.status) || (j.status === "failed" && !j.plan))) { history.replaceState(null, "", `#/job/${j.id}/${firstStep(j)}`); return editor(j, firstStep(j)); }
    localStorage.removeItem(CUR);
  }
  const demoJob=window.maDemo.job(); return demoJob.status === "needs_input" ? editor(demoJob,"c") : jobView(demoJob);
}
function firstStep(j) {
  const f = j.form || {};
  if (!j.files.some((x) => x.kind === "source")) return "a";
  if (!j.analysis || !f.price) return j.analysis ? "c" : "b";
  if (!f.target?.household) return "d";
  return "f";
}

function shell({ step, chips = "", body, below = "", center = false }) {
  const k = QSTEPS.indexOf(step);
  const dots = k >= 0 ? `<div class="prog frost"><span class="dots">${QSTEPS.map((_, i) => `<i class="${i <= k ? "on" : ""}"></i>`).join("")}</span><span class="frac">${k + 1} / 5</span></div>` : "";
  return `<div class="scr ${center ? "center" : ""}">
    <header class="hd"><a class="mark frost" href="#/new" aria-label="間 ma（新しく作る）"><img src="./assets/ma-logo.png" alt="間 ma"></a>${dots}</header>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <div class="grow"></div>
    <section class="glass">${body}</section>
    ${below}
  </div>`;
}

function loginView() {
  setBg(null);
  $app.innerHTML = shell({ step: "", center: true, body: `<h1 class="ttl c">ログイン</h1>
   <form id="f"><label class="lb">ID</label><input class="in" type="text" name="login" autocomplete="username" required>
   <label class="lb">パスワード</label><input class="in" type="password" name="password" autocomplete="current-password" required>
   <p id="e" class="note bad"></p><button class="pill main">ログイン</button></form>` });
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try { await post("/api/login", { login: fd.get("login"), password: fd.get("password") }); me = null; location.hash = "#/"; }
    catch (err) { document.getElementById("e").textContent = err.message; }
  };
}

async function listView() {
  setBg(null);
  const { jobs } = await api("/api/jobs");
  $app.innerHTML = shell({ step: "", body: `<h1 class="ttl">これまでの動画</h1>
   <div class="list scroll">${jobs.length ? jobs.map((j) => `<a href="#/job/${esc(j.id)}"><span><b>${esc(j.title)}</b><small>${new Date(j.created_at * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><em class="st ${j.status === "done" ? "ok" : j.status === "failed" ? "ng" : ""}">${esc(STATUS[j.status] || j.status)}</em></a>`).join("") : '<p class="note">まだありません</p>'}</div>
   <a class="pill main" href="#/new">新しく作る</a>
   <p class="note c"><button class="txt" id="lo">紹介ページへ</button></p>` });
  document.getElementById("lo").onclick = async () => { location.href = "./index.html"; };
}

// =====================================================================
// 質問カード（a〜f）
// =====================================================================
let S = null;
function editor(j, step) {
  const f0 = (j && j.form) || {};
  S = {
    job: j, ups: [], needAnalyze: false, pending: false, going: false, floorplanFile: null, floorplanPreview: "", floorplanBusy: false, floorplanError: "", logoFile: null, logoPreview: "", aiErr: "",
    applied: !!(j && j.analysis), saveT: null, step: "a", aiAt: 0, ai: {},
    form: {
      property_name: f0.property_name || (j && j.title !== "新しい物件" ? j.title : ""), deal: f0.deal === "rent" ? "rent" : "sale", price: f0.price || "", layout: f0.layout || "",
      loan_monthly: f0.loan_monthly || "", management_fee: f0.management_fee || "", repair_reserve: f0.repair_reserve || "", area: f0.area || "", built: f0.built || "", floor: f0.floor || "", floors_total: f0.floors_total || "",
      orientation: f0.orientation || "", station: f0.station || "", walk_min: f0.walk_min || "",
      nearby: f0.nearby && f0.nearby.length ? f0.nearby : ["スーパー", "保育園・小学校", "公園", "病院"].map((kind) => ({ kind, name: "", min: "" })),
      target: { household: "", age: "", gender: "", kids_ages: "", remote_work: false, car: false, pet: false, ...(f0.target || {}) },
      selling_point: f0.selling_point || "", selling_src: f0.selling_src || 0, selling_t: f0.selling_t ?? "", catch_idea: f0.catch_idea || "", catch_strength: f0.catch_strength || "normal",
      rooms: f0.rooms || [], ng_items: f0.ng_items || "",
      company_name: f0.company_name || me?.company_name || me?.name || "", brand_color: f0.brand_color || me?.brand_color || "", line_url: f0.line_url || me?.line_url || "",
      license_no: f0.license_no || me?.license_no || "", deal_type: f0.deal_type || "", address: f0.address || "", answers: f0.answers || {},
    },
    roomsTouched: !!(f0.rooms && f0.rooms.length), thumbs: {},
  };
  if (j) { localStorage.setItem(CUR, j.id); bgFromJob(j); } else setBg(null);
  if (j && j.status === "draft" && j.files.some((x) => x.kind === "source")) S.needAnalyze = true;   // 動画は入っているのに読み取りを始めていない物件だけ自動で
  if (j && j.status === "failed" && !j.plan && j.analysis) { S.needAnalyze = true; S.aiErr = j.error || ""; }   // 読み直しが止まった物件は 作る前に読み直す
  if (j && j.analysis) applyAutofill(true);
  show(step || "a");
  if (S.needAnalyze) maybeAnalyze();
  if (j && j.status === "analyzing") { S.aiAt = Date.now(); poll(); }
}

const sources = () => (S.job ? S.job.files.filter((x) => x.kind === "source") : []);
const uploading = () => S.ups.some((u) => !u.done && !u.err);
const liveUps = () => S.ups.filter((u) => !u.done);
function go2(step) { if (!S.job) return show(step); const h = `#/job/${S.job.id}/${step}`; if (location.hash !== h) location.hash = h; else show(step); }

// 上に並べる「これまでの答え」
function chipsHtml(upto) {
  const k = ["a", ...QSTEPS, "more"].indexOf(upto), f = S.form, out = [];
  const n = sources().length + liveUps().filter((u) => !u.err).length;
  if (k > 1 && n) out.push(["b", `動画 ${n}本`]);
  if (k > 2 && (f.price || f.layout)) out.push(["c", [f.deal === "rent" ? "賃貸" : "売買", f.price ? `${f.price}万円` : "", f.layout].filter(Boolean).join("・")]);
  if (k > 3 && f.target.household) out.push(["d", HOUSE.find((x) => x[0] === f.target.household)?.[1] || ""]);
  if (k > 4 && upto === "more") out.push(["e", VARS.find((x) => x[0] === f.catch_strength)?.[1] || ""]);
  return out.map(([s, t]) => `<button type="button" class="chip frost" data-go="${s}">${s === "b" ? t : esc(t)}</button>`).join("");
}
const left = (step) => { const k = QSTEPS.indexOf(step) + 1; return k >= 2 && k <= 4 ? `<p class="left">あと${6 - k}問</p>` : ""; };

function show(step) {
  if (!S) return;
  if (step !== "a" && !S.job && !S.ups.length) step = "a";
  S.step = step;
  const R = { a: cardA, b: cardB, c: cardC, d: cardD, e: cardE, f: cardF, more: cardMore }[step] || cardA;
  $app.innerHTML = R();
  $app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go2(b.dataset.go)));
  bindCommon();
  paint();
}
function bindCommon() {
  const pick = document.getElementById("pick");
  if (pick) pick.onchange = () => { addFiles([...pick.files]); pick.value = ""; };
  $app.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => pick && pick.click()));
  // 入力 → S.form
  $app.querySelectorAll("[data-f]").forEach((el) => {
    const k = el.dataset.f;
    const set = () => {
      let val = el.type === "checkbox" ? el.checked : el.value;
      if (k === "layout") val = val.normalize("NFKC").toUpperCase();
      if (k === "price") fitPrice();
      if (k.startsWith("target.")) S.form.target[k.slice(7)] = val; else S.form[k] = val;
      delete S.ai[k]; el.closest(".fld")?.querySelector(".aib")?.remove(); el.closest(".fld")?.classList.remove("miss");
      scheduleSave(); paintBtn();
    };
    el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", set);
  });
}
const pickInput = `<input type="file" id="pick" accept="video/*" multiple hidden>`;

// ---- a 内見動画を入れる ----
function cardA() {
  return shell({ step: "a", center: true, body: `${pickInput}
    <div class="drop" id="drop">
      <img class="ic" src="./assets/icon-video.png" alt="">
      <h1 class="ttl c">内見動画を入れる</h1>
      <p class="sub c">縦向き・6本まで</p>
      <button type="button" class="pill main" data-pick>見本の素材を選ぶ</button>
    </div>`, below: `<a class="under" href="#/list">これまでの動画</a>` });
}
// ---- b 読み取り ----
function cardB() {
  return shell({ step: "b", body: `${pickInput}
    <div class="thumbs" id="thumbs"></div>
    <p class="count" id="count"></p>
    <hr class="hair">
    <div id="aiBox"></div>
    <button type="button" class="pill main" id="next" data-go="c">次へ</button>` });
}
// ---- c 物件のこと ----
function cardC() {
  const f = S.form;
  return shell({ step: "c", chips: chipsHtml("c"), body: `
    <h1 class="ttl">物件のこと</h1>
    <div class="seg" role="radiogroup">${[["sale", "売買"], ["rent", "賃貸"]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${f.deal === k}" class="${f.deal === k ? "on" : ""}" data-deal="${k}">${l}</button>`).join("")}</div>
    <div class="fld" id="fld-price"><label class="lb" for="price">価格 / 賃料</label>
      <div class="big"><input id="price" data-f="price" inputmode="decimal" autocomplete="off" value="${v(f.price)}" placeholder="0"><span class="unit">万円</span></div></div>
    <hr class="hair">
    <div class="fld" id="fld-layout"><label class="lb" for="layout">間取り</label>
      <div class="big"><input id="layout" data-f="layout" autocomplete="off" value="${v(f.layout)}" placeholder="${S.job?.status === "analyzing" ? "読み取り中…" : "2LDK"}"></div>${aiBadge("layout")}</div>
    <div class="fld"><span class="lb">間取り図</span><div class="lg"><button type="button" class="logo" id="floorplanBtn" aria-label="間取り図を選ぶ">${floorplanInner()}</button><button type="button" class="txt u" id="floorplanBtn2">${S.job?.files.some(x => x.kind === "floorplan") || S.floorplanFile ? "変える" : "選ぶ"}</button></div><input type="file" id="floorplanPick" accept="image/png,image/jpeg,image/webp" hidden></div>
    ${left("c")}
    <button type="button" class="pill main" id="next" data-go="d">次へ</button>` });
}
function aiBadge(k) {
  if (S.ai[k]) return `<i class="aib">AI案</i>`;
  const FIELD = { layout: "layout", area: "area", floor: "floor", orientation: "orientation" };
  const unclear = (S.job?.analysis?.unclear || []).some((u) => FIELD[u.field] === k);
  const val = k in S.form ? S.form[k] : "";
  return unclear && !val ? `<i class="aib q">AIでは不明</i>` : "";
}
// ---- d 誰に見せたいか ----
function cardD() {
  const h = S.form.target.household;
  return shell({ step: "d", chips: chipsHtml("d"), body: `
    <h1 class="ttl c">誰に見せたいか</h1>
    <div class="tiles fld" id="fld-household">${HOUSE.map(([k, l]) => `<button type="button" class="tile ${h === k ? "on" : ""}" data-house="${k}" aria-pressed="${h === k}">${l}${S.ai.household && h === k ? '<i class="aib s">AI案</i>' : ""}</button>`).join("")}</div>
    ${left("d")}
    <button type="button" class="pill main" id="next" data-go="e">次へ</button>` });
}
// ---- e 編集バリエーション ----
function cardE() {
  const cur = S.form.catch_strength || "normal";
  return shell({ step: "e", chips: chipsHtml("e"), body: `
    <h1 class="ttl">編集バリエーション</h1>
    <div class="vars">${VARS.map(([k, l], i) => `<button type="button" class="var ${cur === k ? "on" : ""}" data-var="${k}" aria-pressed="${cur === k}"><span class="vth" data-vth="${i}"></span><span class="vl">${l}</span></button>`).join("")}</div>
    ${left("e")}
    <button type="button" class="pill main" id="next" data-go="f">次へ</button>` });
}
// ---- f 会社名 / ロゴ ----
function cardF() {
  const f = S.form;
  const n = sources().length + liveUps().filter((u) => !u.err).length;
  const sum = [["b", `動画 ${n}本`], ["c", [f.deal === "rent" ? "賃貸" : "売買", f.price ? `${f.price}万円` : "価格 未入力", f.layout || "間取り 未入力"].join("・")], ["d", HOUSE.find((x) => x[0] === f.target.household)?.[1] || "誰に 未選択"], ["e", VARS.find((x) => x[0] === f.catch_strength)?.[1] || "上質に"]];
  return shell({ step: "f", body: `
    <h1 class="ttl">会社名 / ロゴ</h1>
    <div class="co">
      <div class="fld" id="fld-company_name"><label class="lb" for="company">会社名</label><input id="company" class="mid" data-f="company_name" value="${v(f.company_name)}" placeholder="会社名" autocomplete="organization"></div>
      <div class="vr"></div>
      <div class="fld" id="fld-logo"><span class="lb">ロゴ</span><div class="lg"><button type="button" class="logo" id="logoBtn" aria-label="ロゴを選ぶ">${logoInner()}</button><button type="button" class="txt u" id="logoBtn2">${hasLogo() ? "変える" : "選ぶ"}</button></div>
      <input type="file" id="logoPick" accept="image/png,image/jpeg,image/webp" hidden></div>
    </div>
    <hr class="hair">
    <h2 class="ttl2">内容</h2>
    <div class="sum">${sum.map(([s, t], i) => `<button type="button" class="opt ${i === 3 ? "on" : ""}" data-go="${s}">${esc(t)}</button>`).join("")}</div>
    <button type="button" class="pill main" id="make">動画を作る</button>
    <p class="why" id="why"></p>
    <p class="c"><a class="txt u" href="#/job/${esc(S.job?.id || "")}/more">くわしく入れる（任意）</a></p>` });
}
function floorplanInner() {
  const file = S.job?.files.find(x => x.kind === "floorplan");
  const src = S.floorplanPreview || (file ? window.maDemo.file(file.id) : "");
  return src ? `<img src="${esc(src)}" alt="間取り図">` : `<img class="plus" src="./assets/icon-plus-ink.png" alt="">`;
}
const hasLogo = () => !!(S.job?.files.some((x) => x.kind === "logo") || me?.logo_key || S.logoFile);
function logoInner() {
  const lf = S.job?.files.find((x) => x.kind === "logo");
  if (S.logoPreview) return `<img src="${esc(S.logoPreview)}" alt="">`;
  if (lf) return `<img src="${window.maDemo.file(lf.id)}" alt="">`;
  if (me?.logo_key) return `<span class="lgt">前回のロゴ</span>`;
  return `<img class="plus" src="./assets/icon-plus-ink.png" alt="">`;
}
// 価格の数字の幅に「万円」を寄せる
let mctx = null;
function fitPrice() {
  const el = document.getElementById("price"); if (!el) return;
  mctx = mctx || document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(el); mctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  el.style.width = `${Math.ceil(mctx.measureText(el.value || el.placeholder || "0").width) + 8}px`;
}
// 白っぽいロゴは濃い台に（白い台だと見えない）
function toneLogo(btn) {
  const im = btn.querySelector("img:not(.plus)"); btn.classList.remove("dark"); if (!im) return;
  const run = () => { try { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let l = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { l += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; } if (n && l / n > 200) btn.classList.add("dark"); } catch { /* 読めない画像はそのまま */ } };
  if (im.complete && im.naturalWidth) run(); else im.addEventListener("load", run, { once: true });
}
// ---- くわしく（任意） ----
function cardMore() {
  const f = S.form, t = f.target, a = S.job?.analysis || {};
  const inp = (k, label, ph = "", mode = "") => `<div class="fld"><label class="lb">${label}${aiBadge(k)}</label><input class="in" data-f="${k}" value="${v(k.startsWith("target.") ? t[k.slice(7)] : f[k])}" placeholder="${esc(ph)}" ${mode ? `inputmode="${mode}"` : ""}></div>`;
  const FIELD = { layout: 1, area: 1, floor: 1, orientation: 1 };
  const qs = (a.unclear || []).filter((u) => !FIELD[u.field]);
  const rooms = roomsList();
  return shell({ step: "more", chips: chipsHtml("more"), body: `
    <h1 class="ttl">くわしく入れる<span class="opt-l">任意</span></h1>
    <div class="scroll">
      ${inp("property_name", "物件名", "例: みなと台レジデンス 1203号室")}
      <div class="g2">${inp("area", "広さ（㎡）", "", "decimal")}${inp("floor", "階", "", "numeric")}${inp("orientation", "向き", "南")}${inp("built", "築年", "築8年")}${inp("station", "最寄り駅", "みなと台駅")}${inp("walk_min", "駅から徒歩（分）", "", "numeric")}</div>
      ${inp("selling_point", "一番見せたいところ", "例: バルコニーから海が見える")}
      ${inp("catch_idea", "最初の3秒の一言（12文字まで）", "例: 12階から海を一望")}
      <p class="note">「最高」「絶景」など いちばんを言う言葉は使えません</p>
      ${qs.length ? `<h2 class="ttl2">AIからの質問</h2>${qs.map((u) => `<div class="fld"><label class="lb">${esc(u.question)}</label><input class="in" data-q="${esc(u.question)}" value="${v(f.answers[u.question])}"></div>`).join("")}` : ""}
      ${rooms.length ? `<h2 class="ttl2">部屋ごとに伝えたいこと${!S.roomsTouched && !(S.job?.form?.rooms || []).length ? '<i class="aib">AI案</i>' : ""}</h2>${rooms.map((r, i) => `<div class="rm"><input class="in" data-rm="${i}" data-rk="name" value="${v(r.name)}" aria-label="部屋"><input class="in" data-rm="${i}" data-rk="features" value="${v(r.features)}" aria-label="伝えたいこと"></div>`).join("")}` : ""}
      <div class="g2">${inp("loan_monthly", "月々のローン目安", "月々12.8万円")}${inp("management_fee", "管理費")}${inp("repair_reserve", "修繕積立金")}${inp("floors_total", "何階建て", "", "numeric")}${inp("target.age", "年齢層", "30代")}${inp("target.kids_ages", "子どもの年齢", "0歳・3歳")}</div>
      <div class="opts">${[["remote_work", "在宅ワーク"], ["car", "車あり"], ["pet", "ペットあり"]].map(([k, l]) => `<label class="opt ${t[k] ? "on" : ""}"><input type="checkbox" data-f="target.${k}" ${t[k] ? "checked" : ""} hidden>${l}</label>`).join("")}</div>
      <div class="fld"><label class="lb">言ってはいけないこと・映したくないもの</label><textarea class="in" data-f="ng_items" placeholder="売主のNGなど">${v(f.ng_items)}</textarea></div>
      ${inp("line_url", "LINEのURL", "https://lin.ee/…")}
      <div class="g2">${inp("brand_color", "ブランドの色", "#0E2A47")}${inp("deal_type", "取引態様", "仲介・売主")}</div>
      ${inp("license_no", "宅建業免許番号", "〇〇県知事(1)第00000号")}${inp("address", "所在地")}
    </div>
    <button type="button" class="pill main" data-go="f">戻る</button>` });
}
function roomsList() {
  const f = S.form, a = S.job?.analysis || {}, sg = a.suggest || {};
  if (f.rooms.length) return f.rooms;
  const sgRooms = (sg.rooms || []).filter((r) => r.name);
  const rooms = sgRooms.length ? sgRooms : uniq((a.rooms || []).map((r) => r.name)).map((name) => ({ name, features: (a.rooms.find((r) => r.name === name)?.features || []).join(" ") }));
  return rooms.map((r) => ({ name: r.name, features: r.features || "" }));
}

// ---- カードの動く部分 ----
function paint() {
  if (!S || !$app.querySelector(".glass")) return;
  const st = S.step;
  if (st === "b") paintB();
  if (st === "e") paintE();
  if (st === "c") { const l = document.getElementById("layout"); if (l && document.activeElement !== l && l.value !== S.form.layout) l.value = S.form.layout; const fl = document.getElementById("fld-layout"); fl?.querySelector(".aib")?.remove(); fl?.insertAdjacentHTML("beforeend", aiBadge("layout")); }
  if (st === "c") { fitPrice(); document.fonts?.ready.then(fitPrice); }
  if (st === "f") { const lb = document.getElementById("logoBtn"); if (lb) { lb.innerHTML = logoInner(); toneLogo(lb); } const lb2 = document.getElementById("logoBtn2"); if (lb2) lb2.textContent = hasLogo() ? "変える" : "選ぶ"; }
  if (S.floorplanFile && S.job && !RUNNING.has(S.job.status)) uploadFloorplan();
  if (S.logoFile && S.job && S.job.status !== "analyzing") uploadLogo();
  bindStep(); paintBtn();
}
let bound = null;
function bindStep() {
  const g = $app.querySelector(".glass"); if (!g || bound === g) return; bound = g;
  g.querySelectorAll("[data-deal]").forEach((b) => (b.onclick = () => { S.form.deal = b.dataset.deal; g.querySelectorAll("[data-deal]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); }); scheduleSave(); }));
  g.querySelectorAll("[data-house]").forEach((b) => (b.onclick = () => { S.form.target.household = b.dataset.house; delete S.ai.household; g.querySelectorAll("[data-house]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); x.querySelector(".aib")?.remove(); }); document.getElementById("fld-household")?.classList.remove("miss"); scheduleSave(); paintBtn(); }));
  g.querySelectorAll("[data-var]").forEach((b) => (b.onclick = () => { S.form.catch_strength = b.dataset.var; g.querySelectorAll("[data-var]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }); scheduleSave(); }));
  g.querySelectorAll("[data-q]").forEach((el) => (el.oninput = () => { S.form.answers[el.dataset.q] = el.value.trim(); scheduleSave(); }));
  g.querySelectorAll("[data-rm]").forEach((el) => (el.oninput = () => { if (!S.form.rooms.length) S.form.rooms = roomsList().map((r) => ({ ...r })); S.form.rooms[Number(el.dataset.rm)][el.dataset.rk] = el.value; S.roomsTouched = true; scheduleSave(); }));
  g.querySelectorAll(".opts input[type=checkbox]").forEach((el) => el.addEventListener("change", () => el.closest(".opt").classList.toggle("on", el.checked)));
  const fp = document.getElementById("floorplanPick");
  if (fp) {
    document.getElementById("floorplanBtn").onclick = document.getElementById("floorplanBtn2").onclick = () => fp.click();
    fp.onchange = () => { const file = fp.files[0]; if (!file) return; S.floorplanFile = file; S.floorplanError = ""; if (S.floorplanPreview) URL.revokeObjectURL(S.floorplanPreview); S.floorplanPreview = URL.createObjectURL(file); document.getElementById("floorplanBtn").innerHTML = floorplanInner(); document.getElementById("floorplanBtn2").textContent = "変える"; uploadFloorplan(); };
  }
  const lp = document.getElementById("logoPick");
  if (lp) {
    const open = () => lp.click();
    document.getElementById("logoBtn").onclick = open; document.getElementById("logoBtn2").onclick = open;
    lp.onchange = () => { const file = lp.files[0]; if (!file) return; S.logoFile = file; S.logoPreview = URL.createObjectURL(file); document.getElementById("fld-logo")?.classList.remove("miss"); if (S.job) uploadLogo(); else paint(); };
  }
  const mk = document.getElementById("make"); if (mk) mk.onclick = submit;
  const nx = document.getElementById("next");
  if (nx && S.step === "b") nx.onclick = () => { if (!sources().length && !uploading()) return toast("まず動画を入れてください", true); go2("c"); };
}

function paintB() {
  const box = document.getElementById("thumbs"); if (!box) return;
  const src = sources(), live = liveUps(), busy = S.job?.status === "analyzing";
  const key = src.map((f) => f.id).join(",") + "|" + live.map((u) => `${u.k}:${u.err ? "e" : ""}`).join(",") + (busy ? "|busy" : "");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const tiles = src.map((f, i) => `<div class="th" data-fid="${esc(f.id)}"><img alt="" data-src-fid="${esc(f.id)}"><span class="n">${i + 1}</span><button type="button" class="del" data-del="${esc(f.id)}" aria-label="${i + 1}本目を外す" ${busy ? "disabled" : ""}>×</button></div>`)
      .concat(live.map((u) => `<div class="th up ${u.err ? "err" : ""}" data-k="${u.k}"><img alt="" ${S.thumbs["u" + u.k] ? `src="${esc(S.thumbs["u" + u.k])}"` : ""}><span class="pc">${u.err ? "失敗" : "0%"}</span>${u.err ? `<button type="button" class="del" data-drop="${u.k}" aria-label="消す">×</button>` : ""}</div>`));
    const full = src.length + live.filter((u) => !u.err).length >= 6;
    if (!full) tiles.push(`<button type="button" class="th add" data-pick ${busy ? "disabled" : ""} aria-label="動画を追加"><img src="./assets/icon-plus.png" alt=""></button>`);
    box.innerHTML = tiles.join("");
    box.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => document.getElementById("pick").click()));
    box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("この動画を外しますか？")) return;
      try { await api(`/api/jobs/${S.job.id}/files/${b.dataset.del}`, { method: "DELETE" }); await refresh(); S.needAnalyze = sources().length > 0; if (!sources().length) setBg(null); else bgFromJob(S.job); paint(); maybeAnalyze(); } catch (e) { toast(e.message, true); }
    }));
    box.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = () => { S.ups = S.ups.filter((u) => String(u.k) !== b.dataset.drop); paint(); }));
    src.forEach((f) => { const im = box.querySelector(`[data-src-fid="${f.id}"]`); const cached = S.thumbs[f.id]; if (cached) im.src = cached; else grabFrame(window.maDemo.file(f.id), 0.35, 240).then((u) => { if (u) { S.thumbs[f.id] = u; im.src = u; } }); });
  }
  live.forEach((u) => { const pc = box.querySelector(`[data-k="${u.k}"] .pc`); if (pc && !u.err) pc.textContent = `${Math.round(u.p * 100)}%`; });
  document.getElementById("count").textContent = `${src.length + live.filter((u) => !u.err).length} / 6本`;
  // AIの状態
  const ai = document.getElementById("aiBox"), j = S.job, a = j?.analysis;
  let t = "", bar = 0, sub = "", btn = "";
  if (uploading()) { const tot = live.reduce((s, u) => s + (u.file?.size || 1), 0) || 1; bar = live.reduce((s, u) => s + u.p * (u.file?.size || 1), 0) / tot; t = "動画を送っています"; sub = "終わるとAIが自動で読み取ります"; }
  else if (j?.status === "analyzing") { const el = (Date.now() - (S.aiAt || Date.now())) / 1000; bar = Math.min(0.92, 0.08 + el / 150); t = "AIが動画を読んでいます"; sub = "読み取り中… 先に進んでも大丈夫です"; }
  else if (j?.status === "failed" && !a) { t = "読み取りが止まりました"; sub = j.error || S.aiErr || ""; btn = "もう一度"; }
  else if (!a && S.aiErr) { t = "読み取りを始められませんでした"; sub = S.aiErr; btn = "もう一度"; }
  else if (a && S.needAnalyze) { t = "動画が変わりました"; sub = S.aiErr ? `読み直せませんでした: ${S.aiErr}` : "「動画を作る」を押すと読み直してから進みます"; btn = "いま読み直す"; bar = 1; }
  else if (a) { t = "読み取りました"; bar = 1; sub = uniq((a.rooms || []).map((r) => r.name)).join("・"); }
  else { t = "動画を待っています"; }
  ai.innerHTML = `<p class="aiT">${esc(t)}</p><div class="bar"><i style="width:${Math.round(bar * 100)}%"></i></div><p class="aiS">${esc(sub)}</p>${btn ? `<button type="button" class="pill sub" id="reAi">${btn}</button>` : ""}`;
  const r = document.getElementById("reAi"); if (r) r.onclick = () => { S.aiErr = ""; S.needAnalyze = true; maybeAnalyze(true); };
  if ((uploading() || j?.status === "analyzing") && !S.tick) S.tick = setTimeout(() => { S && (S.tick = null); if (S?.step === "b") paintB(); }, 1000);
}
function paintE() {
  const src = sources(); if (!src.length) return;
  $app.querySelectorAll("[data-vth]").forEach((el) => {
    const i = Number(el.dataset.vth), f = src[i % src.length], at = [0.3, 0.55, 0.8][i];
    grabFrame(window.maDemo.file(f.id), at, 240).then((u) => { if (u && !el.firstChild) el.innerHTML = `<img src="${u}" alt="">`; });
  });
}

// ---------------- アップロード ----------------
async function ensureJob() {
  if (S.job) return S.job;
  if (!S.jobP) S.jobP = createJob().finally(() => { S && (S.jobP = null); });   // 2回続けて選んでも物件は1つだけ
  return S.jobP;
}
async function createJob() {
  const { id } = await post("/api/jobs", { title: S.form.property_name || "新しい物件" });
  localStorage.setItem(CUR, id);
  S.job = await api(`/api/jobs/${id}`);
  history.replaceState(null, "", `#/job/${id}/${S.step === "a" ? "b" : S.step}`);
  return S.job;
}
let upSeq = 0;
async function addFiles(list) { window.maDemo.useSamples(); return;
  list = list.filter((x) => /^video\//.test(x.type) || /\.(mov|mp4|m4v)$/i.test(x.name));
  if (!list.length) return;
  if (S.job?.status === "analyzing") return toast("AIが読み取り中です\n読み取りが終わってから追加してください", true);
  const room = 6 - sources().length - S.ups.filter((u) => !u.done && !u.err).length;
  if (list.length > room) { toast(`動画は6本までです（あと${Math.max(0, room)}本）`, true); list = list.slice(0, Math.max(0, room)); }
  if (!list.length) return;
  const items = list.map((file) => ({ k: ++upSeq, file, name: file.name, p: 0, done: false, err: "" }));
  S.ups.push(...items);
  // 写真とサムネはその場で（アップロードを待たない）
  items.forEach((u, i) => { const url = URL.createObjectURL(u.file); grabFrame(url, 0.35, i === 0 && !sources().length ? 900 : 240).then((x) => { if (!x || !S) return; S.thumbs["u" + u.k] = x; if (i === 0 && !sources().length) setBg(x); const im = document.querySelector(`[data-k="${u.k}"] img`); if (im) im.src = x; }); });
  if (S.step === "a") show("b"); else paint();
  let job;
  try { job = await ensureJob(); } catch (e) { items.forEach((u) => (u.err = e.message)); paint(); return; }
  if (S.logoFile) uploadLogo();
  for (const u of items) {
    try { await uploadFile(job.id, "source", u.file, (r) => { u.p = r; }); u.done = true; S.needAnalyze = true; }
    catch (e) { u.err = e.message; }
    const before = new Set(sources().map((f) => f.id));
    await refresh();
    const nf = sources().find((f) => !before.has(f.id)); if (nf && S.thumbs["u" + u.k]) S.thumbs[nf.id] = S.thumbs["u" + u.k];
  }
  S.ups = S.ups.filter((u) => !u.done);
  paint(); maybeAnalyze();
}
function videoDuration(file) {
  return new Promise((res) => { const el = document.createElement("video"); el.preload = "metadata"; el.onloadedmetadata = () => { res(el.duration || 0); URL.revokeObjectURL(el.src); }; el.onerror = () => res(0); el.src = URL.createObjectURL(file); });
}
async function uploadFile(jobId, kind, file, onProgress) {
  const duration = kind === "source" ? await videoDuration(file) : 0;
  const { fileId, partSize, parts } = await post(`/api/jobs/${jobId}/files/start`, { kind, name: file.name, size: file.size, type: file.type || (kind === "source" ? "video/mp4" : "image/png"), duration });
  const done = []; let sent = 0, next = 1;
  const worker = async () => {
    while (next <= parts) {
      const n = next++; const blob = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
      for (let a = 0; ; a++) {
        try { const r = await api(`/api/jobs/${jobId}/files/${fileId}/part/${n}`, { method: "PUT", body: blob }); done.push(r); break; }
        catch (e) { if (a >= 2) throw e; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
      }
      sent += blob.size; onProgress(sent / file.size);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await post(`/api/jobs/${jobId}/files/${fileId}/complete`, { parts: done });
}
async function refresh() { if (S?.job) S.job = await api(`/api/jobs/${S.job.id}`); return S?.job; }
async function uploadFloorplan() {
  if (!S?.floorplanFile || !S.job || RUNNING.has(S.job.status) || S.floorplanBusy) return;
  const state = S, file = S.floorplanFile; state.floorplanBusy = true;
  try {
    const old = state.job.files.filter(x => x.kind === "floorplan");
    await uploadFile(state.job.id, "floorplan", file, () => {});
    for (const x of old) await api(`/api/jobs/${S.job.id}/files/${x.id}`, { method: "DELETE" });
    state.floorplanFile = null; await refresh();
  } catch (e) { state.floorplanFile = null; state.floorplanError = e.message; toast(`間取り図: ${e.message}`, true); }
  finally { state.floorplanBusy = false; }
}
async function uploadLogo() {
  const file = S.logoFile; if (!file || !S.job) return;
  if (S.job.status === "analyzing") return;   // 読み取りが終わったら送る（paint から）
  S.logoFile = null;
  try { const old = S.job.files.filter((x) => x.kind === "logo"); await uploadFile(S.job.id, "logo", file, () => {}); for (const o of old) await api(`/api/jobs/${S.job.id}/files/${o.id}`, { method: "DELETE" }).catch(() => {}); await refresh(); }
  catch (e) { toast(`ロゴ: ${e.message}`, true); S.logoPreview = ""; }
  paint();
}

// ---------------- AIの読み取り ----------------
// force なし（アップロード直後の自動）は、まだ一度も読み取っていないときだけ。
// 読み取り済みで動画を足した・外したときは、「動画を作る」か「いま読み直す」で1回だけ読み直す（余計な費用を出さない）
async function maybeAnalyze(force) {
  if (!S || !S.needAnalyze || uploading() || !S.job || !sources().length || RUNNING.has(S.job.status)) return;
  if (S.job.analysis && !force) return paint();
  S.needAnalyze = false; S.aiErr = "";
  try { await post(`/api/jobs/${S.job.id}/analyze`); S.aiAt = Date.now(); await refresh(); paint(); poll(); }
  catch (e) { toast(e.message, true); S.aiErr = e.message; if (S.job.analysis) S.needAnalyze = true; paint(); }
}
function poll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!S || !S.job) return;
    const before = S.job.status;
    try { await refresh(); } catch { return poll(); }
    if (!S) return;
    if (S.job.status === "analyzing") { paint(); return poll(); }
    // 読み直しが止まったとき: 前の読み取り結果が残っていても構成づくりへは進まない
    if (before === "analyzing" && S.job.status === "failed") {
      S.aiErr = S.job.error || "読み取りが止まりました"; if (S.job.analysis) S.needAnalyze = true;
      if (S.pending) { S.pending = false; toast(`読み直せませんでした: ${S.aiErr}`, true); }
      if (S.step === "c" || S.step === "d") show(S.step); else paint();
      return paintBtn();
    }
    if (before === "analyzing" && S.job.analysis) { applyAutofill(); toast("AIが動画を読み取りました\n空いている欄にAI案を入れました"); }
    if (S.step === "c" || S.step === "d") show(S.step); else paint();
    if (S.pending) go();
  }, 3500);
}
// AI案は空いている欄にだけ（入力済みは上書きしない）
function applyAutofill(silent) {
  const a = S.job.analysis || {}, sg = a.suggest || {}, best = a.best_shots?.[0], f = S.form;
  const fill = (k, val) => { if (!f[k] && val) { f[k] = val; S.ai[k] = true; } };
  fill("layout", sg.layout); fill("orientation", sg.orientation); fill("selling_point", sg.selling_point || best?.what); fill("catch_idea", sg.catch_idea);
  if (f.selling_t === "" && (sg.selling_t !== undefined || best)) { f.selling_src = sg.selling_t !== undefined ? sg.selling_src || 0 : best.src || 0; f.selling_t = sg.selling_t !== undefined ? sg.selling_t : best.in; }
  if (!f.target.household && sg.target_hint) {
    const k = /子育て|ファミリー|子ども|子供/.test(sg.target_hint) ? "family" : /夫婦|カップル|二人|2人|DINKS/i.test(sg.target_hint) ? "couple" : /シニア|高齢/.test(sg.target_hint) ? "senior" : /単身|一人|1人|ひとり/.test(sg.target_hint) ? "single" : "";
    if (k) { f.target.household = k; S.ai.household = true; }
  }
  S.applied = true;
  if (!silent) scheduleSave();
}

// ---------------- 保存 ----------------
function scheduleSave() { clearTimeout(S.saveT); S.saveT = setTimeout(save, 800); }
async function save() {
  if (!S || !S.job || RUNNING.has(S.job.status)) return;
  try { await put(`/api/jobs/${S.job.id}/form`, readForm()); } catch { /* 次の入力で再保存 */ }
}
function readForm() {
  const f = S.form, s = (x) => String(x ?? "").trim();
  const rooms = (f.rooms.length ? f.rooms : roomsList()).filter((r) => s(r.name)).map((r) => ({ name: s(r.name), features: s(r.features) }));
  return { ...f, property_name: s(f.property_name), price: s(f.price), layout: s(f.layout), rooms, selling_src: Number(f.selling_src) || 0, selling_t: f.selling_t === "" ? "" : f.selling_t,
    target: { ...f.target }, nearby: f.nearby, answers: Object.fromEntries(Object.entries(f.answers).map(([k, x]) => [k, s(x)])) };
}
// 足りないもの（サーバーの requiredMissing と同じ ＋ ロゴ）。[カード, 欄id, 名前]
function missing() {
  const f = S.form, m = [];
  if (!sources().length && !uploading()) m.push(["a", "", "動画"]);
  if (!s0(f.price)) m.push(["c", "fld-price", f.deal === "rent" ? "賃料" : "価格"]);
  if (!s0(f.layout) && S.applied) m.push(["c", "fld-layout", "間取り"]);
  if (!f.target.household) m.push(["d", "fld-household", "誰に見せたいか"]);
  if (!s0(f.company_name)) m.push(["f", "fld-company_name", "会社名"]);
  if (!hasLogo()) m.push(["f", "fld-logo", "会社ロゴ"]);
  return m;
}
const s0 = (x) => String(x ?? "").trim();
function paintBtn() {
  const btn = document.getElementById("make"); if (!btn || !S) return;
  const why = document.getElementById("why");
  if (S.pending) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>準備ができたら進みます'; why.textContent = uploading() ? "動画を送り終わるのを待っています" : "AIの読み取りが終わるのを待っています"; return; }
  btn.disabled = false; btn.textContent = "動画を作る";
  const m = missing();
  why.textContent = m.length ? `あと: ${m.map((x) => x[2]).join("・")}` : "次の画面で構成を確かめてから書き出します";
}
function flagMissing(m) {
  if (S.step !== m[0][0]) go2(m[0][0]);
  setTimeout(() => m.filter((x) => x[0] === S.step).forEach(([, id]) => document.getElementById(id)?.classList.add("miss")), 60);
  toast(`入力が足りません: ${m.map((x) => x[2]).join("・")}`, true);
}
async function submit() {
  if (S.pending) return;   // 連打で二重に送らない
  const m = missing();
  if (m.length) return flagMissing(m);
  S.pending = true; paintBtn(); go();
}
// アップロードと読み取りが終わっていたら、保存して構成づくりへ
async function go() {
  if (!S || !S.pending) return;
  if (uploading()) { setTimeout(go, 1500); return paintBtn(); }
  if (!S.job) { S.pending = false; return paintBtn(); }
  if (S.needAnalyze || (!S.job.analysis && S.job.status !== "analyzing")) { S.needAnalyze = true; await maybeAnalyze(true); if (S.aiErr) { S.pending = false; return paintBtn(); } }
  if (S.job.status === "analyzing") { poll(); return paintBtn(); }
  if (!S.job.analysis) { S.pending = false; return paintBtn(); }
  const m = missing();
  if (m.length) { S.pending = false; paintBtn(); return flagMissing(m); }
  if (S.floorplanBusy) { setTimeout(go, 200); return; }
  if (S.floorplanFile) { await uploadFloorplan(); if (S.floorplanFile) return; }
  if (S.floorplanError) { S.pending = false; paintBtn(); return toast(`間取り図: ${S.floorplanError}`, true); }
  if (S.going) return;   // submit と poll から同時に来ても 構成づくりは1回だけ
  S.going = true;
  try {
    clearTimeout(S.saveT);
    await put(`/api/jobs/${S.job.id}/form`, readForm());
    await post(`/api/jobs/${S.job.id}/plan`);
    localStorage.removeItem(CUR);
    location.hash = `#/job/${S.job.id}`;
  } catch (e) { S.pending = false; S.going = false; paintBtn(); toast(e.message, true); }
}

// =====================================================================
// 「動画を作る」のあと: 構成の確認 → 書き出し → 完成
// =====================================================================
const THEMES = [["hotel", "ホテル"], ["modern", "モダン"], ["natural", "北欧"], ["wa", "和モダン"], ["industrial", "工業風"], ["pop", "カラフル"], ["moody", "ダーク"]];
function themePicker(j) {
  const recommended = THEMES.some(([id]) => id === j.analysis?.theme) ? j.analysis.theme : "modern";
  const selected = j.plan.theme || recommended;
  return `<h2 class="ttl2">型を選ぶ</h2><div class="theme-grid" role="group" aria-label="テロップの型">${THEMES.map(([id, label]) => `<button type="button" class="theme-card" data-theme="${id}" aria-pressed="${selected === id}"><img src="./assets/themes/${id}.png" alt="${label}のテロップ見本" loading="lazy"><span>${label}</span>${id === recommended ? '<small>おすすめ</small>' : ""}</button>`).join("")}</div>`;
}
const AFTER = ["構成", "書き出し", "完成"];
const STEP_OF = { planning: 0, plan_ready: 0, rendering: 1, reviewing: 1, done: 2, failed: 0 };
const TYPE = { eyecatch: "最初の3秒", logo: "会社ロゴ", overview: "物件概要", room: "部屋", best: "見せ場", cta: "問い合わせ" };
function afterShell(j, body) {
  const k = STEP_OF[j.status] ?? 0;
  return `<div class="scr">
    <header class="hd"><a class="mark frost" href="#/list" aria-label="これまでの動画"><img src="./assets/ma-logo.png" alt="間 ma"></a>
      <div class="prog frost"><span class="dots">${AFTER.map((_, i) => `<i class="${i <= k ? "on" : ""}"></i>`).join("")}</span><span class="frac">${AFTER[k]}</span></div></header>
    <div class="chips"><span class="chip frost">${esc(j.title)}</span></div>
    <div class="grow"></div>
    <section class="glass">${body}</section></div>`;
}
function jobView(j, keepScroll) {
  S = null;
  bgFromJob(j);
  let body = "";
  const err = j.error ? `<p class="note bad">止まりました: ${esc(j.error)}</p>` : "";
  if (RUNNING.has(j.status)) {
    const last = j.events[j.events.length - 1];
    const plan = j.status === "planning";
    body = `<h1 class="ttl">${plan ? "構成を考えています" : "書き出しています"}</h1>
      <div class="bar run"><i></i></div>
      <p class="aiS">${esc(last?.message || STATUS[j.status])}</p>
      <p class="note">${plan ? "数秒で構成ができます<br>" : "数秒で完成します<br>"}この画面は閉じても大丈夫です</p>
      ${eventsHtml(j)}`;
  } else if (j.status === "plan_ready" || (j.status === "failed" && j.plan && !j.outputs)) {
    const p = j.plan;
    body = `<h1 class="ttl">構成の確認</h1>${err}
      <div class="scroll plan">
        
        ${(p.warnings || []).length ? `<p class="note warn">${p.warnings.map(esc).join("<br>")}</p>` : ""}
        ${sceneCards(j)}
        <label class="lb">TikTokの説明文</label><textarea class="in" id="cap" style="min-height:120px">${v(p.caption)}</textarea>
        <p class="note">${esc(p.hashtags.join(" "))}</p>
        ${themePicker(j)}
      </div>
      <div class="row2"><button type="button" class="pill sub" id="psave">保存</button><button type="button" class="pill main" id="approve">この内容で書き出す</button></div>
      <p class="c"><a class="txt u" href="#/job/${esc(j.id)}/edit">入力に戻る</a></p>`;
  } else if (j.status === "done") {
    const o = j.outputs || {}, rv = j.review || {};
    const issues = (rv.issues || []).filter((i) => i.severity !== "low");
    body = `<h1 class="ttl">できました${j.duration ? `<span class="opt-l">${formatSeconds(j.duration)}</span>` : ""}</h1>
      <div class="scroll done">
        <div id="completed-timeline"><video controls playsinline preload="metadata" src="${esc(o.publish || o.client)}" poster="${esc(o.publish_thumbnail || o.thumbnail)}"></video>${timelineHtml()}</div>
        
        
        <label class="lb">TikTokの説明文</label><textarea class="in" id="capout" readonly style="min-height:110px">${v(j.caption)}</textarea>
        <h2 class="ttl2">AIの自動チェック</h2><p class="note">${esc(rv.summary || "")}</p>
        ${issues.length ? `<p class="note warn">${issues.map((i) => `${formatSeconds(i.t)}: ${esc(i.detail)}${i.fix ? `（${esc(i.fix)}）` : ""}`).join("<br>")}</p>` : ""}
        <a class="pill sub" href="${esc(o.thumbnail)}?dl=1">サムネイルを保存</a>

        ${(j.plan.warnings || []).map(w=>`<p class="note">${esc(w)}</p>`).join("")}
        <h2 class="ttl2">これまでの版</h2><div class="versions">${(j.versions || []).filter(x=>x.state==="done").map((x,i)=>`<button class="pill sub" data-restore="${x.version}">${x.version}版${j.activeVersion===x.version || (!j.activeVersion && i===0)?" 表示中":" に戻す"}</button>`).join("")}</div>
        <button type="button" class="pill sub" id="reedit">気になる場面を直す</button>
      </div>
      <div class="row2"><button type="button" class="pill sub" id="copy">説明文をコピー</button><a class="pill main" href="#/new">別の物件を作る</a></div>`;
  }
  const y = $app.querySelector(".scroll")?.scrollTop || 0;
  $app.innerHTML = afterShell(j, body);
  if (keepScroll) { const sc = $app.querySelector(".scroll"); if (sc) sc.scrollTop = y; }
  window.maDemo.play(document.querySelector("#completed-timeline video"),j);
  bindJob(j);
  if (RUNNING.has(j.status)) timer = setTimeout(async () => { const n = await api(`/api/jobs/${j.id}`).catch(() => j); if (location.hash === `#/job/${j.id}`) jobView(n, true); }, 4000);
}
function eventsHtml(j) { return j.events.length ? `<details class="ev"><summary>経過</summary><div>${j.events.slice(-12).map((e) => `<p>${new Date(e.at * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}　${esc(e.message)}</p>`).join("")}</div></details>` : ""; }
function readPlanEdits() {
  const segments = readComposition();
  return { theme: document.querySelector('[data-theme][aria-pressed="true"]')?.dataset.theme, segments, caption: document.getElementById("cap").value.trim() };
}
function bindJob(j) {
  bindComposition(j,grabFrame);
  document.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => {
    document.querySelectorAll("[data-theme]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = async (e) => { e.preventDefault(); if (el.disabled) return; el.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { el.disabled = false; } }; };
  const reload = async () => jobView(await api(`/api/jobs/${j.id}`));
  on("psave", async () => { const r = await put(`/api/jobs/${j.id}/plan`, readPlanEdits()); toast(r.plan.warnings.length ? "保存しました（注意があります）" : "保存しました"); reload(); });
  on("approve", async () => { await put(`/api/jobs/${j.id}/plan`, readPlanEdits()); if (!confirm("この内容で書き出しますか")) return; await post(`/api/jobs/${j.id}/approve`); reload(); });
  on("copy", async () => { await navigator.clipboard.writeText(document.getElementById("capout").value); toast("コピーしました"); });
  const completed=document.getElementById('completed-timeline');
  if(completed){
    const timeline=mountTimeline(completed,j,{video:completed.querySelector('video'),grabFrame,completed:true,editable:false,onOpen:id=>{timeline.destroy();revisionEditor(j,{app:$app,shell:afterShell,post,reload,grabFrame,toast});document.querySelector(`[data-scene="${id}"]`)?.click();}});
  }
  on("reedit", async () => { revisionEditor(j, { app: $app, shell: afterShell, post, reload, grabFrame, toast }); });
  document.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => { b.disabled=true; try { await post(`/api/jobs/${j.id}/versions/restore`, {version:Number(b.dataset.restore)}); await reload(); } catch(e) {toast(e.message,true);b.disabled=false;} });
  if(j.status === "plan_ready") fillFrames(j,grabFrame);
}

// パソコンはどこにドロップしても入る
["dragover", "drop"].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" && S && e.dataTransfer?.files?.length) window.maDemo.useSamples(); }));
route();
