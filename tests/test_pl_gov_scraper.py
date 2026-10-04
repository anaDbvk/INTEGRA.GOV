import unittest
from unittest.mock import patch

from scraper.load_to_supabase import CHUNK_OVERLAP, CHUNK_SIZE, split_into_chunks
from scraper.pl_gov_scraper import (
    KRAKOW_DISTRICTS,
    UA,
    WARSAW_DISTRICTS,
    SOURCES,
    extract,
    links_to_follow,
    page_type,
    parse_event_date,
    robots_for,
    same_site,
)


class ScraperTests(unittest.TestCase):
    def test_extract_redacts_contact_data_and_keeps_machine_readable_event_date(self):
        html = """
        <html><head><title>Wydarzenie</title></head><body><main>
        <h1>Wydarzenie</h1><time datetime="2026-10-20">20 października 2026</time>
        <p>Napisz user@example.com lub zadzwoń +48 123 456 789.</p>
        <a href="/wydarzenia/koncert">Koncert</a>
        </main><script>not page text</script></body></html>
        """
        title, text, dates, links = extract(
            html, "https://um.warszawa.pl/kalendarz", "warsaw"
        )
        self.assertEqual(title, "Wydarzenie")
        self.assertIn("[EMAIL]", text)
        self.assertIn("[PHONE]", text)
        self.assertNotIn("not page text", text)
        self.assertEqual(dates, ["2026-10-20"])
        self.assertEqual(links, [("https://um.warszawa.pl/wydarzenia/koncert", "Koncert")])

    def test_same_site_does_not_accept_untrusted_hosts(self):
        base = "https://www.gov.pl"
        self.assertTrue(same_site("https://gov.pl/web/gov/uslugi", base))
        self.assertFalse(same_site("https://www.gov.pl.evil.example/page", base))
        self.assertFalse(same_site("javascript:alert(1)", base))

    def test_city_directory_follows_districts_and_event_links_but_not_contact_pages(self):
        links = [
            ("https://www.krakow.pl/dzielnice/nowa_huta", "Nowa Huta"),
            ("https://www.krakow.pl/dzielnica_i_stare_miasto/", "Stare Miasto"),
            ("https://www.krakow.pl/kalendarz/wydarzenie", "Wydarzenie"),
            ("https://www.krakow.pl/kontakt", "Kontakt"),
            ("https://example.com/dzielnice", "Dzielnice"),
        ]
        followed = links_to_follow(
            "krakow", "https://www.krakow.pl/dzielnice/", links,
            "https://www.krakow.pl",
        )
        self.assertEqual(
            followed,
            [
                "https://www.krakow.pl/dzielnice/nowa_huta",
                "https://www.krakow.pl/dzielnica_i_stare_miasto/",
                "https://www.krakow.pl/kalendarz/wydarzenie",
            ],
        )

    def test_all_warsaw_district_sources_are_configured(self):
        self.assertEqual(len(WARSAW_DISTRICTS), 18)
        self.assertEqual(WARSAW_DISTRICTS["praga_poludnie"], "pragapld")
        self.assertEqual(WARSAW_DISTRICTS["praga_polnoc"], "pragapn")
        for district, host in WARSAW_DISTRICTS.items():
            source = f"warsaw_{district}"
            self.assertIn(source, SOURCES)
            self.assertTrue(SOURCES[source].startswith(f"https://{host}.um.warszawa.pl"))

    def test_all_krakow_district_sources_are_configured(self):
        self.assertEqual(KRAKOW_DISTRICTS, tuple(range(1, 19)))
        for district in KRAKOW_DISTRICTS:
            source = f"krakow_district_{district:02d}"
            self.assertEqual(
                SOURCES[source], f"https://dzielnica{district}.krakow.pl"
            )

    def test_page_classification_and_polish_date_parsing(self):
        self.assertEqual(
            page_type("gov.pl", "https://www.gov.pl/web/gov/zglos-zgon", "Zgłoś zgon"),
            "government_process",
        )
        self.assertEqual(
            page_type("krakow", "https://www.krakow.pl/kalendarium", "Kalendarz"),
            "event",
        )
        self.assertEqual(parse_event_date("20 października 2026"), parse_event_date("2026-10-20"))
        self.assertIsNone(parse_event_date("not a date"))

    def test_robots_rules_are_respected_and_unavailable_robots_fail_closed(self):
        class Response:
            status_code = 200
            text = "User-agent: *\nDisallow: /private/\n"

        with patch("scraper.pl_gov_scraper.get", return_value=Response()):
            parser = robots_for("https://example.gov")
        self.assertTrue(parser.can_fetch(UA, "https://example.gov/public"))
        self.assertFalse(parser.can_fetch(UA, "https://example.gov/private/page"))

        with patch("scraper.pl_gov_scraper.get", return_value=None):
            self.assertIsNone(robots_for("https://unavailable.gov"))



class LoaderTests(unittest.TestCase):
    def test_supabase_chunking_preserves_text_with_overlapping_context(self):
        text = "x" * (CHUNK_SIZE + 500)
        chunks = split_into_chunks(text)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0][-CHUNK_OVERLAP:], chunks[1][:CHUNK_OVERLAP])
        rebuilt = chunks[0] + "".join(chunk[CHUNK_OVERLAP:] for chunk in chunks[1:])
        self.assertEqual(rebuilt, text)


if __name__ == "__main__":
    unittest.main()
