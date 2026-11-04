// The tools an AI employee can call (supabase/migrations/0084_ai_employees.sql, public.bot_call, decides every one).
// This list only describes them to the bot: the database checks the bot's access map, its company and the arguments
// again on every call, so a tool listed here by mistake still does nothing the database refuses.
//
// There is deliberately no tool that sends to a client, deletes, changes a price, moves money, publishes or signs.
// For those a bot calls approvals_request, and an owner or a manager of the company decides in VYNTEX ERP.
//
// MCP tool names use underscores (some clients refuse dots); the database names use dots: leads_list -> leads.list.

const id = { type: 'string', format: 'uuid' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' };
const lim = { type: 'integer', minimum: 1, maximum: 200, description: 'At most this many (default 50).' };
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

/** name -> { section, need, description, input } */
export const TOOLS = {
  whoami: { section: null, description: 'Your name, title and the sections you can view or edit, with the approval rule.', input: obj() },

  leads_list: { section: 'leads', need: 'view', description: 'Latest leads, newest first. Optional filter by status or creation date.',
    input: obj({ status: { type: 'string' }, since: date, limit: lim }) },
  leads_get: { section: 'leads', need: 'view', description: 'One lead with its last 20 notes.', input: obj({ id }, ['id']) },
  leads_create: { section: 'leads', need: 'edit', description: 'Add a new lead. It starts as "new" and gets its own ticket.',
    input: obj({ name: { type: 'string', minLength: 1, maxLength: 200 }, company: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
      address: { type: 'string' }, type: { type: 'string' }, source: { type: 'string' }, sourceDetail: { type: 'string', maxLength: 300 },
      pri: { enum: ['high', 'medium', 'low'] }, value: { type: 'number', minimum: 0 }, followUp: date, nextAction: { type: 'string' }, lang: { enum: ['en', 'es'] } }, ['name']) },
  leads_update: { section: 'leads', need: 'edit', description: 'Move a lead along the pipeline, set its priority, follow-up date or next action. Winning or losing a lead needs approval.',
    input: obj({ id, status: { type: 'string' }, pri: { enum: ['high', 'medium', 'low'] }, followUp: date, nextAction: { type: 'string' }, nextActionDue: date }, ['id']) },

  clients_list: { section: 'clients', need: 'view', description: 'Clients by name. Optional search text.', input: obj({ q: { type: 'string', maxLength: 100 }, limit: lim }) },
  clients_get: { section: 'clients', need: 'view', description: 'One client with jobs and last 20 notes. Tax IDs and bank details are never shown.', input: obj({ id }, ['id']) },
  clients_update: { section: 'clients', need: 'edit', description: 'Change a client\'s phone, email, company, lifecycle or tags.',
    input: obj({ id, phone: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, lifecycle: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 30 } }, ['id']) },

  jobs_list: { section: 'jobs', need: 'view', description: 'Jobs, newest first. Optional filter by status (estimate, contract, progress, hold, done).',
    input: obj({ status: { enum: ['estimate', 'contract', 'progress', 'hold', 'done'] }, limit: lim }) },
  jobs_get: { section: 'jobs', need: 'view', description: 'One job with its scope, terms and the amount received so far.', input: obj({ id }, ['id']) },
  jobs_update: { section: 'jobs', need: 'edit', description: 'Change a job\'s status or its start and end dates.',
    input: obj({ id, status: { enum: ['estimate', 'contract', 'progress', 'hold', 'done'] }, start: date, end: date }, ['id']) },

  tasks_list: { section: 'tasks', need: 'view', description: 'Tasks by due date. Optional filter by status or due before a date.',
    input: obj({ status: { enum: ['todo', 'doing', 'waiting', 'review', 'done'] }, dueBefore: date, limit: lim }) },
  tasks_create: { section: 'tasks', need: 'edit', description: 'Create a task, optionally for a lead, a client or a job, and for a person of the team.',
    input: obj({ title: { type: 'string', minLength: 1, maxLength: 300 }, description: { type: 'string' }, status: { enum: ['todo', 'doing', 'waiting', 'review', 'done'] },
      pri: { enum: ['high', 'medium', 'low'] }, due: date, leadId: id, clientId: id, jobId: id, assigneeId: id }, ['title']) },
  tasks_update: { section: 'tasks', need: 'edit', description: 'Change a task\'s title, description, status, priority or due date.',
    input: obj({ id, title: { type: 'string' }, description: { type: 'string' }, status: { enum: ['todo', 'doing', 'waiting', 'review', 'done'] }, pri: { enum: ['high', 'medium', 'low'] }, due: date }, ['id']) },

  calendar_list: { section: 'calendar', need: 'view', description: 'Job starts, lead visits and open tasks between two dates (default: the next 14 days).', input: obj({ from: date, to: date }) },
  notes_add: { section: null, description: 'Add a note to a lead, a client or a job (needs edit on that section).',
    input: obj({ parent: { enum: ['lead', 'client', 'job'] }, id, text: { type: 'string', minLength: 1, maxLength: 4000 } }, ['parent', 'id', 'text']) },
  documents_list: { section: 'documents', need: 'view', description: 'Documents with their title, kind and signature status.', input: obj({ limit: lim }) },

  messages_list: { section: 'messages', need: 'view', description: 'Latest messages, sent, received and drafts.', input: obj({ status: { type: 'string' }, limit: lim }) },
  messages_draft: { section: 'messages', need: 'edit', description: 'Write a draft email or text. It is never sent by you: ask with approvals_request (kind message.send) and a person sends it.',
    input: obj({ channel: { enum: ['email', 'text', 'whatsapp'] }, to: { type: 'string', minLength: 3, maxLength: 200 }, subject: { type: 'string', maxLength: 300 },
      body: { type: 'string', minLength: 1, maxLength: 20000 }, leadId: id, clientId: id }, ['to', 'body']) },

  payments_list: { section: 'payments', need: 'view', description: 'Payments received: date, method, amount and job. Never a bank or card detail.', input: obj({ limit: lim }) },
  catalog_list: { section: 'catalog', need: 'view', description: 'Services and their price tiers, as published in the catalog.', input: obj({ limit: lim }) },
  reports_summary: { section: 'reports', need: 'view', description: 'Counts and totals straight from the records: open leads, pipeline, new leads, active jobs, overdue tasks, collected this month, approvals waiting.', input: obj() },
  automations_list: { section: 'automations', need: 'view', description: 'The workspace automations and whether each is on.', input: obj() },
  team_list: { section: 'team', need: 'view', description: 'The people of the team (not field workers) and the AI employees.', input: obj() },

  approvals_request: { section: null, description: 'Ask a person (Daysi or Abdul) to decide something you may not do yourself: send to a client, delete, change a price, a payment, a refund, a discount, a contract, publishing, a campaign, an access change, production. Payments, refunds, discounts, contracts, price changes and deletions are always level 3.',
    input: obj({ kind: { enum: ['message.send', 'record.delete', 'price.change', 'payment', 'refund', 'payout', 'discount', 'contract', 'publish', 'campaign', 'access', 'production', 'other'] },
      level: { enum: [2, 3] }, what: { type: 'string', minLength: 3, maxLength: 500 }, why: { type: 'string', maxLength: 1000 }, riskIfWeDo: { type: 'string', maxLength: 1000 },
      riskIfWeDont: { type: 'string', maxLength: 1000 }, recommendation: { type: 'string', maxLength: 1000 }, deadline: date,
      target: obj({ type: { type: 'string', maxLength: 30 }, id }) }, ['kind', 'what']) },
  chat_inbox: { section: null, description: 'Team chat messages meant for you that you have not seen yet: your direct chats and every @mention of you in a group, oldest first. Reading marks them read. Pass wait: 25 to hold the call up to 25 seconds until one arrives, then call again at once: this is how you answer people within seconds.',
    input: obj({ limit: lim, wait: { type: 'integer', minimum: 0, maximum: 25 } }) },
  chat_send: { section: null, description: 'Reply in a team chat room you are a member of (a direct chat or a group). Use replyTo to answer one message. @mention people or AI employees by passing mentions. This is internal team chat, never a message to a client.',
    input: obj({ roomId: id, body: { type: 'string', minLength: 1, maxLength: 8000 }, replyTo: id, mentions: { type: 'array', maxItems: 30, items: obj({ type: { enum: ['member', 'bot'] }, id }, ['type', 'id']) } }, ['roomId', 'body']) },
  chat_rooms: { section: null, description: 'The team chat rooms you are a member of, with who is in each.', input: obj() },
  approvals_list: { section: null, description: 'Your own approval requests and how each was decided.', input: obj({ status: { enum: ['pending', 'approved', 'rejected', 'done', 'cancelled'] }, limit: lim }) },
};

export const dbName = (name) => name.replace('_', '.');

const LEVEL = { none: 0, view: 1, edit: 2 };
/** The tools this access map can use (what tools/list shows a bot; the database checks again on each call). */
export function toolsFor(access) {
  const may = (s, need) => (LEVEL[access?.[s]] || 0) >= LEVEL[need];
  return Object.entries(TOOLS).filter(([name, t]) => {
    if (name === 'notes_add') return ['leads', 'clients', 'jobs'].some((s) => may(s, 'edit'));
    return !t.section || may(t.section, t.need);
  }).map(([name, t]) => ({ name, description: t.description, inputSchema: t.input }));
}
