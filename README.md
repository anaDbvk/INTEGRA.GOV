# Polish government and city information scraper

This project collects public service guidance from Polish government sites and
public event/district pages from Kraków and Warsaw. It writes one JSON object
per line to `pl_gov_pages.jsonl`; the GitHub Actions workflow uploads that file
as an artifact and does not load it into a database or commit it to the repo.

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
to 100 pages per configured source and uploads a `pl_gov_pages` artifact with
90-day retention. It runs weekly on Mondays; remove the `schedule` trigger in
`.github/workflows/scrape.yml` to disable scheduled runs.

The crawler does not run JavaScript. Some calendars or government pages may
therefore be incomplete, and the page limit can exclude districts or events.
PII redaction is best-effort (common emails, phone numbers, and identifiers);
it does not remove names or guarantee that all personal data is redacted.

## SmartIN assistant draft

`webapp/` contains a guided-interview UI and a small FastAPI backend. The
assistant asks one follow-up at a time, then returns an ordered set of
source-cited journey blocks. It interviews in English, Polish, or Ukrainian
and searches an uploaded scraper JSONL artifact locally. Only the conversation
and up to five matching page excerpts are sent to Anthropic. Uploaded pages
live in process memory only: restarting the app or loading another artifact
clears/replaces them. The assistant does not automatically download artifacts
from GitHub; download `pl_gov_pages` from a workflow run, extract
`pl_gov_pages.jsonl`, then upload it in the UI.

Run it locally from the repository root:

```powershell
python -m pip install -r requirements.txt
$env:ANTHROPIC_API_KEY = "your-Anthropic-API-key"
$env:ANTHROPIC_MODEL = "your-enabled-Claude-model-id"
python -m uvicorn webapp.app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000` and upload the extracted JSONL. Never put the
Anthropic key in the UI or browser; it is read only by the backend. Use a
currently enabled model ID from your Anthropic account. This draft has no
built-in sign-in: when deployed, put it behind your platform's authentication,
HTTPS, and request/cost limits. Do not expose the backend directly to the
public internet without those controls.

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
