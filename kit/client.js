const STYLE = `
.gahi-bar{position:fixed;top:max(12px,env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));display:flex;gap:8px;align-items:center;z-index:20}
.gahi-bar button{background:var(--sheet,#fff);border:1px solid var(--rule,#ccc);border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600;color:inherit;cursor:pointer}
.gahi-bar .gahi-link{font-weight:400;color:var(--muted,#566471)}
.gahi-bar .gahi-badge{border-color:var(--agent,#C2500A)}
.gahi-badge::before{content:"\\25C6 ";color:var(--agent,#C2500A)}
.gahi-panel{position:fixed;top:0;right:0;bottom:0;width:380px;box-sizing:border-box;overflow:auto;padding:16px max(16px,env(safe-area-inset-right,0px)) 16px 16px;background:var(--sheet,#fff);border-left:1px solid var(--rule,#ccc);display:grid;gap:14px;align-content:start;font-size:14px;z-index:20}
.gahi-bar[hidden],.gahi-panel[hidden],.gahi-panel [hidden]{display:none}
.gahi-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.gahi-panel h2{font-size:15px;font-weight:600;line-height:1.3;margin:0}
@media (min-width:861px){body.gahi-open{padding-right:396px}}
@media (max-width:860px){.gahi-panel{top:auto;left:0;width:auto;max-height:60vh;border-left:0;border-top:1px solid var(--rule,#ccc);padding-left:max(16px,env(safe-area-inset-left,0px));padding-bottom:max(16px,env(safe-area-inset-bottom,0px))}body.gahi-open{padding-bottom:62vh}}
.gahi-panel section{display:grid;gap:8px}
.gahi-switch{display:inline-flex;border:1px solid var(--rule,#ccc);border-radius:8px;overflow:hidden;width:fit-content}
.gahi-switch button{border:0;border-radius:0;background:transparent;color:inherit;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer}
.gahi-switch button[aria-pressed=true]{background:var(--human,#0B5FD6);color:var(--sheet,#fff)}
.gahi-switch button:last-child[aria-pressed=true]{background:var(--agent,#C2500A)}
.gahi-item{border:1px solid var(--rule,#ccc);border-radius:8px;padding:10px;display:grid;gap:6px;background:var(--vellum,transparent)}
.gahi-item p,.gahi-log p{margin:0}
.gahi-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.gahi-chip{font:12px/1.4 var(--mono,monospace);border:1px solid var(--rule,#ccc);border-radius:6px;padding:1px 6px}
.gahi-chip.hard{background:var(--stop,#B3123E);border-color:var(--stop,#B3123E);color:var(--sheet,#fff)}
.gahi-agent::before{content:"\\25C6 ";color:var(--agent,#C2500A)}
.gahi-person::before{content:"\\25CF ";color:var(--human,#0B5FD6)}
.gahi-log{display:grid;gap:6px;max-height:280px;overflow:auto}
.gahi-msg:empty{display:none}
.gahi-msg{position:fixed;left:max(12px,env(safe-area-inset-left,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));max-width:min(420px,calc(100% - 24px));margin:0;box-sizing:border-box;background:var(--sheet,#fff);border:1px solid var(--stop,#B3123E);border-radius:8px;padding:8px;z-index:30}
.gahi-peek pre{font:12px/1.5 var(--mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;margin:8px 0 0}
[data-gahi-object].gahi-drafted{background:repeating-linear-gradient(135deg,var(--vellum,#fde),var(--vellum,#fde) 6px,transparent 6px,transparent 12px)}
[data-gahi-object].gahi-viewing{outline:2px solid var(--human,#0B5FD6);outline-offset:-2px}
.gahi-mark{display:block;font-size:12px;color:var(--agent,#C2500A)}
.gahi-mark::before{content:"\\25C6 "}
.gahi-changed{color:var(--agent,#C2500A);font-weight:600}
`;

const key = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';

async function api(path, body) {
  const options = body === undefined
    ? { headers: { 'x-gahi-key': key } }
    : { method: 'POST', headers: { 'content-type': 'application/json', 'x-gahi-key': key }, body: JSON.stringify(body) };
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `That request failed (${res.status}).`);
  return data;
}

// All content goes through textContent, because proposals and notes can hold untrusted text.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'text') el.textContent = value;
    else if (name === 'onclick') el.addEventListener('click', value);
    else if (name === 'class') el.className = value;
    else el.setAttribute(name, value);
  }
  el.append(...kids);
  return el;
}

const chip = undo => h('span', { class: `gahi-chip${undo === 'free' ? '' : ' hard'}`, text: `Undo: ${undo}` });
const who = actor => (actor === 'agent' ? 'gahi-agent' : 'gahi-person');
const label = e => `${e.object}#${e.objectId}`;

function logLine(e) {
  const text = {
    proposed: `${e.actor} proposed ${e.action} on ${label(e)}`,
    replaced: `${e.actor} replaced its ${e.action} on ${label(e)}`,
    approved: `${e.actor} approved ${e.action} on ${label(e)}, proposed by ${e.proposedBy}`,
    rejected: `${e.actor} rejected ${e.action} on ${label(e)}, proposed by ${e.proposedBy}`,
    ran: `${e.action} ran on ${label(e)}. Proposed by ${e.proposedBy}, approved by ${e.approvedBy}`,
    failed: `${e.action} failed on ${label(e)}: ${e.error}`,
    conflict: `${e.action} on ${label(e)} wasn't applied because it changed first`,
    undone: `${e.actor} undid ${e.action} on ${label(e)}`,
  }[e.type] ?? e.type;
  return h('p', { class: who(e.actor), text });
}

export function mount(root = document.body) {
  root.prepend(h('style', { text: STYLE }));

  let state = null;
  let showDraft = false;
  let asking = null;
  let lastJson = '';
  let open = false;
  let opener = null;

  const msg = h('p', { class: 'gahi-msg', role: 'status' });
  const title = h('h2', { text: 'Changes from agents', tabindex: '-1' });
  const history = h('details', {}, h('summary', { text: 'History' }));
  const badge = h('button', {
    type: 'button',
    class: 'gahi-badge',
    onclick: () => {
      opener = badge;
      setOpen(true);
      title.focus();
    },
  });
  const historyLink = h('button', {
    type: 'button',
    class: 'gahi-link',
    text: 'History',
    onclick: () => {
      opener = historyLink;
      history.open = true;
      setOpen(true);
      title.focus();
    },
  });
  const bar = h('div', { class: 'gahi-bar', 'aria-live': 'polite' }, historyLink, badge);
  const panel = h('aside', { class: 'gahi-panel', 'aria-label': 'Changes from agents' });
  root.append(msg, bar, panel);
  const realBtn = h('button', { type: 'button', text: 'Real', 'aria-pressed': 'true', onclick: () => flip(false) });
  const draftBtn = h('button', { type: 'button', text: 'Draft', 'aria-pressed': 'false', onclick: () => flip(true) });
  const summary = h('p', { style: 'margin:0' });
  const items = h('div', { style: 'display:grid;gap:8px' });
  const confirmBox = h('div');
  const logBox = h('div', { class: 'gahi-log' });
  const viewBox = h('pre');
  const waiting = h('section', {},
    h('div', { class: 'gahi-switch', role: 'group', 'aria-label': 'Show real data or the draft' }, realBtn, draftBtn),
    summary,
    h('h2', { text: 'Waiting for you' }),
    items);
  history.append(logBox);
  panel.append(
    h('div', { class: 'gahi-head' }, title, h('button', { type: 'button', text: 'Close', onclick: () => setOpen(false) })),
    confirmBox,
    waiting,
    history,
    h('details', { class: 'gahi-peek' }, h('summary', { text: 'What the agent reads' }), viewBox),
  );
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') setOpen(false);
  });
  history.addEventListener('toggle', () => syncPanel());

  const flip = next => {
    showDraft = next;
    paint();
  };

  function setOpen(next) {
    const hadFocus = panel.contains(document.activeElement) || document.activeElement === document.body;
    open = next;
    panel.hidden = !next;
    bar.hidden = next;
    document.body.classList.toggle('gahi-open', next);
    if (next) return;
    // The app's own buttons are disabled in the draft view, so closing always returns to real data.
    showDraft = false;
    asking = null;
    confirmBox.replaceChildren();
    history.open = false;
    paint();
    if (hadFocus) {
      const row = opener?.closest?.('[data-gahi-object]')?.querySelector('button:not([hidden])');
      [opener, row, badge, historyLink].find(el => el?.offsetParent)?.focus({ preventScroll: true });
    }
  }

  function syncPanel() {
    if (open && !state?.draft.summary.total && !history.open && !asking) setOpen(false);
  }

  async function act(path, body) {
    msg.textContent = '';
    try {
      const result = await api(path, body);
      const problems = [...(result.conflicts ?? []).map(c => `A change wasn't applied because its object changed first (${c.reason}).`),
        ...(result.failed ?? []).map(f => `A change failed and nothing was saved: ${f.error}`)];
      if (result.kind === 'failed') problems.push(`That failed and nothing was saved: ${result.error}`);
      msg.textContent = problems.join(' ');
      await refresh();
      return result;
    } catch (e) {
      msg.textContent = e.message;
      return null;
    }
  }

  function paintObjects(objects, changes) {
    for (const el of document.querySelectorAll('[data-gahi-object]')) {
      const [type, id] = el.dataset.gahiObject.split(':');
      const obj = objects[type]?.find(o => o.id === id);
      const drafted = changes.filter(i => i.object === type && i.objectId === id && !i.stale);
      el.classList.toggle('gahi-drafted', drafted.length > 0);
      el.classList.toggle('gahi-viewing', state.viewing?.object === type && state.viewing?.id === id);
      for (const field of el.querySelectorAll('[data-gahi-field]')) {
        const name = field.dataset.gahiField;
        field.textContent = obj?.[name] ?? '';
        field.classList.toggle('gahi-changed', showDraft && drafted.some(i => i.changes.some(c => c.field === name)));
      }
      el.querySelector('.gahi-mark')?.remove();
      if (drafted.length) el.querySelector('td, div')?.append(h('span', { class: 'gahi-mark', text: drafted.map(i => `${i.action}, proposed by ${i.actor}`).join('; ') }));
      for (const btn of el.querySelectorAll('[data-gahi-action]')) {
        btn.hidden = !state.available[type]?.[id]?.includes(btn.dataset.gahiAction);
        btn.disabled = showDraft;
      }
    }
    const values = showDraft ? state.draft.computed.draft : state.draft.computed.real;
    for (const el of document.querySelectorAll('[data-gahi-computed]')) {
      el.textContent = (values[el.dataset.gahiComputed] ?? '').toLocaleString('en-US');
    }
  }

  function paintItems(list) {
    const yes = i => act('/gahi/approve', { yes: [i.id] });
    const plain = list.filter(i => !i.needsYes && !i.stale);
    items.replaceChildren(
      ...(plain.length > 1 ? [h('button', { type: 'button', 'data-key': 'all', text: `Approve ${plain.length} that don't need a yes`, onclick: () => act('/gahi/approve', { ids: 'all' }) })] : []),
      ...list.map(i => h('div', { class: 'gahi-item' },
        h('p', { class: who(i.actor), text: `${i.actor} proposes ${i.action} on ${label({ object: i.object, objectId: i.objectId })}` }),
        ...i.changes.map(c => h('p', { text: `${c.field}: ${c.from ?? 'empty'} → ${c.to ?? 'empty'}` })),
        ...(i.stale ? [h('p', { text: 'This object changed after the proposal, so it can\'t be approved. Reject it.' })] : []),
        h('div', { class: 'gahi-row' }, chip(i.undo),
          ...(i.stale ? [] : i.needsYes
            ? [h('button', { type: 'button', 'data-key': `yes-${i.id}`, text: `Yes, ${i.action}`, onclick: () => yes(i) })]
            : [h('button', { type: 'button', 'data-key': `ok-${i.id}`, text: 'Approve', onclick: () => act('/gahi/approve', { ids: [i.id] }) })]),
          h('button', { type: 'button', 'data-key': `no-${i.id}`, text: 'Reject', onclick: () => act('/gahi/reject', { ids: [i.id] }) })),
      )),
    );
  }

  function paintLog(entries) {
    const undone = new Set(entries.filter(e => e.type === 'undone').map(e => e.entry));
    logBox.replaceChildren(...entries.slice(-15).reverse().map(e => {
      const line = logLine(e);
      if (e.type !== 'ran' || undone.has(e.entry)) return line;
      return h('div', { class: 'gahi-row' }, line, e.undo === 'free'
        ? h('button', { type: 'button', 'data-key': `undo-${e.entry}`, text: 'Undo', onclick: () => act('/gahi/undo', { entry: e.entry }) })
        : chip(e.undo));
    }));
    if (!entries.length) logBox.replaceChildren(h('p', { text: 'Nothing yet.' }));
  }

  function paintConfirm() {
    if (!asking) {
      confirmBox.replaceChildren();
      return;
    }
    const { action, id, input, undo } = asking;
    const close = () => {
      asking = null;
      paintConfirm();
      syncPanel();
      if (open) title.focus();
    };
    const confirm = h('button', {
      type: 'button',
      text: `Yes, ${action}`,
      onclick: async () => {
        close();
        await act('/gahi/do', { action, id, input, yes: true });
      },
    });
    confirmBox.replaceChildren(h('div', { class: 'gahi-item', role: 'alertdialog', 'aria-label': `Confirm ${action}` },
      h('p', { text: `${action} on ${id} needs your yes.` }),
      h('div', { class: 'gahi-row' }, chip(undo), confirm, h('button', { type: 'button', text: 'Cancel', onclick: close }))));
    confirm.focus();
  }

  function paint() {
    if (!state) return;
    const { draft, timeline, agentView } = state;
    const focused = document.activeElement?.dataset?.key;
    realBtn.setAttribute('aria-pressed', String(!showDraft));
    draftBtn.setAttribute('aria-pressed', String(showDraft));
    paintObjects(showDraft ? draft.draft : draft.real, draft.items);
    const counts = Object.entries(draft.summary.byAction).map(([name, n]) => `${n} ${name}`).join(', ');
    summary.textContent = `${draft.summary.total} waiting: ${counts}.${draft.summary.needsYes ? ` ${draft.summary.needsYes} needs its own yes.` : ''}`;
    waiting.hidden = !draft.summary.total;
    badge.hidden = !draft.summary.total;
    badge.textContent = `${draft.summary.total} waiting for you`;
    historyLink.hidden = !timeline.length;
    paintItems(draft.items);
    paintLog(timeline);
    viewBox.textContent = agentView;
    syncPanel();
    // A used button disappears, so move keyboard focus to the heading rather than losing it.
    if (focused && open) (document.querySelector(`[data-key="${CSS.escape(focused)}"]`) ?? title).focus();
  }

  async function refresh() {
    try {
      const next = await api('/gahi/state');
      const json = JSON.stringify(next);
      if (json === lastJson) return;
      lastJson = json;
      state = next;
      paint();
    } catch (e) {
      msg.textContent = e.message;
    }
  }

  document.addEventListener('click', async e => {
    const btn = e.target.closest?.('[data-gahi-action]');
    const row = e.target.closest?.('[data-gahi-object]');
    if (row) noteViewing(row);
    if (!btn) return;
    const payload = { action: btn.dataset.gahiAction, id: btn.dataset.gahiId, input: JSON.parse(btn.dataset.gahiInput ?? '{}') };
    const result = await act('/gahi/do', payload);
    if (result?.kind === 'needs_yes') {
      asking = { ...payload, undo: result.undo };
      opener = btn;
      setOpen(true);
      paintConfirm();
    }
  });
  document.addEventListener('focusin', e => {
    const row = e.target.closest?.('[data-gahi-object]');
    if (row) noteViewing(row);
  });

  function noteViewing(row) {
    const [object, id] = row.dataset.gahiObject.split(':');
    if (state?.viewing?.object === object && state?.viewing?.id === id) return;
    api('/gahi/viewing', { object, id }).then(refresh, e => {
      msg.textContent = e.message;
    });
  }

  badge.hidden = true;
  historyLink.hidden = true;
  panel.hidden = true;
  refresh();
  // shortcut: polls every 1.5 seconds, upgrade to server-sent events when an app has many viewers.
  setInterval(refresh, 1500);
}

mount();
