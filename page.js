// 玻璃板回收与二次涂布准入台 —— 页面业务文件
// 列表、待涂布队列、玻璃板履历三个视图都取自同一个 /api/state 快照，刷新后一致。

export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>玻璃板回收与二次涂布准入台</title>
<style>
:root { --bg:#eef1ec; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#3f6b52; --warn:#9b4937; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif; }
header { padding:20px 26px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
h1 { margin:0; font-size:23px; } h2 { margin:0 0 10px; font-size:16px; }
main { display:grid; grid-template-columns:360px 1fr; gap:20px; padding:20px 26px; align-items:start; }
form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
form { margin-bottom:14px; }
label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; }
input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; }
button.secondary { background:#69736a; } button.warn { background:var(--warn); } button:disabled { opacity:.45; cursor:not-allowed; }
.btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; margin-bottom:14px; }
.stat { padding:10px; } .stat strong { display:block; font-size:22px; } .stat span { font-size:12px; color:var(--muted); }
.tabs { display:flex; gap:8px; margin-bottom:12px; } .tabs button.on { outline:2px solid var(--ink); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
.card { display:grid; gap:7px; }
.card h3 { margin:0; display:flex; justify-content:space-between; gap:8px; align-items:center; }
.pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; }
.pill.ok { background:#e3efe6; border-color:#9fc3ab; color:#2f5d40; }
.pill.no { background:#f7e6e1; border-color:#d3a294; color:var(--warn); }
.meta { color:var(--muted); font-size:13px; }
.sub { border-top:1px dashed var(--line); padding-top:7px; font-size:13px; }
.toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
.toolbar select,.toolbar input { width:auto; min-width:150px; }
.queue-row,.hist-row { border:1px solid var(--line); border-radius:8px; background:#fff; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.tag { font-size:12px; color:var(--muted); }
.logs { max-height:360px; overflow:auto; }
details { margin-top:8px; } summary { cursor:pointer; color:var(--muted); font-size:13px; }
.error { color:var(--warn); font-weight:700; font-size:13px; margin-top:8px; min-height:16px; }
@media (max-width:920px){ main{grid-template-columns:1fr;} header{display:block;} }
</style>
</head>
<body>
<header>
  <div>
    <h1>玻璃板回收与二次涂布准入台</h1>
    <div class="meta">旧底片交付登记 → 缺陷判定（划痕 / 乳剂残留 / 清洗人）→ 另一人两次洁净确认（间隔四小时）→ 准予回用 → 涂布槽</div>
  </div>
  <button id="reload">刷新</button>
</header>
<main>
  <section id="forms"></section>
  <section>
    <div class="stats" id="stats"></div>
    <div class="tabs">
      <button data-tab="list" class="on">玻璃板列表</button>
      <button data-tab="queue">待涂布队列</button>
      <button data-tab="history">玻璃板履历</button>
    </div>
    <div id="tab-list" class="panel">
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号、清洗人、备注">
      </div>
      <div class="grid" id="cards"></div>
    </div>
    <div id="tab-queue" class="panel" hidden>
      <h2>待涂布队列（仅「准予回用」的玻璃板可占用涂布槽）</h2>
      <div id="queue"></div>
    </div>
    <div id="tab-history" class="panel" hidden>
      <div class="toolbar"><select id="histSelect"></select></div>
      <h2>操作流水</h2>
      <div class="logs" id="histRows"></div>
      <h2 style="margin-top:14px">归档旧记录（留档可查）</h2>
      <div class="logs" id="archiveRows"></div>
    </div>
  </section>
</main>
<script>
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
let state = { plates: [], history: [], archives: [], constants: {}, stats: {} };
let tab = "list";

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}
function reqId() { return "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(at) { return at ? at.replace("T", " ").replace(/\\.\\d+Z$/, "Z") : ""; }

// ---------- 左侧操作表单 ----------
const formDefs = [
  {
    id: "f-create", title: "1. 玻璃板建档",
    fields: [["code", "玻璃板编号", "text", true], ["plateSize", "玻璃板尺寸", "text"], ["source", "来源旧底片批次", "text"], ["note", "备注", "text"]],
    submit: (f) => api("/api/plates", { requestId: reqId(), ...Object.fromEntries(new FormData(f)) })
  },
  {
    id: "f-delivery", title: "2. 旧底片交付登记",
    select: ["code", "选择玻璃板"],
    fields: [["cleaner", "清洗人", "text", true], ["scratchResult", "划痕判定", "select", true, ["合格", "不合格"]], ["scratch", "划痕描述（不合格必填）", "text"], ["residueResult", "乳剂残留判定", "select", true, ["合格", "不合格"]], ["residue", "乳剂残留描述", "text"]],
    submit: (f) => postAction(f, "delivery")
  },
  {
    id: "f-confirm", title: "3. 表面洁净确认（须另一人）",
    select: ["code", "选择玻璃板"],
    fields: [["inspector", "确认人（不得为清洗人）", "text", true]],
    note: "同一人连续两次，第二次与第一次间隔满四小时；不满足则拒绝，缺陷未达标的玻璃板只能复洗。",
    submit: (f) => postAction(f, "confirm")
  },
  {
    id: "f-correct", title: "4. 玻璃板档案更正",
    select: ["code", "选择玻璃板"],
    fields: [["plateSize", "更正后玻璃板尺寸", "text"], ["source", "更正后来源批次", "text"], ["note", "更正后备注", "text"]],
    submit: (f) => postAction(f, "correct")
  },
  {
    id: "f-slot", title: "5. 占用涂布槽",
    select: ["code", "选择准予回用玻璃板"],
    fields: [["slot", "涂布槽", "select", true, []]],
    submit: (f) => postAction(f, "occupy")
  }
];

function fieldHtml(d) {
  const [key, label, type, required, opts] = d;
  const req = required ? "required" : "";
  if (type === "select") return '<label>' + label + '</label><select name="' + key + '" ' + req + '><option value="">请选择</option>' + opts.map(o => '<option>' + o + '</option>').join("") + '</select>';
  return '<label>' + label + '</label><input name="' + key + '" type="' + type + '" ' + req + '>';
}
function renderForms() {
  $("#forms").innerHTML = formDefs.map(d =>
    '<form id="' + d.id + '"><h2>' + d.title + '</h2>' +
    (d.select ? '<label>' + d.select[1] + '</label><select name="' + d.select[0] + '"></select>' : "") +
    d.fields.map(fieldHtml).join("") +
    (d.note ? '<div class="meta" style="margin-top:8px">' + d.note + '</div>' : "") +
    '<div class="btns"><button>提交</button></div><div class="error"></div></form>'
  ).join("");
  formDefs.forEach(d => {
    const f = $("#" + d.id);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $(".error", f);
      try { await d.submit(f); f.reset(); errEl.textContent = ""; await load(); }
      catch (err) { errEl.textContent = err.message; }
    });
  });
}
async function postAction(f, action) {
  const data = Object.fromEntries(new FormData(f));
  const code = data.code;
  delete data.code;
  return api("/api/plates/" + encodeURIComponent(code) + "/" + action, { requestId: reqId(), ...data });
}

function refreshFormSelects() {
  const all = state.plates.map(p => p.code);
  fill("#f-delivery select[name=code]", all, code => code + " · " + state.plates.find(p => p.code === code).status);
  fill("#f-confirm select[name=code]", state.plates.filter(p => p.status === "待洁净确认").map(p => p.code));
  fill("#f-correct select[name=code]", all);
  fill("#f-slot select[name=code]", state.plates.filter(p => p.status === "准予回用").map(p => p.code));
  const slotSelect = $("#f-slot select[name=slot]");
  if (slotSelect) {
    const busy = new Set(state.activeSlots.map(s => s.slot));
    slotSelect.innerHTML = '<option value="">请选择</option>' + (state.constants.slots || []).map(s => '<option ' + (busy.has(s) ? "disabled" : "") + '>' + s + (busy.has(s) ? "（占用中）" : "") + '</option>').join("");
  }
}
function fill(sel, codes, label) {
  const el = $(sel);
  if (!el) return;
  el.innerHTML = '<option value="">请选择</option>' + codes.map(c => '<option value="' + esc(c) + '">' + esc(label ? label(c) : c) + "</option>").join("");
}

// ---------- 顶部统计 ----------
function renderStats() {
  $("#stats").innerHTML = Object.entries(state.stats).map(([k, v]) =>
    '<div class="stat"><span>' + k + "</span><strong>" + v + "</strong></div>"
  ).join("");
  const filter = $("#statusFilter");
  const cur = filter.value;
  filter.innerHTML = '<option value="">全部状态</option>' + (state.constants.statuses || []).map(s => '<option>' + s + '</option>').join("");
  filter.value = cur;
}

// ---------- 列表 ----------
function renderCards() {
  const status = $("#statusFilter").value;
  const q = $("#search").value.trim();
  const visible = state.plates.filter(p =>
    (!status || p.status === status) &&
    (!q || JSON.stringify({ c: p.code, m: p.note, cl: p.currentInspection && p.currentInspection.cleaner }).includes(q))
  );
  $("#cards").innerHTML = visible.map(cardHtml).join("") || '<div class="meta">没有符合条件的玻璃板</div>';
  $$("[data-quick]").forEach(btn => btn.onclick = () => quickAction(btn));
}
function cardHtml(p) {
  const ins = p.currentInspection;
  const ok = p.admitted;
  const confirmRows = (p.confirmations || []).map((c, i) =>
    '<div class="meta">第' + (i + 1) + '次确认：' + esc(c.inspector) + " · " + fmt(c.at) + "</div>"
  ).join("");
  const insHtml = ins ?
    '<div class="sub">交付登记 ' + fmt(ins.deliveredAt) + '<br>清洗人：' + esc(ins.cleaner) +
      '；划痕：' + ins.scratchResult + ' ' + esc(ins.scratch) +
      '<br>乳剂残留：' + ins.residueResult + ' ' + esc(ins.residue) +
      confirmRows + "</div>"
    : '<div class="sub meta">尚未登记旧底片交付</div>';
  const slotHtml = p.coating ? '<div class="meta">占用 ' + esc(p.coating.slot) + "（" + fmt(p.coating.occupiedAt) + "）</div>" : "";
  return '<article class="card">' +
    '<h3><span>' + esc(p.code) + '</span><span class="pill ' + (ok ? "ok" : "no") + '">' + esc(p.status) + "</span></h3>" +
    '<div class="meta">' + esc(p.plateSize) + " · " + esc(p.source) + " · 档案 v" + p.version + " / 第" + p.epoch + "轮 · 归档" + p.archivedCount + "次</div>" +
    '<div><b>准入结论：</b>' + esc(p.conclusion) + "</div>" +
    insHtml + slotHtml +
    '<div class="btns">' + quickButtons(p) + "</div></article>";
}
function quickButtons(p) {
  const b = [];
  if (["待登记交付", "待复洗", "已回退"].includes(p.status)) b.push('<button data-quick="delivery" data-code="' + esc(p.code) + '">登记交付/复洗重交</button>');
  if (p.status === "待洁净确认") b.push('<button data-quick="confirm" data-code="' + esc(p.code) + '">表面洁净确认</button>');
  if (["待复洗", "待洁净确认", "准予回用"].includes(p.status)) b.push('<button class="warn" data-quick="rollback" data-code="' + esc(p.code) + '">旧底片回退</button>');
  if (p.status === "准予回用") b.push('<button data-quick="occupy" data-code="' + esc(p.code) + '">占用涂布槽</button>');
  if (p.status === "涂布中") b.push('<button data-quick="complete" data-code="' + esc(p.code) + '">完成涂布释放槽位</button>');
  b.push('<button class="secondary" data-quick="correct" data-code="' + esc(p.code) + '">档案更正</button>');
  return b.join("");
}
async function quickAction(btn) {
  const code = btn.dataset.code;
  const action = btn.dataset.quick;
  try {
    if (action === "delivery") {
      const cleaner = prompt("清洗人"); if (!cleaner) return;
      const sr = prompt("划痕判定：合格 / 不合格", "合格"); if (!sr) return;
      const rr = prompt("乳剂残留判定：合格 / 不合格", "合格"); if (!rr) return;
      const scratch = sr === "不合格" ? prompt("划痕描述") || "" : "";
      const residue = rr === "不合格" ? prompt("乳剂残留描述") || "" : "";
      await api("/api/plates/" + encodeURIComponent(code) + "/delivery", { requestId: reqId(), cleaner, scratchResult: sr, residueResult: rr, scratch, residue });
    } else if (action === "confirm") {
      const inspector = prompt("表面洁净确认人（必须不是清洗人，连续两次间隔四小时）"); if (!inspector) return;
      await api("/api/plates/" + encodeURIComponent(code) + "/confirm", { requestId: reqId(), inspector });
    } else if (action === "rollback") {
      const reason = prompt("回退原因"); if (reason === null) return;
      await api("/api/plates/" + encodeURIComponent(code) + "/rollback", { requestId: reqId(), reason });
    } else if (action === "correct") {
      const plate = state.plates.find(p => p.code === code);
      const plateSize = prompt("更正后玻璃板尺寸（留空不改）", plate.plateSize); if (plateSize === null) return;
      const source = prompt("更正后来源批次（留空不改）", plate.source); if (source === null) return;
      const note = prompt("更正后备注（留空不改）", plate.note); if (note === null) return;
      const body = { requestId: reqId() };
      if (plateSize !== plate.plateSize) body.plateSize = plateSize;
      if (source !== plate.source) body.source = source;
      if (note !== plate.note) body.note = note;
      await api("/api/plates/" + encodeURIComponent(code) + "/correct", body);
    } else if (action === "occupy") {
      const busy = new Set(state.activeSlots.map(s => s.slot));
      const free = (state.constants.slots || []).filter(s => !busy.has(s));
      if (!free.length) return alert("涂布槽全部占用中");
      const slot = prompt("选择涂布槽：" + free.join("、"), free[0]); if (!slot) return;
      await api("/api/plates/" + encodeURIComponent(code) + "/occupy", { requestId: reqId(), slot });
    } else if (action === "complete") {
      await api("/api/plates/" + encodeURIComponent(code) + "/complete-coating", { requestId: reqId() });
    }
    await load();
  } catch (err) { alert(err.message); }
}

// ---------- 待涂布队列 ----------
function renderQueue() {
  const q = state.coatingQueue;
  const slots = state.activeSlots;
  $("#queue").innerHTML =
    '<div class="meta" style="margin-bottom:10px">队列 ' + q.length + ' 块 · 涂布槽占用 ' + slots.length + " / " + (state.constants.slots || []).length + "</div>" +
    (q.length ? q.map(p =>
      '<div class="queue-row"><div><b>' + esc(p.code) + "</b> <span class='tag'>" + esc(p.plateSize) + " · 清洗人 " + esc(p.currentInspection.cleaner) +
      " · 两次确认 " + esc(p.confirmations[0].inspector) + "</span><div class='tag'>" + esc(p.conclusion) + "</div></div>" +
      '<button data-quick="occupy" data-code="' + esc(p.code) + '">占用涂布槽</button></div>'
    ).join("") : '<div class="meta">队列为空：缺陷未达标的留待复洗，确认未满两次的等待第二次（间隔四小时）。</div>') +
    (slots.length ? "<h2>占用中的涂布槽</h2>" + slots.map(s =>
      '<div class="queue-row"><div><b>' + esc(s.slot) + "</b> <span class='tag'>" + esc(s.plateCode) + " · 自 " + fmt(s.occupiedAt) + "</span></div>" +
      '<button data-quick="complete" data-code="' + esc(s.plateCode) + '">完成涂布</button></div>').join("") : "");
  $$("#queue [data-quick]").forEach(btn => btn.onclick = () => quickAction(btn));
}

// ---------- 玻璃板履历 ----------
function renderHistory() {
  const sel = $("#histSelect");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部玻璃板</option>' + state.plates.map(p => '<option>' + esc(p.code) + "</option>").join("");
  sel.value = cur;
  const code = sel.value;
  const rows = state.history.filter(h => !code || h.plateCode === code);
  $("#histRows").innerHTML = rows.map(h =>
    '<div class="hist-row"><div><b>' + esc(h.plateCode) + "</b> · " + esc(h.type) +
    ' <span class="tag">[v' + h.version + " 第" + h.epoch + "轮]</span><div class='tag'>" + esc(h.note) + "</div></div>" +
    '<div class="tag">' + fmt(h.at) + "</div></div>"
  ).join("") || '<div class="meta">暂无流水</div>';
  const arch = state.archives.filter(a => !code || a.plateCode === code);
  $("#archiveRows").innerHTML = arch.map(a =>
    '<details><summary><b>' + esc(a.plateCode) + "</b> · " + esc(a.reason) + " · " + fmt(a.archivedAt) +
    "（v" + a.version + " 第" + a.epoch + "轮）</summary><pre class='meta'>" + esc(JSON.stringify({ inspection: a.inspection, confirmations: a.confirmations }, null, 2)) + "</pre></details>"
  ).join("") || '<div class="meta">暂无归档记录</div>';
}

// ---------- 统一加载：三个视图共用一份快照 ----------
async function load() {
  state = await api("/api/state");
  refreshFormSelects();
  renderStats();
  renderCards();
  renderQueue();
  renderHistory();
}

$$(".tabs button").forEach(btn => btn.onclick = () => {
  tab = btn.dataset.tab;
  $$(".tabs button").forEach(b => b.classList.toggle("on", b === btn));
  $("#tab-list").hidden = tab !== "list";
  $("#tab-queue").hidden = tab !== "queue";
  $("#tab-history").hidden = tab !== "history";
});
$("#statusFilter").onchange = renderCards;
$("#search").oninput = renderCards;
$("#histSelect") && ($("#histSelect").onchange = renderHistory);
$("#reload").onclick = load;

renderForms();
load();
</script>
</body>
</html>`;
}
