# Polish government and city information scraper

This project collects public service guidance from Polish government sites and
public event/district pages from Kraków and Warsaw. It writes one JSON object
per line to `pl_gov_pages.jsonl`. The weekly GitHub Actions workflow retains
the output as an artifact and attempts to load it into Supabase; scrape
artifacts are not committed to the repository.

## Included sources

The default run covers official national sources (`gov.pl`, `mos`, `udsc`,
`biznes`, `podatki`, `zus`, and `nfz`), the migrant information portal, and
official municipal sources for Kraków and Warsaw. Government-service seeds
include citizen services, reporting a death, address registration, PESEL, and
civil registry record copies. Kraków's official district directory, events
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

Install `requirements.txt` and run `pl_gov_scraper.py`, or use **Actions →
Scrape Polish government and city pages → Run workflow**. The workflow defaults
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

## SmartIN assistant draft

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
model for Polish query rewriting; it defaults to `ANTHROPIC_MODEL`. Use model
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
