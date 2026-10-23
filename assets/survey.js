// Participant page: identify by ID, place each case on the archetype spectrum.
const app = document.getElementById('app');
const state = { code: null, data: null, timers: {}, pending: {} };
const STORE_KEY = 'arch_code';

function renderLanding(error = '', prefill = '') {
  app.innerHTML = `
    <section class="landing card">
      <div class="hero" style="margin:0">
        <div class="eyebrow">Archetype placement</div>
        <h1>Welcome</h1>
        <p>Please enter the personal ID you received to start.</p>
      </div>
      <form id="idForm">
        <input type="text" id="idInput" name="id" autocomplete="off" spellcheck="false"
          placeholder="Your ID" aria-label="Your ID" value="${esc(prefill)}" required>
        <button class="btn primary" type="submit">Continue</button>
      </form>
      ${error ? `<p class="notice error" style="margin-top:14px">${esc(error)}</p>` : ''}
    </section>`;
  const input = document.getElementById('idInput');
  input.focus();
  document.getElementById('idForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (code) load(code);
  });
}

async function load(code) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await sb.rpc('arch_get_survey', { p_code: code });
  if (error) {
    safeStorage('del', STORE_KEY);
    history.replaceState(null, '', location.pathname);
    renderLanding(errorText(error), code);
    return;
  }
  state.code = data.participant.code;
  state.data = data;
  safeStorage('set', STORE_KEY, state.code);
  const url = new URL(location.href);
  url.searchParams.set('id', state.code);
  history.replaceState(null, '', url);
  render();
}

function render() {
  const { participant, settings } = state.data;
  if (participant.submitted_at) return renderSubmitted();
  if (!settings.is_open) return renderMessage('The survey is currently closed', 'Please check back later.');
  if (!state.data.archetypes.length || !state.data.cases.length) {
    return renderMessage('Not ready yet', 'This survey has not been set up yet. Please check back later.');
  }
  renderSurvey();
}

function renderMessage(title, text) {
  app.innerHTML = `<section class="landing card"><h1>${esc(title)}</h1><p class="muted" style="margin-top:10px">${esc(text)}</p>${whoLine()}</section>`;
  bindWho();
}

function whoLine() {
  return `<p class="who">Signed in with ID <strong>${esc(state.code)}</strong> · <button type="button" data-switch>Use a different ID</button></p>`;
}
function bindWho() {
  app.querySelector('[data-switch]')?.addEventListener('click', () => {
    safeStorage('del', STORE_KEY);
    history.replaceState(null, '', location.pathname);
    renderLanding();
  });
}

function legendHtml(archetypes, open) {
  return `
    <details class="legend card" ${open ? 'open' : ''}>
      <summary>The ${archetypes.length} archetypes</summary>
      <div class="legend-grid">
        ${archetypes.map((a, i) => `
          <div class="legend-item">
            <span class="badge">${letter(i)}</span>
            <div><strong>${esc(a.name)}</strong>${a.description ? `<p class="pre">${esc(a.description)}</p>` : ''}</div>
          </div>`).join('')}
      </div>
    </details>`;
}

function spectrumHtml(caseId, archetypes, value, step, readonly) {
  const n = archetypes.length;
  const max = n - 1;
  const unset = value == null;
  const ticks = [];
  for (let i = 0; i <= max; i++) {
    ticks.push(`<span class="tick" style="--f:${i / max}"></span>`);
    if (step && step < 1 && i < max) {
      for (let s = step; s < 1 - 1e-9; s += step) ticks.push(`<span class="tick minor" style="--f:${(i + s) / max}"></span>`);
    }
  }
  return `
    <div class="spectrum ${unset ? 'unset' : ''}" style="--n:${n}" data-spectrum="${caseId}">
      <div class="track-wrap">
        <span class="track-line"></span>
        ${ticks.join('')}
        <input type="range" min="0" max="${max}" step="${step || 'any'}" value="${unset ? max / 2 : value}"
          aria-label="Placement" ${readonly ? 'disabled' : ''}>
      </div>
      <div class="arch-labels">
        ${archetypes.map((a, i) => `
          <button type="button" class="arch-btn" data-idx="${i}" title="${esc(a.name)}" ${readonly ? 'disabled' : ''}>
            <span class="badge">${letter(i)}</span><span class="nm">${esc(a.name)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function answeredCount() {
  const { cases, responses } = state.data;
  return cases.filter((c) => responses[c.id] != null).length;
}

function renderSurvey() {
  const { settings, archetypes, cases, responses } = state.data;
  const step = settings.slider_step ? Number(settings.slider_step) : null;
  app.innerHTML = `
    <header class="hero">
      <div class="eyebrow">Archetype placement</div>
      <h1>${esc(settings.title)}</h1>
      ${settings.intro ? `<p class="pre">${esc(settings.intro)}</p>` : ''}
      ${whoLine()}
    </header>
    ${legendHtml(archetypes, true)}
    <div class="progress-bar">
      <span id="progressText"></span>
      <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
    </div>
    ${cases.map((c, i) => {
      const r = responses[c.id];
      return `
      <article class="card case-card ${r ? '' : 'unset'}" data-case="${c.id}" aria-labelledby="t-${c.id}">
        <div class="case-head"><span class="case-num">Case ${i + 1}</span><h2 id="t-${c.id}">${esc(c.title)}</h2></div>
        ${c.description ? `<p class="case-desc">${esc(c.description)}</p>` : ''}
        ${spectrumHtml(c.id, archetypes, r ? Number(r.value) : null, step, false)}
        <div class="readout"><span data-readout></span><span class="save-state" data-save></span></div>
        ${settings.allow_comments ? `
        <details class="note" ${r?.comment ? 'open' : ''}>
          <summary>Add a note (optional)</summary>
          <textarea data-comment maxlength="2000" placeholder="Why did you place it here?">${esc(r?.comment || '')}</textarea>
        </details>` : ''}
      </article>`;
    }).join('')}
    <div class="submit-bar">
      <button class="btn primary" id="submitBtn" type="button">Submit my answers</button>
      <span class="muted small" id="submitHint"></span>
    </div>
    <p class="notice error" id="submitError" hidden></p>`;
  bindWho();

  app.querySelectorAll('.case-card').forEach((card) => bindCase(card));
  document.getElementById('submitBtn').addEventListener('click', submit);
  updateProgress();
}

function bindCase(card) {
  const caseId = card.dataset.case;
  const spectrum = card.querySelector('.spectrum');
  const range = spectrum.querySelector('input[type=range]');
  const comment = card.querySelector('[data-comment]');
  const r = state.data.responses[caseId];
  updateReadout(card, r ? Number(r.value) : null);

  const setValue = (v) => {
    range.value = v;
    spectrum.classList.remove('unset');
    card.classList.remove('unset');
    const value = Number(range.value);
    const prev = state.data.responses[caseId];
    state.data.responses[caseId] = { value, comment: prev?.comment || '' };
    updateReadout(card, value);
    updateProgress();
    scheduleSave(card, caseId);
  };
  range.addEventListener('input', () => setValue(range.value));
  // Keyboard users on an untouched slider: first arrow press places it.
  range.addEventListener('keydown', (e) => {
    if (spectrum.classList.contains('unset') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      setTimeout(() => setValue(range.value));
    }
  });
  spectrum.querySelectorAll('.arch-btn').forEach((b) => b.addEventListener('click', () => setValue(b.dataset.idx)));
  comment?.addEventListener('input', () => {
    const cur = state.data.responses[caseId];
    if (!cur) { setSaveState(card, 'Place the case first, then your note is saved.'); return; }
    cur.comment = comment.value;
    scheduleSave(card, caseId, 800);
  });
}

function updateReadout(card, value) {
  const { archetypes } = state.data;
  const out = card.querySelector('[data-readout]');
  const btns = card.querySelectorAll('.arch-btn');
  btns.forEach((b) => { b.classList.remove('near'); b.style.removeProperty('--w'); });
  if (value == null) {
    out.innerHTML = 'Not placed yet: drag the marker or click an archetype.';
    return;
  }
  splitValue(value, archetypes.length).forEach((p) => {
    btns[p.idx].classList.add('near');
    btns[p.idx].style.setProperty('--w', (0.35 + 0.65 * p.share).toFixed(2));
  });
  out.innerHTML = `Placed at <strong>${esc(describeValue(value, archetypes))}</strong>`;
}

function setSaveState(card, text, isError = false) {
  const el = card.querySelector('[data-save]');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

function scheduleSave(card, caseId, delay = 350) {
  clearTimeout(state.timers[caseId]);
  setSaveState(card, 'Saving…');
  state.pending[caseId] = true;
  state.timers[caseId] = setTimeout(() => save(card, caseId), delay);
}

async function save(card, caseId) {
  const r = state.data.responses[caseId];
  const { error } = await sb.rpc('arch_save_response', {
    p_code: state.code, p_case: caseId, p_value: r.value, p_comment: r.comment || '',
  });
  delete state.pending[caseId];
  if (error) {
    setSaveState(card, errorText(error) + ' ', true);
    const retry = document.createElement('button');
    retry.className = 'btn sm'; retry.textContent = 'Retry';
    retry.onclick = () => scheduleSave(card, caseId, 0);
    card.querySelector('[data-save]').append(retry);
    return;
  }
  setSaveState(card, 'Saved ✓');
}

function updateProgress() {
  const total = state.data.cases.length;
  const done = answeredCount();
  document.getElementById('progressText').textContent = `${done} of ${total} placed`;
  document.getElementById('progressFill').style.width = `${(done / total) * 100}%`;
  const btn = document.getElementById('submitBtn');
  btn.disabled = done < total;
  document.getElementById('submitHint').textContent =
    done < total ? `Place ${total - done} more case${total - done === 1 ? '' : 's'} to submit.` : 'All cases placed. You can still adjust before submitting.';
}

async function submit() {
  const errEl = document.getElementById('submitError');
  errEl.hidden = true;
  if (!confirm('Submit your answers? You will not be able to change them afterwards.')) return;
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  // Flush pending saves first.
  for (const caseId of Object.keys(state.timers)) {
    if (state.pending[caseId]) {
      clearTimeout(state.timers[caseId]);
      await save(app.querySelector(`[data-case="${caseId}"]`), caseId);
    }
  }
  const { data, error } = await sb.rpc('arch_submit', { p_code: state.code });
  if (error) {
    errEl.textContent = errorText(error);
    errEl.hidden = false;
    btn.textContent = 'Submit my answers';
    updateProgress();
    return;
  }
  state.data.participant.submitted_at = data;
  window.scrollTo({ top: 0 });
  renderSubmitted();
}

function renderSubmitted() {
  const { settings, archetypes, cases, responses, participant } = state.data;
  app.innerHTML = `
    <header class="hero">
      <div class="eyebrow">Submitted ${esc(fmtDate(participant.submitted_at))}</div>
      <h1>${esc(settings.title)}</h1>
      <p class="pre">${esc(settings.thanks)}</p>
      ${whoLine()}
    </header>
    <h2 style="margin-bottom:12px">Your placements</h2>
    ${cases.map((c, i) => {
      const r = responses[c.id];
      return `
      <article class="card case-card">
        <div class="case-head"><span class="case-num">Case ${i + 1}</span><h2>${esc(c.title)}</h2></div>
        ${r ? spectrumHtml(c.id, archetypes, Number(r.value), null, true) : ''}
        <div class="readout">${r ? `<span>Placed at <strong>${esc(describeValue(r.value, archetypes))}</strong></span>` : 'Not placed'}</div>
        ${r?.comment ? `<p class="muted small pre" style="margin-top:8px">Note: ${esc(r.comment)}</p>` : ''}
      </article>`;
    }).join('')}`;
  bindWho();
  app.querySelectorAll('.case-card').forEach((card) => {
    const sp = card.querySelector('.spectrum');
    if (!sp) return;
    const v = Number(sp.querySelector('input').value);
    splitValue(v, archetypes.length).forEach((p) => {
      const b = sp.querySelectorAll('.arch-btn')[p.idx];
      b.classList.add('near');
      b.style.setProperty('--w', (0.35 + 0.65 * p.share).toFixed(2));
    });
  });
}

window.addEventListener('beforeunload', (e) => {
  if (Object.keys(state.pending).length) { e.preventDefault(); e.returnValue = ''; }
});

(function init() {
  const fromUrl = new URLSearchParams(location.search).get('id');
  const code = (fromUrl || safeStorage('get', STORE_KEY) || '').trim();
  if (code) load(code); else renderLanding();
})();
