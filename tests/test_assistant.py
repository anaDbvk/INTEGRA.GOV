import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from webapp.app import (
    DB_POOL_MAX,
    _db_idle,
    count_assistant_message,
    database_connection,
    delete_profile_data,
    export_profile_data,
    JourneyStepInput,
    _domain_cache,
    app,
    normalize_domains,
    official_domains,
    rebuild_steps,
    require_guest,
    web_search_tool,
)


def research_response(*results, stop_reason="end_turn", text="Report a death within three days.", cite=None):
    citations = []
    if cite:
        citations.append(SimpleNamespace(
            type="web_search_result_location",
            url=cite,
            title="Cited page",
            cited_text="Report a death at the civil registry office within three days.",
        ))
    return SimpleNamespace(stop_reason=stop_reason, content=[
        SimpleNamespace(type="server_tool_use", id="srvtoolu_1", name="web_search", input={"query": "zgłoszenie zgonu"}),
        SimpleNamespace(type="web_search_tool_result", tool_use_id="srvtoolu_1", content=[
            SimpleNamespace(type="web_search_result", url=url, title=title, page_age="March 3, 2026", encrypted_content="x")
            for url, title in results
        ]),
        SimpleNamespace(type="text", text=text, citations=citations),
    ])


def journey_response(tool_input):
    return SimpleNamespace(stop_reason="tool_use", content=[
        SimpleNamespace(type="tool_use", name="return_journey_step", input=tool_input),
    ])


def fake_client(*responses):
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.messages = SimpleNamespace(create=AsyncMock(side_effect=list(responses)))
            calls.append(self)

        async def close(self):
            return None

    return FakeClient, calls


OFFICIAL = ("https://www.gov.pl/web/gov/zglos-zgon", "Report death - Gov.pl")


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[require_guest] = lambda: "test-profile-id"
        self.addCleanup(app.dependency_overrides.clear)
        self.env = patch.dict(
            os.environ,
            {
                "ANTHROPIC_API_KEY": "test-api-key",
                "ANTHROPIC_MODEL": "test-model",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        for name in ("DATABASE_URL",):
            os.environ.pop(name, None)

    def test_ui_is_served_without_exposing_api_credentials(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Moving to Poland", response.text)
        self.assertIn('/static/app.css', response.text)
        self.assertIn('/static/app.js', response.text)
        self.assertNotIn('type="file"', response.text)
        self.assertNotIn("Load assistant knowledge", response.text)
        self.assertNotIn("test-api-key", response.text)
        script = self.client.get("/static/app.js")
        self.assertEqual(script.status_code, 200)
        self.assertIn('enterkeyhint="send"', script.text)
        self.assertIn('id="chatForm"', script.text)
        self.assertIn("smartin_lang", script.text)
        self.assertIn("language: state.language", script.text)
        self.assertLess(response.text.index("/static/i18n.js"), response.text.index("/static/app.js"))
        translations = self.client.get("/static/i18n.js")
        self.assertEqual(translations.status_code, 200)
        self.assertIn("sent to Anthropic", translations.text)
        for marker in ("en: {", "pl: {", "uk: {", "Zaloguj się", "Увійти"):
            self.assertIn(marker, translations.text)
        stylesheet = self.client.get("/static/app.css")
        self.assertEqual(stylesheet.status_code, 200)
        self.assertNotIn("fonts.googleapis.com", stylesheet.text)
        self.assertIn("/static/fonts/lexend-latin.woff2", stylesheet.text)
        for path in ("/static/scene.js", "/static/scenes.css", "/static/fonts/publicsans-latin.woff2"):
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_journey_details_can_be_renamed_with_target_date_and_focus(self):
        journey_id = "11111111-1111-1111-1111-111111111111"
        with patch("webapp.app.database_call", new=AsyncMock(return_value=True)) as database_call:
            response = self.client.patch(
                f"/api/journeys/{journey_id}",
                json={"title": "  My PESEL plan ", "target_date": "2026-12-31", "focus": ["first", "health"]},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"title": "My PESEL plan", "target_date": "2026-12-31", "focus": ["first", "health"]},
        )
        self.assertEqual(database_call.await_args.args[1], "test-profile-id")

    def test_journey_details_update_returns_404_for_unknown_journey(self):
        with patch("webapp.app.database_call", new=AsyncMock(return_value=False)):
            response = self.client.patch(
                "/api/journeys/11111111-1111-1111-1111-111111111111",
                json={"title": "Plan"},
            )
        self.assertEqual(response.status_code, 404)

    def test_journey_details_update_rejects_invalid_date(self):
        response = self.client.patch(
            "/api/journeys/11111111-1111-1111-1111-111111111111",
            json={"title": "Plan", "target_date": "31.12.2026"},
        )
        self.assertEqual(response.status_code, 422)

    def test_user_can_create_own_journey(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("22222222-2222-2222-2222-222222222222",)
        saved = {"id": "22222222-2222-2222-2222-222222222222", "title": "Settle in Kraków"}
        with patch("webapp.app.database_connection", return_value=connection), \
                patch("webapp.app.get_journey", return_value=saved) as loader:
            response = self.client.post("/api/journeys", json={
                "title": " Settle in Kraków ",
                "target_date": "2026-12-01",
                "language": "pl",
                "steps": [{"title": "Find a flat", "action": "Look on OLX", "deadline": "by 15.11"}],
            })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json(), saved)
        params = cursor.execute.call_args.args[1]
        self.assertEqual(params[:4], ("test-profile-id", "Settle in Kraków", "Settle in Kraków", "pl"))
        journey = json.loads(params[4])
        self.assertTrue(journey["custom"])
        self.assertEqual(journey["target_date"], "2026-12-01")
        self.assertEqual(journey["sources"], [])
        self.assertEqual(journey["journey_blocks"], [{
            "title": "Find a flat", "action": "Look on OLX", "deadline": "by 15.11", "source_ids": [], "custom": True,
        }])
        connection.commit.assert_called_once()
        self.assertEqual(loader.call_args.args, ("test-profile-id", "22222222-2222-2222-2222-222222222222"))

    def test_own_journey_needs_named_steps(self):
        for steps in ([], [{"title": "  "}]):
            with self.subTest(steps=steps), \
                    patch("webapp.app.database_connection", return_value=MagicMock()):
                response = self.client.post("/api/journeys", json={"title": "Plan", "steps": steps})
                self.assertEqual(response.status_code, 422)

    def test_editing_steps_keeps_official_steps_and_remaps_progress(self):
        official = {"title": "Apply for PESEL", "action": "Go to the office.", "source_ids": ["S1"]}
        own = {"title": "Buy SIM", "action": "", "deadline": "", "source_ids": [], "custom": True}
        steps = [
            JourneyStepInput(title="Get a SIM card", from_index=1),
            JourneyStepInput(title="ignored rename", from_index=0),
            JourneyStepInput(title="Open bank account", deadline="next week"),
        ]
        blocks, completed = rebuild_steps([official, own], {0}, steps)
        self.assertEqual(blocks[0]["title"], "Get a SIM card")
        self.assertTrue(blocks[0]["custom"])
        self.assertEqual(blocks[1], official)
        self.assertEqual(blocks[2]["deadline"], "next week")
        self.assertEqual(completed, [1])

    def test_editing_steps_rejects_bad_references_and_empty_names(self):
        old = [{"title": "A", "source_ids": ["S1"]}]
        for steps in (
            [JourneyStepInput(from_index=3)],
            [JourneyStepInput(from_index=0), JourneyStepInput(from_index=0)],
            [JourneyStepInput(title=" ")],
        ):
            with self.subTest(steps=steps), self.assertRaises(HTTPException) as caught:
                rebuild_steps(old, set(), steps)
            self.assertEqual(caught.exception.status_code, 422)

    def test_edit_steps_endpoint_saves_for_profile_and_handles_missing_journey(self):
        journey_id = "11111111-1111-1111-1111-111111111111"
        result = {"journey_blocks": [{"title": "A"}], "completed_steps": []}
        with patch("webapp.app.database_call", new=AsyncMock(return_value=result)) as database_call:
            response = self.client.put(f"/api/journeys/{journey_id}/steps", json={"steps": [{"title": "A"}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)
        self.assertEqual(database_call.await_args.args[1], "test-profile-id")
        with patch("webapp.app.database_call", new=AsyncMock(return_value=None)):
            response = self.client.put(f"/api/journeys/{journey_id}/steps", json={"steps": [{"title": "A"}]})
        self.assertEqual(response.status_code, 404)

    def test_legacy_knowledge_endpoints_are_removed(self):
        self.assertEqual(self.client.get("/api/status").status_code, 404)
        self.assertEqual(self.client.post("/api/knowledge").status_code, 404)

    def test_static_app_assets_are_served(self):
        self.assertEqual(self.client.get("/static/app.js").status_code, 200)
        self.assertEqual(self.client.get("/static/app.css").status_code, 200)

    def test_private_routes_require_a_guest_session(self):
        app.dependency_overrides.clear()
        for path in ("/api/conversation", "/api/journeys", "/api/alerts"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)

    def test_journeys_are_loaded_for_the_authenticated_profile(self):
        with patch("webapp.app.database_call", new=AsyncMock(return_value=[])) as database_call:
            response = self.client.get("/api/journeys")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"journeys": []})
        self.assertEqual(database_call.await_args.args[1], "test-profile-id")

    def test_interview_returns_source_cited_journey_blocks(self):
        FakeClient, calls = fake_client(
            research_response(OFFICIAL, cite=OFFICIAL[0]),
            journey_response({
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
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "journey")
        self.assertEqual(body["journey_blocks"][0]["source_ids"], ["S1"])
        self.assertEqual(body["needs_official_help"], True)
        self.assertEqual(body["journey_blocks"][0]["documents"], ["Death certificate"])
        self.assertEqual(body["journey_blocks"][0]["where"], "Civil registry office")
        self.assertEqual(body["sources"][0]["url"], OFFICIAL[0])
        self.assertEqual(body["sources"][0]["page_age"], "March 3, 2026")

        create = calls[0].messages.create
        research_call, journey_call = create.await_args_list
        tool = research_call.kwargs["tools"][0]
        self.assertEqual(tool["type"], "web_search_20250305")
        self.assertIn("gov.pl", tool["allowed_domains"])
        self.assertIn("migrant.info.pl", tool["allowed_domains"])
        self.assertEqual(tool["max_uses"], 3)
        self.assertEqual(journey_call.kwargs["tool_choice"]["name"], "return_journey_step")
        prompt = journey_call.kwargs["messages"][-1]["content"]
        self.assertIn("[S1] Report death - Gov.pl", prompt)
        self.assertIn("Report a death within three days. [S1]", prompt)
        self.assertIn("civil registry office within three days", prompt)

    def test_research_drops_results_outside_approved_domains(self):
        FakeClient, calls = fake_client(
            research_response(
                ("https://example.com/fake-gov", "Fake guide"),
                ("http://www.gov.pl/insecure", "Insecure"),
                ("https://evilgov.pl/page", "Lookalike"),
                ("https://udsc.gov.pl/cudzoziemcy/", "UDSC"),
            ),
            journey_response({
                "outcome": "journey",
                "message": "Plan.",
                "question": "",
                "needs_official_help": False,
                "journey_blocks": [{"title": "Apply", "action": "Apply at the voivodeship office.", "source_ids": ["S1"]}],
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "I need a residence card.", "language": "pl"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([s["url"] for s in response.json()["sources"]], ["https://udsc.gov.pl/cudzoziemcy/"])

    def test_research_continues_after_pause_turn(self):
        FakeClient, calls = fake_client(
            research_response(stop_reason="pause_turn", text=""),
            research_response(OFFICIAL),
            journey_response({
                "outcome": "interview",
                "message": "I can help.",
                "question": "Which city are you in?",
                "journey_blocks": [],
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        create = calls[0].messages.create
        self.assertEqual(create.await_count, 3)
        continuation = create.await_args_list[1].kwargs["messages"]
        self.assertEqual(continuation[-1]["role"], "assistant")
        self.assertEqual(response.json()["sources"][0]["url"], OFFICIAL[0])

    def test_journey_without_any_official_source_becomes_unsupported(self):
        FakeClient, _ = fake_client(
            SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="NO_RESEARCH", citations=None)]),
            journey_response({
                "outcome": "journey",
                "message": "Plan.",
                "question": "",
                "journey_blocks": [{"title": "Do it", "action": "Go.", "source_ids": ["S1"]}],
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "Hello", "language": "en"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outcome"], "unsupported")
        self.assertEqual(response.json()["journey_blocks"], [])

    def test_interview_can_ask_follow_up_without_research(self):
        FakeClient, _ = fake_client(
            SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="NO_RESEARCH", citations=None)]),
            journey_response({
                "outcome": "interview",
                "message": "I can help find an appropriate process.",
                "question": "Which city or process do you mean?",
                "journey_blocks": [],
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "I need help with local events.", "language": "en"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["outcome"], "interview")
        self.assertEqual(response.json()["question"], "Which city or process do you mean?")
        self.assertEqual(response.json()["sources"], [])

    def test_configured_search_domains_override_defaults(self):
        with patch.dict(os.environ, {"WEB_SEARCH_DOMAINS": "https://gov.pl/, zus.pl", "WEB_SEARCH_MAX_USES": "50"}):
            tool = web_search_tool()
        self.assertEqual(tool["allowed_domains"], ["gov.pl", "zus.pl"])
        self.assertEqual(tool["max_uses"], 8)

    def test_source_urls_collapse_to_parent_domains(self):
        domains = normalize_domains([
            "https://www.gov.pl", "https://udsc.gov.pl", "https://mos.cudzoziemcy.gov.pl",
            "https://www.krakow.pl", "https://dzielnica3.krakow.pl", "https://um.warszawa.pl",
            "https://bemowo.um.warszawa.pl", "https://migrant.info.pl/", "not a domain", "",
        ])
        self.assertEqual(domains, ["gov.pl", "krakow.pl", "um.warszawa.pl", "migrant.info.pl"])

    def test_research_uses_domains_from_supabase_sources(self):
        _domain_cache.clear()
        self.addCleanup(_domain_cache.clear)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test"}), \
                patch("webapp.app.load_source_domains", return_value=["gov.pl", "krakow.pl"]) as loader:
            self.assertEqual(asyncio.run(official_domains()), ["gov.pl", "krakow.pl"])
            self.assertEqual(asyncio.run(official_domains()), ["gov.pl", "krakow.pl"])
        self.assertEqual(loader.call_count, 1)

    def test_supabase_failure_falls_back_to_configured_domains(self):
        _domain_cache.clear()
        self.addCleanup(_domain_cache.clear)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test", "WEB_SEARCH_DOMAINS": "zus.pl"}), \
                patch("webapp.app.load_source_domains", side_effect=RuntimeError("down")):
            self.assertEqual(asyncio.run(official_domains()), ["zus.pl"])

    def test_interview_rejects_uncited_journey(self):
        FakeClient, _ = fake_client(
            research_response(OFFICIAL),
            journey_response({
                "outcome": "journey",
                "message": "Here is a plan.",
                "question": "",
                "journey_blocks": [{
                    "title": "Do something",
                    "action": "Go somewhere.",
                    "source_ids": ["S404"],
                }],
            }),
        )
        with patch("webapp.app.anthropic.AsyncAnthropic", FakeClient):
            response = self.client.post(
                "/api/interview",
                json={"answer": "I need to report a death.", "language": "en"},
            )
        self.assertEqual(response.status_code, 502)


class FakeInfo:
    def __init__(self):
        self.transaction_status = 0


class FakeConnection:
    def __init__(self):
        self.closed = 0
        self.info = FakeInfo()

    def rollback(self):
        self.info.transaction_status = 0

    def close(self):
        self.closed = 1

    def cursor(self):
        return MagicMock()


class ProductionHardeningTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[require_guest] = lambda: "test-profile-id"
        self.addCleanup(app.dependency_overrides.clear)
        _db_idle.clear()
        self.addCleanup(_db_idle.clear)

    def test_security_headers_are_set(self):
        response = self.client.get("/health")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
        self.assertNotIn("Strict-Transport-Security", response.headers)
        https = self.client.get("/health", headers={"x-forwarded-proto": "https"})
        self.assertIn("max-age=", https.headers["Strict-Transport-Security"])
        api = self.client.get("/api/session")
        self.assertEqual(api.headers["Cache-Control"], "no-store")

    def test_pool_reuses_connections_and_releases_slots(self):
        created = []

        def connect(*args, **kwargs):
            created.append(FakeConnection())
            return created[-1]

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://example"}), \
                patch("webapp.app.psycopg2.connect", side_effect=connect):
            for _ in range(DB_POOL_MAX * 3):
                connection = database_connection()
                connection.close()
                connection.close()
            self.assertEqual(len(created), 1)
            held = [database_connection() for _ in range(DB_POOL_MAX)]
            self.assertEqual(len(created), DB_POOL_MAX)
            held[0].closed = 1
            held[0]._connection.closed = 1
            for connection in held:
                connection.close()
            self.assertEqual(len(_db_idle), DB_POOL_MAX - 1)

    def test_failed_connect_releases_slot(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://example"}), \
                patch("webapp.app.psycopg2.connect", side_effect=RuntimeError("down")):
            for _ in range(DB_POOL_MAX + 1):
                with self.assertRaisesRegex(RuntimeError, "down"):
                    database_connection()

    def test_daily_assistant_limit_returns_429(self):
        env = {"DATABASE_URL": "postgresql://example", "ANTHROPIC_API_KEY": "k", "ANTHROPIC_MODEL": "m"}
        with patch.dict(os.environ, env), \
                patch("webapp.app.database_call", new=AsyncMock(return_value=False)) as database_call, \
                patch("webapp.app.anthropic.AsyncAnthropic") as client:
            response = self.client.post("/api/interview", json={"answer": "Hello", "language": "en"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["X-Limit"], "daily")
        self.assertIs(database_call.await_args.args[0], count_assistant_message)
        client.assert_not_called()

    def test_export_returns_json_attachment(self):
        data = {"profile_id": "test-profile-id", "journeys": [{"title": "Ślub"}]}
        with patch("webapp.app.database_call", new=AsyncMock(return_value=data)) as database_call:
            response = self.client.get("/api/me/export")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["Content-Disposition"])
        self.assertEqual(response.json(), data)
        database_call.assert_awaited_once_with(export_profile_data, "test-profile-id")

    def test_delete_my_data_removes_profile_and_cookies(self):
        with patch("webapp.app.database_call", new=AsyncMock(return_value=None)) as database_call:
            response = self.client.delete("/api/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True})
        database_call.assert_awaited_once_with(delete_profile_data, "test-profile-id")
        cookies = response.headers.get_list("set-cookie")
        self.assertTrue(any(c.startswith("smartin_session=") for c in cookies))
        self.assertTrue(any(c.startswith("smartin_device=") for c in cookies))

    def test_export_skips_secrets(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.description = [("created_at",)]
        cursor.fetchall.return_value = [("2026-10-01",)]
        with patch("webapp.app.database_connection", return_value=connection):
            data = export_profile_data("test-profile-id")
        executed = " ".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertNotIn("hash", executed)
        self.assertEqual(data["profile"], {"created_at": "2026-10-01"})
        connection.close.assert_called_once()

if __name__ == "__main__":
    unittest.main()
