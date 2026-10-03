# Polish government and city information scraper

This project collects public service guidance from Polish government sites and
public event/district pages from KrakÃ³w and Warsaw. It writes one JSON object
per line to `pl_gov_pages.jsonl`. The weekly GitHub Actions workflow retains
the output as an artifact and attempts to load it into Supabase; scrape
artifacts are not committed to the repository.

## Included sources

The default run covers official national sources (`gov.pl`, `mos`, `udsc`,
`biznes`, `podatki`, `zus`, and `nfz`), the migrant information portal, and
official municipal sources for KrakÃ³w and Warsaw. Government-service seeds
include citizen services, reporting a death, address registration, PESEL, and
civil registry record copies. KrakÃ³w's official district directory, events
calendar, and 18 district portals, plus each of Warsaw's 18 official district
portals, are seeded. The
crawler follows relevant same-site links from those pages and observes each
site's `robots.txt`; a disallowed or unreachable site is skipped, not bypassed.

`MAX_PAGES` limits fetched pages **per source**. `SOURCES_ONLY` is a
comma-separated list of source names; leave it empty to include all configured
sources. For example:

```text
MAX_PAGES=100
SOURCES_ONLY=gov.pl,krakow,krakow_district_01,warsaw,warsaw_mokotow,warsaw_wola
```

The JSONL rows include a `page_type`, source URL, extracted text, related
same-site URLs, and fetch time. Event pages also include machine-readable
`event_dates` and `upcoming_event_dates` when dates can be recognized. Dated
event pages outside the next 365 days are omitted when all their dates are
parseable; dates embedded in page text may not be machine-readable, so review
the artifact before relying on the date filter.

## Run it

Install `requirements.txt` and run `pl_gov_scraper.py`, or use **Actions â†’
Scrape Polish government and city pages â†’ Run workflow**. The workflow defaults
to 100 pages per configured source, uploads a `pl_gov_pages` artifact with
90-day retention even if the scrape job fails partway, and runs weekly on
Mondays. After a successful scrape it attempts to load the JSONL into Supabase.
The database load is allowed to fail without preventing the artifact from
being retained. To disable scheduled runs, remove the `schedule` trigger in
`.github/workflows/scrape.yml`.

Before enabling the database load, apply `supabase/schema.sql` to the Supabase
project. Add a repository Actions secret named `DATABASE_URL` containing the
Supabase **Session pooler** connection string (the GitHub runner may not be
able to reach the direct IPv6 database endpoint). `load_to_supabase.py`
upserts scraped pages and does not overwrite manually-originated documents.

The crawler does not run JavaScript. Some calendars or government pages may
therefore be incomplete, and the page limit can exclude districts or events.
PII redaction is best-effort (common emails, phone numbers, and identifiers);
it does not remove names or guarantee that all personal data is redacted.

## Legacy chat-only demo notes (superseded)

> The notes in this section describe the earlier chat-only prototype. Use the
> current smartphone app and Render instructions in the section at the end of
> this README instead.

`webapp/` contains a chat-only guided-interview UI and a small FastAPI backend.
The assistant asks one follow-up at a time, then returns an ordered set of
source-cited journey blocks. It interviews in English, Polish, or Ukrainian
and searches scraper JSONL pages held in server memory. Only the conversation
and up to five matching page excerpts are sent to Anthropic. Pages are loaded
from GitHub Actions when configured, or from a local JSONL file for preview.
Long scraped pages are split into searchable chunks at load time instead of
being rejected; excerpts are selected around the user's relevant terms so the
assistant can use information that appears later on a source page.

For a local preview, place a merged JSONL file at
`webapp/data/pl_gov_pages.jsonl`; the backend loads it into memory on startup
and the UI shows the loaded page count. This local data file is git-ignored and
is not included in commits or deployments. For a deployed instance, configure
`GITHUB_TOKEN` and `GITHUB_REPOSITORY=anaDbvk/SmartIN` on the backend. At
startup, the app fetches unexpired `pl_gov_pages` artifacts from recent
successful runs of `scrape.yml`, merges duplicate URLs, and loads the pages
without requiring a browser upload. Restarting the app reloads the pages. The
GitHub token must have Actions artifact read access for this private
repository. `GITHUB_WORKFLOW_FILE` can
override the workflow filename; it defaults to `scrape.yml`. If those GitHub
settings are absent and there is no local JSONL file, the assistant reports
that its sources are unavailable; it does not offer a browser-upload control.

Run it locally from the repository root:

```powershell
python -m pip install -r requirements.txt
$env:ANTHROPIC_API_KEY = "your-Anthropic-API-key"
$env:ANTHROPIC_MODEL = "your-enabled-Claude-model-id"
$env:ANTHROPIC_FAST_MODEL = "your-enabled-fast-Claude-model-id"
$env:ADMIN_TOKEN = "a-long-random-secret"
$env:RATE_LIMIT_PER_MINUTE = "10"
$env:GITHUB_TOKEN = "your-read-only-fine-grained-GitHub-token"
$env:GITHUB_REPOSITORY = "anaDbvk/SmartIN"
python -m uvicorn webapp.app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. The app loads scrape artifacts automatically.
Never put the Anthropic key or GitHub token in the UI or browser; they are read
only by the backend. `ANTHROPIC_FAST_MODEL` optionally selects a less expensive
model for the web-research step; it defaults to `ANTHROPIC_MODEL`. Use model
IDs enabled for your Anthropic account.

Set `ADMIN_TOKEN` to a long random secret to protect the optional
`POST /api/knowledge` endpoint; uploads without the `X-Admin-Token` header
matching that value receive 404. Set `RATE_LIMIT_PER_MINUTE` to control the
per-IP interview limit (default `10`). This in-memory limiter is draft-grade
and resets when the service restarts. Also set a monthly spend limit in the
Anthropic Console. This draft has no built-in sign-in: when deployed, put it
behind your platform's authentication, HTTPS, and request/cost limits. Do not
expose the backend directly to the public internet without those controls.

For Render, add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`ANTHROPIC_FAST_MODEL`, `ADMIN_TOKEN`, `RATE_LIMIT_PER_MINUTE`,
`GITHUB_TOKEN`, and `GITHUB_REPOSITORY` as service environment variables. Use a
fine-grained GitHub token restricted to this repository with Actions read
permission. This lets a private Render service find and download recent
unexpired Actions artifacts on startup.

To embed it in another page after deploying the backend, use an iframe:

```html
<iframe
  src="https://YOUR-PRIVATE-APP-HOST/"
  title="SmartIN Poland information assistant"
  width="100%"
  height="760"
  loading="lazy"
></iframe>
```

Set `EMBED_PARENT_ORIGIN` to the exact HTTPS origin of the host platform to
allow the iframe to send a `smartin:journey-ready` `postMessage` containing the
suggested journey blocks and source links. The host platform must permit
framing the app, and its integration must verify the message's origin and
source window before using the blocks to navigate to its next screen. Do not
make this unauthenticated draft public. Questions and selected scraped excerpts
are sent to Anthropic; because source redaction is best-effort, users should
not submit personal or sensitive data. The first version uses local lexical
retrieval rather than embeddings and does not persist uploaded pages or chat
history. It gives citations to the retrieved pages rather than independently
verifying claims.

## Moving to Poland web app

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical architecture diagram.

Production readiness plan: [docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md).

`webapp/` contains the smartphone-first FastAPI app that follows
`Moving to Poland â€“ App Design (1).html` (Lexend/Public Sans fonts are
self-hosted in `webapp/static/fonts`, the animations are in `scenes.css` and
`scene.js`). It provides a guided interview in English, Polish or Ukrainian,
cited official-source journeys, private saved conversations and journeys
(name, target date and focus categories via `PATCH /api/journeys/{id}`),
step-by-step progress, in-app reminders, category browsing and display
preferences. The static interface is served by the same app; no
separate frontend hosting is needed.

The whole interface is translated into English, Polish and Ukrainian
(`webapp/static/i18n.js`). On first visit the language follows the phone's
language, otherwise English; users can switch it with the globe button on the
login screen or in Profile â€º Preferences. The choice is saved in the browser,
and the assistant answers in the same language. Official Polish terms (PESEL,
NFZ, ZUS) stay untranslated.

### Own journeys and navigation

Users can also build a journey themselves ("Create my own journey" on Home or
the + button in My journeys): a name, an optional target date and up to 20
steps, each with a name, optional notes and an optional deadline
(`POST /api/journeys`). Any journey, including one from the assistant, can be
edited with "Edit or add steps" (`PUT /api/journeys/{id}/steps`): users can
add, reorder and remove steps. Official steps from the assistant keep their
text and cited sources and can only be moved or removed; own steps are
editable and are labelled as personal notes, not official advice. Completed
progress follows the steps when they are reordered.

The phone/browser Back button follows the in-app navigation, and the bottom
navigation bar is shown on Home as well as the main tabs.

### How the assistant finds official information

The assistant no longer reads scraped pages from Supabase. For each chat turn
the backend makes two Anthropic calls:

1. **Research**: Claude uses Anthropic's web search tool
   (`web_search_20250305`), restricted to the approved official domains, to find and
   summarise the relevant official pages with citations. Results from other
   domains or non-HTTPS URLs are discarded by the backend. If the user's goal
   is still unclear, it skips searching.

   The approved domains come from the Supabase `sources` table: every row with
   `assistant_enabled = true` contributes the host of its `base_url` (a leading
   `www.` is dropped, and subdomains of another listed domain are merged, because
   searches cover subdomains). The list is cached for 5 minutes. If
   `DATABASE_URL` is not set, the table is unavailable, or no rows are enabled,
   `WEB_SEARCH_DOMAINS` (or the built-in defaults) is used instead. To add a
   site, insert a row into `sources`; to stop searching one, set
   `assistant_enabled = false`.
2. **Interview or journey**: the cited research is passed to the
   `return_journey_step` tool call, which either asks one follow-up question or
   returns journey steps. Every step must cite one of the researched sources;
   otherwise the request fails or the answer becomes "unsupported".

Journeys, steps, progress, conversations and reminders are still saved in
Supabase. Web search costs $10 per 1,000 searches plus the tokens of the
search results, so a researched turn costs more and takes longer (roughly
5â€“15 seconds) than the old database lookup. Web search must be enabled for the
organisation in the Anthropic Console. The scraper and **Scrape and load**
workflow remain in the repository for manual runs, but the weekly schedule is
disabled.

### Supabase setup

Run `supabase/schema.sql` first if it has not already been applied, then run
`supabase/app_tables.sql` in the Supabase SQL editor. The second script adds
the private guest-profile, device, session, conversation, journey, reminder,
and daily assistant-usage tables. It enables row-level security without public policies; the
server accesses these records using its private `DATABASE_URL`. Re-running the
script is safe (`create table if not exists`), so run it again after updates
to add new tables such as `assistant_usage`.

The scraper loader creates searchable text chunks for scraped pages. The
assistant now uses live web search instead (see above), so loading scraped
pages is optional. If you still run the **Scrape and load** workflow, add the Supabase **Session pooler**
connection string as `DATABASE_URL` in both GitHub Actions secrets (for the
loader) and the Render service environment (for the app). Do not use the
direct database connection string for GitHub Actions.

### Render deployment

Create a Render Blueprint from this repository using `render.yaml`, or create
a Python web service with build command `pip install -r requirements.txt`,
start command `uvicorn webapp.app:app --host 0.0.0.0 --port $PORT`, and health
check path `/health`. Configure these service environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Session pooler connection string |
| `APP_SESSION_SECRET` | Stable random secret of at least 32 characters; changing it prevents existing phone hashes from matching |
| `ANTHROPIC_API_KEY` | Server-side Anthropic API key |
| `ANTHROPIC_MODEL` | Model ID enabled for the Anthropic account |
| `ANTHROPIC_FAST_MODEL` | Optional less expensive model for the web-research step; defaults to `ANTHROPIC_MODEL` |
| `WEB_SEARCH_DOMAINS` | Fallback comma-separated official domains when the Supabase `sources` table cannot be used (subdomains included); defaults to `gov.pl,migrant.info.pl,udsc.gov.pl,nfz.gov.pl,zus.pl,podatki.gov.pl,biznes.gov.pl` |
| `WEB_SEARCH_MAX_USES` | Maximum web searches per chat turn (1â€“8, default `3`) |
| `ADMIN_TOKEN` | Optional long random secret for the restricted knowledge-upload endpoint |
| `RATE_LIMIT_PER_MINUTE` | Per-IP interview/session request limit; defaults to `10` |
| `ASSISTANT_DAILY_LIMIT` | Assistant messages per profile per UTC day, stored in Supabase `assistant_usage`; defaults to `50`, `0` disables |
| `DB_POOL_MAX` | Maximum pooled Supabase connections per instance; defaults to `5` |

Never put database or Anthropic credentials in the browser or repository.
Set an Anthropic Console spend limit. The per-minute limiter is in-memory and
resets when Render restarts the service; the daily limit is stored in Supabase.

### Production hardening

- **CI:** `.github/workflows/ci.yml` runs the Python tests and the JavaScript
  syntax, translation and navigation smoke tests (`tests/js/`) on every push
  and pull request. `render.yaml` uses `autoDeployTrigger: checksPass`, so
  Render deploys only after CI passes. If the service was created manually,
  set **Settings > Build & Deploy > Auto-Deploy** to *After CI Checks Pass*.
- **Dependencies:** `requirements.txt` is pinned; Dependabot
  (`.github/dependabot.yml`) proposes weekly updates that must pass CI.
- **Database:** connections are reused from a small thread-safe pool with TCP
  keepalives and a liveness check after 30 seconds idle.
- **Security headers:** every response sends a Content-Security-Policy
  (scripts only from this site, no framing), `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS
  over HTTPS. API responses are `Cache-Control: no-store`.
- **Your data (GDPR):** Profile > Privacy offers **Download my data**
  (`GET /api/me/export`, JSON without phone or token hashes) and
  **Delete my data** (`DELETE /api/me`, removes the profile and, through
  `on delete cascade`, its devices, sessions, chats, journeys, alerts and usage).

See [docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md) for the remaining steps.

### Guest profile and privacy limits

The MVP does not verify phone numbers: a number is only an identifier, not
proof of identity. A random HttpOnly device cookie binds each profile to that
browser. The session expires after 15 days without activity, while the
device-bound cookie can restore the profile on the same browser when the user
enters the same number again. Phone-only recovery on another device, after
clearing browser data, or after losing the cookie is not supported. Supabase
data remains saved after logout; users can download or permanently delete it
in Profile > Privacy. Add phone verification before treating this
as production authentication or storing sensitive personal information.

Do not enter PESEL, document numbers, exact addresses, or other sensitive
details. Questions and relevant official excerpts are sent to Anthropic.
Source redaction is best-effort. Reminders are shown only inside the app;
there is no email, push, or scheduled notification service. Official facts
must be checked against the linked government or city pages.

For a local preview, configure the same variables and run:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL = "your-Supabase-Session-pooler-connection-string"
$env:APP_SESSION_SECRET = "a-stable-random-secret-at-least-32-characters"
$env:ANTHROPIC_API_KEY = "your-Anthropic-API-key"
$env:ANTHROPIC_MODEL = "your-enabled-model-id"
python -m uvicorn webapp.app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Never commit real credentials or scraped
personal information.
