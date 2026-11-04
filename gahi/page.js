// Runs in the app's page. Reads the gahi-* attributes on the screen, turns them into the agent's text,
// and runs an agent's verbs through the real controls, so the two can't drift apart.
import { LEVELS, VERSION, decide, defaultRules, parseState, render, riskOf } from './language.js';

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
const tick = () => new Promise(resolve => { setTimeout(resolve, 30); });
const quote = JSON.stringify;

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

function verbInfo(el) {
  return {
    el,
    name: el.getAttribute('gahi-verb'),
    risk: el.getAttribute('gahi-risk'),
    about: el.getAttribute('gahi-about'),
    after: el.getAttribute('gahi-after'),
    inputs: el.tagName === 'FORM' ? [...el.elements].filter(c => c.name).map(c => ({ name: c.name, required: c.required })) : [],
  };
}

function snapshot(person, draft) {
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
      if (!v.disabled && !obj.verbs.some(x => x.name === v.getAttribute('gahi-verb'))) obj.verbs.push(verbInfo(v));
    }
  }
  const known = ref => (objects.has(ref) ? ref : null);
  return {
    screen: document.querySelector('[gahi-screen]')?.getAttribute('gahi-screen') ?? document.title,
    person: { on: known(person.on), pointing: known(person.pointing) },
    objects: [...objects.values()],
    verbs: [...document.querySelectorAll('[gahi-verb]')].filter(v => !v.closest('[gahi-object]') && !v.closest('[hidden]') && !v.disabled).map(verbInfo),
    draft,
  };
}

function setValue(control, value) {
  const proto = { TEXTAREA: HTMLTextAreaElement, SELECT: HTMLSelectElement }[control.tagName] ?? HTMLInputElement;
  // The native setter, so frameworks that track a control's value still see the change.
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

// Running the real control means an agent goes through the same code and checks as a person.
function fire(el, input) {
  if (el.tagName !== 'FORM') {
    el.click();
    return;
  }
  for (const [name, value] of Object.entries(input)) setValue(el.elements[name], value);
  if (!el.checkValidity()) throw new Error('The form refused that input.');
  el.requestSubmit();
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

export function mount({ root = document.body } = {}) {
  let rules = loadRules();
  const draft = [];
  const log = [];
  const listeners = new Set();
  const person = { on: null, pointing: null };
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  let draftOpen = false;
  let panelOpen = false;
  let link = null;
  let problem = '';
  let toastTimer;
  let panelKey = '';
  let barKey = '';

  const snap = () => snapshot(person, draft);
  const read = door => render(snap(), rules, door);
  const locate = (ref, verb, from = snap()) => (ref === undefined
    ? from.verbs.find(v => v.name === verb)
    : from.objects.find(o => o.ref === ref)?.verbs.find(v => v.name === verb));
  const objectEls = ref => [...document.querySelectorAll('[gahi-object]')].filter(el => el.getAttribute('gahi-object') === ref);

  // ---------- the page's own small interface ----------
  const toast = h('div', { class: 'gahi-ui gahi-toast', role: 'status', hidden: true });
  const draftBtn = h('button', { type: 'button', class: 'gahi-draft-btn', hidden: true, onclick: () => setDraftOpen(true) });
  const agentBtn = h('button', { type: 'button', class: 'gahi-agent-btn', text: 'Agent', onclick: () => setPanelOpen(!panelOpen) });
  const dock = h('div', { class: 'gahi-ui gahi-dock' }, draftBtn, agentBtn);
  const panel = h('aside', { class: 'gahi-ui gahi-panel', 'aria-label': 'Agent', hidden: true });
  const bar = h('div', { class: 'gahi-ui gahi-bar', role: 'group', 'aria-label': 'Draft', hidden: true });
  const hint = h('p', { class: 'gahi-ui gahi-hint', 'aria-hidden': 'true', text: 'This page has an agent view. In this page, gahi.read() returns it as text.' });
  root.append(h('style', { class: 'gahi-ui', text: STYLE }), toast, dock, panel, bar, hint);
  document.head.append(h('meta', { name: 'gahi', content: VERSION }));

  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function setRules(next) {
    rules = next;
    try { localStorage.setItem('gahi-rules', JSON.stringify(rules)); } catch { /* A private window can refuse storage, and rules then last until reload. */ }
    paint();
  }

  function setPanelOpen(next) {
    panelOpen = next;
    panel.hidden = !next;
    paint();
  }

  function setDraftOpen(next) {
    draftOpen = next && draft.length > 0;
    paint();
  }

  function paintRules() {
    const seg = (current, choices, pick) => h('span', { class: 'gahi-seg' }, choices.map(o => h('button', {
      type: 'button', text: OUTCOMES[o], 'aria-pressed': String(current === o), onclick: () => pick(o),
    })));
    const verbs = [...new Set([...snap().objects.flatMap(o => o.verbs), ...snap().verbs].map(v => v.name).concat(Object.keys(rules.verbs)))].sort();
    return h('section', {},
      h('h2', { text: 'Rules' }),
      LEVELS.map(level => h('div', { class: 'gahi-rule' }, h('span', { text: LEVEL_LABEL[level] }),
        seg(rules.risk[level], level === 'view' ? ['do', 'block'] : ['do', 'draft', 'block'], o => setRules({ ...rules, risk: { ...rules.risk, [level]: o } })))),
      h('label', { class: 'gahi-row' },
        h('input', { type: 'checkbox', checked: rules.draftAll, onchange: e => setRules({ ...rules, draftAll: e.target.checked }) }),
        'Put every change on a draft'),
      verbs.length ? h('details', {}, h('summary', { text: 'Rules for one verb' }), h('div', { class: 'gahi-log' }, verbs.map(name => h('label', { class: 'gahi-rule' }, name,
        h('select', {
          onchange: e => {
            const { [name]: _, ...others } = rules.verbs;
            setRules({ ...rules, verbs: e.target.value ? { ...others, [name]: e.target.value } : others });
          },
        },
        h('option', { value: '', text: 'Use its level', selected: !Object.hasOwn(rules.verbs, name) }),
        Object.entries(OUTCOMES).map(([o, label]) => h('option', { value: o, text: label, selected: rules.verbs[name] === o })))))))
        : null);
  }

  function paintLink() {
    if (!key) return null;
    const copy = h('button', {
      type: 'button',
      text: 'Copy',
      onclick: async e => {
        try {
          await navigator.clipboard.writeText(link);
          e.target.textContent = 'Copied';
        } catch {
          e.target.previousElementSibling?.select?.();
        }
      },
    });
    return h('section', {},
      h('h2', { text: 'Your agent' }),
      link
        ? [h('p', { class: 'gahi-muted', text: 'Give your agent this link. It can use the app with your rules while this page is open.' }),
          h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Agent link' }),
          h('div', { class: 'gahi-row' }, copy, h('button', { type: 'button', text: 'Stop agent', onclick: stopAgent }))]
        : h('button', { type: 'button', text: 'Link an agent', onclick: linkAgent }));
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
    const verbs = [...snap().objects.flatMap(o => o.verbs), ...snap().verbs].map(v => v.name);
    const nextKey = quote([rules, [...new Set(verbs)], log.length, link]);
    if (nextKey === panelKey) return;
    panelKey = nextKey;
    panel.replaceChildren(...[
      h('div', { class: 'gahi-head' }, h('h2', { text: 'Agent' }), h('button', { type: 'button', text: 'Close', onclick: () => setPanelOpen(false) })),
      paintLink(),
      paintRules(),
      log.length ? h('section', {}, h('h2', { text: 'What it did' }), h('div', { class: 'gahi-log' }, log.slice(-30).reverse().map(logLine))) : null,
      h('details', { class: 'gahi-peek' }, h('summary', { text: 'What the agent reads' }), h('pre', { text: read('link') })),
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
    const now = snap();
    for (const item of draft) {
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
    const away = draft.filter(item => !item.object || !objectEls(item.object).length);
    // Painting runs on every hover, and replacing a button mid-click would lose the click.
    const nextKey = quote([draft.length, away.length, problem]);
    if (nextKey === barKey) return;
    barKey = nextKey;
    bar.replaceChildren(...[
      h('span', { text: `${draft.length} change${draft.length === 1 ? '' : 's'} in draft${away.length ? `, ${away.length} not on this screen` : ''}` }),
      problem ? h('span', { text: problem }) : null,
      h('button', { type: 'button', class: 'gahi-approve', text: 'Approve', onclick: approve }),
      h('button', { type: 'button', text: 'Discard', onclick: discard }),
      h('button', { type: 'button', text: 'Back to app', onclick: () => setDraftOpen(false) }),
    ].filter(Boolean));
  }

  function paint() {
    draftBtn.hidden = !draft.length || draftOpen;
    draftBtn.textContent = `Draft (${draft.length})`;
    if (!draft.length) draftOpen = false;
    dock.hidden = draftOpen;
    paintBar();
    paintMarks();
    paintPanel();
    for (const fn of listeners) fn();
  }

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

  // ---------- where the person is ----------
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

  // ---------- what an agent can do ----------
  async function act(agent, request, door = 'link') {
    const { verb, object, input = {}, draft: wantsDraft = false } = request ?? {};
    const refuse = (status, text) => ({ status, text });
    if (typeof verb !== 'string') return refuse(400, 'Send JSON with a verb, such as {"verb":"NAME","object":"TYPE:ID"}.');
    if (object !== undefined && typeof object !== 'string') return refuse(400, 'object must be text, such as "chat:1".');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return refuse(400, 'input must be an object.');
    const v = locate(object, verb);
    if (!v) return refuse(409, `${object ?? 'This screen'} has no verb ${quote(verb)} on this screen. Read the screen again. You may need to open it first.`);
    const extra = Object.keys(input).filter(k => !v.inputs.some(i => i.name === k));
    if (extra.length) return refuse(400, `${verb} doesn't take ${extra.map(quote).join(', ')}. It takes: ${v.inputs.map(i => i.name).join(', ') || 'nothing'}.`);
    if (Object.values(input).some(value => typeof value !== 'string')) return refuse(400, 'Input values must be text.');
    const missing = v.inputs.filter(i => i.required && !input[i.name]?.trim());
    if (missing.length) return refuse(400, `${verb} needs ${missing.map(i => i.name).join(', ')}.`);

    const entry = { by: agent, verb, object, input };
    const outcome = decide(rules, verb, v.risk, wantsDraft === true);
    if (outcome === 'block') {
      log.push({ ...entry, type: 'blocked' });
      paint();
      return refuse(403, `The person's rules block ${verb}. Nothing happened.`);
    }
    if (outcome === 'draft') {
      const same = draft.findIndex(d => d.verb === verb && d.object === object);
      if (same >= 0) draft.splice(same, 1);
      draft.push({ ...entry, risk: riskOf(v.risk), after: v.after });
      log.push({ ...entry, type: 'drafted' });
      paint();
      return { status: 200, text: `In draft: ${verb} on ${object ?? 'this screen'}. Nothing changes until the person approves it.` };
    }
    try {
      fire(v.el, input);
    } catch (e) {
      return refuse(409, e.message);
    }
    log.push({ ...entry, type: 'ran' });
    await tick();
    // Only the first copy: flashing a whole open pane too would hide what changed.
    const shown = objectEls(object)[0];
    if (shown) {
      shown.classList.remove('gahi-flash');
      void shown.offsetWidth;
      shown.classList.add('gahi-flash');
    }
    say(`${agent}: ${verb} ${object ?? ''}`);
    paint();
    const done = `Ran ${verb} on ${object ?? 'this screen'}.`;
    return { status: 200, text: riskOf(v.risk) === 'view' ? `${done}\n\n${read(door)}` : `${done} Read the screen to see the result.` };
  }

  async function approve() {
    problem = '';
    for (const item of [...draft]) {
      let v = locate(item.object, item.verb);
      if (!v && item.object) {
        // The verb lives on another screen, so go there the way the agent did.
        snap().objects.find(o => o.ref === item.object)?.verbs.find(x => riskOf(x.risk) === 'view')?.el.click();
        await tick();
        v = locate(item.object, item.verb);
      }
      if (!v) {
        problem = `Couldn't run ${item.verb} on ${item.object}, because it's no longer on screen.`;
        continue;
      }
      try {
        fire(v.el, item.input);
      } catch (e) {
        problem = `${item.verb} on ${item.object}: ${e.message}`;
        continue;
      }
      draft.splice(draft.indexOf(item), 1);
      log.push({ by: item.by, verb: item.verb, object: item.object, input: item.input, type: 'approved' });
      await tick();
    }
    paint();
  }

  function discard() {
    for (const item of draft.splice(0)) log.push({ by: item.by, verb: item.verb, object: item.object, input: item.input, type: 'discarded' });
    problem = '';
    paint();
  }

  // ---------- the link for agents outside the browser ----------
  const api = (path, options = {}) => fetch(path, { ...options, headers: { 'x-gahi-key': key, ...(options.body ? { 'content-type': 'application/json' } : {}) } });

  async function linkAgent() {
    const res = await api('/gahi/link', { method: 'POST', body: '{}' });
    if (res.ok) link = (await res.json()).url;
    paint();
  }

  async function stopAgent() {
    await api('/gahi/unlink', { method: 'POST', body: '{}' });
    link = null;
    paint();
  }

  async function connect() {
    for (;;) {
      try {
        const res = await api('/gahi/next');
        if (res.status === 200) {
          const job = await res.json();
          const answer = job.type === 'read' ? { status: 200, text: read('link') } : await act('agent', job.body);
          await api('/gahi/answer', { method: 'POST', body: JSON.stringify({ id: job.id, ...answer }) });
        } else if (res.status !== 204) {
          await new Promise(resolve => { setTimeout(resolve, 2000); });
        }
      } catch {
        await new Promise(resolve => { setTimeout(resolve, 2000); });
      }
    }
  }

  // An agent driving this browser can use this instead of screenshots.
  window.gahi = Object.freeze({
    version: VERSION,
    read: () => read('page'),
    act: async request => (await act('agent', request, 'page')).text,
  });

  paint();
  if (key) connect();

  return {
    read, act, approve, discard, snapshot: snap, setRules, setDraftOpen, setPanelOpen,
    rules: () => rules,
    draft: () => draft,
    log: () => log,
    on: fn => listeners.add(fn),
  };
}
