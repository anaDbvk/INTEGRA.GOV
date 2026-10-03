-- SmartIN schema for Supabase Postgres.
-- Matches load_to_supabase.py. Vector size 1024 must match your embedding model.

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- sources
create table if not exists sources (
  id            serial primary key,
  name          text not null unique,          -- must equal SOURCES keys in pl_gov_scraper.py
  base_url      text not null,
  kind          text not null default 'scrape'
                check (kind in ('api', 'sitemap', 'scrape', 'curated')),
  jurisdiction  text not null default 'national',
  refresh_days  int  not null default 7,
  license_notes text
);
alter table sources
  add column if not exists jurisdiction text not null default 'national';

-- ------------------------------------------------------------- raw_pages
create table if not exists raw_pages (
  id           bigserial primary key,
  source_id    int not null references sources(id),
  url          text not null,
  content_hash text not null,
  text         text not null,
  http_status  int,
  fetched_at   timestamptz not null,
  unique (url, content_hash)
);

-- ------------------------------------------------------------- documents
create table if not exists documents (
  id            bigserial primary key,
  source_id     int not null references sources(id),
  url           text not null unique,
  title         text,
  text_redacted text not null,
  content_hash  text not null,
  embedded_hash text,                          -- set by the embedding job; re-embed when != content_hash
  origin        text not null default 'scraped'
                check (origin in ('scraped', 'manual', 'api')),
  recrawl       boolean not null default true,
  category      text,
  page_type     text,
  jurisdiction  text not null default 'national',
  language      text not null default 'pl',
  event_dates   jsonb not null default '[]'::jsonb,
  valid_from    date,
  valid_to      date,
  fetched_at    timestamptz not null
);
alter table documents
  add column if not exists category text,
  add column if not exists page_type text,
  add column if not exists jurisdiction text not null default 'national',
  add column if not exists language text not null default 'pl',
  add column if not exists event_dates jsonb not null default '[]'::jsonb,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists fetched_at timestamptz;
create index if not exists documents_jurisdiction_idx on documents (jurisdiction);
create index if not exists documents_category_idx on documents (category);
create index if not exists documents_source_idx on documents (source_id);

-- ---------------------------------------------------------------- chunks
create table if not exists chunks (
  id          bigserial primary key,
  document_id bigint not null references documents(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  embedding   extensions.vector(1024),
  tsv         tsvector,
  unique (document_id, chunk_index)
);
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);

create or replace function chunks_set_tsv() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.tsv := to_tsvector('simple', unaccent(new.content));
  return new;
end
$$;

drop trigger if exists chunks_set_tsv_trg on chunks;
create trigger chunks_set_tsv_trg
  before insert or update of content on chunks
  for each row execute function chunks_set_tsv();

-- -------------------------------------------------------------- journeys
-- Curated, human-verified journeys for high-stakes life events
-- (death, marriage, PESEL, address registration, residence).
create table if not exists journeys (
  id           bigserial primary key,
  slug         text not null,
  topic        text not null,
  jurisdiction text not null default 'national',
  language     text not null default 'en',
  steps        jsonb not null,                 -- [{title, action, where, documents[], fee, deadline, source_url}]
  legal_basis  jsonb not null default '[]'::jsonb,
  verified_at  date not null,
  verified_by  text not null,
  unique (slug, jurisdiction, language)
);

-- -------------------------------------------------------- row level security
-- Tables in `public` are exposed through the Supabase REST API. Enable RLS with
-- no policies so anon/authenticated roles get nothing. The backend connects
-- with the database role / service role, which bypasses RLS.
alter table sources    enable row level security;
alter table raw_pages  enable row level security;
alter table documents  enable row level security;
alter table chunks     enable row level security;
alter table journeys   enable row level security;

-- ----------------------------------------------------------- hybrid search
-- query_tsq: prefix tsquery built by the app from stemmed tokens,
-- e.g. 'malzen:* | slub:*'. Reciprocal rank fusion of semantic + keyword hits.
create or replace function match_chunks(
  query_embedding      extensions.vector(1024),
  query_tsq            text,
  filter_jurisdictions text[] default null,
  filter_category      text   default null,
  match_count          int    default 8
)
returns table (
  chunk_id     bigint,
  document_id  bigint,
  url          text,
  title        text,
  content      text,
  page_type    text,
  jurisdiction text,
  fetched_at   timestamptz,
  score        double precision
)
language sql stable
set search_path = public, extensions
as $$
  with sem as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    where c.embedding is not null
      and (filter_jurisdictions is null or d.jurisdiction = any (filter_jurisdictions))
      and (filter_category is null or d.category = filter_category)
    order by c.embedding <=> query_embedding
    limit 40
  ),
  kw as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.tsv, q.tsq) desc) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    cross join (select to_tsquery('simple', unaccent(query_tsq)) as tsq) q
    where c.tsv @@ q.tsq
      and (filter_jurisdictions is null or d.jurisdiction = any (filter_jurisdictions))
      and (filter_category is null or d.category = filter_category)
    order by ts_rank_cd(c.tsv, q.tsq) desc
    limit 40
  ),
  fused as (
    select u.id, sum(1.0 / (60 + u.rnk)) as s
    from (select id, rnk from sem union all select id, rnk from kw) u
    group by u.id
  )
  select c.id, d.id, d.url, d.title, c.content,
         d.page_type, d.jurisdiction, d.fetched_at, f.s
  from fused f
  join chunks c on c.id = f.id
  join documents d on d.id = c.document_id
  order by f.s desc
  limit match_count;
$$;

revoke execute on function match_chunks(extensions.vector, text, text[], text, int)
  from public, anon, authenticated;

-- ------------------------------------------------------------------ seed
-- Source names must match SOURCES in pl_gov_scraper.py exactly.
insert into sources (name, base_url, kind, jurisdiction) values
  ('gov.pl',      'https://www.gov.pl',                 'scrape', 'national'),
  ('mos',         'https://mos.cudzoziemcy.gov.pl',     'scrape', 'national'),
  ('udsc',        'https://udsc.gov.pl',                'scrape', 'national'),
  ('biznes',      'https://www.biznes.gov.pl',          'scrape', 'national'),
  ('podatki',     'https://www.podatki.gov.pl',         'scrape', 'national'),
  ('zus',         'https://www.zus.pl',                 'scrape', 'national'),
  ('nfz',         'https://www.nfz.gov.pl',             'scrape', 'national'),
  ('migrant',     'https://migrant.info.pl',            'scrape', 'national'),
  ('warsaw',      'https://um.warszawa.pl',             'scrape', 'warsaw'),
  ('warsaw19115', 'https://warszawa19115.pl',           'scrape', 'warsaw'),
  ('krakow',      'https://www.krakow.pl',              'scrape', 'krakow')
on conflict (name) do nothing;

insert into sources (name, base_url, kind, jurisdiction)
select format('krakow_district_%s', lpad(g::text, 2, '0')),
       format('https://dzielnica%s.krakow.pl', g),
       'scrape', 'krakow'
from generate_series(1, 18) as g
on conflict (name) do nothing;

insert into sources (name, base_url, kind, jurisdiction)
select 'warsaw_' || d.slug, 'https://' || d.host || '.um.warszawa.pl', 'scrape', 'warsaw'
from (values
  ('bemowo','bemowo'), ('bialoleka','bialoleka'), ('bielany','bielany'),
  ('mokotow','mokotow'), ('ochota','ochota'), ('praga_poludnie','pragapld'),
  ('praga_polnoc','pragapn'), ('rembertow','rembertow'), ('srodmiescie','srodmiescie'),
  ('targowek','targowek'), ('ursus','ursus'), ('ursynow','ursynow'),
  ('wawer','wawer'), ('wesola','wesola'), ('wilanow','wilanow'),
  ('wlochy','wlochy'), ('wola','wola'), ('zoliborz','zoliborz')
) as d(slug, host)
on conflict (name) do nothing;
