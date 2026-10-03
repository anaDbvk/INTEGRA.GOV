"""
Crawler for Polish official service pages (all pages, PII redacted).
Run locally:  pip install requests beautifulsoup4 lxml
              python pl_gov_scraper.py

Respects robots.txt, rate-limits, discovers pages via sitemaps,
and stores facts + source URL (JSONL). Untested against live sites:
adjust selectors and sitemap handling per domain.
"""
import hashlib, json, os, re, time, urllib.robotparser
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

UA = "SmartIN-Scraper/0.1"
DELAY = 2.0          # seconds between requests
MAX_PAGES = int(os.getenv("MAX_PAGES", "100"))   # per domain; raise gradually
KEYWORDS = ()        # empty = crawl everything; add words to filter by URL
# URLs likely to be staff/contact directories (mostly personal data): skipped
SKIP_URL_PARTS = ("kontakt", "contact", "pracownicy", "kadra", "oswiadczeni",
                  "wykaz-pracownikow", "struktura-organizacyjna", "/osoby/")

# --- PII redaction (best effort) ---
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+?48[\s-]?)?(?:\d{3}[\s-]?\d{3}[\s-]?\d{3}|\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})(?!\d)")
IBAN = re.compile(r"\bPL\s?\d{2}(?:\s?\d{4}){6}\b")
NIP = re.compile(r"(?<!\d)\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}(?!\d)")
ID_CARD = re.compile(r"\b[A-Z]{3}\s?\d{6}\b")
PESEL = re.compile(r"(?<!\d)\d{11}(?!\d)")


def valid_pesel(s):
    w = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    return (10 - sum(int(d) * k for d, k in zip(s, w)) % 10) % 10 == int(s[10])


def redact(text):
    text = PESEL.sub(lambda m: "[PESEL]" if valid_pesel(m.group()) else m.group(), text)
    for rx, tag in ((EMAIL, "[EMAIL]"), (IBAN, "[IBAN]"), (ID_CARD, "[ID]"),
                    (NIP, "[NIP]"), (PHONE, "[PHONE]")):
        text = rx.sub(tag, text)
    return text


SOURCES = {
    "gov.pl": "https://www.gov.pl",
    "obywatel": "https://www.gov.pl/web/gov",
    "mos": "https://mos.cudzoziemcy.gov.pl",
    "udsc": "https://udsc.gov.pl",
    "biznes": "https://www.biznes.gov.pl",
    "podatki": "https://www.podatki.gov.pl",
    "zus": "https://www.zus.pl",
    "nfz": "https://www.nfz.gov.pl",
    "migrant": "https://migrant.info.pl",
    "warsaw": "https://um.warszawa.pl",
    "warsaw19115": "https://warszawa19115.pl",
}

session = requests.Session()
session.headers["User-Agent"] = UA


def robots_for(base):
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(base.rstrip("/") + "/robots.txt")
    try:
        rp.read()
    except Exception:
        pass
    return rp


def sitemap_urls(base, rp):
    """Collect page URLs from sitemaps listed in robots.txt (or /sitemap.xml)."""
    sitemaps = rp.site_maps() or [base.rstrip("/") + "/sitemap.xml"]
    pages, queue = [], list(sitemaps)
    while queue and len(pages) < MAX_PAGES * 5:
        sm = queue.pop(0)
        try:
            r = session.get(sm, timeout=20)
            time.sleep(DELAY)
            soup = BeautifulSoup(r.text, "xml")
        except Exception:
            continue
        for loc in soup.find_all("loc"):
            u = loc.text.strip()
            (queue if u.endswith(".xml") else pages).append(u)
    return pages


def relevant(url):
    u = url.lower()
    if any(p in u for p in SKIP_URL_PARTS):
        return False
    return not KEYWORDS or any(k in u for k in KEYWORDS)


def extract(html):
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "nav", "footer", "header"]):
        t.decompose()
    for a in soup.select('a[href^="mailto:"], a[href^="tel:"]'):
        a.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    main = soup.find("main") or soup.body or soup
    text = " ".join(main.get_text(" ", strip=True).split())
    return redact(title), redact(text)


def run(out_path="pl_gov_pages.jsonl"):
    with open(out_path, "a", encoding="utf-8") as out:
        only = [x.strip() for x in os.getenv("SOURCES_ONLY", "").split(",") if x.strip()]
        for name, base in SOURCES.items():
            if only and name not in only:
                continue
            rp = robots_for(base)
            urls = [u for u in sitemap_urls(base, rp) if relevant(u)][:MAX_PAGES]
            print(f"{name}: {len(urls)} candidate pages")
            for u in urls:
                if not rp.can_fetch(UA, u):
                    continue
                try:
                    r = session.get(u, timeout=20)
                    time.sleep(DELAY)
                    if r.status_code != 200:
                        continue
                    title, text = extract(r.text)
                except Exception as e:
                    print("skip", u, e)
                    continue
                out.write(json.dumps({
                    "source": name,
                    "url": u,
                    "domain": urlparse(u).netloc,
                    "title": title,
                    "text": text,
                    "hash": hashlib.sha256(text.encode()).hexdigest(),
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    run()
