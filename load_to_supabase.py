"""
Load pl_gov_pages.jsonl (from pl_gov_scraper.py) into Supabase Postgres.

  pip install psycopg2-binary
  export DATABASE_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres"
  python load_to_supabase.py pl_gov_pages.jsonl

Apply supabase_schema.sql first. Use the Session pooler connection string from
Supabase > Project Settings > Database (GitHub runners are IPv4-only).

Re-running is safe: raw pages are deduplicated, and only rows with
origin='scraped' are ever updated. Manual entries are never overwritten.
Changed pages keep their old chunks until the embedding job re-embeds them
(documents.embedded_hash != documents.content_hash).
"""
import json
import os
import re
import sys

import psycopg2

# Word-boundary patterns (the old substring matching made "pit" match "capital").
# Matched against the URL and title; first match wins, so order matters.
CATEGORY_PATTERNS = {
    "marriage": r"\bmalzen|\bmałżeń|\bslub|\bślub|\bmarriage\b|\busc\b|stanu[- ]cywilnego",
    "pesel": r"\bpesel\b",
    "address_registration": r"\bmeldun|\bzameld|address-registration",
    "residence_permit": r"\bpobyt|\bresidence|\bcudzoziem|\bforeigner|\bvisa\b|\bwiza\b",
    "tax": r"\bpodatk|\btax\b|\bpit\b",
    "health": r"\bnfz\b|\bzdrowot|\bhealth",
    "social_insurance": r"\bzus\b|\bubezpiecz",
    "business": r"\bdzialalnosc|\bdziałalność|\bceidg\b|\bbusiness\b",
}
CATEGORY_RES = {
    category: re.compile(pattern, re.IGNORECASE)
    for category, pattern in CATEGORY_PATTERNS.items()
}


def guess_category(url, title):
    haystack = f"{url} {title or ''}"
    for category, pattern in CATEGORY_RES.items():
        if pattern.search(haystack):
            return category
    return None


def jurisdiction_for(source):
    if source.startswith("krakow"):
        return "krakow"
    if source.startswith("warsaw"):
        return "warsaw"
    return "national"


def load(cur, path):
    cur.execute("select name, id from sources")
    source_ids = dict(cur.fetchall())

    loaded = skipped = 0
    with open(path, encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                print(f"line {line_number}: invalid JSON, skipping")
                skipped += 1
                continue

            source_id = source_ids.get(row.get("source"))
            if source_id is None:
                print(f"line {line_number}: unknown source {row.get('source')!r}, skipping")
                skipped += 1
                continue

            cur.execute(
                """insert into raw_pages
                     (source_id, url, content_hash, text, http_status, fetched_at)
                   values (%s,%s,%s,%s,200,%s)
                   on conflict (url, content_hash) do nothing""",
                (source_id, row["url"], row["hash"], row["text"], row["fetched_at"]),
            )

            event_dates = row.get("upcoming_event_dates", row.get("event_dates", []))
            cur.execute(
                """insert into documents
                     (source_id, url, title, text_redacted, content_hash,
                      origin, recrawl, category, page_type, jurisdiction,
                      event_dates, fetched_at)
                   values (%s,%s,%s,%s,%s,'scraped',true,%s,%s,%s,%s::jsonb,%s)
                   on conflict (url) do update set
                     title = excluded.title,
                     text_redacted = excluded.text_redacted,
                     content_hash = excluded.content_hash,
                     page_type = excluded.page_type,
                     jurisdiction = excluded.jurisdiction,
                     event_dates = excluded.event_dates,
                     fetched_at = excluded.fetched_at,
                     category = coalesce(documents.category, excluded.category)
                   where documents.origin = 'scraped'""",
                (
                    source_id, row["url"], row.get("title"), row["text"], row["hash"],
                    guess_category(row["url"], row.get("title")),
                    row.get("page_type"),
                    jurisdiction_for(row["source"]),
                    json.dumps(event_dates),
                    row["fetched_at"],
                ),
            )

            loaded += 1
            if loaded % 200 == 0:
                print(loaded, "rows")
    return loaded, skipped


def main(path):
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            loaded, skipped = load(cur, path)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"done: {loaded} pages loaded, {skipped} lines skipped")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "pl_gov_pages.jsonl")
