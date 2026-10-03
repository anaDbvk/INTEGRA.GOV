import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient

from webapp.app import (
    MAX_PAGE_TEXT,
    app,
    format_evidence,
    github_get_json,
    load_github_dataset,
    parse_jsonl,
    retrieve_pages,
    validate_page,
)


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
        app.state.knowledge_source = ""
        app.state.knowledge_error = ""
        app.state.last_load_attempt = None
        self.tempdir = tempfile.TemporaryDirectory()
        dataset = Path(self.tempdir.name) / "missing.jsonl"
        self.dataset_patch = patch("webapp.app.DEFAULT_DATASET", dataset)
        self.dataset_patch.start()
        self.addCleanup(self.dataset_patch.stop)
        self.addCleanup(self.tempdir.cleanup)
        self.client = TestClient(app)
        self.env = patch.dict(
            os.environ,
            {
                "ANTHROPIC_API_KEY": "test-api-key",
                "ANTHROPIC_MODEL": "test-model",
                "ADMIN_TOKEN": "test-admin",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def tearDown(self):
        app.state.pages = []
        app.state.knowledge_source = ""
        app.state.knowledge_error = ""
        app.state.last_load_attempt = None

    def test_ui_is_served_without_exposing_api_credentials(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("SmartIN Assistant", response.text)
        self.assertIn("sent to Anthropic", response.text)
        self.assertIn("Enter to send", response.text)
        self.assertIn('event.key === "Enter"', response.text)
        self.assertIn("loaded from the latest GitHub scrape", response.text)
        self.assertNotIn('type="file"', response.text)
        self.assertNotIn("Load assistant knowledge", response.text)
        self.assertNotIn("test-api-key", response.text)

    def test_api_is_available_without_a_shared_access_token(self):
        self.assertEqual(
            self.client.get("/api/status").json(),
            {"loaded_pages": 0, "knowledge_source": "", "knowledge_error": ""},
        )

    def test_status_auto_loads_local_dataset(self):
        dataset = Path(self.tempdir.name) / "missing.jsonl"
        dataset.write_text(json.dumps(jsonl_page()) + "\n", encoding="utf-8")
        response = self.client.get("/api/status")
        self.assertEqual(
            response.json(),
            {
                "loaded_pages": 1,
                "knowledge_source": "local scrape artifact",
                "knowledge_error": "",
            },
        )
        self.assertEqual(app.state.pages[0]["title"], "Report death - Gov.pl")

    def test_github_loader_merges_recent_artifacts_and_keeps_latest_page(self):
        old = jsonl_page(text="Older scraped content.")
        old["fetched_at"] = "2026-10-02T12:00:00+00:00"
        new = jsonl_page(text="Latest scraped content.")
        new["fetched_at"] = "2026-10-03T12:00:00+00:00"
        event = jsonl_page(
            title="Upcoming city event",
            text="A local event in Krakow.",
            url="https://www.krakow.pl/events/example",
            source="krakow",
        )
        run = {"id": 123}
        with (
            patch.dict(os.environ, {"GITHUB_TOKEN": "test-github-token", "GITHUB_REPOSITORY": "owner/repo"}),
            patch(
                "webapp.app.github_get_json",
                side_effect=[
                    {"workflow_runs": [run]},
                    {"artifacts": [{"id": 456, "name": "pl_gov_pages", "expired": False}]},
                ],
            ) as github_get,
            patch(
                "webapp.app.download_artifact",
                return_value=(
                    "\n".join(json.dumps(row) for row in (old, new, event)) + "\n"
                ).encode(),
            ),
        ):
            pages, artifact_count = load_github_dataset()
        self.assertEqual(artifact_count, 1)
        self.assertEqual(len(pages), 2)
        self.assertEqual(
            github_get.call_args_list[0].args[1]["Authorization"],
            "Bearer test-github-token",
        )
        latest = next(page for page in pages if page["url"] == new["url"])
        self.assertEqual(latest["text"], "Latest scraped content.")

    def test_github_loader_keeps_all_chunks_from_an_oversized_page(self):
        large_page = jsonl_page(
            text=("service information " * (MAX_PAGE_TEXT // 20)) + "late deadline requirements."
        )
        with (
            patch.dict(os.environ, {"GITHUB_TOKEN": "test-github-token", "GITHUB_REPOSITORY": "owner/repo"}),
            patch(
                "webapp.app.github_get_json",
                side_effect=[
                    {"workflow_runs": [{"id": 123}]},
                    {"artifacts": [{"id": 456, "name": "pl_gov_pages", "expired": False}]},
                ],
            ),
            patch(
                "webapp.app.download_artifact",
                return_value=(json.dumps(large_page) + "\n").encode(),
            ),
        ):
            pages, artifact_count = load_github_dataset()
        self.assertEqual(artifact_count, 1)
        self.assertEqual(len(pages), 2)
        self.assertIn("late deadline requirements.", format_evidence(pages, "late deadline")[0])

    def test_missing_github_repository_is_shown_in_status(self):
        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-github-token"}, clear=False):
            os.environ.pop("GITHUB_REPOSITORY", None)
            response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        self.assertIn("GITHUB_REPOSITORY", response.json()["knowledge_error"])

    def test_status_does_not_expose_raw_github_errors(self):
        with (
            patch.dict(
                os.environ,
                {
                    "GITHUB_TOKEN": "test-github-token",
                    "GITHUB_REPOSITORY": "owner/repo",
                },
            ),
            patch(
                "webapp.app.load_github_dataset",
                side_effect=HTTPException(
                    status_code=400,
                    detail="private upstream error text",
                ),
            ),
        ):
            response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("private upstream error text", response.text)
        self.assertEqual(
            response.json()["knowledge_error"],
            "Automatic GitHub artifact loading failed. Check the server logs.",
        )

    def test_github_api_errors_are_wrapped_as_bad_request(self):
        with patch("webapp.app.requests.get") as get:
            get.return_value.raise_for_status.side_effect = requests.HTTPError(
                "404 Client Error: Not Found"
            )
            with self.assertRaises(HTTPException) as raised:
                github_get_json("https://api.github.com/test", {})
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "404 Client Error: Not Found")
        self.assertIsInstance(raised.exception.__cause__, requests.HTTPError)

    def test_upload_rejects_non_http_url_and_keeps_previous_knowledge(self):
        app.state.pages = [validate_page(jsonl_page(), 1)]
        bad = jsonl_page(url="javascript:alert(1)")
        response = self.client.post(
            "/api/knowledge",
            files={"file": ("pages.jsonl", json.dumps(bad) + "\n")},
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(app.state.pages), 1)

    def test_upload_requires_admin_token(self):
        response = self.client.post(
            "/api/knowledge",
            files={"file": ("pages.jsonl", json.dumps(jsonl_page()) + "\n")},
        )
        self.assertEqual(response.status_code, 404)

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
            files={"file": ("pl_gov_pages.jsonl", content)},
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["loaded_pages"], 2)
        selected = retrieve_pages(app.state.pages, "How to report death?")
        self.assertEqual(len(selected), 1)
        self.assertIn("Report death", selected[0]["title"])

    def test_oversized_scraped_page_is_split_without_losing_content(self):
        text = ("general information " * (MAX_PAGE_TEXT // 20)) + "late deadline details."
        pages = parse_jsonl((json.dumps(jsonl_page(text=text)) + "\n").encode())
        self.assertGreater(len(pages), 1)
        self.assertTrue(all(len(page["text"]) <= MAX_PAGE_TEXT for page in pages))
        self.assertTrue(all("(part " in page["title"] for page in pages))
        self.assertIn("late deadline details.", pages[-1]["text"])
        self.assertIn("late deadline details.", format_evidence(pages, "late deadline")[0])

    def test_retrieval_excerpt_centers_on_relevant_text(self):
        text = ("general information " * 500) + "Required documents include proof of address."
        page = validate_page(jsonl_page(text=text), 1)
        evidence, _ = format_evidence([page], "required documents")
        self.assertIn("Required documents include proof of address.", evidence)

    def test_polish_inflection_and_missing_diacritics_still_match(self):
        page = validate_page(
            jsonl_page(
                title="Zawarcie małżeństwa",
                text=(
                    "Zawarcie małżeństwa odbywa się w urzędzie stanu cywilnego. "
                    "Dokumenty potrzebne przy małżeństwie należy złożyć w urzędzie."
                ),
                url="https://www.gov.pl/web/gov/slub",
            ),
            1,
        )
        self.assertEqual(len(retrieve_pages([page], "malzenstwo")), 1)
        self.assertEqual(len(retrieve_pages([page], "ślub w urzędzie")), 1)
        matches = retrieve_pages([page], "malzenstwo")
        self.assertIn("małżeństwie", matches[0]["text"])

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
                                "needs_official_help": True,
                                "journey_blocks": [{
                                    "title": "Register the death",
                                    "action": "Report it to the civil registry office.",
                                    "where": "Civil registry office",
                                    "documents": ["Death certificate", 7],
                                    "fee": "No fee stated.",
                                    "deadline": "Within three days.",
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
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outcome"], "journey")
        self.assertEqual(response.json()["journey_blocks"][0]["source_ids"], ["S1"])
        self.assertEqual(response.json()["needs_official_help"], True)
        self.assertEqual(response.json()["journey_blocks"][0]["documents"], ["Death certificate"])
        self.assertEqual(response.json()["journey_blocks"][0]["where"], "Civil registry office")
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
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
