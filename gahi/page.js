// Runs in the app's page. Reads the gahi-* attributes on the screen, and runs verbs through the real
// controls, so an agent's view can't drift from the UI. Everything visible here appears only when needed.
import { LEVELS, VERSION, defaultRules, parseState, riskOf } from './language.js';
import { createSession } from './session.js';

const STYLE = `
.gahi-ui[hidden]{display:none!important}
.gahi-dock{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));display:flex;gap:8px;align-items:center;z-index:50;font:13px/1.4 var(--gahi-font,system-ui,sans-serif)}
.gahi-ui button{font:inherit;color:inherit;background:var(--gahi-bg,Canvas);border:1px solid var(--gahi-rule,#9aa8b5);border-radius:7px;padding:5px 10px;cursor:pointer}
.gahi-ui button:focus-visible{outline:2px solid var(--gahi-human,#0B5FD6);outline-offset:2px}
.gahi-ui{color:var(--gahi-fg,CanvasText)}
.gahi-agent-btn::before,.gahi-log-a::before{content:"\\25C6 ";color:var(--gahi-agent,#C2500A)}
.gahi-draft-btn{border:1.5px dashed var(--gahi-agent,#C2500A)!important;font-weight:600!important}
.gahi-toast{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(52px,calc(env(safe-area-inset-bottom,0px) + 52px));max-width:min(360px,calc(100% - 24px));background:var(--gahi-bg,Canvas);border:1px solid var(--gahi-agent,#C2500A);border-radius:7px;padding:5px 10px;font:12px/1.4 var(--gahi-mono,ui-monospace,monospace);overflow-wrap:anywhere;z-index:50}
.gahi-panel{position:fixed;top:0;right:0;bottom:0;width:min(370px,100%);box-sizing:border-box;overflow:auto;padding:16px max(16px,env(safe-area-inset-right,0px)) 16px 16px;background:var(--gahi-bg,Canvas);border-left:1px solid var(--gahi-rule,#9aa8b5);display:grid;gap:18px;align-content:start;font:14px/1.45 var(--gahi-font,system-ui,sans-serif);z-index:60}
.gahi-panel h2{font-size:15px;margin:0}
.gahi-panel section{display:grid;gap:8px}
.gahi-panel p{margin:0}
.gahi-head{display:flex;justify-content:space-between;align-items:center}
.gahi-rule{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px}
.gahi-seg{display:inline-flex;border:1px solid var(--gahi-rule,#9aa8b5);border-radius:7px;overflow:hidden}
.gahi-ui .gahi-seg button{border:0;border-radius:0;padding:3px 9px;font-size:12px}
.gahi-ui .gahi-seg button[aria-pressed=true]{background:var(--gahi-human,#0B5FD6);color:var(--gahi-bg,Canvas);font-weight:600}
.gahi-panel select{font:inherit;font-size:12px;color:inherit;background:var(--gahi-bg,Canvas);border:1px solid var(--gahi-rule,#9aa8b5);border-radius:6px;padding:2px 4px}
.gahi-panel input[type=text]{font:12px var(--gahi-mono,ui-monospace,monospace);width:100%;box-sizing:border-box;color:inherit;background:transparent;border:1px solid var(--gahi-rule,#9aa8b5);border-radius:6px;padding:4px 6px}
.gahi-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.gahi-log{display:grid;gap:4px;font:12px/1.45 var(--gahi-mono,ui-monospace,monospace);overflow-wrap:anywhere}
.gahi-peek pre{font:11.5px/1.5 var(--gahi-mono,ui-monospace,monospace);white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}
.gahi-muted{opacity:.72;font-size:13px}
.gahi-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;width:max-content;max-width:calc(100% - 24px);box-sizing:border-box;background:var(--gahi-bg,Canvas);border:1.5px dashed var(--gahi-agent,#C2500A);border-radius:10px;padding:8px 12px;font:14px/1.4 var(--gahi-font,system-ui,sans-serif);z-index:55}
.gahi-ui .gahi-approve{background:var(--gahi-human,#0B5FD6);border-color:var(--gahi-human,#0B5FD6);color:var(--gahi-bg,Canvas);font-weight:600}
.gahi-mark{display:flex;flex-wrap:wrap;gap:3px 8px;padding:3px 14px 6px;font:12.5px/1.4 var(--gahi-font,system-ui,sans-serif);overflow-wrap:anywhere}
.gahi-mark del{color:var(--gahi-before,#B3123E)}
.gahi-mark ins{color:var(--gahi-after,#137A4E);text-decoration:none;font-weight:600}
.gahi-mark ins::before{content:"+ "}
.gahi-removed>:not(.gahi-mark){opacity:.6;text-decoration:line-through}
.gahi-flash{animation:gahi-flash 1.4s ease-out}
@keyframes gahi-flash{from{box-shadow:inset 0 0 0 2px var(--gahi-agent,#C2500A);background:color-mix(in srgb,var(--gahi-agent,#C2500A) 16%,transparent)}to{box-shadow:inset 0 0 0 2px transparent}}
.gahi-hint{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.gahi-flash{animation:none}}
`;

const LEVEL_LABEL = { view: 'Looking around', undoable: 'Easy to undo', outward: 'Reaches other people', permanent: 'Can\'t be undone' };
const OUTCOMES = { do: 'Do', draft: 'Draft', block: 'Block' };
const quote = JSON.stringify;

// Apps fetch and re-render after a click, so wait until the screen has stopped changing.
const settled = ({ quiet = 200, max = 2000 } = {}) => new Promise(resolve => {
  let timer;
  let limit;
  const done = () => {
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(limit);
    resolve();
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(done, quiet);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  timer = setTimeout(done, quiet);
  limit = setTimeout(done, max);
});

// All content goes in as text, because agent input and app fields can hold anything.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(c => c !== null && c !== undefined && c !== false));
  return el;
}

const own = (el, selector) => [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll(selector)]
  .filter(n => n.closest('[gahi-object]') === el && !n.closest('[hidden]'));

function inputsOf(el) {
  if (el.tagName === 'FORM') return [...el.elements].filter(c => c.name).map(c => ({ name: c.name, required: c.required, control: c }));
  // Rich editors and controls outside a form name themselves with gahi-input, and a verb names them with gahi-uses.
  const scope = el.closest('[gahi-object]');
  return (el.getAttribute('gahi-uses') ?? '').split(/\s+/).filter(Boolean).map(word => {
    const name = word.replace(/\?$/, '');
    const control = [...document.querySelectorAll('[gahi-input]')].find(c => c.getAttribute('gahi-input') === name && c.closest('[gahi-object]') === scope);
    return { name, required: !word.endsWith('?'), control };
  });
}

// A control that takes input can stay disabled until it has some, so it still counts as available.
const usable = el => !el.disabled || el.hasAttribute('gahi-uses');

const verbInfo = el => ({
  el,
  name: el.getAttribute('gahi-verb'),
  risk: el.getAttribute('gahi-risk'),
  about: el.getAttribute('gahi-about'),
  after: el.getAttribute('gahi-after'),
  inputs: inputsOf(el),
});

function readScreen() {
  const objects = new Map();
  for (const el of document.querySelectorAll('[gahi-object]')) {
    if (el.closest('[hidden]')) continue;
    const ref = el.getAttribute('gahi-object');
    if (!objects.has(ref)) objects.set(ref, { ref, in: null, fields: [], state: [], verbs: [] });
    // The same object can appear twice on a screen, like a chat in the list and in the open pane.
    const obj = objects.get(ref);
    obj.in ??= el.parentElement?.closest('[gahi-object]')?.getAttribute('gahi-object') ?? null;
    for (const pair of parseState(el.getAttribute('gahi-state'))) {
      if (!obj.state.some(([k]) => k === pair[0])) obj.state.push(pair);
    }
    for (const f of own(el, '[gahi-field]')) {
      const name = f.getAttribute('gahi-field');
      if (!obj.fields.some(x => x.name === name)) obj.fields.push({ name, value: f.textContent.trim(), from: f.getAttribute('gahi-from') });
    }
    for (const v of own(el, '[gahi-verb]')) {
      if (usable(v) && !obj.verbs.some(x => x.name === v.getAttribute('gahi-verb'))) obj.verbs.push(verbInfo(v));
    }
  }
  return {
    screen: document.querySelector('[gahi-screen]')?.getAttribute('gahi-screen') ?? document.title,
    url: location.pathname + location.search,
    objects: [...objects.values()],
    verbs: [...document.querySelectorAll('[gahi-verb]')].filter(v => !v.closest('[gahi-object]') && !v.closest('[hidden]') && usable(v)).map(verbInfo),
  };
}

const plainVerb = ({ name, risk, about, after, inputs }) => ({ name, risk, about, after, inputs: inputs.map(i => ({ name: i.name, required: i.required })) });

function snapshot() {
  const snap = readScreen();
  return { ...snap, objects: snap.objects.map(o => ({ ...o, verbs: o.verbs.map(plainVerb) })), verbs: snap.verbs.map(plainVerb) };
}

function setValue(found, value) {
  const control = found.isContentEditable || found.matches('input,textarea,select') ? found : found.querySelector('[contenteditable=true],input,textarea,select');
  if (control.isContentEditable) {
    // insertText is what typing produces, so rich editors update their own state.
    control.focus();
    document.execCommand('selectAll');
    if (!value.includes('\n')) {
      document.execCommand('insertText', false, value);
      return;
    }
    // Rich editors lose or join lines from insertText, but they all handle a paste of several lines.
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    const paste = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    if (control.dispatchEvent(paste)) throw new Error('This editor can\'t take text with several lines.');
    return;
  }
  const proto = { TEXTAREA: HTMLTextAreaElement, SELECT: HTMLSelectElement }[control.tagName] ?? HTMLInputElement;
  // The native setter, so frameworks that track a control's value still see the change.
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

// Running the real control means an agent goes through the same code and checks as a person.
async function fire(v, input, relocate) {
  const { el } = v;
  if (el.tagName === 'FORM') {
    for (const [name, value] of Object.entries(input)) setValue(el.elements[name], value);
    if (!el.checkValidity()) throw new Error('The form refused that input.');
    el.requestSubmit();
    return;
  }
  for (const { name, control } of v.inputs) {
    if (!Object.hasOwn(input, name)) continue;
    if (!control) throw new Error(`The control for ${name} isn't on screen.`);
    setValue(control, input[name]);
  }
  if (v.inputs.length) await settled({ quiet: 100, max: 800 });
  // The app may have swapped a disabled control for an enabled one once it saw the input.
  const current = v.inputs.length ? relocate() : v;
  if (!current || current.el.disabled) throw new Error('The app kept that control disabled, so nothing happened.');
  current.el.click();
}

async function run({ object, verb, input = {}, via, reveal = false }) {
  const find = () => {
    const snap = readScreen();
    return object === undefined ? snap.verbs.find(v => v.name === verb) : snap.objects.find(o => o.ref === object)?.verbs.find(v => v.name === verb);
  };
  let v = find();
  if (!v && reveal && object !== undefined) {
    const verbs = readScreen().objects.find(o => o.ref === object)?.verbs ?? [];
    (verbs.find(x => x.name === via) ?? verbs.find(x => riskOf(x.risk) === 'view'))?.el.click();
    await settled();
    v = find();
  }
  if (!v) return { error: `${object ?? 'This screen'} has no verb ${quote(verb)} right now.` };
  try {
    await fire(v, input, find);
  } catch (e) {
    return { error: e.message };
  }
  await settled();
  return { ok: true };
}

function takeKey() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('key');
  // Apps route and redirect, so the key can't stay in the URL.
  if (fromLink) history.replaceState(history.state, '', location.pathname + location.search);
  try {
    if (fromLink) sessionStorage.setItem('gahi-key', fromLink);
    return fromLink ?? sessionStorage.getItem('gahi-key');
  } catch {
    return fromLink;
  }
}

function loadRules() {
  const fresh = defaultRules();
  try {
    const saved = JSON.parse(localStorage.getItem('gahi-rules') ?? '{}');
    return { draftAll: saved.draftAll === true, risk: { ...fresh.risk, ...saved.risk }, verbs: { ...saved.verbs } };
  } catch {
    return fresh;
  }
}

// With no server, the session lives right here and the agent shares this screen.
function localSession() {
  const session = createSession({ screen: { snapshot, run }, rules: loadRules() });
  const { setRules } = session;
  session.setRules = next => {
    try { localStorage.setItem('gahi-rules', JSON.stringify(next)); } catch { /* A private window can refuse storage, and rules then last until reload. */ }
    setRules(next);
  };
  return session;
}

// With a server, the session lives there, so it keeps going after this page closes.
function serverSession(key) {
  const listeners = new Set();
  let state = { rules: defaultRules(), draft: [], log: [], problem: '', person: {}, link: null };
  const api = (path, body) => fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-gahi-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let lastPerson = '';
  async function refresh() {
    try {
      const res = await api('/gahi/state');
      if (!res.ok) return;
      const next = await res.json();
      const changed = quote(next) !== quote(state);
      state = next;
      if (changed) for (const fn of listeners) fn();
    } catch { /* The server may be restarting, and the next tick tries again. */ }
  }
  const send = async (path, body) => {
    const res = await api(path, body);
    await refresh();
    return res;
  };
  refresh();
  setInterval(refresh, 1000);
  return {
    rules: () => state.rules,
    draft: () => state.draft,
    log: () => state.log,
    problem: () => state.problem,
    person: () => state.person,
    linkUrl: () => state.link,
    setRules: next => {
      state = { ...state, rules: next };
      for (const fn of listeners) fn();
      return send('/gahi/rules', next);
    },
    setPerson: next => {
      const text = quote(next);
      if (text === lastPerson) return;
      lastPerson = text;
      api('/gahi/person', next).catch(() => { lastPerson = ''; });
    },
    approve: () => send('/gahi/approve', {}),
    discard: () => send('/gahi/discard', {}),
    // The hidden tab needs what this tab signed in with. Cookies travel on the request, and this adds local storage.
    link: () => {
      const storage = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const name = localStorage.key(i);
        if (!name.startsWith('gahi-')) storage[name] = localStorage.getItem(name);
      }
      return send('/gahi/link', { storage });
    },
    stop: () => send('/gahi/unlink', {}),
    read: async () => (await api('/gahi/read')).text(),
    act: async (_agent, request) => {
      const res = await api('/gahi/act', request);
      return { status: res.status, text: await res.text() };
    },
    on: fn => listeners.add(fn),
  };
}

export function mount({ root = document.body } = {}) {
  window.gahiScreen = Object.freeze({ snapshot, run });
  // The agent's hidden tab only needs the screen. Rules, drafts and buttons are for the person's tab.
  if (window.__gahiAgentTab) return null;

  const key = takeKey();
  const session = key ? serverSession(key) : localSession();
  const person = { on: null, pointing: null };
  let draftOpen = false;
  let panelOpen = false;
  let toastTimer;
  let panelKey = '';
  let barKey = '';
  let seen = session.log().length;
  let linkError = '';

  const objectEls = ref => [...document.querySelectorAll('[gahi-object]')].filter(el => el.getAttribute('gahi-object') === ref);

  const toast = h('div', { class: 'gahi-ui gahi-toast', role: 'status', hidden: true });
  const draftBtn = h('button', { type: 'button', class: 'gahi-draft-btn', hidden: true, onclick: () => setDraftOpen(true) });
  const agentBtn = h('button', { type: 'button', class: 'gahi-agent-btn', text: 'Agent', onclick: () => setPanelOpen(!panelOpen) });
  const dock = h('div', { class: 'gahi-ui gahi-dock' }, draftBtn, agentBtn);
  const panel = h('aside', { class: 'gahi-ui gahi-panel', 'aria-label': 'Agent', hidden: true });
  const bar = h('div', { class: 'gahi-ui gahi-bar', role: 'group', 'aria-label': 'Draft', hidden: true });
  const hint = h('p', { class: 'gahi-ui gahi-hint', 'aria-hidden': 'true', text: 'This page has an agent view. In this page, await gahi.read() returns it as text.' });
  root.append(h('style', { class: 'gahi-ui', text: STYLE }), toast, dock, panel, bar, hint);
  document.head.append(h('meta', { name: 'gahi', content: VERSION }));

  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function setPanelOpen(next) {
    panelOpen = next;
    panel.hidden = !next;
    panelKey = '';
    paint();
  }

  function setDraftOpen(next) {
    draftOpen = next && session.draft().length > 0;
    paint();
  }

  function paintRules() {
    const rules = session.rules();
    const seg = (current, choices, pick) => h('span', { class: 'gahi-seg' }, choices.map(o => h('button', {
      type: 'button', text: OUTCOMES[o], 'aria-pressed': String(current === o), onclick: () => pick(o),
    })));
    const snap = readScreen();
    const verbs = [...new Set([...snap.objects.flatMap(o => o.verbs), ...snap.verbs].map(v => v.name).concat(Object.keys(rules.verbs)))].sort();
    return h('section', {},
      h('h2', { text: 'Rules' }),
      LEVELS.map(level => h('div', { class: 'gahi-rule' }, h('span', { text: LEVEL_LABEL[level] }),
        seg(rules.risk[level], level === 'view' ? ['do', 'block'] : ['do', 'draft', 'block'], o => session.setRules({ ...rules, risk: { ...rules.risk, [level]: o } })))),
      h('label', { class: 'gahi-row' },
        h('input', { type: 'checkbox', checked: rules.draftAll, onchange: e => session.setRules({ ...rules, draftAll: e.target.checked }) }),
        'Put every change on a draft'),
      verbs.length ? h('details', {}, h('summary', { text: 'Rules for one verb' }), h('div', { class: 'gahi-log' }, verbs.map(name => h('label', { class: 'gahi-rule' }, name,
        h('select', {
          onchange: e => {
            const { [name]: _, ...others } = rules.verbs;
            session.setRules({ ...rules, verbs: e.target.value ? { ...others, [name]: e.target.value } : others });
          },
        },
        h('option', { value: '', text: 'Use its level', selected: !Object.hasOwn(rules.verbs, name) }),
        Object.entries(OUTCOMES).map(([o, label]) => h('option', { value: o, text: label, selected: rules.verbs[name] === o })))))))
        : null);
  }

  function paintLink() {
    if (!session.link) return null;
    const link = session.linkUrl();
    const copy = h('button', {
      type: 'button',
      text: 'Copy',
      onclick: async e => {
        try {
          await navigator.clipboard.writeText(link);
          e.target.textContent = 'Copied';
        } catch {
          e.target.closest('section').querySelector('input')?.select();
        }
      },
    });
    return h('section', {},
      h('h2', { text: 'Your agent' }),
      link
        ? [h('p', { class: 'gahi-muted', text: 'Give your agent this link. It works in its own hidden tab with your sign-in and your rules, even after you close this page.' }),
          h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Agent link' }),
          h('div', { class: 'gahi-row' }, copy, h('button', { type: 'button', text: 'Stop agent', onclick: () => session.stop() }))]
        : h('button', {
          type: 'button',
          text: 'Link an agent',
          onclick: async () => {
            const res = await session.link();
            linkError = res.ok ? '' : await res.text();
            panelKey = '';
            paint();
          },
        }),
      linkError ? h('p', { text: linkError }) : null);
  }

  const logLine = e => h('div', { class: 'gahi-log-a', text: {
    ran: `${e.by} ran ${e.verb} on ${e.object ?? 'screen'}`,
    drafted: `${e.by} drafted ${e.verb} on ${e.object ?? 'screen'}`,
    blocked: `${e.by} was blocked from ${e.verb} on ${e.object ?? 'screen'}`,
    approved: `you approved ${e.verb} on ${e.object ?? 'screen'}, from ${e.by}`,
    discarded: `you discarded ${e.verb} on ${e.object ?? 'screen'}, from ${e.by}`,
  }[e.type] });

  function paintPanel() {
    if (!panelOpen) return;
    const snap = readScreen();
    const verbs = [...snap.objects.flatMap(o => o.verbs), ...snap.verbs].map(v => v.name);
    const log = session.log();
    const nextKey = quote([session.rules(), [...new Set(verbs)], log.length, session.linkUrl?.(), linkError]);
    if (nextKey === panelKey) return;
    panelKey = nextKey;
    const peek = h('pre');
    session.read?.('link').then(text => { peek.textContent = text; }, () => { peek.textContent = 'Link an agent to see this.'; });
    panel.replaceChildren(...[
      h('div', { class: 'gahi-head' }, h('h2', { text: 'Agent' }), h('button', { type: 'button', text: 'Close', onclick: () => setPanelOpen(false) })),
      paintLink(),
      paintRules(),
      log.length ? h('section', {}, h('h2', { text: 'What it did' }), h('div', { class: 'gahi-log' }, log.slice(-30).reverse().map(logLine))) : null,
      h('details', { class: 'gahi-peek' }, h('summary', { text: 'What the agent reads' }), peek),
    ].filter(Boolean));
  }

  function markFor(item, obj) {
    const del = text => h('del', { text });
    const ins = text => h('ins', { text });
    const before = name => obj?.state.find(([k]) => k === name)?.[1] ?? obj?.fields.find(f => f.name === name)?.value ?? 'empty';
    const parts = [];
    if (item.after === 'removed') parts.push(del('Will be removed'));
    else for (const [name, value] of parseState(item.after)) parts.push(del(`${name}: ${before(name)}`), ins(`${name}: ${value}`));
    for (const value of Object.values(item.input)) parts.push(ins(`${item.verb}: ${value}`));
    if (!parts.length) parts.push(ins(item.verb));
    return h('div', { class: 'gahi-ui gahi-mark' }, parts);
  }

  function paintMarks() {
    for (const el of document.querySelectorAll('.gahi-mark')) el.remove();
    for (const el of document.querySelectorAll('.gahi-removed')) el.classList.remove('gahi-removed');
    if (!draftOpen) return;
    const now = readScreen();
    for (const item of session.draft()) {
      const el = item.object && objectEls(item.object)[0];
      if (!el) continue;
      if (item.after === 'removed') el.classList.add('gahi-removed');
      (el.tagName === 'TR' ? el.lastElementChild : el).append(markFor(item, now.objects.find(o => o.ref === item.object)));
    }
  }

  function paintBar() {
    bar.hidden = !draftOpen;
    if (!draftOpen) {
      barKey = '';
      return;
    }
    const draft = session.draft();
    const away = draft.filter(item => !item.object || !objectEls(item.object).length);
    const problem = session.problem();
    // Painting runs on every hover, and replacing a button mid-click would lose the click.
    const nextKey = quote([draft.length, away.length, problem]);
    if (nextKey === barKey) return;
    barKey = nextKey;
    bar.replaceChildren(...[
      h('span', { text: `${draft.length} change${draft.length === 1 ? '' : 's'} in draft${away.length ? `, ${away.length} not on this screen` : ''}` }),
      problem ? h('span', { text: problem }) : null,
      h('button', { type: 'button', class: 'gahi-approve', text: 'Approve', onclick: () => session.approve() }),
      h('button', { type: 'button', text: 'Discard', onclick: () => session.discard() }),
      h('button', { type: 'button', text: 'Back to app', onclick: () => setDraftOpen(false) }),
    ].filter(Boolean));
  }

  function showNewActivity() {
    const log = session.log();
    const fresh = log.slice(seen);
    seen = log.length;
    for (const e of fresh.filter(x => x.type === 'ran' || x.type === 'approved')) {
      say(`${e.by}: ${e.verb} ${e.object ?? ''}`);
      // Only the first copy: flashing a whole open pane too would hide what changed.
      const shown = e.object && objectEls(e.object)[0];
      if (shown) {
        shown.classList.remove('gahi-flash');
        void shown.offsetWidth;
        shown.classList.add('gahi-flash');
      }
    }
  }

  function reportPerson() {
    const known = ref => (ref && objectEls(ref).length ? ref : null);
    const screen = document.querySelector('[gahi-screen]')?.getAttribute('gahi-screen') ?? document.title;
    session.setPerson({ on: known(person.on), pointing: known(person.pointing), url: location.pathname + location.search, screen });
  }

  function paint() {
    const count = session.draft().length;
    draftBtn.hidden = !count || draftOpen;
    draftBtn.textContent = `Draft (${count})`;
    if (!count) draftOpen = false;
    dock.hidden = draftOpen;
    showNewActivity();
    paintBar();
    paintMarks();
    paintPanel();
    reportPerson();
  }
  session.on(paint);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      paint();
    }, 30);
  }
  const ours = node => node.nodeType === 1 && node.closest?.('.gahi-ui') !== null;
  new MutationObserver(list => {
    const changed = list.some(m => !(m.target.nodeType === 1 && m.target.closest('.gahi-ui'))
      && !(m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(ours) && m.addedNodes.length + m.removedNodes.length > 0));
    if (changed) schedule();
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['gahi-object', 'gahi-state', 'gahi-verb', 'gahi-field', 'gahi-risk', 'gahi-after', 'hidden', 'disabled'] });

  // isTrusted separates a person's real clicks from the clicks this file makes for an agent.
  const closestRef = target => (target.closest?.('.gahi-ui') ? null : target.closest?.('[gahi-object]')?.getAttribute('gahi-object') ?? null);
  document.addEventListener('click', e => {
    if (!e.isTrusted) return;
    const ref = closestRef(e.target);
    if (ref) {
      person.on = ref;
      schedule();
    }
  }, true);
  document.addEventListener('mouseover', e => {
    if (!e.isTrusted) return;
    const ref = closestRef(e.target);
    if (ref !== person.pointing) {
      person.pointing = ref;
      schedule();
    }
  });

  // An agent driving this browser can use this instead of screenshots.
  window.gahi = Object.freeze({
    version: VERSION,
    read: () => session.read('page'),
    act: async request => (await session.act('agent', request, 'page')).text,
  });

  paint();
  return { ...session, setDraftOpen, setPanelOpen, snapshot };
}
