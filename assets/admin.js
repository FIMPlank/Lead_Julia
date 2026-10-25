// Admin dashboard: edit the survey, manage participant IDs, view results.
const app = document.getElementById('app');
const A = {
  tab: safeStorage('get', 'arch_admin_tab') || 'results',
  settings: null, archetypes: [], cases: [], participants: [], responses: [],
  view: { filter: 'submitted', bin: 0.25 },
  drafts: {},
};

// ---------- utilities ----------
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function fetchAll(table, orderCols = []) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*').range(from, from + 999);
    orderCols.forEach((c) => { q = q.order(c); });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

function surveyLink(code) {
  const url = new URL('index.html', location.href);
  url.searchParams.set('id', code);
  return url.href;
}

function csvDownload(filename, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch (_) { prompt('Copy this:', text); }
}

const activeCases = () => A.cases.filter((c) => c.active);
const answersOf = (code) => A.responses.filter((r) => r.participant_code === code);

// Tooltip for any element with data-tip.
const tip = document.getElementById('tooltip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.classList.remove('show'); return; }
  tip.innerHTML = el.dataset.tip;
  tip.classList.add('show');
});
document.addEventListener('mousemove', (e) => {
  if (!tip.classList.contains('show')) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
});

// ---------- start ----------
async function start() {
  app.innerHTML = '<p class="muted">Loading data…</p>';
  try {
    await loadAll();
  } catch (err) {
    app.innerHTML = `<section class="landing card"><h1>Could not load data</h1><p class="notice error" style="margin-top:12px">${esc(err.message)}</p></section>`;
    return;
  }
  renderShell();
}

async function loadAll() {
  try {
    const [settings, archetypes, cases, participants, responses] = await Promise.all([
      sb.from('arch_settings').select('*').eq('id', 1).single().then((r) => { if (r.error) throw r.error; return r.data; }),
      fetchAll('arch_archetypes', ['sort_order', 'created_at']),
      fetchAll('arch_cases', ['sort_order', 'created_at']),
      fetchAll('arch_participants', ['created_at', 'code']),
      fetchAll('arch_responses', ['participant_code']),
    ]);
    Object.assign(A, { settings, archetypes, cases, participants, responses });
    A.drafts = {};
  } catch (err) {
    toast('Loading failed: ' + err.message);
    throw err;
  }
}

// ---------- shell ----------
const TABS = [['results', 'Results'], ['participants', 'Participants'], ['setup', 'Survey setup']];

function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div>
        <div class="small muted" style="font-weight:600">Admin dashboard</div>
        <h1 style="font-size:1.5rem">${esc(A.settings.title)}</h1>
      </div>
      <span class="spacer"></span>
      <span class="pill ${A.settings.is_open ? 'ok' : 'warn'}">${A.settings.is_open ? 'Survey open' : 'Survey closed'}</span>
      <button class="btn sm" id="reload" type="button">Refresh</button>
      <button class="btn sm" id="copySurvey" type="button">Copy survey link</button>
      <a class="btn sm" href="index.html" target="_blank" rel="noopener">Open survey ↗</a>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join('')}
    </div>
    <section id="tabBody"></section>`;
  document.getElementById('copySurvey').onclick = () => copyText(new URL('index.html', location.href).href, 'Survey link copied');
  document.getElementById('reload').onclick = async () => { await loadAll(); renderShell(); toast('Refreshed'); };
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    A.tab = b.dataset.tab;
    safeStorage('set', 'arch_admin_tab', A.tab);
    app.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    renderTab();
  }));
  renderTab();
}

function renderTab() {
  const body = document.getElementById('tabBody');
  if (A.tab === 'participants') renderParticipants(body);
  else if (A.tab === 'setup') renderSetup(body);
  else renderResults(body);
}

// ---------- results ----------
function includedCodes() {
  const answered = new Set(A.responses.map((r) => r.participant_code));
  return new Set(A.participants
    .filter((p) => (A.view.filter === 'submitted' ? p.submitted_at : answered.has(p.code)))
    .map((p) => p.code));
}

function stats(vals) {
  const n = vals.length;
  if (!n) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, sd };
}

function renderResults(body) {
  const codes = includedCodes();
  const cases = activeCases();
  const nA = A.archetypes.length;
  const max = nA - 1;
  const rs = A.responses.filter((r) => codes.has(r.participant_code));
  const stale = rs.some((r) => r.scale_max !== max);
  const submitted = A.participants.filter((p) => p.submitted_at).length;
  const started = new Set(A.responses.map((r) => r.participant_code)).size;

  body.innerHTML = `
    <div class="tiles">
      <div class="card tile"><div class="k">Participants</div><div class="v">${A.participants.length}</div></div>
      <div class="card tile"><div class="k">Started</div><div class="v">${started}</div></div>
      <div class="card tile"><div class="k">Submitted</div><div class="v">${submitted}</div></div>
      <div class="card tile"><div class="k">In this view</div><div class="v">${codes.size}</div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="section-head">
        <div><h2>Placement heat map</h2><p>Each row is a case. Darker cells mean more participants placed the case there.</p></div>
        <span class="spacer"></span>
        <label class="field" style="width:auto"><span>Include</span>
          <select id="fFilter">
            <option value="submitted" ${A.view.filter === 'submitted' ? 'selected' : ''}>Submitted only</option>
            <option value="all" ${A.view.filter === 'all' ? 'selected' : ''}>Everyone with answers</option>
          </select></label>
        <label class="field" style="width:auto"><span>Resolution</span>
          <select id="fBin">
            ${[[0.25, 'Quarter steps'], [0.5, 'Half steps'], [1, 'Archetypes only']].map(([v, l]) =>
              `<option value="${v}" ${A.view.bin === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
      ${stale ? '<p class="notice warn" style="margin-bottom:14px">Some answers were given when the survey had a different number of archetypes (marked ⚠ below). Their positions may not line up with the current archetypes.</p>' : ''}
      ${!nA || !cases.length ? '<p class="notice">Add archetypes and cases in Survey setup first.</p>' :
        codes.size === 0 ? '<p class="notice">No responses in this view yet.</p>' :
        `<div style="overflow-x:auto">${heatmapHtml(cases, rs)}</div>`}
      <div class="arch-key">${A.archetypes.map((a, i) => `<span><b>${letter(i)}</b>${esc(a.name)}</span>`).join('')}</div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="section-head">
        <div><h2>Individual responses</h2><p>One row per participant. Values run from 0 (${esc(letter(0))}) to ${max} (${esc(letter(max))}).</p></div>
        <span class="spacer"></span>
        <button class="btn sm" id="expLong" type="button">Export CSV (long)</button>
        <button class="btn sm" id="expWide" type="button">Export CSV (wide)</button>
      </div>
      ${codes.size ? individualHtml(cases, codes) : '<p class="notice">No responses in this view yet.</p>'}
    </div>

    <div class="card">
      <div class="section-head"><div><h2>Notes</h2><p>Optional notes participants left on a case.</p></div></div>
      ${commentsHtml(cases, rs)}
    </div>`;

  document.getElementById('fFilter').onchange = (e) => { A.view.filter = e.target.value; renderTab(); };
  document.getElementById('fBin').onchange = (e) => { A.view.bin = Number(e.target.value); renderTab(); };
  document.getElementById('expLong').onclick = () => exportLong(codes);
  document.getElementById('expWide').onclick = () => exportWide(codes);
}

function heatmapHtml(cases, rs) {
  const nA = A.archetypes.length;
  const max = nA - 1;
  const bin = A.view.bin;
  const nb = Math.round(max / bin) + 1;
  const axis = Array.from({ length: nb }, (_, j) => {
    const pos = j * bin;
    const isInt = Math.abs(pos - Math.round(pos)) < 1e-9;
    return `<span class="hm-axis ${isInt ? '' : 'minor'}" ${isInt ? `data-tip="${esc(A.archetypes[Math.round(pos)]?.name)}"` : ''}>${isInt ? letter(Math.round(pos)) : '·'}</span>`;
  }).join('');

  const rows = cases.map((c, ci) => {
    const vals = rs.filter((r) => r.case_id === c.id).map((r) => Math.min(max, Number(r.value)));
    const st = stats(vals);
    const counts = new Array(nb).fill(0);
    vals.forEach((v) => { counts[Math.min(nb - 1, Math.round(v / bin))]++; });
    const cells = counts.map((k, j) => {
      const share = st ? k / st.n : 0;
      const pos = j * bin;
      const bg = k ? `background:color-mix(in oklab, var(--seq-hi) ${Math.round(share * 100)}%, var(--seq-lo))` : '';
      const tipText = `<strong>${esc(c.title)}</strong><br>${esc(describeValue(pos, A.archetypes))}<br>${k} of ${st ? st.n : 0} participants (${Math.round(share * 100)}%)`;
      return `<span class="hm-cell ${share > 0.5 ? 'on-dark' : ''}" style="${bg}" data-tip="${tipText}">${k || ''}</span>`;
    }).join('');
    const meanLeft = st ? ((st.mean / bin + 0.5) / nb) * 100 : 0;
    return `
      <div class="hm-row">
        <div class="hm-title" title="${esc(c.title)}"><small>Case ${ci + 1}</small>${esc(c.title)}</div>
        <div class="hm-strip" style="--bins:${nb}">${cells}
          ${st ? `<span class="hm-mean" style="left:${meanLeft}%"></span>` : ''}</div>
        <div class="hm-stat">${st ? st.n : 0}</div>
        <div class="hm-stat">${st ? `${st.mean.toFixed(2)}<small>${esc(shortValue(st.mean, nA))}</small>` : '–'}</div>
        <div class="hm-stat">${st ? st.median.toFixed(2) : '–'}</div>
        <div class="hm-stat">${st ? st.sd.toFixed(2) : '–'}</div>
      </div>`;
  }).join('');

  return `
    <div class="hm">
      <div class="hm-row head">
        <div>Case</div>
        <div class="hm-strip head" style="--bins:${nb}">${axis}</div>
        <div class="hm-stat">n</div><div class="hm-stat">Mean</div><div class="hm-stat">Median</div><div class="hm-stat">SD</div>
      </div>
      ${rows}
    </div>
    <div class="hm-key">
      <span class="hm-scale">0% <i></i> 100% of a case's responses</span>
      <span><span class="mean-swatch"></span>Mean position</span>
    </div>`;
}

function individualHtml(cases, codes) {
  const nA = A.archetypes.length;
  const byKey = new Map(A.responses.map((r) => [r.participant_code + '|' + r.case_id, r]));
  const people = A.participants.filter((p) => codes.has(p.code));
  return `
    <div class="table-wrap" style="max-height:560px">
      <table>
        <thead><tr>
          <th>ID</th><th>Label</th><th>Status</th>
          ${cases.map((c, i) => `<th class="num" data-tip="${esc(c.title)}">Case ${i + 1}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${people.map((p) => `
            <tr>
              <td class="code">${esc(p.code)}</td>
              <td>${esc(p.label)}</td>
              <td>${p.submitted_at ? '<span class="pill ok">Submitted</span>' : '<span class="pill">In progress</span>'}</td>
              ${cases.map((c) => {
                const r = byKey.get(p.code + '|' + c.id);
                if (!r) return '<td class="num muted">–</td>';
                const isStale = r.scale_max !== nA - 1;
                const t = `<strong>${esc(p.code)}</strong> · ${esc(c.title)}<br>${esc(describeValue(r.value, A.archetypes))}${r.comment ? `<br><em>${esc(r.comment)}</em>` : ''}`;
                return `<td class="num" data-tip="${t}"><span class="val ${isStale ? 'stale' : ''}"><b>${Number(r.value).toFixed(2)}</b><span>${esc(shortValue(r.value, nA))}${r.comment ? ' ✎' : ''}</span></span></td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function commentsHtml(cases, rs) {
  const groups = cases.map((c, i) => {
    const list = rs.filter((r) => r.case_id === c.id && r.comment.trim());
    if (!list.length) return '';
    return `<div class="comment-group"><h3>Case ${i + 1}: ${esc(c.title)}</h3>
      ${list.map((r) => `<div class="comment"><span class="meta">${esc(r.participant_code)} · placed at ${esc(describeValue(r.value, A.archetypes))}</span>${esc(r.comment)}</div>`).join('')}
    </div>`;
  }).join('');
  return groups ? `<div class="comments">${groups}</div>` : '<p class="notice">No notes yet.</p>';
}

function exportLong(codes) {
  const caseIdx = new Map(A.cases.map((c, i) => [c.id, i]));
  const pmap = new Map(A.participants.map((p) => [p.code, p]));
  const rows = [['participant_id', 'label', 'submitted_at', 'case_no', 'case_title', 'value', 'scale_max',
    'lower_archetype', 'lower_share', 'upper_archetype', 'upper_share', 'comment', 'updated_at']];
  A.responses.filter((r) => codes.has(r.participant_code)).forEach((r) => {
    const c = A.cases[caseIdx.get(r.case_id)];
    const p = pmap.get(r.participant_code);
    const parts = splitValue(r.value, r.scale_max + 1);
    const lo = parts[0], hi = parts[1] || parts[0];
    rows.push([r.participant_code, p?.label, p?.submitted_at, (caseIdx.get(r.case_id) ?? -1) + 1, c?.title, r.value, r.scale_max,
      A.archetypes[lo.idx]?.name, parts[1] ? lo.share.toFixed(4) : 1, A.archetypes[hi.idx]?.name, parts[1] ? hi.share.toFixed(4) : 1,
      r.comment, r.updated_at]);
  });
  csvDownload(`archetype-responses-long-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportWide(codes) {
  const cases = activeCases();
  const byKey = new Map(A.responses.map((r) => [r.participant_code + '|' + r.case_id, r]));
  const rows = [['participant_id', 'label', 'submitted_at', ...cases.map((c, i) => `case_${i + 1}: ${c.title}`)]];
  A.participants.filter((p) => codes.has(p.code)).forEach((p) => {
    rows.push([p.code, p.label, p.submitted_at, ...cases.map((c) => byKey.get(p.code + '|' + c.id)?.value ?? '')]);
  });
  csvDownload(`archetype-responses-wide-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

// ---------- participants ----------
function participantStatus(p) {
  const n = answersOf(p.code).length;
  const total = activeCases().length;
  if (p.submitted_at) return `<span class="pill ok">Submitted</span>`;
  if (n) return `<span class="pill warn">In progress ${n}/${total}</span>`;
  if (p.started_at) return `<span class="pill">Opened</span>`;
  return `<span class="pill">Not started</span>`;
}

function renderParticipants(body) {
  body.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div><h2>Participants</h2><p>${A.participants.length} IDs. Participants choose their own ID on the survey page; it appears here the first time it is used. Labels are only shown here.</p></div>
        <span class="spacer"></span>
        <button class="btn sm" id="copyAll" type="button">Copy all links</button>
        <button class="btn sm" id="dlP" type="button">Download list (CSV)</button>
      </div>
      ${A.participants.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Label</th><th>Status</th><th>Opened</th><th>Submitted</th><th>Link</th><th></th></tr></thead>
          <tbody>
          ${A.participants.map((p) => `
            <tr data-code="${esc(p.code)}">
              <td class="code">${esc(p.code)}</td>
              <td><input type="text" value="${esc(p.label)}" data-label aria-label="Label for ${esc(p.code)}"></td>
              <td>${participantStatus(p)}</td>
              <td class="small muted">${esc(fmtDate(p.started_at))}</td>
              <td class="small muted">${esc(fmtDate(p.submitted_at))}</td>
              <td><button class="btn sm" data-act="copy" type="button">Copy link</button></td>
              <td><div class="row" style="flex-wrap:nowrap;gap:4px">
                ${p.submitted_at ? '<button class="btn sm" data-act="reopen" type="button">Reopen</button>' : ''}
                ${answersOf(p.code).length ? '<button class="btn sm" data-act="clear" type="button">Clear answers</button>' : ''}
                <button class="btn sm danger" data-act="delete" type="button">Delete</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="notice">No participants yet. Share the survey link; IDs show up here once people start.</p>'}
    </div>`;

  document.getElementById('copyAll').onclick = () => {
    if (!A.participants.length) return toast('No IDs yet');
    copyText(A.participants.map((p) => `${p.code}\t${p.label}\t${surveyLink(p.code)}`).join('\n'), 'All links copied (ID, label, link)');
  };
  document.getElementById('dlP').onclick = () => csvDownload('participants.csv',
    [['participant_id', 'label', 'link', 'opened_at', 'submitted_at'],
      ...A.participants.map((p) => [p.code, p.label, surveyLink(p.code), p.started_at, p.submitted_at])]);

  body.querySelectorAll('tr[data-code]').forEach((tr) => {
    const code = tr.dataset.code;
    tr.querySelector('[data-label]').addEventListener('change', async (e) => {
      const { error } = await sb.from('arch_participants').update({ label: e.target.value.trim() }).eq('code', code);
      if (error) return toast('Could not save label');
      A.participants.find((p) => p.code === code).label = e.target.value.trim();
      toast('Label saved');
    });
    tr.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'copy') return copyText(surveyLink(code), 'Link copied');
      let res;
      if (act === 'reopen') {
        if (!confirm(`Reopen ${code}? The participant can change and resubmit their answers.`)) return;
        res = await sb.from('arch_participants').update({ submitted_at: null }).eq('code', code);
      } else if (act === 'clear') {
        if (!confirm(`Delete all answers of ${code}? This cannot be undone.`)) return;
        res = await sb.from('arch_responses').delete().eq('participant_code', code);
        if (!res.error) res = await sb.from('arch_participants').update({ submitted_at: null }).eq('code', code);
      } else if (act === 'delete') {
        if (!confirm(`Delete ID ${code} and all of its answers? This cannot be undone.`)) return;
        res = await sb.from('arch_participants').delete().eq('code', code);
      }
      if (res?.error) return toast('Failed: ' + res.error.message);
      await loadAll(); renderTab(); toast('Done');
    }));
  });
}

// ---------- setup ----------
function renderSetup(body) {
  const s = A.settings;
  const step = s.slider_step == null ? '' : String(Number(s.slider_step));
  body.innerHTML = `
    <form class="card stack" id="settingsForm" style="margin-bottom:18px">
      <div class="section-head" style="margin:0"><div><h2>Survey settings</h2><p>What participants see on the survey page.</p></div></div>
      <label class="field"><span>Title</span><input type="text" name="title" value="${esc(s.title)}" required></label>
      <label class="field"><span>Introduction</span><textarea name="intro">${esc(s.intro)}</textarea></label>
      <label class="field"><span>Thank-you message after submitting</span><textarea name="thanks">${esc(s.thanks)}</textarea></label>
      <div class="form-grid">
        <label class="field"><span>Slider movement</span>
          <select name="slider_step">
            ${[['', 'Free (continuous)'], ['0.25', 'Quarter steps'], ['0.5', 'Half steps'], ['1', 'Archetypes only']].map(([v, l]) =>
              `<option value="${v}" ${step === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        <div class="stack" style="padding-top:22px">
          <label class="check"><input type="checkbox" name="allow_comments" ${s.allow_comments ? 'checked' : ''}> Let participants add a note per case</label>
          <label class="check"><input type="checkbox" name="is_open" ${s.is_open ? 'checked' : ''}> Survey is open for answers</label>
        </div>
      </div>
      <div class="row"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
    <div class="card" style="margin-bottom:18px" id="archEditor"></div>
    <div class="card" id="caseEditor"></div>`;

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const patch = {
      title: String(f.get('title')).trim() || 'Archetype placement',
      intro: String(f.get('intro')),
      thanks: String(f.get('thanks')),
      slider_step: f.get('slider_step') ? Number(f.get('slider_step')) : null,
      allow_comments: f.get('allow_comments') === 'on',
      is_open: f.get('is_open') === 'on',
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('arch_settings').update(patch).eq('id', 1);
    if (error) return toast('Could not save: ' + error.message);
    Object.assign(A.settings, patch);
    renderShell();
    toast('Settings saved');
  });

  renderEditor(document.getElementById('archEditor'), {
    key: 'archetypes', table: 'arch_archetypes', title: 'Archetypes',
    help: 'The positions on every slider, in order from left to right. Participants see the name and description.',
    fields: [['name', 'Name', 'text'], ['description', 'Description (optional)', 'textarea']],
    blank: () => ({ name: '', description: '' }),
    label: (i) => letter(i),
    addText: 'Add archetype',
  });
  renderEditor(document.getElementById('caseEditor'), {
    key: 'cases', table: 'arch_cases', title: 'Cases',
    help: 'Each active case gets its own slider, in this order. Inactive cases are hidden from participants.',
    fields: [['title', 'Title', 'text'], ['description', 'Description', 'textarea'], ['active', 'Active', 'checkbox']],
    blank: () => ({ title: '', description: '', active: true }),
    label: (i) => String(i + 1),
    addText: 'Add case',
  });
}

function renderEditor(root, cfg) {
  if (!A.drafts[cfg.key]) A.drafts[cfg.key] = A[cfg.key].map((x) => ({ ...x }));
  const items = A.drafts[cfg.key];
  const dirty = JSON.stringify(items.map(strip)) !== JSON.stringify(A[cfg.key].map(strip));
  function strip(x) { const o = { id: x.id }; cfg.fields.forEach(([f]) => { o[f] = x[f]; }); return o; }

  root.innerHTML = `
    <div class="section-head">
      <div><h2>${cfg.title}</h2><p>${cfg.help}</p></div>
      <span class="spacer"></span>
      ${dirty ? '<span class="pill warn">Unsaved changes</span>' : ''}
    </div>
    <div class="edit-list">
      ${items.map((it, i) => `
        <div class="edit-row ${it.active === false ? 'inactive' : ''}" data-i="${i}">
          <span class="badge">${cfg.label(i)}</span>
          <div class="fields">
            ${cfg.fields.map(([f, l, type]) => type === 'textarea'
              ? `<label class="field"><span>${l}</span><textarea data-f="${f}" rows="2">${esc(it[f])}</textarea></label>`
              : type === 'checkbox'
                ? `<label class="check small"><input type="checkbox" data-f="${f}" ${it[f] ? 'checked' : ''}> ${l}</label>`
                : `<label class="field"><span>${l}</span><input type="text" data-f="${f}" maxlength="${NAME_MAX}" value="${esc(it[f])}"></label>`).join('')}
          </div>
          <div class="actions">
            <button class="btn sm" data-mv="-1" type="button" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn sm" data-mv="1" type="button" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button class="btn sm danger" data-del type="button" aria-label="Remove">✕</button>
          </div>
        </div>`).join('')}
    </div>
    <p class="notice error" data-err role="alert" style="margin-top:14px" hidden></p>
    <div class="row" style="margin-top:14px">
      <button class="btn" data-add type="button">+ ${cfg.addText}</button>
      <span class="spacer"></span>
      ${dirty ? '<button class="btn ghost" data-reset type="button">Discard changes</button>' : ''}
      <button class="btn primary" data-save type="button" ${dirty ? '' : 'disabled'}>Save ${cfg.title.toLowerCase()}</button>
    </div>`;

  const rerender = () => renderEditor(root, cfg);
  root.querySelectorAll('.edit-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll('[data-f]').forEach((el) => {
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        items[i][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'checkbox') rerender(); else markDirty();
      });
    });
    row.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
      const j = i + Number(b.dataset.mv);
      [items[i], items[j]] = [items[j], items[i]];
      rerender();
    }));
    row.querySelector('[data-del]').addEventListener('click', () => { items.splice(i, 1); rerender(); });
  });
  root.querySelector('[data-add]').addEventListener('click', () => { items.push(cfg.blank()); rerender(); });
  root.querySelector('[data-reset]')?.addEventListener('click', () => { delete A.drafts[cfg.key]; rerender(); });
  root.querySelector('[data-save]').addEventListener('click', () => saveEditor(cfg, rerender, root));

  function markDirty() {
    const btn = root.querySelector('[data-save]');
    btn.disabled = false;
    if (!root.querySelector('.pill.warn')) {
      root.querySelector('.section-head .spacer').insertAdjacentHTML('afterend', '<span class="pill warn">Unsaved changes</span>');
    }
  }
}

// Matches the length checks on arch_archetypes.name and arch_cases.title.
const NAME_MAX = 300;

async function saveEditor(cfg, rerender, root) {
  const errEl = root.querySelector('[data-err]');
  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
  errEl.hidden = true;
  const items = A.drafts[cfg.key];
  const [main, mainLabel] = cfg.fields[0];
  const empty = items.findIndex((it) => !String(it[main] || '').trim());
  if (empty >= 0) return fail(`${cfg.label(empty)}: please enter a ${mainLabel.toLowerCase()}.`);
  const long = items.findIndex((it) => String(it[main] || '').trim().length > NAME_MAX);
  if (long >= 0) return fail(`${cfg.label(long)}: the ${mainLabel.toLowerCase()} is too long (max ${NAME_MAX} characters). Put longer text in the description.`);
  if (cfg.key === 'archetypes' && items.length < 2) return fail('You need at least two archetypes.');

  const keep = new Set(items.filter((x) => x.id).map((x) => x.id));
  const removed = A[cfg.key].filter((x) => !keep.has(x.id));
  const hasAnswers = A.responses.length > 0;
  if (cfg.key === 'archetypes' && hasAnswers && items.length !== A.archetypes.length &&
      !confirm('There are already answers. Changing the number of archetypes changes what existing positions mean. Continue?')) return;
  if (cfg.key === 'cases') {
    const lost = A.responses.filter((r) => removed.some((c) => c.id === r.case_id)).length;
    if (lost && !confirm(`Deleting these cases also deletes ${lost} answers. Set them inactive instead to keep the data. Delete anyway?`)) return;
  }

  const rowOf = (it, i) => {
    const o = { sort_order: i + 1 };
    cfg.fields.forEach(([f]) => { o[f] = typeof it[f] === 'string' ? it[f].trim() : it[f]; });
    return o;
  };
  const existing = items.map((it, i) => (it.id ? { id: it.id, ...rowOf(it, i) } : null)).filter(Boolean);
  const fresh = items.map((it, i) => (it.id ? null : rowOf(it, i))).filter(Boolean);
  try {
    if (removed.length) {
      const { error } = await sb.from(cfg.table).delete().in('id', removed.map((x) => x.id));
      if (error) throw error;
    }
    if (existing.length) {
      const { error } = await sb.from(cfg.table).upsert(existing);
      if (error) throw error;
    }
    if (fresh.length) {
      const { error } = await sb.from(cfg.table).insert(fresh);
      if (error) throw error;
    }
  } catch (err) {
    return fail('Could not save. Details: ' + err.message);
  }
  await loadAll();
  rerender();
  toast(`${cfg.title} saved`);
}

start();
