// What happens when an agent asks for something: rules, drafts and history. It runs in the app's server,
// or in the page when there's no server. `screen` is wherever the agent's view lives.
import { decide, defaultRules, render, riskOf } from './language.js';

const quote = JSON.stringify;
const FOLLOW = { name: 'follow-person', risk: 'view', inputs: [], about: 'Opens the screen the person is on' };

export function createSession({ screen, rules: startRules = defaultRules(), here = () => true }) {
  let rules = startRules;
  let person = {};
  let problem = '';
  let queue = Promise.resolve();
  const draft = [];
  const log = [];
  const listeners = new Set();
  const lastView = new Map();

  const changed = () => {
    for (const fn of listeners) fn();
  };
  // One at a time, because each action changes the screen the next one reads.
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };

  async function view() {
    const snap = await screen.snapshot();
    const present = here();
    const elsewhere = present && person.url && snap.url && person.url !== snap.url;
    return { ...snap, person: { ...person, here: present }, draft, verbs: elsewhere ? [...snap.verbs, FOLLOW] : snap.verbs };
  }

  const read = async (door = 'link') => render(await view(), rules, door);

  // "this" is worked out at the moment of asking, so an agent's memory of the screen can't point it at the wrong thing.
  async function resolveThis(agent, verb) {
    const { on, within = [], url } = person;
    if (!here()) return { error: 'The person isn\'t here right now, so "this" doesn\'t point at anything. Ask them which one they mean.' };
    if (!on) return { error: 'The person isn\'t on anything right now, so "this" doesn\'t point at anything. Ask them which one they mean.' };
    const candidates = [on, ...within];
    const holder = snap => candidates.map(ref => snap.objects.find(o => o.ref === ref)).find(o => o?.verbs.some(v => v.name === verb))?.ref;
    const allowed = v => decide(rules, v.name, v.risk) === 'do';
    let snap = await screen.snapshot();
    if (holder(snap)) return { ref: holder(snap) };
    // Not on the agent's own screen yet, so go where the person is, then open it, the way a person would.
    if (url && snap.url !== url && allowed(FOLLOW)) {
      const went = await screen.goTo(url);
      if (!went?.error) {
        log.push({ by: agent, verb: FOLLOW.name, input: {}, type: 'ran' });
        snap = await screen.snapshot();
        if (holder(snap)) return { ref: holder(snap) };
      }
    }
    for (const ref of candidates) {
      const opener = snap.objects.find(o => o.ref === ref)?.verbs.find(v => riskOf(v.risk) === 'view' && allowed(v));
      if (!opener) continue;
      const opened = await screen.run({ object: ref, verb: opener.name });
      if (opened?.error) continue;
      lastView.set(ref, opener.name);
      log.push({ by: agent, verb: opener.name, object: ref, input: {}, type: 'ran' });
      snap = await screen.snapshot();
      if (holder(snap)) return { ref: holder(snap) };
    }
    return { error: `The person is on ${on}, and it has no verb ${quote(verb)} right now. Read the screen to see what it has.` };
  }

  const act = (agent, request, door = 'link') => serial(async () => {
    const { verb, object: asked, input = {}, draft: wantsDraft = false, ...unknown } = request ?? {};
    const refuse = (status, text) => ({ status, text });
    const stray = Object.keys(unknown);
    if (stray.length) return refuse(400, `Unknown field ${stray.map(quote).join(', ')}. Use verb, object, input and draft, such as {"verb":"NAME","object":"TYPE:ID"}.`);
    if (typeof verb !== 'string') return refuse(400, 'Send JSON with a verb, such as {"verb":"NAME","object":"TYPE:ID"}.');
    if (asked !== undefined && typeof asked !== 'string') return refuse(400, 'object must be text, such as "chat:1".');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return refuse(400, 'input must be an object.');

    let object = asked;
    let meant = '';
    if (asked === 'this') {
      const found = await resolveThis(agent, verb);
      if (found.error) return refuse(409, found.error);
      object = found.ref;
      meant = ' That\'s what the person is on.';
    }

    const snap = await view();
    const v = object === undefined
      ? snap.verbs.find(x => x.name === verb)
      : snap.objects.find(o => o.ref === object)?.verbs.find(x => x.name === verb);
    if (!v && object === undefined) {
      const owner = snap.objects.find(o => o.verbs.some(x => x.name === verb));
      if (owner) return refuse(400, `${verb} needs an object, such as {"verb":${quote(verb)},"object":${quote(owner.ref)}}.`);
    }
    if (!v) return refuse(409, `${object ?? 'This screen'} has no verb ${quote(verb)} right now. Read the screen again. You may need to open it first.`);
    const extra = Object.keys(input).filter(k => !v.inputs.some(i => i.name === k));
    if (extra.length) return refuse(400, `${verb} doesn't take ${extra.map(quote).join(', ')}. It takes: ${v.inputs.map(i => i.name).join(', ') || 'nothing'}.`);
    if (Object.values(input).some(value => typeof value !== 'string')) return refuse(400, 'Input values must be text.');
    const missing = v.inputs.filter(i => i.required && !input[i.name]?.trim());
    if (missing.length) return refuse(400, `${verb} needs ${missing.map(i => i.name).join(', ')}.`);

    const entry = { by: agent, verb, object, input };
    const outcome = decide(rules, verb, v.risk, wantsDraft === true);
    if (outcome === 'block') {
      log.push({ ...entry, type: 'blocked' });
      changed();
      return refuse(403, `The person's rules block ${verb}. Nothing happened.`);
    }
    if (outcome === 'draft') {
      const same = draft.findIndex(d => d.verb === verb && d.object === object);
      if (same >= 0) draft.splice(same, 1);
      draft.push({ ...entry, risk: riskOf(v.risk), after: v.after, via: lastView.get(object) });
      log.push({ ...entry, type: 'drafted' });
      changed();
      return { status: 200, text: `In draft: ${verb} on ${object ?? 'this screen'}.${meant} Nothing changes until the person approves it in the app. You can't approve it from here.` };
    }
    const result = verb === FOLLOW.name ? await screen.goTo(person.url) : await screen.run({ object, verb, input });
    if (result?.error) return refuse(409, result.error);
    log.push({ ...entry, type: 'ran' });
    if (riskOf(v.risk) === 'view' && object) lastView.set(object, verb);
    changed();
    const done = `Ran ${verb} on ${object ?? 'this screen'}.${meant}`;
    return { status: 200, text: riskOf(v.risk) === 'view' ? `${done}\n\n${render(await view(), rules, door)}` : `${done} Read the screen to see the result.` };
  });

  const approve = () => serial(async () => {
    problem = '';
    for (const item of [...draft]) {
      // The verb may live on another screen, so the screen goes back the way the agent got there.
      const result = await screen.run({ object: item.object, verb: item.verb, input: item.input, via: item.via, reveal: true });
      if (result?.error) {
        problem = `Couldn't run ${item.verb} on ${item.object ?? 'the screen'}: ${result.error}`;
        continue;
      }
      draft.splice(draft.indexOf(item), 1);
      log.push({ by: item.by, verb: item.verb, object: item.object, input: item.input, type: 'approved' });
    }
    changed();
  });

  const discard = () => serial(async () => {
    for (const item of draft.splice(0)) log.push({ by: item.by, verb: item.verb, object: item.object, input: item.input, type: 'discarded' });
    problem = '';
    changed();
  });

  return {
    read, act, approve, discard,
    rules: () => rules,
    draft: () => draft,
    log: () => log,
    problem: () => problem,
    person: () => person,
    setRules: next => {
      rules = next;
      changed();
    },
    setPerson: next => {
      if (quote(next) === quote(person)) return;
      person = next;
      changed();
    },
    on: fn => listeners.add(fn),
  };
}
