// 玻璃板回收与二次涂布准入台 —— 页面
// 三个视图共用同一份刷新数据：底片/玻璃板列表、待涂布队列、玻璃板履历。

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>玻璃板回收与二次涂布准入台</title>
  <style>
    :root { --bg:#eef2ec; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#4f6e41; --warn:#9b4937; --hold:#8a6d2a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:17px; } main { padding:20px 28px; display:grid; grid-template-columns:360px 1fr; gap:20px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; margin-top:10px; } button.secondary { background:#69736a; } button.danger { background:var(--warn); } button.small { padding:5px 9px; font-size:12px; margin-top:6px; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; } .tabs button { margin:0; background:#fff; color:var(--ink); border:1px solid var(--line); } .tabs button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:12px; } .card { display:grid; gap:6px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; }
    .pill.rewash { color:var(--warn); border-color:var(--warn); } .pill.ready { color:var(--accent); border-color:var(--accent); } .pill.coated { color:var(--muted); } .pill.await { color:var(--hold); border-color:var(--hold); }
    .logs { border-top:1px solid var(--line); padding-top:8px; margin-top:6px; max-height:150px; overflow:auto; display:grid; gap:3px; font-size:13px; }
    .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } .warn { color:var(--warn); font-weight:700; } .ok { color:var(--accent); font-weight:700; }
    .queue-empty { color:var(--muted); padding:18px; text-align:center; border:1px dashed var(--line); border-radius:8px; }
    #toast { position:fixed; right:18px; bottom:18px; background:#20241f; color:#fff; padding:10px 14px; border-radius:8px; display:none; max-width:60%; }
    @media (max-width:960px){ header{display:block;padding:16px;} main{grid-template-columns:1fr;padding:14px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>玻璃板回收与二次涂布准入台</h1><div class="meta">旧底片交付后登记划痕 · 乳剂残留 · 清洗人；另一人两次确认（间隔四小时）方可回用涂布</div></div>
    <div class="row"><button id="reload">刷新</button></div>
  </header>
  <main>
    <section>
      <form id="negForm"><h2>① 登记旧底片 / 交付</h2>
        <label>底片编号</label><input name="code" required>
        <label>玻璃板尺寸</label><input name="plateSize" placeholder="如 18x24cm">
        <label>药液批次</label><input name="chemicalBatch">
        <label>存放盒位</label><input name="box">
        <label>状态</label><select name="status"><option>待曝光</option><option>冲洗中</option><option>待入盒</option><option selected>已交付</option></select>
        <button>保存旧底片</button>
      </form>
      <form id="intakeForm" style="margin-top:14px"><h2>② 旧底片交付后验收登记</h2>
        <label>玻璃板编号</label><input name="code" required placeholder="如 GP-003">
        <label>来源旧底片</label><select name="sourceNegative" id="sourceSelect"></select>
        <label>划痕（达标填“无”）</label><input name="scratch" required placeholder="无 / 描述划痕">
        <label>乳剂残留（达标填“无”）</label><input name="emulsion" required placeholder="无 / 描述残留">
        <label>清洗人</label><input name="cleaner" required>
        <button>提交验收</button>
      </form>
      <form id="confirmForm" style="margin-top:14px"><h2>③ 表面洁净确认（另一人，两次间隔四小时）</h2>
        <label>玻璃板</label><select name="code" id="confirmSelect"></select>
        <label>确认人（不得为清洗人）</label><input name="confirmer" required>
        <label>确认时间</label><input name="at" type="datetime-local">
        <label>备注</label><input name="note" placeholder="透光检查结果">
        <button>提交确认</button>
      </form>
      <form id="coatForm" style="margin-top:14px"><h2>④ 占用涂布槽</h2>
        <label>待涂布玻璃板</label><select name="code" id="coatSelect"></select>
        <label>涂布槽号</label><input name="slot" placeholder="如 槽-2">
        <label>二次涂布药液批次</label><input name="batch" placeholder="如 B-0925">
        <label>涂布人</label><input name="operator">
        <button>进入涂布</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="tabs">
        <button data-tab="list" class="active">底片 / 玻璃板列表</button>
        <button data-tab="queue">待涂布队列</button>
        <button data-tab="history">玻璃板履历</button>
      </div>
      <div class="panel" id="view"></div>
    </section>
  </main>
  <div id="toast"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

export function appJs() {
  return `
const plateStatuses = ["待登记","待复洗","待复认","待涂布","已涂布"];
const view = document.querySelector('#view');
const statsEl = document.querySelector('#stats');
const toastEl = document.querySelector('#toast');
let state = { negatives: [], plates: [], stats: null };
let tab = 'list';
let historyCode = '';

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers: { 'Content-Type': 'application/json' } } : options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
function toast(msg, bad) {
  toastEl.textContent = msg;
  toastEl.style.background = bad ? '#9b4937' : '#20241f';
  toastEl.style.display = 'block';
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 3200);
}
function pill(status) {
  const cls = { '待复洗':'rewash','待复认':'await','待涂布':'ready','已涂布':'coated' }[status] || '';
  return '<span class="pill '+cls+'">'+status+'</span>';
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// 三个视图共享一次加载，刷新后列表 / 队列 / 履历严格一致
async function load() {
  const [negatives, plates, stats] = await Promise.all([
    api('/api/negatives'), api('/api/plates'), api('/api/stats'),
  ]);
  state = { negatives, plates, stats };
  renderSelects();
  renderStats();
  render();
}
function renderStats() {
  const s = state.stats;
  const cells = [
    ['待复洗', s.plate['待复洗']], ['待复认', s.plate['待复认']],
    ['待涂布队列', s.coatingQueue], ['涂布中', s.coatingOccupied],
    ['已交付底片', s.negative['已交付']], ['已回退底片', s.negative['已回退']],
  ];
  statsEl.innerHTML = cells.map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+(v ?? 0)+'</strong></div>').join('');
}
function renderSelects() {
  document.querySelector('#sourceSelect').innerHTML =
    '<option value="">（不关联）</option>' +
    state.negatives.filter(n => n.status === '已交付').map(n => '<option>'+esc(n.code)+'</option>').join('');
  document.querySelector('#confirmSelect').innerHTML =
    state.plates.filter(p => p.status === '待复认').map(p =>
      '<option value="'+esc(p.code)+'">'+esc(p.code)+'（已确认 '+p.cleanProgress+'/2）</option>').join('')
    || '<option value="">暂无待复认玻璃板</option>';
  document.querySelector('#coatSelect').innerHTML =
    state.plates.filter(p => p.status === '待涂布' && p.cleanConfirmed).map(p =>
      '<option value="'+esc(p.code)+'">'+esc(p.code)+'</option>').join('')
    || '<option value="">队列为空</option>';
}
function render() {
  if (tab === 'list') renderList();
  else if (tab === 'queue') renderQueue();
  else renderHistory();
}
function renderList() {
  const negCards = state.negatives.map(n =>
    '<article class="card"><h3>'+esc(n.code)+'</h3>'+pill(n.status)+
    '<div class="meta">尺寸 '+esc(n.plateSize)+' · 盒位 '+esc(n.box)+' · 药液 '+esc(n.chemicalBatch)+'</div>'+
    (n.defect ? '<div class="meta">缺陷：'+esc(n.defect)+'</div>' : '') +
    (n.status === '已交付'
      ? '<button class="small danger" data-rollback="'+esc(n.code)+'">状态回退（关联回用结论失效）</button>'
      : '') +
    '</article>').join('');
  const plateCards = state.plates.map(p =>
    '<article class="card"><h3>'+esc(p.code)+' '+pill(p.status)+'</h3>'+
    '<div class="meta">来源底片：'+esc(p.sourceNegative || '—')+' · 尺寸 '+esc(p.plateSize)+' · 版本 r'+p.revision+'</div>'+
    '<div class="'+(p.intakePassed ? 'ok' : 'warn')+'">验收：'+esc(p.defectSummary)+'</div>'+
    '<div class="meta">划痕：'+esc(p.intake?.scratch)+'｜乳剂残留：'+esc(p.intake?.emulsion)+'｜清洗人：'+esc(p.intake?.cleaner)+'</div>'+
    '<div class="'+(p.cleanConfirmed ? 'ok' : 'meta')+'">洁净确认：'+p.cleanProgress+'/2'+(p.cleanConfirmed ? '（已达四小时间隔）' : '')+'</div>'+
    '<div class="row">'+
      (p.status === '待复洗' ? '<button class="small secondary" data-rewash="'+esc(p.code)+'">复洗后重登记</button>' : '') +
      '<button class="small" data-goto-history="'+esc(p.code)+'">查看履历</button>'+
    '</div></article>').join('');
  view.innerHTML =
    '<h2>已交付旧底片</h2><div class="grid">'+(negCards || '<div class="queue-empty">暂无底片</div>')+'</div>'+
    '<h2 style="margin-top:18px">回收玻璃板</h2><div class="grid">'+(plateCards || '<div class="queue-empty">暂无玻璃板</div>')+'</div>';
  bindCardActions();
}
function renderQueue() {
  const q = state.plates.filter(p => p.status === '待涂布' && p.cleanConfirmed);
  const blocked = state.plates.filter(p => p.status !== '已涂布' && !(p.status === '待涂布' && p.cleanConfirmed));
  view.innerHTML =
    '<h2>待涂布队列（准入通过，可占用涂布槽）</h2>' +
    (q.length ? '<div class="grid">'+q.map(p =>
      '<article class="card"><h3>'+esc(p.code)+'</h3>'+pill(p.status)+
      '<div class="meta">来源 '+esc(p.sourceNegative||'—')+' · r'+p.revision+' · 两次确认完成</div>'+
      '<div class="ok">'+esc(p.defectSummary)+'</div>'+
      '<button class="small" data-goto-history="'+esc(p.code)+'">查看履历</button></article>').join('')+'</div>'
      : '<div class="queue-empty">队列为空：待复洗/待复认或确认未满四小时的玻璃板不能占用涂布槽</div>') +
    '<h2 style="margin-top:18px">未准入（不占槽）</h2><div class="grid">'+blocked.map(p =>
      '<article class="card"><h3>'+esc(p.code)+'</h3>'+pill(p.status)+
      '<div class="'+(p.intakePassed?'meta':'warn')+'">'+esc(p.defectSummary)+'</div>'+
      '<div class="meta">洁净确认 '+p.cleanProgress+'/2</div></article>').join('')+'</div>';
  bindCardActions();
}
function renderHistory() {
  const options = state.plates.map(p => '<option value="'+esc(p.code)+'"'+(p.code===historyCode?' selected':'')+'>'+esc(p.code)+'</option>').join('');
  if (!historyCode && state.plates.length) historyCode = state.plates[0].code;
  const p = state.plates.find(x => x.code === historyCode);
  view.innerHTML =
    '<div class="row"><h2 style="margin:0">玻璃板履历</h2><select id="historySelect" style="width:auto">'+options+'</select>'+
    '<button class="small secondary" data-correct="'+esc(p?.code||'')+'">档案更正（结论失效重算）</button></div>' +
    (p ? historyBody(p) : '<div class="queue-empty">暂无玻璃板</div>');
  const sel = document.querySelector('#historySelect');
  if (sel) sel.onchange = () => { historyCode = sel.value; render(); };
  bindCardActions();
}
function historyBody(p) {
  const lines = (p.history||[]).slice().reverse().map(h => {
    const map = { intake:'验收登记', rewash:'复洗重登记', clean:'洁净确认 '+ (h.seq||''), ready:'准入通过', coat:'进入涂布', invalidate:'结论失效', correction:'档案更正' };
    return '<div><b>'+esc(new Date(h.at).toLocaleString('zh-CN'))+' · '+(map[h.type]||h.type)+'</b>'+
      (h.confirmer ? ' · 确认人 '+esc(h.confirmer) : '')+
      (h.toStatus ? ' → '+esc(h.toStatus) : '')+
      (h.fromRevision ? ' <span class="meta">r'+h.fromRevision+'→r'+h.toRevision+'</span>' : (h.revision ? ' <span class="meta">r'+h.revision+'</span>' : ''))+
      '<div class="meta">'+esc(h.detail||h.note||'')+'</div></div>';
  }).join('');
  const archive = (p.archive||[]).slice().reverse().map(a =>
    '<div><b>'+esc(new Date(a.at).toLocaleString('zh-CN'))+' · 旧记录留档（'+esc(a.type)+'）</b><div class="meta">'+esc(a.note||'')+'</div></div>').join('');
  return '<div style="margin-top:10px">'+pill(p.status)+' <span class="meta">当前版本 r'+p.revision+' · 来源底片 '+esc(p.sourceNegative||'—')+'</span></div>'+
    '<h2 style="margin-top:14px">操作履历</h2><div class="logs">'+(lines||'暂无')+'</div>'+
    '<h2 style="margin-top:14px">失效前留档</h2><div class="logs">'+(archive||'暂无旧记录')+'</div>';
}
function bindCardActions() {
  document.querySelectorAll('[data-rollback]').forEach(b => b.onclick = async () => {
    const note = prompt('旧底片状态回退原因？关联玻璃板的回用结论将失效重算。');
    if (note === null) return;
    try { await api('/api/negatives/'+b.dataset.rollback+'/rollback', { method:'POST', body: JSON.stringify({ note }) }); toast('已回退，关联结论失效重算'); }
    catch (e) { toast(e.message, true); }
    load();
  });
  document.querySelectorAll('[data-rewash]').forEach(b => b.onclick = async () => {
    const scratch = prompt('复洗后划痕（达标填“无”）', '无'); if (scratch === null) return;
    const emulsion = prompt('复洗后乳剂残留（达标填“无”）', '无'); if (emulsion === null) return;
    const cleaner = prompt('清洗人'); if (cleaner === null) return;
    try { await api('/api/plates/'+b.dataset.rewash+'/rewash', { method:'POST', body: JSON.stringify({ scratch, emulsion, cleaner }) }); toast('复洗登记已提交'); }
    catch (e) { toast(e.message, true); }
    load();
  });
  document.querySelectorAll('[data-goto-history]').forEach(b => b.onclick = () => {
    historyCode = b.dataset.gotoHistory; tab = 'history';
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'history'));
    render();
  });
  document.querySelectorAll('[data-correct]').forEach(b => b.onclick = async () => {
    if (!b.dataset.correct) return;
    const note = prompt('更正内容说明？更正后当前回用结论立即失效并按最新档案重算，旧记录留档。');
    if (note === null) return;
    const scratch = prompt('划痕（留空表示不更正）') || undefined;
    const emulsion = prompt('乳剂残留（留空表示不更正）') || undefined;
    const cleaner = prompt('清洗人（留空表示不更正）') || undefined;
    try {
      await api('/api/plates/'+b.dataset.correct+'/correct',
        { method:'POST', body: JSON.stringify({ note, scratch, emulsion, cleaner }) });
      toast('档案已更正，结论失效并重算');
    } catch (e) { toast(e.message, true); }
    load();
  });
}

document.querySelector('#negForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('/api/negatives', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }); toast('旧底片已保存'); e.target.reset(); }
  catch (err) { toast(err.message, true); }
  load();
};
document.querySelector('#intakeForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const p = await api('/api/plates/intake', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
    toast('验收完成：' + p.status + (p.status === '待复洗' ? '（有缺陷，只留待复洗，不占涂布槽）' : '（可进入洁净确认）'));
    e.target.reset();
  } catch (err) { toast(err.message, true); }
  load();
};
document.querySelector('#confirmForm').onsubmit = async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.at) data.at = new Date(data.at).toISOString(); else delete data.at;
  try {
    const p = await api('/api/plates/'+data.code+'/clean', { method:'POST', body: JSON.stringify(data) });
    toast('确认已登记（'+p.cleanProgress+'/2），状态：' + p.status);
    e.target.reset();
  } catch (err) { toast(err.message, true); }
  load();
};
document.querySelector('#coatForm').onsubmit = async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try { await api('/api/plates/'+data.code+'/coat', { method:'POST', body: JSON.stringify(data) }); toast('已占用涂布槽'); e.target.reset(); }
  catch (err) { toast(err.message, true); }
  load();
};
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  render();
});
document.querySelector('#reload').onclick = () => load();
load();
`;
}
