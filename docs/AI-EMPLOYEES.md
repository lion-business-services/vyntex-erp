# AI employees (VYNTEX USA workspace only)

VYNTEX USA's six Grok bots (Parker, Sterling, Aria, Atlas, Sofia, Grant) work inside the company's own VYNTEX ERP
workspace (`erp.vyntexusa.com/vyntex-hq`, plan `internal`). Owner decisions of November 4, 2026.

## The rules the database enforces

| Rule | Where |
|---|---|
| Each bot has its own account and its own key. Only a keyed hash of the key is stored. | `app.bots`, `bot_key_issue` (api/_lib/public/office.js) |
| Each bot reaches only the sections its profile lists (none, view, edit), on its own company only. | `public.bot_call` (0084) |
| Access is not approval. There is no tool that sends to a client, deletes, changes a price, moves money, publishes or signs. A bot asks with `approvals_request`. | `public.bot_call`, `app.approvals` |
| Daysi and Abdul (owner or manager of the workspace) decide every level, 2 and 3. Payments, refunds, payouts, discounts, contracts, price changes and deletions are always level 3. | `public.approval_decide` |
| Approving "send to a client" for a bot's draft queues it in the approver's name. The delivery job checks consent and opt-outs again before anything leaves. | `public.approval_decide`, `app.messages_guard`, api/_lib/pipeline/deliver.js |
| No bot ever sees a tax ID, a bank or card detail or the secure vault. Payments show date, method, amount and job only. | `public.bot_call` (no tool reads those columns) |
| Winning or losing a lead needs a person. | `leads.update` refuses `won` and `lost` |
| Every call is kept, refused ones too. The log cannot be changed. | `app.bot_activity` (append only) |
| A paused bot, a revoked key or a closed workspace is refused at once. | `public.bot_auth`, `public.bot_call` |

## Connecting a bot

* MCP server (recommended): `POST https://erp.vyntexusa.com/api/bot/mcp` (JSON-RPC 2.0: `initialize`, `tools/list`,
  `tools/call`, `ping`; answers as `application/json`, no stream)
* Plain HTTPS: `POST https://erp.vyntexusa.com/api/bot/call` with `{"tool": "leads_list", "args": {}}`
* Header on every request: `Authorization: Bearer vxb_<64 hex characters>`
* No cookies and no browser origin: a request carrying either is refused
* Up to 120 calls a minute per bot (600 a minute per network address before the key is checked)

The key is created by the owner, IN: VYNTEX ERP, System, AI employees, the bot's card, "Create key" (fresh identity
check). It is shown once. It goes straight into the bot's own secret store, never into a chat or a document.

## Tools

`whoami`, `leads_list`, `leads_get`, `leads_create`, `leads_update`, `clients_list`, `clients_get`, `clients_update`,
`jobs_list`, `jobs_get`, `jobs_update`, `tasks_list`, `tasks_create`, `tasks_update`, `calendar_list`, `notes_add`,
`documents_list`, `messages_list`, `messages_draft`, `payments_list`, `catalog_list`, `reports_summary`,
`automations_list`, `team_list`, `approvals_request`, `approvals_list`, `chat_inbox`, `chat_send`, `chat_rooms`. A bot's `tools/list` shows only the tools its
access allows. The input schema of each is in api/_lib/bots/tools.js.

## Team chat (0087)

People talk to an AI employee in Team > Chat: a direct chat with it, or an @mention of it in a group. A bot only ever
reads the rooms it is a member of.

* Delivery, when the owner set the bot's chat address (AI employees > the bot's card > Chat address, fresh identity
  check): `POST <the bot's https address>` with JSON
  `{ "type": "chat.message", "id", "at", "bot": { "id", "slug", "name" }, "room": { "id", "kind", "name" }, "message": { "id", "body", "author", "mentions", "replyTo", "files", "at" }, "reply": { "tool": "chat_send", "args": { "roomId", "replyTo" } } }`
* Signature header: `X-VX-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the signing secret>`.
  The secret (`vxw_...`) is shown once when the address is saved. Reject a request whose `t` is more than 5 minutes off.
* Answer with HTTP 2xx. 400, 401, 403, 404, 410 and 422 stop the retries; anything else is tried again with a growing
  wait, up to 6 times.
* The bot replies with the `chat_send` tool (`roomId`, `body`, optional `replyTo` and `mentions`). Without an address,
  the bot reads the same messages with `chat_inbox` whenever it checks in.
* `chat_send` is internal team chat only. Anything to a client still goes through `messages_draft` and an approval.

## Not decided yet (ask the owner, do not fill in)

* Fixed network addresses of the bots' servers, if the list should be limited to them
* Routine times, 24/7 coverage, data limits beyond secrets

## Setting up

1. Migration `supabase/migrations/0084_ai_employees.sql`
2. `supabase/setup/vyntex_ai_employees.sql` (insert only, adds the six bots with their access, no keys)
3. The owner creates each key in the workspace and hands it to that bot's server
