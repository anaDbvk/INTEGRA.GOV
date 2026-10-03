import unittest

from pl_gov_scraper import (
    extract,
    links_to_follow,
    page_type,
    parse_event_date,
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
                "https://www.krakow.pl/kalendarz/wydarzenie",
            ],
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


if __name__ == "__main__":
    unittest.main()
