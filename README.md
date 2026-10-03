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
civil registry record copies. Kraków's official district directory and events
calendar and each of Warsaw's 18 official district portals are seeded. The
crawler follows relevant same-site links from those pages and observes each
site's `robots.txt`; a disallowed or unreachable site is skipped, not bypassed.

`MAX_PAGES` limits fetched pages **per source**. `SOURCES_ONLY` is a
comma-separated list of source names; leave it empty to include all configured
sources. For example:

```text
MAX_PAGES=100
SOURCES_ONLY=gov.pl,krakow,warsaw,warsaw_mokotow,warsaw_wola
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
