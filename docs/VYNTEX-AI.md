# VYNTEX AI

The assistant inside VYNTEX ERP for companies on the **Master Builder** plan (and VYNTEX USA's own workspace). It answers
questions about the business and does the work the owner or the team asks for.

## What it can do

| Ask for | What happens |
|---|---|
| a new lead, a new client | created at once |
| a new project for a client | created at once (also for a client added in the same request) |
| a lead's stage, value or follow-up date; a visit date | changed at once (a won stage converts the lead, as on the screen) |
| a task, a change to a task, a task done | at once |
| a note on a lead, client or project | at once |
| a project's status | at once |
| a draft invoice for a project | created as a draft at once; it is sent from Invoices |
| an appointment | booked at once (the calendar's rules decide) |
| a payment received | shown on a card: nothing is recorded until **Confirm** |
| a review request to a client | shown on a card: nothing is sent until **Confirm** |
| a question ("who owes us", "what is due today", "how is the pipeline") | answered from the records |

Up to 5 actions in one request, in order. Every action is checked by the same business rules as the screens, against
the records as they are after the action before it, and the result of each one is shown with a link to the record.

## What it never does

- See more than the person's own role may see (office scoping, money only with the money right).
- See or send phone numbers, emails, addresses or tax IDs to the model (tax IDs are masked twice, in the browser and on
  the server).
- Send anything to a client, record money, delete or publish without the person's Confirm.
- Invent a record, an id or an amount: when something is missing it asks one short question.

## The models

Free tiers only (no cost), tried in this order until one answers:

1. **Groq**: `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`. First, because Groq does not keep
   inference data by default.
2. **Google Gemini**: `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`. The backup once Groq's free
   allowance is used up. On the free tier Google may use prompts and answers to improve its products, and human
   reviewers may read them. VYNTEX AI never sends phones, emails, addresses or tax IDs, but the summary has names and
   amounts. To keep everything on Groq, leave `GEMINI_API_KEY` unset.

Each model has its own free daily allowance; when one is used up the next answers, and when all are, the page answers
with the built-in assistant until the next day. A model a key cannot use is skipped.

Fair use, because one free allowance is shared by every company: 60 questions a day per company, 20 a minute per person.

## Setting it up

1. Create a free Groq key at https://console.groq.com (API Keys).
2. Create a free Gemini key at https://aistudio.google.com (Get API key).
3. In Vercel, project `vyntex-erp`, Settings, Environment Variables: add `GROQ_API_KEY` and `GEMINI_API_KEY`
   (Production, Sensitive), then redeploy. Never paste a key into a chat.
4. Optional: `GROQ_MODELS` and `GEMINI_MODELS` to change the models or their order (comma separated).

## Where it lives

- `api/_lib/assistant/ask.js`: the office operations `assistant_status` and `assistant_ask` (sign-in, plan, limits, Groq and Gemini, tools)
- `supabase/migrations/0095_vyntex_ai_access.sql`: `public.assistant_access` (who may use it)
- `src/features/assistant/`: the page; `context.ts` (the summary and the tool calls), `engine.ts` (actions, cards,
  checks, what is risky), `run.ts` (carrying them out), `remote.ts` (the network)
