// Shared helpers for the survey and the admin dashboard.
const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (i) => LETTERS[i] || String(i + 1);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Split a spectrum position into the one or two archetypes it sits between.
// Returns [{ idx, share }] with shares summing to 1.
function splitValue(v, count) {
  const max = count - 1;
  v = Math.min(max, Math.max(0, Number(v)));
  const lo = Math.floor(v + 1e-9);
  const frac = v - lo;
  if (frac < 0.005 || lo >= max) return [{ idx: Math.min(lo, max), share: 1 }];
  if (frac > 0.995) return [{ idx: lo + 1, share: 1 }];
  return [{ idx: lo, share: 1 - frac }, { idx: lo + 1, share: frac }];
}

// Whole percentages for a split that always add up to 100.
function splitPercents(parts) {
  const first = Math.round(parts[0].share * 100);
  return parts.length === 1 ? [100] : [first, 100 - first];
}

function describeValue(v, archetypes) {
  const parts = splitValue(v, archetypes.length);
  const name = (i) => archetypes[i]?.name || letter(i);
  if (parts.length === 1) return name(parts[0].idx);
  const pct = splitPercents(parts);
  return parts.map((p, i) => `${name(p.idx)} ${pct[i]}%`).join(' · ');
}

// Short form for dense tables: "C", or "C–D 75/25".
function shortValue(v, count) {
  const parts = splitValue(v, count);
  if (parts.length === 1) return letter(parts[0].idx);
  const [a, b] = splitPercents(parts);
  return `${letter(parts[0].idx)}–${letter(parts[1].idx)} ${a}/${b}`;
}

const ERROR_TEXT = {
  invalid_code: 'This ID is not known. Please check it and try again.',
  already_submitted: 'Your answers have already been submitted.',
  survey_closed: 'The survey is currently closed.',
  incomplete: 'Please place every case before submitting.',
  invalid_case: 'This case is no longer part of the survey. Please reload the page.',
  invalid_value: 'That position is outside the spectrum. Please reload the page.',
  no_archetypes: 'The survey is not set up yet.',
};
function errorText(err) {
  const msg = err?.message || String(err);
  for (const key of Object.keys(ERROR_TEXT)) if (msg.includes(key)) return ERROR_TEXT[key];
  return 'Something went wrong: ' + msg;
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function safeStorage(op, key, value) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') localStorage.setItem(key, value);
    if (op === 'del') localStorage.removeItem(key);
  } catch (_) { /* storage unavailable */ }
  return null;
}
