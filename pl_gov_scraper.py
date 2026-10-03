"""
Collect public Polish government information and Krakow/Warsaw municipal pages.

Run locally with:
    pip install -r requirements.txt
    MAX_PAGES=100 SOURCES_ONLY=gov.pl,krakow,warsaw python pl_gov_scraper.py

Pages are saved as JSONL. The crawler obeys robots.txt, stays on each source
host, rate-limits requests, and redacts common identifiers on a best-effort
basis. It does not execute JavaScript.
"""
import hashlib
import json
import os
import re
import time
import urllib.robotparser
from collections import deque
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = "SmartIN-Scraper/0.2 (+https://github.com/anaDbvk/SmartIN)"
DELAY = float(os.getenv("REQUEST_DELAY", "2"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "100"))
SKIP_URL_PARTS = (
    "kontakt", "contact", "pracownicy", "kadra", "oswiadczeni",
    "wykaz-pracownikow", "struktura-organizacyjna", "/osoby/", "/radni/",
    "/rada/", "/council/",
)

SOURCES = {
    "gov.pl": "https://www.gov.pl",
    "mos": "https://mos.cudzoziemcy.gov.pl",
    "udsc": "https://udsc.gov.pl",
    "biznes": "https://www.biznes.gov.pl",
    "podatki": "https://www.podatki.gov.pl",
    "zus": "https://www.zus.pl",
    "nfz": "https://www.nfz.gov.pl",
    "migrant": "https://migrant.info.pl",
    "warsaw": "https://um.warszawa.pl",
    "warsaw19115": "https://warszawa19115.pl",
    "krakow": "https://www.krakow.pl",
}

WARSAW_DISTRICTS = (
    "bemowo", "bialoleka", "bielany", "mokotow", "ochota",
    "pragapoludnie", "pragapolnoc", "rembertow", "srodmiescie",
    "targowek", "ursus", "ursynow", "wawer", "wesola", "wilanow",
    "wlochy", "wola", "zoliborz",
)
for district in WARSAW_DISTRICTS:
    SOURCES[f"warsaw_{district}"] = f"https://{district}.um.warszawa.pl"

GOV_SERVICE_SEEDS = (
    "https://www.gov.pl/web/gov/uslugi-dla-obywatela",
    "https://www.gov.pl/web/gov/zglos-zgon",
    "https://www.gov.pl/web/mswia-en/report-death",
    "https://www.gov.pl/web/gov/zamelduj-sie-na-pobyt-staly-lub-czasowy-dluzszy-niz-3-miesiace",
    "https://www.gov.pl/web/gov/uzyskaj-numer-pesel-dla-cudzoziemcow",
    "https://www.gov.pl/web/gov/uzyskaj-odpis-aktu-stanu-cywilnego-urodzenia-malzenstwa-zgonu",
)

SEED_URLS = {
    "gov.pl": GOV_SERVICE_SEEDS,
    "krakow": (
        "https://www.krakow.pl/dzielnice/19934,glowna.html",
        "https://www.krakow.pl/kalendarium/1919,find,0,0,znajdz_impreze.html",
    ),
    "warsaw": (
        "https://um.warszawa.pl/kalendarz",
        "https://um.warszawa.pl/urzad/urzedy-dzielnic",
    ),
}
for district in WARSAW_DISTRICTS:
    district_base = SOURCES[f"warsaw_{district}"]
    SEED_URLS[f"warsaw_{district}"] = (
        district_base.rstrip("/") + "/kalendarz",
        district_base.rstrip("/") + "/",
    )

OFFICIAL_PROCESS_SOURCES = {
    "gov.pl", "mos", "udsc", "biznes", "podatki", "zus", "nfz",
}
CITY_SOURCES = {"krakow", "warsaw", "warsaw19115"} | {
    f"warsaw_{district}" for district in WARSAW_DISTRICTS
}
EVENT_RE = re.compile(
    r"wydarzen|wydar|imprez|spotkan|posiedzen|konsultac|kalendar|"
    r"\bevent\b|\bcalendar\b|piknik|warsztat|dyzur|dyżur|agenda",
    re.IGNORECASE,
)
PROCESS_RE = re.compile(
    r"uslug|usług|spraw|wniosek|wniosk|zezwolen|zglos|zgłoś|"
    r"zameld|rejestr|obywatel|cudzoziem|pobyt|akt-stanu-cywilnego|"
    r"pesel|insurance|health",
    re.IGNORECASE,
)
DISTRICT_RE = re.compile(r"dzielnic|district", re.IGNORECASE)
POLISH_MONTHS = {
    "stycznia": 1, "styczeń": 1, "lutego": 2, "luty": 2,
    "marca": 3, "marzec": 3, "kwietnia": 4, "kwiecień": 4,
    "maja": 5, "maj": 5, "czerwca": 6, "czerwiec": 6,
    "lipca": 7, "lipiec": 7, "sierpnia": 8, "sierpień": 8,
    "września": 9, "wrzesień": 9, "października": 10, "październik": 10,
    "listopada": 11, "listopad": 11, "grudnia": 12, "grudzień": 12,
}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(
    r"(?<!\d)(?:\+?48[\s-]?)?(?:\d{3}[\s-]?\d{3}[\s-]?\d{3}|"
    r"\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})(?!\d)"
)
IBAN = re.compile(r"\bPL\s?\d{2}(?:\s?\d{4}){6}\b")
NIP = re.compile(r"(?<!\d)\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}(?!\d)")
ID_CARD = re.compile(r"\b[A-Z]{3}\s?\d{6}\b")
PESEL = re.compile(r"(?<!\d)\d{11}(?!\d)")

session = requests.Session()
session.headers["User-Agent"] = UA


def valid_pesel(value):
    weights = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    checksum = (10 - sum(int(digit) * weight
                         for digit, weight in zip(value, weights)) % 10) % 10
    return checksum == int(value[10])


def redact(text):
    text = PESEL.sub(
        lambda match: "[PESEL]" if valid_pesel(match.group()) else match.group(),
        text,
    )
    for pattern, label in (
        (EMAIL, "[EMAIL]"), (IBAN, "[IBAN]"), (ID_CARD, "[ID]"),
        (NIP, "[NIP]"), (PHONE, "[PHONE]"),
    ):
        text = pattern.sub(label, text)
    return text


def same_site(url, base):
    candidate = urlparse(url)
    source = urlparse(base)
    candidate_host = (candidate.hostname or "").lower().removeprefix("www.")
    source_host = (source.hostname or "").lower().removeprefix("www.")
    return candidate.scheme in ("http", "https") and candidate_host == source_host


def relevant(url):
    lowered = url.lower()
    return not any(part in lowered for part in SKIP_URL_PARTS)


def page_type(source, url, title):
    haystack = f"{url} {title}"
    if source in CITY_SOURCES and EVENT_RE.search(haystack):
        return "event"
    if source in CITY_SOURCES and DISTRICT_RE.search(haystack):
        return "district_info"
    if source in OFFICIAL_PROCESS_SOURCES and PROCESS_RE.search(haystack):
        return "government_process"
    return "official_city_info" if source in CITY_SOURCES else "general_info"


def parse_event_date(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    numeric = re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b", value)
    if numeric:
        try:
            return date(int(numeric.group(3)), int(numeric.group(2)), int(numeric.group(1)))
        except ValueError:
            return None
    polish = re.search(
        r"\b(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})\b", value, re.IGNORECASE
    )
    if polish:
        month = POLISH_MONTHS.get(polish.group(2).lower())
        if month:
            try:
                return date(int(polish.group(3)), month, int(polish.group(1)))
            except ValueError:
                pass
    return None


def links_to_follow(source, page_url, links, base):
    page_path = urlparse(page_url).path.lower()
    candidates = []
    for link_url, link_text in links:
        link_url, _ = urldefrag(link_url)
        if not same_site(link_url, base) or not relevant(link_url):
            continue
        target_path = urlparse(link_url).path.lower()
        if source == "gov.pl":
            service_index = "uslugi-dla-obywatela" in page_path
            should_follow = (
                target_path.startswith("/web/gov/")
                if service_index
                else bool(PROCESS_RE.search(f"{target_path} {link_text}"))
            )
        elif source == "krakow":
            in_district_directory = "dzielnice" in page_path
            should_follow = (
                ("dzielnice" in target_path if in_district_directory else False)
                or bool(EVENT_RE.search(f"{target_path} {link_text}"))
            )
        elif source == "warsaw":
            in_calendar = "kalendar" in page_path
            in_district_directory = "urzedy-dzielnic" in page_path or "dzielnic" in page_path
            should_follow = (
                (in_calendar and bool(link_text))
                or (in_district_directory and bool(DISTRICT_RE.search(target_path)))
                or bool(EVENT_RE.search(f"{target_path} {link_text}"))
            )
        elif source.startswith("warsaw_"):
            should_follow = bool(EVENT_RE.search(f"{target_path} {link_text}"))
        elif source in CITY_SOURCES:
            should_follow = bool(EVENT_RE.search(f"{target_path} {link_text}"))
        else:
            should_follow = bool(PROCESS_RE.search(f"{target_path} {link_text}"))
        if should_follow:
            candidates.append(link_url)
    return list(dict.fromkeys(candidates))


def robots_for(base):
    parser = urllib.robotparser.RobotFileParser()
    robots_url = base.rstrip("/") + "/robots.txt"
    parser.set_url(robots_url)
    response = get(robots_url, timeout=10)
    if response is None:
        print(f"robots.txt unavailable for {base}; skipping source")
        return None
    if response.status_code == 200:
        parser.parse(response.text.splitlines())
    elif response.status_code == 404:
        parser.parse([])
    else:
        print(f"robots.txt returned HTTP {response.status_code} for {base}; skipping source")
        return None
    return parser


def get(url, timeout=20):
    try:
        response = session.get(url, timeout=timeout)
    except requests.RequestException as error:
        print(f"request failed for {url}: {error}")
        return None
    time.sleep(DELAY)
    return response


def sitemap_urls(base, parser):
    sitemap_queue = deque(parser.site_maps() or [base.rstrip("/") + "/sitemap.xml"])
    seen_sitemaps = set()
    pages = []
    while sitemap_queue and len(seen_sitemaps) < 100 and len(pages) < MAX_PAGES * 5:
        sitemap = sitemap_queue.popleft()
        if sitemap in seen_sitemaps or not same_site(sitemap, base):
            continue
        seen_sitemaps.add(sitemap)
        response = get(sitemap)
        if response is None or response.status_code != 200:
            if response is not None:
                print(f"sitemap returned HTTP {response.status_code}: {sitemap}")
            continue
        try:
            soup = BeautifulSoup(response.content, "xml")
        except Exception as error:
            print(f"could not parse sitemap {sitemap}: {error}")
            continue
        for loc in soup.find_all("loc"):
            target = loc.get_text(strip=True)
            if not same_site(target, base):
                continue
            if urlparse(target).path.lower().endswith(".xml"):
                sitemap_queue.append(target)
            elif relevant(target):
                pages.append(target)
    return list(dict.fromkeys(pages))


def extract(html, page_url, source):
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    main = soup.find("main") or soup.find("article") or soup.body or soup
    event_dates = list(dict.fromkeys(
        value for node in main.select("time[datetime], time")
        if (value := node.get("datetime") or node.get_text(" ", strip=True))
    ))
    for tag in main(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    for anchor in main.select('a[href^="mailto:"], a[href^="tel:"]'):
        anchor.decompose()
    text = " ".join(main.get_text(" ", strip=True).split())
    links = [
        (urljoin(page_url, anchor.get("href", "")), anchor.get_text(" ", strip=True))
        for anchor in main.select("a[href]")
    ]
    return redact(title), redact(text), event_dates, links


def run(out_path="pl_gov_pages.jsonl"):
    only = [name.strip() for name in os.getenv("SOURCES_ONLY", "").split(",") if name.strip()]
    unknown = sorted(set(only) - set(SOURCES))
    if unknown:
        raise ValueError(f"Unknown source name(s): {', '.join(unknown)}")
    selected = [(name, base) for name, base in SOURCES.items() if not only or name in only]
    if not selected:
        raise ValueError("No sources selected.")

    total = 0
    with open(out_path, "w", encoding="utf-8") as output:
        for name, base in selected:
            robots = robots_for(base)
            if robots is None:
                continue
            seeds = [url for url in SEED_URLS.get(name, ()) if same_site(url, base)]
            queue = deque((url, "seed") for url in seeds)
            queued = set(seeds)
            visited = set()
            count = 0
            sitemap_pages = None

            while count < MAX_PAGES:
                if not queue:
                    if sitemap_pages is None:
                        sitemap_pages = sitemap_urls(base, robots)
                    next_url = next(
                        (url for url in sitemap_pages
                         if url not in visited and url not in queued),
                        None,
                    )
                    if next_url is None:
                        break
                    queue.append((next_url, "sitemap"))
                    queued.add(next_url)

                url, discovered_by = queue.popleft()
                if url in visited or not same_site(url, base) or not relevant(url):
                    continue
                visited.add(url)
                if not robots.can_fetch(UA, url):
                    print(f"robots.txt disallows {url}")
                    continue
                response = get(url)
                count += 1
                if response is None or response.status_code != 200:
                    if response is not None:
                        print(f"page returned HTTP {response.status_code}: {url}")
                    continue

                title, text, event_dates, links = extract(response.text, url, name)
                kind = page_type(name, url, title)
                today = datetime.now(timezone.utc).date()
                horizon_end = today + timedelta(days=365)
                upcoming_dates = [
                    value for value in event_dates
                    if (parsed := parse_event_date(value)) and today <= parsed <= horizon_end
                ]
                parsed_dates = [parse_event_date(value) for value in event_dates]
                if (kind == "event" and parsed_dates
                        and all(parsed_dates) and not upcoming_dates):
                    continue
                followed = links_to_follow(name, url, links, base)
                for target in followed:
                    if target not in visited and target not in queued:
                        queue.append((target, url))
                        queued.add(target)
                output.write(json.dumps({
                    "source": name,
                    "page_type": kind,
                    "url": url,
                    "domain": urlparse(url).netloc,
                    "title": title,
                    "text": text,
                    "event_dates": event_dates,
                    "upcoming_event_dates": upcoming_dates,
                    "related_urls": followed[:100],
                    "discovered_from": discovered_by,
                    "hash": hashlib.sha256(text.encode()).hexdigest(),
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False) + "\n")
                total += 1
                if count % 25 == 0:
                    print(f"{name}: fetched {count}/{MAX_PAGES} pages")

            print(f"{name}: saved {sum(1 for _ in visited)} visited URLs")
    print(f"done: saved {total} pages to {out_path}")


if __name__ == "__main__":
    run()
