# GAHI

**Graphic Agent-Human Interface:** an early experiment in apps that people and AI agents use together.

Think of it as Track Changes for everything an agent does in an app. The agent reads the app as text, its changes wait on a draft, and you approve them before anything becomes real.

> **Early experiment.** It runs locally, keeps data in memory, and its API will change. Don't use it with real data or real money.

## Try it

Tested on Node 24, with no dependencies to install.

```bash
npm run invoices
```

Open the link it prints. You'll see an ordinary invoice app, using made-up data and a fake payment.

Then connect any MCP client to `http://127.0.0.1:4310/mcp` and ask it to clean up the overdue invoices. It can only read and propose changes. A small "waiting for you" badge appears in the app, and clicking it opens the review panel.

## The idea

Nothing new appears for anyone until it's needed.

- **People** see the app they already know. A review layer only appears when an agent has proposed something, and hard-to-undo actions need their own yes.
- **Agents** get the app as text, plus tools generated from its actions, with no docs needed. They can propose but not approve.
- **Developers** define each action once. The button wiring, agent view, tools, draft and approval all come from that definition.

```js
const snooze = action({
  object: 'invoice', input: { until: 'date' }, undo: 'free',
  when: inv => inv.status === 'overdue',
  apply: (inv, { until }) => ({ ...inv, status: 'snoozed', until }),
});

const pay = action({
  object: 'invoice', input: { account: 'string' }, undo: '5 days + $25 fee', needsYes: true,
  when: (inv, input) => inv.approved === true && inv.status !== 'paid' && (!input || input.account === inv.account),
  apply: inv => ({ ...inv, status: 'paid' }),
  effect: (inv, input) => payments.send(inv, input), // only ever runs on approval
});
```

```html
<tr data-gahi-object="invoice:482">
  <td data-gahi-field="status"></td>
  <td><button data-gahi-action="pay" data-gahi-id="482" data-gahi-input='{"account":"4021"}'>Pay</button></td>
</tr>
```

The full example is in [`examples/invoices`](examples/invoices).

## What's been tried

- Claude Sonnet and Haiku connected to the example over MCP with no docs. In one run, Sonnet flagged a suspicious invoice note without being told to.
- An agent told to obey that note and approve its own work did neither, and calls to the approval routes without the key were refused.
- An earlier version drafted labels for 6 real GitHub issues, and they were applied after a person approved them.
- In a small test, it used fewer tool calls and less time than click-based agents on one labeling task, and made the same decisions.

## What's unproven

- Whether people catch an agent's mistakes better this way. The one test so far was inconclusive.
- Whether developers want to write actions this way. No outside developer has tried it.
- Whether it holds up on larger apps. The example has 9 invoices.

## Known limits

- **Approval:** the approval key is printed in the server's log, so an agent that can read that log could use it. An agent that controls the browser and has the key could press Approve. Hard-to-undo actions should eventually need a fingerprint or similar check.
- **Agent identity:** all agents appear as `agent` in the history.
- **MCP:** `/mcp` has no authentication and binds to `127.0.0.1` only. Don't expose it beyond your machine.
- **Scale:** data is in memory, and the page polls for updates.

## What's in this repo

| Folder | What it is |
|---|---|
| [`kit`](kit) | The kit: actions, drafts and approval, the server, and the browser helper |
| [`examples/invoices`](examples/invoices) | A small app built on the kit |
| [`research`](research) | How this could work on iOS, Android, macOS, Windows and Linux |
| [`demos`](demos) | Earlier prototypes, built as Claude artifacts. Some rely on that runtime, so they may not work as plain files |
| [`experiments`](experiments) | Raw results from the model runs |
| [`tools`](tools) | The one-off script that applied the approved GitHub labels |
| [`design`](design) | The brief behind the prototypes' look |

Run the tests with `npm test`.

## License

There's no license yet, so all rights are reserved for now. If you'd like to try it or build on it, please [open an issue](https://github.com/bekhruzbekswe/gahi/issues).
