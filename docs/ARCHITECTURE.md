# SmartIN architecture

![SmartIN technical architecture](architecture.png)

Editable source: [`architecture.svg`](architecture.svg).

```mermaid
flowchart LR
  subgraph Client["Smartphone browser"]
    UI["Vanilla JS SPA<br/>i18n EN/PL/UK · History API"]
  end
  subgraph Render["Render web service"]
    API["FastAPI · Python 3.12 · Uvicorn<br/>sessions · journeys · alerts"]
    AS["Assistant /api/interview<br/>1 research → 2 journey tool"]
  end
  subgraph Anthropic["Anthropic API"]
    CL["Claude Haiku 4.5<br/>web_search_20250305 + return_journey_step"]
  end
  WEB["Official websites<br/>gov.pl · zus.pl · migrant.info.pl · city sites"]
  subgraph Supabase["Supabase PostgreSQL (RLS)"]
    APP["guest_* · user_journeys · in_app_alerts"]
    SRC["sources (search allowlist)"]
    KB["raw_pages · documents · chunks (optional)"]
  end
  subgraph GitHub["GitHub anaDbvk/SmartIN"]
    CODE["code · tests · render.yaml"]
    ACT["Actions: Scrape and load (manual)"]
  end

  UI <-- "HTTPS JSON + cookies" --> API
  API --> AS
  AS <-- "Anthropic SDK" --> CL
  CL -- "allowed_domains" --> WEB
  API <-- "psycopg2 · Session pooler" --> APP
  AS -- "domain allowlist" --> SRC
  CODE -. "auto-deploy" .-> Render
  ACT -. "crawl" .-> WEB
  ACT -. "load" .-> KB
```

## Chat turn

```mermaid
sequenceDiagram
  participant U as Phone (SPA)
  participant F as FastAPI on Render
  participant S as Supabase
  participant C as Claude + web search
  U->>F: POST /api/interview (answer, history, language)
  F->>S: approved domains (sources, cached 5 min)
  F->>C: Call 1 research (web_search, allowed_domains)
  C-->>F: cited results S1…S8
  F->>C: Call 2 return_journey_step (forced tool)
  C-->>F: follow-up question or cited steps
  F->>S: save conversation and journey
  F-->>U: message, steps, sources
```

## Key technologies

| Layer | Technology |
| --- | --- |
| Frontend | Vanilla JavaScript SPA, HTML, CSS, self-hosted Lexend/Public Sans, i18n (EN/PL/UK), History API |
| Backend | Python 3.12, FastAPI, Pydantic, Uvicorn, httpx/requests |
| AI | Anthropic Claude Haiku 4.5, server web search tool restricted to official domains, forced tool output |
| Data | Supabase PostgreSQL, psycopg2, JSONB journeys, row-level security, Session pooler |
| Hosting & CI | Render (Blueprint `render.yaml`, auto-deploy), GitHub, GitHub Actions |
| Scraper (optional) | requests, BeautifulSoup, lxml, robots.txt, PII redaction |
| Security | HMAC-hashed phone IDs, HttpOnly cookies, secrets only in environment variables, rate limiting |
