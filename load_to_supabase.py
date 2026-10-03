"""
Load pl_gov_pages.jsonl (from pl_gov_scraper.py) into Supabase Postgres.

  pip install psycopg2-binary
  export DATABASE_URL="postgresql://postgres:<password>@<host>:5432/postgres"
  python load_to_supabase.py pl_gov_pages.jsonl

Use the connection string from Supabase > Project Settings > Database.
Re-running is safe: raw pages are deduplicated, and only rows with
origin='scraped' are ever updated. Manual entries are never overwritten.
"""
import json, os, sys
import psycopg2

CATEGORY_HINTS = {
    "marriage":         ("malzen", "małżeń", "slub", "ślub", "marriage", "usc"),
    "pesel":            ("pesel",),
    "address_registration": ("meldun", "zamelda", "address-registration"),
    "residence_permit": ("pobyt", "residence", "cudzoziem", "foreigner", "visa", "wiza"),
    "tax":              ("podatk", "tax", "pit"),
    "health":           ("nfz", "zdrowot", "health"),
    "social_insurance": ("zus", "ubezpiecz"),
    "business":         ("dzialalnosc", "działalność", "ceidg", "business"),
}


def guess_category(url, title):
    hay = f"{url} {title or ''}".lower()
    for cat, words in CATEGORY_HINTS.items():
        if any(w in hay for w in words):
            return cat
    return None


def main(path):
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute("select name, id from sources")
    source_ids = dict(cur.fetchall())

    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            sid = source_ids.get(r["source"])
            if sid is None:
                print("unknown source, skipping:", r["source"])
                continue

            cur.execute(
                """insert into raw_pages (source_id, url, content_hash, text, http_status, fetched_at)
                   values (%s,%s,%s,%s,200,%s)
                   on conflict (url, content_hash) do nothing""",
                (sid, r["url"], r["hash"], r["text"], r["fetched_at"]),
            )

            cur.execute(
                """insert into documents
                     (source_id, url, title, text_redacted, content_hash,
                      origin, recrawl, category, fetched_at)
                   values (%s,%s,%s,%s,%s,'scraped',true,%s,%s)
                   on conflict (url) do update set
                     title = excluded.title,
                     text_redacted = excluded.text_redacted,
                     content_hash = excluded.content_hash,
                     fetched_at = excluded.fetched_at,
                     category = coalesce(documents.category, excluded.category)
                   where documents.origin = 'scraped'""",
                (sid, r["url"], r["title"], r["text"], r["hash"],
                 guess_category(r["url"], r["title"]), r["fetched_at"]),
            )

            n += 1
            if n % 200 == 0:
                conn.commit()
                print(n, "rows")

    conn.commit()
    cur.close()
    conn.close()
    print("done:", n, "pages")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "pl_gov_pages.jsonl")
