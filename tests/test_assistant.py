import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from webapp.app import app, retrieve_pages, validate_page


def jsonl_page(
    *,
    title="Report death - Gov.pl",
    text="Report a death at the civil registry office within three days.",
    url="https://www.gov.pl/web/gov/zglos-zgon",
    source="gov.pl",
):
    return {
        "title": title,
        "text": text,
        "url": url,
        "source": source,
        "page_type": "government_process",
        "fetched_at": "2026-10-03T12:00:00+00:00",
    }


class AssistantTests(unittest.TestCase):
    def setUp(self):
        app.state.pages = []
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-access-token"}
        self.env = patch.dict(
            os.environ,
            {
                "APP_ACCESS_TOKEN": "test-access-token",
                "ANTHROPIC_API_KEY": "test-api-key",
                "ANTHROPIC_MODEL": "test-model",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def tearDown(self):
        app.state.pages = []

    def test_ui_is_served_without_exposing_api_credentials(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("SmartIN Assistant", response.text)
        self.assertIn("sent to Anthropic", response.text)
        self.assertNotIn("test-api-key", response.text)

    def test_api_rejects_missing_or_wrong_access_token(self):
        self.assertEqual(self.client.get("/api/status").status_code, 401)
        self.assertEqual(
            self.client.get(
                "/api/status", headers={"Authorization": "Bearer wrong"}
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.get("/api/status", headers=self.headers).json(),
            {"loaded_pages": 0},
        )

    def test_upload_rejects_non_http_url_and_keeps_previous_knowledge(self):
        app.state.pages = [validate_page(jsonl_page(), 1)]
        bad = jsonl_page(url="javascript:alert(1)")
        response = self.client.post(
            "/api/knowledge",
            headers=self.headers,
            files={"file": ("pages.jsonl", json.dumps(bad) + "\n")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(app.state.pages), 1)

    def test_upload_upgrades_legacy_http_source_links_to_https(self):
        page = validate_page(jsonl_page(url="http://www.gov.pl/report"), 1)
        self.assertEqual(page["url"], "https://www.gov.pl/report")

    def test_upload_and_lexical_retrieval_find_relevant_official_page(self):
        content = "\n".join(json.dumps(page) for page in [
            jsonl_page(),
            jsonl_page(
                title="Upcoming city concert",
                text="Music concert in the city park on Saturday.",
                url="https://www.krakow.pl/events/concert",
                source="krakow",
            ),
        ])
        response = self.client.post(
            "/api/knowledge",
            headers=self.headers,
            files={"file": ("pl_gov_pages.jsonl", content)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["loaded_pages"], 2)
        selected = retrieve_pages(app.state.pages, "How to report death?")
        self.assertEqual(len(selected), 1)
        self.assertIn("Report death", selected[0]["title"])

    def test_interview_returns_source_cited_journey_blocks(self):
        app.state.pages = [validate_page(jsonl_page(), 1)]

        class FakeClient:
            def __init__(self, **kwargs):
                self.messages = SimpleNamespace(
                    create=AsyncMock(return_value=SimpleNamespace(content=[
                        SimpleNamespace(
                            type="tool_use",
                            name="return_journey_step",
                            input={
                                "outcome": "journey",
                                "message": "Here is a suggested journey.",
                                "question": "",
                                "journey_blocks": [{
                                    "title": "Register the death",
                                    "action": "Report it to the civil registry office.",
                                    "source_ids": ["S1"],
                                }],
                            },
                        )
                    ]))
                )

            async def close(self):
                return None

        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                headers=self.headers,
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outcome"], "journey")
        self.assertEqual(response.json()["journey_blocks"][0]["source_ids"], ["S1"])
        self.assertEqual(response.json()["sources"][0]["url"], "https://www.gov.pl/web/gov/zglos-zgon")

    def test_interview_can_ask_follow_up_when_evidence_is_not_yet_relevant(self):
        app.state.pages = [validate_page(jsonl_page(), 1)]

        class FakeClient:
            def __init__(self, **kwargs):
                self.messages = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
                    content=[SimpleNamespace(
                        type="tool_use",
                        name="return_journey_step",
                        input={
                            "outcome": "interview",
                            "message": "I can help find an appropriate process.",
                            "question": "Which city or process do you mean?",
                            "journey_blocks": [],
                        },
                    )]
                )))

            async def close(self):
                return None

        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                headers=self.headers,
                json={"answer": "I need help with local events.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["outcome"], "interview")
        self.assertEqual(response.json()["question"], "Which city or process do you mean?")

    def test_interview_rejects_uncited_journey(self):
        app.state.pages = [validate_page(jsonl_page(), 1)]

        class FakeClient:
            def __init__(self, **kwargs):
                self.messages = SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(
                    content=[SimpleNamespace(
                        type="tool_use",
                        name="return_journey_step",
                        input={
                            "outcome": "journey",
                            "message": "Here is a plan.",
                            "question": "",
                            "journey_blocks": [{
                                "title": "Do something",
                                "action": "Go somewhere.",
                                "source_ids": ["S404"],
                            }],
                        },
                    )]
                )))

            async def close(self):
                return None

        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                headers=self.headers,
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
