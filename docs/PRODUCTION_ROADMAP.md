# INTEGRA.GOV – Road to production

This checklist is based on the current code (`webapp/app.py`, `render.yaml`, `supabase/*.sql`). Items are ordered by priority. **P0** must be done before real users, **P1** before public launch, and **P2** after launch.

## Current state (October 2026)

| Area | Today | Risk |
|---|---|---|
| Hosting | Render **free** plan, one instance | Sleeps after 15 min idle (30–60 s cold start), no zero-downtime guarantees |
| Database | Pooled `psycopg2` connections (done), Supabase session pooler | Backups and migrations still missing |
| Rate limiting | In-memory 10/min per IP + daily cap per profile in Supabase (done) | Per-IP limit not shared between instances |
| Login | Phone number + device token, **no SMS verification** | Anyone can register any phone number; recovery on a new device is impossible |
| Privacy | Export and delete-my-data done, no privacy policy yet | GDPR non-compliance (EU users, special-category data is possible) |
| Testing | 51 Python tests + JS smoke tests in GitHub CI (done) | No browser end-to-end tests yet |
| Dependencies | Pinned + Dependabot (done) | - |
| Monitoring | Python `logging` only, `/health` | No alerting on errors, outages or Anthropic spend |
| Security headers | CSP, HSTS, frame protection (done) | - |
| Domain | `moving-to-poland.onrender.com` | No own brand/domain, no custom email |

---

## P0 – Before real users (about 1–2 weeks)

### 1. Continuous integration
- [x] Add `.github/workflows/ci.yml`: run `python -m unittest` and the JS smoke tests on each push and pull request.
- [x] In Render, turn on **Auto-Deploy: After CI checks pass** (`autoDeployTrigger: checksPass` in `render.yaml`; set it in the dashboard if the service was not created from the Blueprint), or protect `main` with required checks.
- [x] Pin dependencies: `pip freeze > requirements.txt` (or `pip-tools`), and enable Dependabot.

### 2. Hosting
- [ ] Move Render to the **Starter** plan or higher (no sleep, about $7/month). Keep `/health` as the health check.
- [ ] Start with `gunicorn -k uvicorn.workers.UvicornWorker -w 2` and set a request timeout above the assistant's longest call.
- [ ] Use separate **staging** and **production** services, each with its own Supabase project or schema and its own secrets.

### 3. Database
- [x] Use a connection pool (`psycopg_pool` / `psycopg2.pool.ThreadedConnectionPool`) instead of connecting per request.
- [ ] Use the Supabase **transaction pooler** (port 6543) for the web app; keep the session pooler for migrations.
- [ ] Turn on Supabase **Point-in-Time Recovery** or daily backups (Pro plan), and test a restore once.
- [ ] Put `schema.sql` / `app_tables.sql` under migrations (Supabase CLI `supabase/migrations/`) so production and staging match.
- [ ] Confirm **Row Level Security is enabled** on all tables, with no `anon` access. The backend uses the DB role, and the browser never talks to Supabase.

### 4. Security
- [x] Add a middleware for security headers: `Content-Security-Policy` (self + fonts), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- [ ] Rotate `APP_SESSION_SECRET`, `ANTHROPIC_API_KEY` and the DB password before launch. Never reuse dev keys.
- [x] Remove the admin upload endpoint `POST /api/knowledge` and the old knowledge loader (the assistant uses live web search).
- [ ] Session expiry and cleanup: a scheduled job that deletes expired `guest_sessions`.
- [ ] Run the `/security-review` before launch.

### 5. AI cost and abuse control
- [x] **Daily message cap** per profile stored in Supabase (`assistant_usage`, `ASSISTANT_DAILY_LIMIT=50`).
- [ ] Shared per-IP limit (Postgres or Redis/Upstash) once there is more than one instance.
- [ ] Set a monthly **spend limit** and email alerts in the Anthropic Console.
- [ ] Log tokens and web-search calls per request (`usage` from the API response) into a `usage_log` table, so costs per user are visible.
- [ ] Add retry with backoff for Anthropic `429/529` errors, and a friendly "busy, try again" message in the UI.

### 6. Legal / GDPR (EU users)
- [ ] **Privacy policy** and **terms** pages (EN/PL/UK) linked from the welcome screen, plus consent at first start.
- [x] Add a **"Delete my data"** endpoint and button (profile, devices, sessions, conversations, journeys, alerts), and an **export** (JSON).
- [ ] Data retention: delete inactive guest profiles after N months.
- [ ] Sign the **DPAs** (data processing agreements) with Supabase, Render and Anthropic. Choose the Supabase EU region (Frankfurt).
- [ ] A clear disclaimer that the assistant gives **information, not legal advice**. It is already in the prompt; also show it in the UI footer and the policy.
- [ ] Tell users not to paste passport/PESEL numbers into chat, or add automatic redaction before sending to Anthropic.

---

## P1 – Before public launch

### 7. Accounts
- [ ] **SMS OTP verification** of phone numbers (Twilio Verify, or Supabase Auth phone login). This fixes the 409 "phone already linked" problem and allows recovery on a new phone.
- [ ] Optional email or Google/Apple sign-in.

### 8. Monitoring and operations
- [ ] Error tracking: **Sentry** (FastAPI and browser SDKs).
- [ ] Uptime monitoring of `/health` (Better Stack, UptimeRobot), with alerts by email or Telegram.
- [ ] Structured JSON logs with a request ID. Never log phone numbers or chat text.
- [ ] Extend `/health` to check the DB (`select 1`) at a separate `/ready` endpoint.
- [ ] Write a runbook: how to roll back on Render, restore the DB, and rotate keys.

### 9. Domain and delivery
- [ ] Your own domain (for example `integragov.pl`) on Render with automatic HTTPS.
- [ ] Serve static files with cache headers and a version hash (`app.js?v=...`), or put Cloudflare in front for CDN and DDoS protection.
- [ ] Make it a **PWA**: `manifest.json`, icons and a service worker, so users can "Add to Home Screen" and see journeys offline.

### 10. Product quality
- [ ] **Reminders** for step deadlines (email or Web Push) using the existing `alerts` table and a scheduled job (Render Cron or Supabase `pg_cron`).
- [ ] Check the source list monthly (broken links, moved pages), and use a GitHub Action to test the `sources` URLs.
- [ ] An answer-quality test set of 20–30 typical questions (TRC, PESEL, NFZ, ZUS, meldunek) run against the assistant before each prompt or model change.
- [ ] A user feedback button ("Was this step correct?") stored in Supabase.
- [ ] Accessibility check (contrast, screen reader labels, font scaling) and a translation review by native PL/UK speakers.
- [ ] Analytics without cookies (Plausible / Umami) for funnels: onboarding → first journey → completed step.

### 11. Testing
- [ ] Browser end-to-end tests with Playwright on staging: onboarding, chat, own journey, Back button, language switch.
- [ ] A load test (k6/Locust) of about 50 concurrent users on staging.

---

## P2 – After launch / growth

- [ ] Native app shells (Capacitor) for App Store / Google Play, if needed.
- [ ] Caching of frequent research answers (same question + city) to cut AI costs.
- [ ] Choose the model per task: Haiku for most turns, a stronger model only for complex cases.
- [ ] More cities: add rows to `sources` with `assistant_enabled = true`.
- [ ] An admin dashboard: usage, costs, feedback, source management.
- [ ] Scale out to 2+ Render instances (needs a shared rate limit, which item 5 provides).
- [ ] A partnership/legal review with an immigration lawyer or NGO for the content rules.

---

## Rough monthly cost at launch

| Service | Plan | About |
|---|---|---|
| Render | Starter web service | $7 |
| Supabase | Pro (backups, no pause) | $25 |
| Anthropic | Haiku 4.5 + web search ($10 / 1,000 searches) | $20–100, depends on usage |
| Domain | `.pl` | ~$10 / year |
| Sentry, UptimeRobot, Plausible | free tiers | $0 |
| Twilio Verify (SMS) | per verification | ~$0.05 each |

## Launch checklist (day of release)

1. CI is green on `main`, and staging was tested end to end.
2. Production secrets are rotated and set in Render.
3. The DB backup is confirmed, and migrations are applied to production.
4. The privacy policy, terms and disclaimer are live.
5. The Anthropic spend limit, Sentry and the uptime monitor are active.
6. The custom domain works over HTTPS, and `/health` returns 200.
7. A rollback plan is ready: Render "Rollback to previous deploy".
