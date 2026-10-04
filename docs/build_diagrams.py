"""Generate the SmartIN architecture diagrams.

    python docs/build_diagrams.py

Writes docs/architecture.svg (with GitHub Copilot in the development loop) and
docs/architecture-no-copilot.svg. Export PNGs with any SVG renderer, e.g.
headless Edge/Chrome --screenshot (see docs/ARCHITECTURE.md).
"""
from html import escape
from pathlib import Path

W, H = 1640, 1370
DOCS = Path(__file__).parent


def text(x, y, value, cls="s", **attrs):
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<text x="{x}" y="{y}" class="{cls}"{extra}>{escape(value)}</text>'


def panel(x, y, w, h, color, title, subtitle="", title_fill="#fff", sub_fill="#E6EEFD"):
    return "\n".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="#fff" stroke="#E6E1D8" stroke-width="1.5"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="60" rx="20" fill="{color}"/>',
        f'<rect x="{x}" y="{y + 40}" width="{w}" height="20" fill="{color}"/>',
        text(x + 20, y + 28, title, "h", style=f"fill:{title_fill}"),
        text(x + 20, y + 49, subtitle, "sub", style=f"fill:{sub_fill}") if subtitle else "",
    ])


def lines(x, y, rows, step=19):
    """rows: list of (cls, text); 'gap' adds vertical space."""
    out = []
    for row in rows:
        if row == "gap":
            y += 11
            continue
        cls, value = row
        out.append(text(x, y, value, cls))
        y += step
    return "\n".join(out)


def tile(x, y, w, h, fill, title, rows):
    return "\n".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}"/>',
        text(x + 14, y + 22, title, "t b"),
        lines(x + 14, y + 42, [("s", r) for r in rows], 18),
    ])


def chips(x, y, rows):
    out = []
    for r, (fill, labels) in enumerate(rows):
        for c, label in enumerate(labels):
            cx = x + c * 172
            cy = y + r * 42
            out.append(f'<rect x="{cx}" y="{cy}" width="162" height="32" rx="16" fill="{fill}"/>')
            out.append(text(cx + 81, cy + 21, label, "chip", text_anchor="middle"))
    return "\n".join(out)


def arrow(points, label=None, lx=0, ly=0, grey=False, dashed=False, both=False, anchor="start"):
    color, marker = ("#8A8FA6", "ahg") if grey else ("#1B2A5C", "ah")
    pts = " ".join(f"{a},{b}" for a, b in points)
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    start = f' marker-start="url(#{marker})"' if both else ""
    out = [f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2"{dash} marker-end="url(#{marker})"{start}/>']
    for i, value in enumerate([label] if isinstance(label, str) else (label or [])):
        out.append(text(lx, ly + i * 16, value, "lblg" if grey else "lbl", text_anchor=anchor))
    return "\n".join(out)


def build(copilot):
    p = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">')
    p.append("""<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1B2A5C"/></marker>
<marker id="ahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8A8FA6"/></marker>
<style>
.h{font-size:19px;font-weight:700}
.sub{font-size:13px}
.t{font-size:14px;fill:#18234A}
.s{font-size:12.5px;fill:#4A5373}
.b{font-weight:700}
.lbl{font-size:12.5px;fill:#1B2A5C;font-weight:600}
.lblg{font-size:12.5px;fill:#5F6685;font-style:italic}
.chip{font-size:12.5px;fill:#18234A;font-weight:600}
.band{font-size:12px;fill:#8A8FA6;font-weight:700;letter-spacing:2px}
</style>
</defs>""")
    p.append(f'<rect width="{W}" height="{H}" fill="#F6F3EE"/>')
    title = "SmartIN · Moving to Poland — technical architecture"
    p.append(text(40, 52, title + (" (with GitHub Copilot)" if copilot else ""), "t", style="font-size:30px;font-weight:700"))
    p.append(text(40, 80, "Mobile-first web app · live official-source research with Claude · journeys in Supabase · "
                  "CI-gated deploys from GitHub to Render", "s", style="font-size:15px;fill:#5F6685"))
    p.append(text(40, 104, "RUNTIME", "band"))

    # A. Client
    p.append(panel(40, 115, 330, 495, "#2A5BD7", "Smartphone browser", "Mobile web app (SPA, also desktop)"))
    p.append(lines(60, 203, [
        ("t b", "Vanilla JS · HTML · CSS"), ("s", "index.html · app.js · app.css · no framework"), "gap",
        ("t b", "i18n.js — EN / PL / UK"), ("s", "auto-detects phone language · switcher"), "gap",
        ("t b", "History API"), ("s", "phone Back button follows the app"), "gap",
        ("t b", "Self-hosted fonts & animations"), ("s", "Lexend, Public Sans · scene.js"), "gap",
        ("t b", "Screens"), ("s", "Login · Home · Assistant chat · Creating"),
        ("s", "My journeys · Journey · Step · Builder"), ("s", "Explore · Alerts · Profile"), "gap",
        ("t b", "Privacy (GDPR)"), ("s", "Profile › Privacy: download / delete my data"), "gap",
        ("s", "HttpOnly cookies · no keys or secrets in browser"),
    ]))

    # B. Render / FastAPI
    p.append(panel(440, 115, 540, 495, "#1B2A5C", "Render · Web service",
                   "FastAPI · Python 3.12 · Uvicorn · deploys after CI passes"))
    p.append(tile(460, 192, 245, 72, "#E6EEFD", "Static UI hosting", ["GET / · /static/* · /health", "same origin, no CORS"]))
    p.append(tile(715, 192, 245, 72, "#E6EEFD", "Guest sessions", ["phone → HMAC hash (no raw number)", "device + session cookies"]))
    p.append(tile(460, 274, 245, 72, "#EAF1DF", "Journeys API", ["create own · edit steps · progress", "name, target date, focus"]))
    p.append(tile(715, 274, 245, 72, "#FDEDE2", "Alerts · chat · my data", ["in-app reminders · saved chat", "GET /api/me/export · DELETE /api/me"]))
    p.append(tile(460, 356, 500, 110, "#EFE7F8", "Assistant · POST /api/interview", [
        "1  Research: Claude + web search, only approved official domains",
        "2  Journey: forced tool return_journey_step → question or cited steps",
        "Guards: HTTPS + allowlisted sources only · every step cites S1…S8",
        "Domain allowlist from Supabase sources (5 min cache, env fallback)",
    ]))
    p.append(tile(460, 476, 500, 72, "#ECEEF3", "Production guards", [
        "CSP · HSTS · X-Frame-Options · no-store API · DB connection pool (keepalive)",
        "10 req/min per IP · 50 assistant messages/day per profile (assistant_usage)",
    ]))
    p.append(text(460, 572, "Secrets only in env vars: ANTHROPIC_API_KEY · DATABASE_URL ·"))
    p.append(text(460, 590, "APP_SESSION_SECRET · limits: ASSISTANT_DAILY_LIMIT · DB_POOL_MAX"))

    # C. Anthropic
    p.append(panel(1050, 115, 550, 240, "#C25A14", "Anthropic API",
                   "Claude Haiku 4.5 (ANTHROPIC_MODEL / ANTHROPIC_FAST_MODEL)", sub_fill="#FDEDE2"))
    p.append(lines(1070, 203, [
        ("t b", "Call 1 · Research"),
        ("s", "server tool web_search_20250305 · max_uses 3 · allowed_domains · PL"),
        ("s", "answers only from cited search results · pause_turn continuation"), "gap",
        ("t b", "Call 2 · Journey"),
        ("s", "forced client tool return_journey_step (JSON schema)"),
        ("s", "outcome: interview | journey | unsupported · reply in EN / PL / UK"), "gap",
        ("s", "Billing: tokens + $10 per 1,000 searches · Console spend limit"),
    ]))

    # D. Official websites
    p.append(panel(1050, 430, 550, 180, "#52771F", "Official Polish websites", "searched live, never stored", sub_fill="#EAF1DF"))
    p.append(lines(1070, 518, [
        ("s", "gov.pl (incl. udsc, mos.cudzoziemcy, nfz, podatki, biznes) · zus.pl"),
        ("s", "migrant.info.pl · um.warszawa.pl (+ districts) · warszawa19115.pl"),
        ("s", "krakow.pl (+ districts)"),
        ("s", "List managed in Supabase table sources (assistant_enabled)"),
    ]))

    # E. GitHub
    p.append(text(40, 682, "DATA & DELIVERY", "band"))
    p.append(panel(40, 693, 330, 345, "#24292F", "GitHub · anaDbvk/SmartIN", "private repository", sub_fill="#D0D7DE"))
    p.append(lines(60, 780, [
        ("t b", "Repository"), ("s", "webapp/ · supabase/ · scraper/ · tests/ · docs/"), "gap",
        ("t b", "Actions · CI (every push / PR)"), ("s", "Python unittest · Node smoke tests"),
        ("s", "(syntax, translations, navigation)"), "gap",
        ("t b", "Dependabot"), ("s", "weekly updates of pinned requirements"), "gap",
        ("t b", "Actions · Scrape and load (manual)"), ("s", "scraper/pl_gov_scraper.py → JSONL"),
        ("s", "→ scraper/load_to_supabase.py"),
    ]))

    # F. Supabase
    p.append(panel(440, 693, 540, 345, "#3ECF8E", "Supabase · PostgreSQL",
                   "Row-level security on · accessed only by the server", title_fill="#0B3B24", sub_fill="#0B3B24"))
    p.append(lines(460, 785, [
        ("t b", "App data (supabase/app_tables.sql)"),
        ("s", "guest_profiles · guest_devices"), ("s", "guest_sessions · guest_conversations"),
        ("s", "user_journeys (steps, sources, progress)"),
        ("s", "in_app_alerts"), ("s", "assistant_usage (daily limit)"), "gap",
        ("s", "on delete cascade → Delete my data"),
    ]))
    p.append(lines(730, 785, [
        ("t b", "Configuration (schema.sql)"), ("s", "sources"),
        ("s", "    assistant_enabled → search allowlist"), "gap",
        ("t b", "Scraped knowledge (optional)"), ("s", "raw_pages · documents · chunks"),
        ("s", "    not used by the live assistant"),
    ]))
    p.append(text(460, 1000, "Connection: Session pooler (IPv4) in DATABASE_URL · pooled psycopg2"))
    p.append(text(460, 1018, "Backups / PITR: see docs/PRODUCTION_ROADMAP.md"))

    # G. Key technologies
    p.append(panel(1050, 693, 550, 345, "#5F6685", "Key technologies", "", sub_fill="#fff"))
    dev_row = ["GitHub Copilot CLI", "unittest · Node", "gh CLI"] if copilot else ["unittest · Node", "gh CLI · Git", "headless Edge"]
    p.append(chips(1070, 773, [
        ("#E6EEFD", ["Vanilla JS SPA", "i18n EN·PL·UK", "History API"]),
        ("#E8EAF2", ["Python 3.12", "FastAPI · Pydantic", "Uvicorn"]),
        ("#FDEDE2", ["Claude Haiku 4.5", "Web search tool", "Anthropic SDK"]),
        ("#DDF5E8", ["Supabase Postgres", "psycopg2 · JSONB", "Row-level security"]),
        ("#EAEEF2", ["Render", "GitHub Actions", "Dependabot"]),
        ("#F3E8FF" if copilot else "#EAEEF2", dev_row),
    ]))

    # H. Development loop
    p.append(text(40, 1088, "DEVELOPMENT", "band"))
    p.append('<rect x="40" y="1098" width="1560" height="190" rx="20" fill="#fff" stroke="#E6E1D8" stroke-width="1.5"/>')
    if copilot:
        p.append(tile(60, 1118, 300, 150, "#E6EEFD", "Product owner / developer", [
            "describes features in plain language", "answers design questions (ask_user)",
            "tests the live app on a phone", "runs SQL in Supabase SQL Editor",
            "sets secrets in Render / GitHub",
        ]))
        p.append(tile(430, 1118, 620, 150, "#F3E8FF", "GitHub Copilot CLI · coding agent", [
            "plans, edits code, writes tests and docs · follows .github/copilot-instructions.md",
            "runs python -m unittest + Node smoke tests · headless Edge screenshots for UI checks",
            "commits with Co-authored-by: Copilot trailer · git push · gh run watch (CI)",
            "checks the live Render deploy (/health, headers) after each push",
            "sub-agents: explore · code review · security review · rubber-duck",
        ]))
        p.append(arrow([(360, 1193), (428, 1193)], ["prompts", "& answers"], 394, 1160, both=True, anchor="middle"))
        p.append(arrow([(740, 1118), (740, 1068), (205, 1068), (205, 1040)],
                       "git commit · push · gh CLI", 420, 1062, grey=True))
    else:
        p.append(tile(60, 1118, 990, 150, "#E6EEFD", "Developer workstation", [
            "Python 3.12 · Node.js · Git · gh CLI · editor of choice",
            "local run: uvicorn webapp.app:app (env vars for DATABASE_URL, ANTHROPIC_API_KEY, APP_SESSION_SECRET)",
            "tests: python -m unittest · node tests/js/*.js · UI checks in a phone-sized browser window",
            "SQL changes: supabase/*.sql run in the Supabase SQL Editor",
            "secrets: Render environment and GitHub Actions secrets, never in the repository",
        ]))
        p.append(arrow([(540, 1118), (540, 1068), (205, 1068), (205, 1040)],
                       "git commit · push", 330, 1062, grey=True))
    p.append(tile(1120, 1118, 460, 150, "#EAF1DF", "Feedback loop", [
        "CI result on every push (GitHub Actions)",
        "Render deploys only when CI is green (checksPass)",
        "verify: /health · security headers · phone test",
        "roadmap: docs/PRODUCTION_ROADMAP.md",
        "rollback: Render › Rollback to previous deploy",
    ]))
    p.append(arrow([(1050, 1193), (1118, 1193)], None))

    # Arrows (runtime)
    p.append(arrow([(370, 330), (438, 330)], ["HTTPS", "JSON API", "+ cookies"], 404, 280, both=True, anchor="middle"))
    p.append(arrow([(980, 240), (1048, 240)], ["2 calls", "per turn"], 1014, 208, both=True, anchor="middle"))
    p.append(arrow([(1325, 355), (1325, 428)], "web_search (allowed_domains only)", 1337, 396))
    p.append(arrow([(710, 610), (710, 691)], "psycopg2 pool · SQL", 722, 656, both=True))
    p.append(arrow([(300, 693), (300, 650), (520, 650), (520, 612)], "CI green → auto-deploy", 312, 642, grey=True))
    p.append(arrow([(370, 985), (438, 985)], "load", 404, 975, grey=True, dashed=True, anchor="middle"))
    p.append(arrow([(370, 950), (405, 950), (405, 628), (1015, 628), (1015, 560), (1048, 560)],
                   "scraper crawl (manual, optional)", 800, 622, grey=True, dashed=True))

    p.append(text(40, 1320, "Solid: live request path · Grey: delivery · Dashed: optional manual scraping pipeline", "s", style="font-size:13px;fill:#5F6685"))
    p.append(text(40, 1342, "Chat turn: browser → FastAPI → Claude researches official sites → Claude returns a cited step plan → "
                  "saved to user_journeys → shown as a journey.", "s", style="font-size:13px;fill:#5F6685"))
    p.append("</svg>")
    return "\n".join(x for x in p if x) + "\n"


if __name__ == "__main__":
    (DOCS / "architecture.svg").write_text(build(True), encoding="utf-8")
    (DOCS / "architecture-no-copilot.svg").write_text(build(False), encoding="utf-8")
    print("wrote architecture.svg and architecture-no-copilot.svg")
