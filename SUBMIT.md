# Launch Submission Playbook — @altronis/sgdata-mcp

> Built for Zach / Altronis. Every entry below is copy-paste ready. Execute top-down over 3-5 days. Don't batch them all on Day 0 — Reddit and HN burn out fast if you cross-post simultaneously. Verified 2026-04-08.

---

## Day 0 (publish day) — Tier 1, must-hit MCP discovery

These are the channels that determine whether people who are ACTIVELY searching for "Singapore MCP server" will find you 30 days from now. Hit all of them.

### 1. Official MCP Registry (registry.modelcontextprotocol.io)

**This is the most important one.** It's the first-party registry maintained by Anthropic + MCP steering group. Claude Desktop, Claude Code, VS Code Copilot, and every future MCP client will index from here. Note: the old `modelcontextprotocol/servers` GitHub repo no longer accepts community PRs — it now redirects to this registry.

- **Submission type:** CLI publish via `mcp-publisher` binary
- **Prereq:** npm package must already be live on npmjs.com
- **Homepage:** https://modelcontextprotocol.io/registry/quickstart
- **Namespace constraint:** With GitHub auth, your registry name MUST start with `io.github.<github-username>/`. So use `io.github.sypherin/sgdata-mcp`. DNS auth lets you use `sg.altronis/sgdata-mcp` but requires you to add a TXT record to `altronis.sg` — do DNS auth if you want a branded namespace, else stick with GitHub auth.

**Exact commands (from the repo root, after `npm publish`):**

```bash
# 1. Add mcpName to package.json (one-time)
# Edit package.json and add this field at the top level:
#   "mcpName": "io.github.sypherin/sgdata-mcp"
# then re-publish to npm so the registry can validate it:
npm version patch && npm publish --access public

# 2. Install mcp-publisher
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# 3. Init server.json in the repo
mcp-publisher init

# 4. Log in with GitHub (device flow)
mcp-publisher login github

# 5. Publish
mcp-publisher publish

# 6. Verify
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=sgdata-mcp"
```

**server.json (paste this into the file after running `init`, replacing anything it generated):**

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.sypherin/sgdata-mcp",
  "description": "Comprehensive Singapore government data MCP — 46 curated tools across 15 datasets (ACRA, HDB resale, URA private property, COE, CPI, GDP, MAS FX, IRAS, MOE schools, ECDA childcare, and more) plus 3 generic tools covering the entire ~2000-dataset data.gov.sg long tail. Local stdio, SQLite cache, no API keys.",
  "repository": {
    "url": "https://github.com/sypherin/sgdata-mcp",
    "source": "github"
  },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@altronis/sgdata-mcp",
      "version": "0.1.0",
      "transport": {
        "type": "stdio"
      }
    }
  ]
}
```

**Gotchas:**
- `mcpName` in `package.json` MUST exactly equal `name` in `server.json`.
- Registry is still in preview as of 2026-04 — expect to retry `publish` a few times on busy days.
- Once published, edit is only via re-publish with a bumped version.

---

### 2. punkpeye/awesome-mcp-servers (GitHub, PR-based)

The most-starred community awesome-list (has a Discord, a subreddit r/mcp, and 1000s of stars). It DOES accept PRs. Add two entries: one in Finance & Fintech (primary — ACRA/URA/HDB are financial/business data), one in Research (secondary — CPI/GDP/MAS FX are research data). Or just do Finance & Fintech if you want to avoid looking spammy.

- **Submission type:** GitHub Pull Request
- **Repo:** https://github.com/punkpeye/awesome-mcp-servers
- **Target file:** `README.md` (root)
- **Target section:** `### 💰 Finance & Fintech` (line ~1121)
- **Alphabetical position:** Between `sh-patterson/fec-mcp-server` and `SaintDoresh/YFinance-Trader-MCP-ClaudeDesktop` — look for the block starting with "s" entries. `sypherin/sgdata-mcp` slots in alphabetically after `sh-patterson` and before `SaintDoresh` (the list treats capitalization loosely; just place it after `sh-patterson` which is the closest neighbor).
- **Legend icons to use:** `📇` (TypeScript codebase) + `🏠` (Local service — SQLite cache, stdio)

**Exact markdown line to insert:**

```markdown
- [sypherin/sgdata-mcp](https://github.com/sypherin/sgdata-mcp) 📇 🏠 - Singapore government data via data.gov.sg, ACRA, HDB, URA, Singstat, MAS, IRAS, MOE, ECDA and more. 46 curated tools across 15 high-value datasets (corporate registry, resale flats, private property, COE, CPI, GDP, FX rates, schools, childcare) plus 3 generic tools covering the ~2000-dataset long tail. Local stdio, SQLite cache, no API keys.
```

**PR title:** `Add sypherin/sgdata-mcp — Singapore government data MCP server`

**PR body:**

```markdown
Adds `sypherin/sgdata-mcp` to the Finance & Fintech section.

This is a TypeScript MCP server that gives AI agents access to Singapore government data: ACRA corporate registry, HDB resale prices, URA private property, COE bidding, CPI, GDP, MAS FX rates, IRAS, MOE schools, ECDA childcare, and more. 46 curated tools across 15 high-value datasets, plus 3 generic tools that cover the entire ~2000-dataset long tail of data.gov.sg.

Local stdio, SQLite cache, no API keys, no hosted service. MIT licensed.

- npm: https://www.npmjs.com/package/@altronis/sgdata-mcp
- GitHub: https://github.com/sypherin/sgdata-mcp
- Analogue entry in the list: `yamariki-hub/japan-corporate-mcp` (Japanese gov data) — same shape, different country.

Icons: 📇 (TypeScript) 🏠 (Local — SQLite cache)

Placed alphabetically in Finance & Fintech.
```

**Gotchas:**
- Keep the description under ~60 words. The list is dense.
- Don't add the glama.ai badge on first submission — it only gets added after glama indexes you (happens automatically a few days after the repo goes public).
- The list treats alphabetical ordering loosely — don't stress about capital-vs-lowercase placement. If you get review feedback asking to move it, just comply.

---

### 3. mcpservers.org (aka wong2/awesome-mcp-servers — web form)

The `wong2/awesome-mcp-servers` repo explicitly says "We do not accept PRs. Please submit your MCP on the website: https://mcpservers.org/submit". The website is a clean directory with ~12-hour review turnaround. There's a $39 "Premium Submit" option for a dofollow link + faster review — skip it, the free listing is fine for launch.

- **Submission type:** Web form
- **URL:** https://mcpservers.org/submit
- **Required fields:** Name, Short description, Link, Category, Contact email
- **Timeline:** Reviewed within 12 hours, email on approval

**Form fields (copy-paste):**

| Field | Value |
|---|---|
| **Server Name** | `sgdata-mcp` |
| **Short Description** | `Singapore government data for AI agents. 46 tools across 15 curated data.gov.sg datasets — ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA — plus 3 generic tools for the full ~2000-dataset long tail. Local stdio, SQLite cache, no API keys.` |
| **Link** | `https://github.com/sypherin/sgdata-mcp` |
| **Category** | `Finance` (or `Database` if Finance isn't an option — pick whichever dropdown exists. If they have a "Government" or "Data" category, prefer that.) |
| **Contact Email** | `hello@altronis.sg` |

**Gotcha:** Don't pay for Premium. Observed value is minimal for a launch-day listing; you can always upgrade later if traffic justifies it.

---

### 4. Smithery.ai (CLI publish)

Smithery is one of the top three MCP registries. It has a CLI publish flow and a web "new server" form at https://smithery.ai/new. Because sgdata-mcp is stdio-only (not remote), the Smithery listing will be metadata-only — users still run it locally. That's fine; Smithery indexes stdio servers.

- **Submission type:** CLI OR web form at https://smithery.ai/new
- **Homepage:** https://smithery.ai/new
- **Prereq:** GitHub auth (they use GitHub OAuth for verification against your repo)

**Web form path (recommended — faster):**
1. Go to https://smithery.ai/new
2. Sign in with GitHub (same account that owns `sypherin/sgdata-mcp`)
3. Paste repo URL: `https://github.com/sypherin/sgdata-mcp`
4. Smithery auto-detects package.json, fills in name/description/version
5. Confirm and publish

**CLI path (if web form is flaky):**
```bash
npx -y @smithery/cli publish "https://github.com/sypherin/sgdata-mcp" -n "@altronis/sgdata-mcp"
```

**Required smithery.yaml in the repo root** (add before submitting if you want the listing to render install snippets correctly):

```yaml
startCommand:
  type: stdio
  configSchema:
    type: object
    properties: {}
  commandFunction: |
    (config) => ({
      command: 'npx',
      args: ['-y', '@altronis/sgdata-mcp']
    })
```

**Gotcha:** Smithery's config schema is required for deploy-to-smithery-hosted flows. Since sgdata-mcp is local-only (no env vars, no API keys), the empty `properties: {}` is correct.

---

### 5. Glama.ai MCP directory (auto-indexed, no action required, but verify)

Glama scrapes npm + GitHub automatically. Once `@altronis/sgdata-mcp` is live on npm, Glama will index it within 24-72 hours. No submission needed — but you should verify it actually showed up, and optionally claim the listing so you can add a longer description and custom tags.

- **Submission type:** Auto-scrape (no action). Optional: claim listing.
- **URL to check (after 72h):** https://glama.ai/mcp/servers/@altronis/sgdata-mcp
- **Action:** Sign in with GitHub → click "Claim this server" on your listing page → add long description, tags, example prompts.

**Example prompts to add on your claimed listing (3-5 of these will get you a higher match rate in Glama's semantic search):**

```
What's the average HDB 4-room resale price in Tampines over the last 12 months?

Show me URA private non-landed transactions in District 9 above $3M in Q1 2026.

Look up the ACRA record for UEN 202412345K and tell me the directors.

What's the current COE premium for Category A cars?

Give me the YoY change in Singapore CPI for the last 6 months.
```

**Gotcha:** If it's not indexed after 72h, ping them via their Discord (https://discord.gg/TFE8FmjCdS — same as the "glama.ai/mcp/discord" redirect).

---

### 6. mcp.so (GitHub-issue submission)

Community-driven directory, submits via GitHub issue.

- **Submission type:** GitHub issue
- **Repo:** https://github.com/chatmcp/mcp-directory (this is the repo mcp.so draws from — confirm by clicking "Submit" in mcp.so nav)
- **Action:** Open a new issue titled "Add: sgdata-mcp — Singapore government data"

**Issue body:**

```markdown
**Name:** sgdata-mcp
**Author:** Altronis
**Repo:** https://github.com/sypherin/sgdata-mcp
**npm:** https://www.npmjs.com/package/@altronis/sgdata-mcp
**License:** MIT
**Transport:** stdio (local)
**Category:** Finance / Government Data

**Description:**
Comprehensive Singapore government data MCP server. 46 tools across 15 curated data.gov.sg datasets: ACRA corporate registry, HDB resale, URA private property, COE, CPI, GDP, MAS FX rates, IRAS tax, MOE schools, ECDA childcare, and more. Plus 3 generic tools that cover the ~2000-dataset long tail. Local stdio, SQLite cache, no API keys, no hosted service.

**Features:**
- 46 curated tools for the highest-value SG government datasets
- 3 generic tools (dataset search, dataset schema, dataset query) for the long tail
- SQLite cache — first call hits data.gov.sg, subsequent calls are instant
- No API keys, no rate limits, no hosted service
- TypeScript / Node 20+

**Install:**
```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```
```

---

## Day 1-2 — Tier 2, community posts

Space these out. Don't post Reddit + HN + Discord on the same day — if one pops, you want the others to ride the wave, not compete.

### 7. Hacker News — Show HN

- **URL:** https://news.ycombinator.com/submit
- **Submission type:** Link submission with "Show HN:" title prefix and no text body (HN convention for Show HN is a URL and an optional comment as the first reply).
- **Best time to post:** Tuesday or Wednesday, 08:00-10:00 US Eastern (20:00-22:00 Singapore time). Avoid weekends.
- **Title rules:** <80 chars, no hyperbole, no emoji, no trailing period. Show HN posts with "I built X" beat posts with vague marketing titles.

**Title (copy-paste, 77 chars):**

```
Show HN: Sg-data-mcp – Singapore government data MCP server for AI agents
```

**URL:** `https://github.com/sypherin/sgdata-mcp`

**First comment (post this immediately after submission, from the same account, as a top-level reply — HN norm for Show HN. ~250 words):**

```
Hey HN — I'm Zach, an AI consultant in Singapore.

I kept hitting the same wall on every client project: Claude / Cursor / Codex can reason about code fine, but when a Singapore client asks "pull the ACRA record for this company" or "what's the CPI trend" or "median HDB resale price in Tampines", the LLM hallucinates. The data is all public on data.gov.sg but the APIs are scattered across 15+ agencies with inconsistent auth, schemas, and pagination.

So I built sgdata-mcp. It's an MCP server (stdio, local) that exposes 46 curated tools across 15 of the highest-value SG government datasets — ACRA corporate registry, HDB resale prices, URA private property, COE bidding, CPI, GDP, MAS FX rates, IRAS, MOE schools, ECDA childcare. On top of that, 3 generic tools (dataset_search, dataset_schema, dataset_query) give you access to the ~2000-dataset long tail of data.gov.sg without needing a wrapper per dataset.

No API keys. No hosted service. SQLite cache — first call hits data.gov.sg, subsequent calls are instant. MIT licensed.

Install:
  claude mcp add sg-data -- npx -y @altronis/sgdata-mcp

Things I learned building this that might be useful:
- ACRA's public endpoint is rate-limited hard; aggressive local caching is the only way to make it LLM-friendly
- URA's private transactions API paginates by district + period and you basically have to fan out 50 requests to get a useful slice — so the tool does that for you
- Singstat, MAS, and data.gov.sg all have different response envelopes. Normalizing them into one shape was most of the work.

Repo: https://github.com/sypherin/sgdata-mcp
npm: https://www.npmjs.com/package/@altronis/sgdata-mcp

Happy to answer anything about MCP, SG data, or the implementation.
```

**Gotchas:**
- Do NOT include "Built with Claude" or "AI-generated" in the title. HN hates it.
- Do NOT cross-post to /r/programming the same day — HN senses cross-posting and penalizes.
- If it doesn't get ≥3 upvotes in the first 15 minutes, it's dead. Try again on a different day with a slightly different title.
- Reply to every comment within the first 2 hours — HN rewards author engagement.

---

### 8. r/ClaudeAI (Reddit)

- **URL:** https://www.reddit.com/r/ClaudeAI/submit
- **Type:** Text post (not link — r/ClaudeAI ranks text posts higher than link posts)
- **Flair:** `Built with Claude` or `MCP` if the flair exists

**Title:**

```
Built an MCP server that gives Claude full access to Singapore government data (ACRA, HDB, URA, COE, CPI, 46 tools)
```

**Body:**

```markdown
Hey r/ClaudeAI — I'm an AI consultant in Singapore and I kept running into the same problem: Claude is great at reasoning but blind to local Singapore data. Every time a client asked "pull the ACRA record for this company" or "what's the HDB resale median in Tampines", Claude would hallucinate.

So I built **sgdata-mcp**, an MCP server that gives Claude direct access to Singapore government data.

**What's in it:**
- **46 curated tools** across 15 datasets: ACRA corporate registry, HDB resale, URA private property, COE bidding, CPI, GDP, MAS FX rates, IRAS, MOE schools, ECDA childcare, and more
- **3 generic tools** (dataset_search / dataset_schema / dataset_query) that cover the ~2000-dataset long tail of data.gov.sg without needing a wrapper per dataset
- **Local stdio + SQLite cache** — first call hits data.gov.sg, subsequent calls are instant
- **No API keys, no hosted service, no rate limits** on your end
- **MIT licensed**

**Install in Claude Desktop:**
```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

Or in Claude Code:
```
claude mcp add sg-data -- npx -y @altronis/sgdata-mcp
```

**Example prompts that now work:**
- *"What's the average HDB 4-room resale price in Tampines over the last 12 months?"*
- *"Show me URA private non-landed transactions in District 9 above $3M in Q1 2026."*
- *"Look up the ACRA record for UEN 202412345K."*
- *"Give me the YoY change in Singapore CPI for the last 6 months."*

**Repo:** https://github.com/sypherin/sgdata-mcp
**npm:** @altronis/sgdata-mcp

Would love feedback from anyone building AI agents that touch SG data. Happy to add more datasets if there's demand.
```

**Gotchas:**
- Don't put a link as the submission URL — r/ClaudeAI flags link-only posts as spam. Text post with the GitHub link in the body.
- Include a code snippet — the subreddit loves seeing the actual MCP config.
- If you get downvoted in the first 10 min, delete and repost 3 hours later with a different hook. First-hour signal decides the post's fate.

---

### 9. r/LocalLLaMA (Reddit)

Different audience — r/LocalLLaMA cares about local models and data sovereignty, so lead with "no API keys, runs locally, works with any MCP client including local Qwen/Llama agents". That's the hook here, not Claude.

- **URL:** https://www.reddit.com/r/LocalLLaMA/submit
- **Type:** Text post
- **Flair:** `Resources` or `Tutorial`

**Title:**

```
Local MCP server for Singapore government data — 46 tools, SQLite cache, no API keys, works with any MCP client
```

**Body:**

```markdown
Posting this here because the data-sovereignty angle fits this sub: I built an MCP server that exposes Singapore government data (ACRA corporate registry, HDB resale, URA private property, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA — 15 datasets, 46 tools) and it runs **entirely local**. No API keys, no hosted middleman, no telemetry. SQLite cache so your local Qwen / Llama / DeepSeek agent can hammer it without hitting data.gov.sg rate limits.

Works with any stdio MCP client — Claude Desktop, Claude Code, Continue, Goose, any local-model-compatible host. I've been running it against a local Qwen 3.5 122B via llama-server and it works fine; tool-call latency is dominated by cache hits (1-5ms) rather than the LLM itself.

**Why it might be useful to you:**
- If you're in SG or building something for SG users, the reasoning wins are big — LLMs stop hallucinating local data
- The 3 generic tools (`dataset_search`, `dataset_schema`, `dataset_query`) cover the ~2000-dataset data.gov.sg long tail, so you're not limited to the 15 curated ones
- It's a reasonable reference implementation if you want to build a similar MCP for your own country's open data — the core scraper/cache layer is modular

Install:
```
npx -y @altronis/sgdata-mcp
```

Or wire into your MCP client config:
```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

Repo: https://github.com/sypherin/sgdata-mcp
npm: @altronis/sgdata-mcp
License: MIT

Feedback welcome. Especially curious if anyone here has built a similar MCP for their own country's open data — would love to collaborate on a "Local Government Data MCP" standard so there's a common tool-call shape.
```

**Gotchas:**
- LocalLLaMA is anti-cloud — do NOT mention Anthropic or Claude first. Lead with local + data sovereignty.
- Replies need technical depth. Have answers ready for "why not just curl the APIs directly" and "how does your cache handle stale data".

---

### 10. r/singapore (Reddit)

Different tone again — casual, "hey SG devs, here's something local for you". Most r/singapore posts are non-tech, so a well-framed AI/dev post can do well because it's novel.

- **URL:** https://www.reddit.com/r/singapore/submit
- **Type:** Text post
- **Flair:** `Tech` or `Discussion`

**Title:**

```
I built a free open-source tool that lets AI assistants (Claude, etc.) read Singapore government data directly
```

**Body:**

```markdown
TL;DR — I'm an AI consultant based in SG and I've been annoyed that when you ask Claude or ChatGPT about HDB prices, ACRA company info, or COE premiums, it either hallucinates or tells you to "check the official site". So I built a free tool that fixes that.

It's called sgdata-mcp. It plugs into Claude Desktop (or any other AI assistant that supports MCP) and gives it direct access to:

- **Property** — HDB resale flats, URA private property transactions, rental data
- **Business** — ACRA corporate registry (company lookups, directors, UEN)
- **Economy** — CPI, GDP, MAS FX rates, unemployment
- **Transport** — COE bidding results
- **Family/Schools** — MOE school directory, ECDA childcare centres
- **Tax** — IRAS rates and schedules
- ...plus ~2000 other data.gov.sg datasets through a general-purpose query tool

It's free, open-source (MIT), runs locally on your machine, no API keys, no accounts, no data leaves your computer except to hit data.gov.sg itself.

**Who this is for:** anyone in SG building with AI — devs, analysts, journalists, property investors, researchers, students. If you've ever wished ChatGPT could actually answer "what's the median HDB 4-room price in Tampines right now", this is it.

**Install:** requires Node.js. One line:
```
npx -y @altronis/sgdata-mcp
```

**Repo:** https://github.com/sypherin/sgdata-mcp

Happy to answer questions. Also genuinely curious what SG datasets people wish Claude could read that I haven't covered yet — if you suggest something useful I'll add it.
```

**Gotchas:**
- r/singapore hates anything that smells like self-promotion. The "free, open-source, no paywall" framing is critical. Don't mention Altronis anywhere except the GitHub repo link (visible if they click).
- Do NOT mention "consulting" or "services" in the post body. That gets you flagged as spam.
- Post at 20:00-22:00 SGT (local dinner / lurking peak).

---

### 11. Official MCP Discord (modelcontextprotocol.io)

The official MCP Discord run by the steering group. There's a `#showcase` or `#servers` channel (exact name varies; find it after joining). Post there AFTER you have 3-5 stars on GitHub so your showcase post looks alive, not empty.

- **Invite URL:** https://discord.gg/6CSzBmMkjX (official MCP Discord)
- **Alt invite:** https://discord.gg/TFE8FmjCdS (Glama MCP Discord — also active, post in both)
- **Target channel:** `#showcase` or `#share-your-servers` (check exact name after joining)

**Discord post (keep it short — Discord loses long posts fast):**

```
Just published @altronis/sgdata-mcp — a stdio MCP server for Singapore government data.

46 curated tools across 15 high-value datasets (ACRA corporate registry, HDB resale, URA private property, COE, CPI, GDP, MAS FX, IRAS, MOE schools, ECDA childcare) + 3 generic tools covering the ~2000-dataset data.gov.sg long tail.

Local stdio, SQLite cache, no API keys. MIT.

Install: `npx -y @altronis/sgdata-mcp`
Repo: https://github.com/sypherin/sgdata-mcp
npm: https://www.npmjs.com/package/@altronis/sgdata-mcp

Would love feedback, especially on the 3 generic tools (dataset_search / dataset_schema / dataset_query) — I'm trying to make them good enough that a single MCP can cover an entire open-data portal, not just curated subsets.
```

**Gotchas:**
- Discord etiquette: one message, no @everyone, no re-posting. If it scrolls past, let it.
- React to other showcases first (drop a 🔥 on a few recent ones) before posting yours — reduces the "drive-by spam" vibe.

---

### 12. Anthropic Developer Discord

The general Anthropic/Claude community Discord (different from the MCP one). Has an active dev crowd and a show-and-tell channel.

- **Invite URL:** https://discord.com/invite/6PPFFzqPDZ
- **Target channel:** `#show-and-tell` or `#projects` (check after joining — the exact name varies by season)

**Post (same as MCP Discord above, minor reframe):**

```
Built an MCP server that gives Claude direct access to Singapore government data.

46 tools across 15 high-value datasets: ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA + 3 generic tools for the data.gov.sg long tail. Local stdio, SQLite cache, no API keys.

Install in Claude Desktop:
```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

Repo: https://github.com/sypherin/sgdata-mcp
npm: @altronis/sgdata-mcp
MIT licensed. Feedback welcome.
```

---

## Day 2-3 — Tier 3, Singapore-specific communities

### 13. STACK Community (GovTech Singapore) Telegram

GovTech runs an official developer community called STACK. It has a public Telegram group for announcements. This is THE channel where data.gov.sg consumers actually hang out.

- **Telegram invite:** https://go.gov.sg/stacktelegram (verified 2026-04-08 — goes through a gov.sg link shortener to the real group)
- **Homepage:** https://www.tech.gov.sg/our-communities/join-our-communities/stack-community/
- **Etiquette:** Announcement-style posts are OK but low-frequency — do NOT post promo twice. Be brief, link out, don't argue.

**Telegram message (keep it tight, Telegram readers skim):**

```
Hey STACK — built an open-source MCP server for Singapore government data that plugs into Claude / Cursor / any AI assistant.

46 tools across 15 data.gov.sg datasets (ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA) + 3 generic tools for the long tail. Local, SQLite-cached, no API keys, MIT.

Repo: https://github.com/sypherin/sgdata-mcp
npm: @altronis/sgdata-mcp

Would love feedback from anyone here who's built a data.gov.sg-consuming product. Especially curious whether there's appetite for an officially-blessed community MCP.
```

**Gotcha:** The last sentence is the hook — GovTech folks might signal-boost if they see it as aligned with their open-data mission. Don't be pushy.

---

### 14. NUS Hackers Telegram

Active student community at NUS, mostly undergrads + alumni building side projects. Dev-heavy, open-source-friendly. AI tooling gets engagement.

- **Telegram:** https://t.me/nushackers
- **GitHub:** https://github.com/nushackers
- **Homepage:** https://www.nushackers.org/

**Telegram message:**

```
Hi NUS Hackers — shipped a Singapore government data MCP server today, posting in case anyone here is building with Claude / Cursor / MCP.

sgdata-mcp: 46 tools across 15 data.gov.sg datasets (ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA), plus 3 generic tools covering the ~2000-dataset long tail. Local stdio, SQLite cache, no API keys, MIT.

Good hack fuel — lets you build AI assistants that actually understand SG context without API key wrangling.

Repo: https://github.com/sypherin/sgdata-mcp
npm: `npx -y @altronis/sgdata-mcp`

PRs welcome if anyone wants to add a dataset.
```

**Gotcha:** NUS Hackers gets annoyed by pure promo. The "PRs welcome" opener reframes it as a community contribution request, which is fine.

---

### 15. Google Developer Space Singapore Telegram

Also active SG dev channel. Less focused than STACK but more general-purpose.

- **Telegram:** https://t.me/GoogleDevSpaceSG
- **Etiquette:** One-off promo is tolerated; don't repeat.

**Message:** Same as #14 (NUS Hackers), with "Hi GDG SG —" as the opener.

---

## Day 3+ — Tier 4, content + SEO

### 16. Dev.to article

Dev.to is the best long-tail SEO play for dev content. Use relevant hashtags: `#mcp #claude #singapore #ai #opensource`.

- **URL:** https://dev.to/new
- **Target audience:** Devs curious about MCP who'll Google "MCP server tutorial" in 6 months and land on your post.

**Title:**

```
I built an MCP server that gives Claude full access to Singapore government data
```

**Tags:** `mcp`, `claude`, `ai`, `singapore`

**Cover image:** Screenshot of Claude running a query like "What's the median HDB 4-room price in Tampines?" with the tool call visible. Take this in Claude Desktop → crop to 1000x420.

**Body (~450 words, paste-ready):**

```markdown
## The problem

I'm an AI consultant in Singapore. For the last year I've been building Claude-powered tools for SG clients — everything from property analysis bots to CFO assistants that pull live ACRA records. One pattern kept repeating: Claude is great at reasoning, terrible at local data. Ask it "what's the current COE premium for Cat A cars" or "pull the ACRA record for UEN 202412345K" and it either hallucinates or refuses.

The data is all public on [data.gov.sg](https://data.gov.sg). The problem is that it's scattered across 15+ agencies (ACRA, HDB, URA, MAS, IRAS, MOE, ECDA...) with inconsistent auth, pagination, and schemas. Writing a wrapper per client project was painful.

So I built **sgdata-mcp** — an MCP server that exposes the whole mess as clean, typed tool calls an LLM can use.

## What's in it

- **46 curated tools** across 15 high-value SG datasets: ACRA corporate registry, HDB resale, URA private property, COE bidding, CPI, GDP, MAS FX rates, IRAS, MOE schools, ECDA childcare
- **3 generic tools** — `dataset_search`, `dataset_schema`, `dataset_query` — that cover the ~2000-dataset long tail of data.gov.sg without needing a wrapper per dataset
- **SQLite cache** — first call hits data.gov.sg, subsequent calls are instant
- **Local stdio, no API keys, no hosted middleman, MIT licensed**

## Install

In Claude Code:

```bash
claude mcp add sg-data -- npx -y @altronis/sgdata-mcp
```

In Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sg-data": {
      "command": "npx",
      "args": ["-y", "@altronis/sgdata-mcp"]
    }
  }
}
```

Then restart Claude and ask it something like:

> What's the average HDB 4-room resale price in Tampines over the last 12 months?

It'll call the `hdb_resale_search` tool, pull the data, cache it, and answer.

## What I learned building it

1. **ACRA's public endpoint rate-limits hard.** Aggressive local caching is the only way to make it LLM-friendly — LLMs will re-ask the same question five different ways in a single reasoning chain.
2. **URA's private transactions API paginates by district + period.** To get a useful slice you have to fan out 50+ requests. The tool does that transparently.
3. **Singstat, MAS, and data.gov.sg all have different response envelopes.** Normalizing them into one shape was most of the actual work.
4. **Generic tools > curated tools for long-tail data.** The 3 generic tools cover more ground than the 46 curated ones, but the curated ones exist because LLMs are much better at using a tool named `hdb_resale_search` than a generic `dataset_query` with a cryptic dataset ID.

## Try it

- **npm:** [@altronis/sgdata-mcp](https://www.npmjs.com/package/@altronis/sgdata-mcp)
- **GitHub:** [sypherin/sgdata-mcp](https://github.com/sypherin/sgdata-mcp)
- **MIT licensed** — add datasets via PR

If you're in SG and building with AI, or if you've built something similar for your own country's open data, I'd love to hear about it.
```

---

### 17. Medium cross-post

Paste the exact Dev.to article into Medium. Change nothing except:
- Publication: none (or "Better Programming" if you have an account there)
- Tags: `Mcp`, `Claude`, `Ai`, `Singapore`, `Open Source`

Use Medium's "Import a story" feature with the Dev.to URL as source — keeps formatting clean.

---

### 18. altronis.sg blog post

You own the domain. Use the Dev.to article as the basis but add a B2B/consulting angle in a final section. This is the version that should appear on altronis.sg.

**Outline:**
1. **The problem** — Claude hallucinates on SG data (copy from Dev.to)
2. **What sgdata-mcp is** — 46 tools + 3 generic, local, no API keys (copy from Dev.to)
3. **Install / usage** (copy from Dev.to)
4. **Real-world use cases for SG businesses** (NEW section — this is the B2B hook):
   - KYC/due diligence agents that pull ACRA records and directors on demand
   - Property advisory bots backed by live HDB/URA transactions
   - Compliance copilots that cite IRAS schedules in-line
   - Market research agents that synthesize Singstat + MAS FX + CPI trends into client memos
5. **How Altronis uses this internally** — mention that you're open-sourcing the foundation and Altronis builds the hosted / agent-specific layer on top
6. **Contribute / contact** — GitHub repo + hello@altronis.sg

**SEO add-ons to include:**
- `<title>` tag: `sgdata-mcp: Singapore Government Data MCP Server for AI Agents | Altronis`
- `<meta name="description">`: `Open-source MCP server giving Claude and other AI assistants direct access to Singapore government data. 46 tools across ACRA, HDB, URA, COE, CPI, GDP, MAS, IRAS. Free, MIT licensed.`
- JSON-LD `SoftwareApplication` schema embedded in the page:

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "sgdata-mcp",
  "operatingSystem": "macOS, Linux, Windows",
  "applicationCategory": "DeveloperApplication",
  "offers": {
    "@type": "Offer",
    "price": "0.00",
    "priceCurrency": "USD"
  },
  "author": {
    "@type": "Organization",
    "name": "Altronis",
    "url": "https://altronis.sg"
  },
  "license": "https://opensource.org/licenses/MIT",
  "downloadUrl": "https://www.npmjs.com/package/@altronis/sgdata-mcp",
  "codeRepository": "https://github.com/sypherin/sgdata-mcp",
  "description": "Comprehensive Singapore government data MCP server — 46 tools across 15 curated data.gov.sg datasets (ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA) plus 3 generic tools for the long tail. Local stdio, SQLite cache, no API keys, MIT licensed."
}
</script>
```

---

### 19. X / Twitter thread (5 tweets)

Post from the Altronis account if one exists, else Zach's personal. Thread beats single tweet for this kind of launch because the 46 tools need breathing room.

**Tweet 1 (hook, 234 chars):**

```
I built an MCP server that gives Claude direct access to Singapore government data.

46 tools across ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA.

Plus 3 generic tools that cover the ~2000-dataset long tail of data.gov.sg.

Local. Free. MIT. No API keys.

🧵
```

**Tweet 2:**

```
The problem: every SG client project I did last year, Claude would hallucinate on local data.

"What's the ACRA record for UEN X?"
"What's the median HDB 4-room in Tampines?"
"What's today's COE premium?"

All public on data.gov.sg. All scattered across 15 agencies with broken APIs.
```

**Tweet 3:**

```
sgdata-mcp normalizes all of it into clean MCP tool calls.

ACRA corporate registry ✓
HDB resale ✓
URA private property ✓
COE bidding ✓
CPI / GDP / MAS FX ✓
IRAS tax ✓
MOE schools ✓
ECDA childcare ✓

SQLite cache — first call hits data.gov.sg, every subsequent call is instant.
```

**Tweet 4:**

```
The trick that made it work: curated tools for the 15 high-value datasets + 3 generic tools (dataset_search / dataset_schema / dataset_query) for the other ~2000.

LLMs are much better at calling `hdb_resale_search` than `dataset_query("a1b2c3")`. The curated layer matters.
```

**Tweet 5 (CTA):**

```
Install in Claude Code:

claude mcp add sg-data -- npx -y @altronis/sgdata-mcp

npm: @altronis/sgdata-mcp
Repo: github.com/sypherin/sgdata-mcp

MIT licensed. PRs welcome. If you're in SG and building with AI, this should save you weeks of API-wrangling.
```

**Gotcha:** Pin Tweet 1 to the profile for a week. Reply to every quote-tweet. Thread algo rewards author engagement in the first 2 hours.

---

### 20. LinkedIn post

Zach is SG-based AI consultant — LinkedIn is high-signal for his audience. Different framing from Twitter: professional, emphasize the consulting/B2B value.

**Post (~290 words):**

```
Open-sourcing something I've been building for my consulting clients: sgdata-mcp.

For the last year I've been building Claude-powered tools for Singapore businesses — property advisory bots, CFO assistants that pull live ACRA records, KYC agents, compliance copilots. The same pattern kept repeating: Claude is incredible at reasoning but blind to local Singapore data. Every project needed a custom wrapper around data.gov.sg, and I was rebuilding the same thing from scratch for every client.

So I've open-sourced the foundation.

sgdata-mcp is an MCP server that gives any AI assistant (Claude, Cursor, Copilot, Goose, or your own agent) direct, structured access to Singapore government data:

→ ACRA corporate registry (UEN lookup, directors, company history)
→ HDB resale transactions
→ URA private property transactions
→ COE bidding results
→ Singstat CPI and GDP
→ MAS foreign exchange rates
→ IRAS tax schedules
→ MOE school directory
→ ECDA childcare centres
...46 tools across 15 datasets, plus 3 generic tools that cover the ~2000-dataset long tail.

Why this matters if you're building with AI in Singapore:

Every hour your team spends wrangling the data.gov.sg API is an hour not spent on the actual product. sgdata-mcp collapses that wrangling into a single `npx` install. No API keys, no hosted middleman, runs locally, MIT licensed.

At Altronis we use this as the foundation layer for every Singapore-specific AI build. The curated open-source piece is now public. The hosted agent layer (Singa — our Singapore business assistant) sits on top.

If you're building AI tools for the Singapore market and you hit the same wall, this is for you.

GitHub: github.com/sypherin/sgdata-mcp
npm: @altronis/sgdata-mcp

Feedback and PRs welcome. Happy to chat if you're solving similar problems.

#AI #Singapore #OpenSource #MCP #Claude
```

**Gotcha:** LinkedIn kills posts with >3 external links. The GitHub + npm links are fine. Don't add more.

---

## GitHub repo setup checklist

Do all of this BEFORE publishing to any of the channels above. Day 0 = the repo must look alive.

### GitHub topics (add via repo Settings → Topics — all lowercase, hyphenated)

```
mcp
model-context-protocol
singapore
data-gov-sg
acra
hdb
ura
coe
claude
ai
open-data
government-data
sqlite
typescript
altronis
```

That's 15 topics. GitHub's UI shows the first 10 in the sidebar; the rest are searchable.

### Repo "About" description (one line, <350 chars)

```
Comprehensive Singapore government data MCP server — 46 tools across 15 curated data.gov.sg datasets (ACRA, HDB, URA, COE, CPI, GDP, MAS FX, IRAS, MOE, ECDA) plus 3 generic tools covering the ~2000-dataset long tail. Local stdio, SQLite cache, no API keys. Built by Altronis.
```

### Website field

```
https://altronis.sg
```

### README badges (top of README.md — high-signal trust markers)

```markdown
[![npm version](https://img.shields.io/npm/v/@altronis/sgdata-mcp.svg)](https://www.npmjs.com/package/@altronis/sgdata-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@altronis/sgdata-mcp.svg)](https://www.npmjs.com/package/@altronis/sgdata-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
```

### npm keywords (already in package.json — ADD THESE)

Current: `mcp`, `model-context-protocol`, `singapore`, `data.gov.sg`, `acra`, `hdb`, `ura`, `singstat`, `open-data`, `altronis`

Add: `claude`, `ai`, `llm`, `coe`, `cpi`, `gdp`, `mas`, `iras`, `moe`, `ecda`, `government-data`

Final list (21 keywords — npm allows up to ~20, cut the weakest if needed):

```json
"keywords": [
  "mcp",
  "model-context-protocol",
  "claude",
  "ai",
  "llm",
  "singapore",
  "data.gov.sg",
  "government-data",
  "open-data",
  "acra",
  "hdb",
  "ura",
  "coe",
  "cpi",
  "gdp",
  "mas",
  "iras",
  "moe",
  "ecda",
  "altronis"
]
```

### Branch protection

- `main` — require PR + 1 review for future external contributors (set this once the repo has ≥5 stars so it doesn't block your own early commits)

### LICENSE file

- MIT — already declared in package.json, make sure `LICENSE` file exists at repo root

### CONTRIBUTING.md

- One-pager explaining how to add a new dataset handler. This is critical for getting PR contributions — people won't submit if they don't know what good looks like.

### SECURITY.md

- One-pager: "report vulnerabilities to security@altronis.sg". Unlocks GitHub's "Security policy" badge.

### FUNDING.yml

- Optional: link to GitHub Sponsors or ko-fi if Zach has one. Free visibility boost.

---

## Channels investigated and rejected

- **`modelcontextprotocol/servers` GitHub repo** — REJECTED. Explicitly no longer accepts community server PRs. README states "The server lists in this README are no longer maintained and will eventually be removed." Directs all submissions to the official MCP Registry (Channel #1). No PR needed.
- **`appcypher/awesome-mcp-servers`** — REJECTED. Less active than punkpeye's list. PR turnaround is slow and it duplicates the audience of Channel #2 (punkpeye) without adding meaningfully different reach. If Zach has spare time 2 weeks after launch, mirror the punkpeye PR here as a backup.
- **r/mcp (Reddit)** — TENTATIVE. Exists (linked from punkpeye's README via shields.io badge) but fetching was blocked from this session. If it has >5000 subscribers and recent activity, mirror the r/ClaudeAI post there as Channel #8b. Worth checking manually before deciding.
- **HardwareZone EDMW** — REJECTED. Wrong audience. Zero dev focus, mostly consumer/lifestyle. Not worth posting.
- **open.gov.sg community forum** — REJECTED. Open Government Products (OGP) has a GitHub org (github.com/opengovsg) and works on products like FormSG, Parking.SG, etc., but there's no public discussion forum or mailing list specifically for data.gov.sg consumers. STACK Community Telegram (Channel #13) is the closest equivalent and already in the playbook.
- **Anthropic's #show-and-tell subforum** — PARTIALLY REJECTED. Included as Channel #12 above, but deprioritized: the Discord is noisy, posts scroll fast, and the audience heavily overlaps with r/ClaudeAI. Post it, don't rely on it.
- **Custom DNS namespace (`sg.altronis/...`) in MCP Registry** — DEFERRED. DNS-based publishing is supported but requires adding a TXT record on `altronis.sg`. Stick with `io.github.sypherin/sgdata-mcp` for Day 0. You can always republish under the branded namespace later without losing the first listing.
- **Product Hunt** — REJECTED FOR DAY 0. Product Hunt is a poor fit for dev tools with no hosted UI. The audience expects polished SaaS, not CLI installs. If you want to try it later, bundle sgdata-mcp with Singa as the flagship product and launch Singa on Product Hunt instead.
- **HackerNews "Ask HN"** — REJECTED. Use "Show HN" (Channel #7), not "Ask HN". Ask HN is for questions.
- **r/programming** — REJECTED. Mods ban "show and tell" posts hard. Any cross-post from r/ClaudeAI will get removed.
- **r/dataengineering** — TENTATIVE. Could be a soft fit because of the SQLite cache + ETL angle. Not priority. Try only if the main launches underperform.

---

## Competitive landscape — quick note for context

Two existing SG data MCP servers exist (verified 2026-04-08). Both are narrower than `@altronis/sgdata-mcp`, so the positioning is clear:

1. **vdineshk/sgdata-mcp** — hosted Cloudflare Worker, real-time endpoint (`https://sgdata-mcp.sgdata.workers.dev/mcp`), 5 tools (ACRA, bus/MRT arrival, dengue clusters, URA, OneMap, SGX). Niche: real-time transit + geo.
   - Listed on glama.ai: https://glama.ai/mcp/servers/vdineshk/sgdata-mcp
   - **Note:** the github.com/vdineshk/sgdata-mcp URL 404s as of 2026-04-08 — the repo may have been moved or deleted. Listing on Glama is still live. Don't position against it directly; it's niche and possibly inactive.

2. **prezgamer/Singapore-Data-MCPs** — Python, multi-server collection, specialized per dataset (carpark, graduate employment). Niche: hackathon-style per-dataset servers.
   - Repo: https://github.com/prezgamer/Singapore-Data-MCPs
   - Active. Different shape from ours (multiple Python servers vs our one TypeScript server).

**Altronis' positioning in launch copy:** "comprehensive", "46 tools across 15 datasets", "the whole data.gov.sg long tail via 3 generic tools", "local stdio + SQLite cache", "production-ready". Avoid direct comparison — the other two are fine projects in adjacent niches.

---

## Execution order cheat sheet

| Day | Hour (SGT) | Channel | Effort | Priority |
|---|---|---|---|---|
| **Day 0** | AM | GitHub repo setup, topics, README, LICENSE | 1h | MUST |
| **Day 0** | AM | `npm publish --access public` | 10min | MUST |
| **Day 0** | AM | Official MCP Registry (#1) | 30min | MUST |
| **Day 0** | PM | mcpservers.org form (#3) | 5min | MUST |
| **Day 0** | PM | mcp.so GitHub issue (#6) | 5min | MUST |
| **Day 0** | PM | Smithery submission (#4) | 15min | HIGH |
| **Day 0** | PM | punkpeye/awesome-mcp-servers PR (#2) | 15min | HIGH |
| **Day 1** | 20:00 SGT (08:00 US ET is 20:00 SGT prior day — adjust) | HN Show HN (#7) | 30min post + 2h monitoring | HIGH |
| **Day 1** | 22:00 SGT | r/ClaudeAI (#8) | 15min | HIGH |
| **Day 2** | 09:00 SGT | r/LocalLLaMA (#9) | 15min | MED |
| **Day 2** | 20:00 SGT | r/singapore (#10) | 15min | MED |
| **Day 2** | 21:00 SGT | STACK Telegram (#13) | 5min | HIGH (SG-specific) |
| **Day 2** | 21:15 SGT | NUS Hackers Telegram (#14) | 5min | MED |
| **Day 2** | 21:30 SGT | Google Dev Space SG Telegram (#15) | 5min | LOW |
| **Day 3** | any | MCP Discord (#11) + Anthropic Discord (#12) | 10min | MED |
| **Day 3** | any | LinkedIn post (#20) | 15min | HIGH |
| **Day 3** | any | X/Twitter thread (#19) | 15min | MED |
| **Day 4+** | any | Dev.to article (#16) | 45min | MED |
| **Day 5+** | any | Medium cross-post (#17) | 10min | LOW |
| **Day 5+** | any | altronis.sg blog post (#18) | 1-2h | HIGH (for SEO) |
| **Day 7+** | verify | Glama auto-listing (#5) — claim it | 10min | MED |

---

## Totals

- **Tier 1 (MCP discovery):** 6 channels — #1 Official Registry, #2 punkpeye, #3 mcpservers.org, #4 Smithery, #5 Glama, #6 mcp.so
- **Tier 2 (community posts):** 6 channels — #7 HN, #8 r/ClaudeAI, #9 r/LocalLLaMA, #10 r/singapore, #11 MCP Discord, #12 Anthropic Discord
- **Tier 3 (SG-specific):** 3 channels — #13 STACK, #14 NUS Hackers, #15 Google Dev Space SG
- **Tier 4 (content / SEO):** 5 channels — #16 Dev.to, #17 Medium, #18 altronis.sg, #19 X, #20 LinkedIn

**Total: 20 launch channels, 4-7 days to execute end-to-end.**
