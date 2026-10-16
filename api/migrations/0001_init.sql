-- Core schema for the m-book platform.
-- ids for sections/blocks are the human-chosen text ids already used by the
-- artifact-era studio exports (e.g. "c3-02", "c3-02-017"); keep them as text.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  avatar_url text,
  color text not null default '#888888',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_index on sessions(user_id);

-- One-time links used instead of real e-mail (no SMTP configured yet):
-- platform invite, password reset, and per-book invite all share this table.
create table auth_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  kind text not null check (kind in ('invite_platform', 'reset_password', 'invite_book')),
  email text,
  user_id uuid references users(id) on delete cascade,
  book_id uuid,
  role text check (role in ('owner', 'author', 'editor', 'reviewer')),
  created_by uuid references users(id),
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table books (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  type text not null check (type in ('textbook-en', 'textbook-fa', 'fiction-fa')),
  title text not null default '',
  visibility text not null default 'private' check (visibility in ('public', 'unlisted', 'private')),
  authors_can_publish boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table book_members (
  book_id uuid not null references books(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'author', 'editor', 'reviewer')),
  created_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

-- settings/book is a single JSON document per book (fonts, authors, cover, ...).
create table book_settings (
  book_id uuid primary key references books(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create table sections (
  book_id uuid not null references books(id) on delete cascade,
  id text not null,
  chapter text not null default '',
  title text not null default '',
  num text not null default '',
  "order" bigint not null default 0,
  status text not null default 'draft',
  notes text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  primary key (book_id, id)
);
create index sections_book_order_index on sections(book_id, "order");

create table blocks (
  book_id uuid not null references books(id) on delete cascade,
  id text not null,
  section text not null default '',
  type text not null default 'paragraph',
  "order" bigint not null default 0,
  fields jsonb not null default '{}'::jsonb,
  voice jsonb,
  style jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  primary key (book_id, id)
);
create index blocks_book_section_index on blocks(book_id, section);
create index blocks_book_order_index on blocks(book_id, "order");

create table block_history (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  block_id text not null,
  section text,
  type text,
  "order" bigint,
  fields jsonb,
  voice jsonb,
  style jsonb,
  version integer not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);
create index block_history_book_block_index on block_history(book_id, block_id, changed_at desc);

create table comments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  block_id text not null,
  author_id uuid references users(id),
  text text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_book_block_index on comments(book_id, block_id);

create table assets (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  filename text not null default '',
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null default 0,
  storage_path text not null,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index assets_book_id_index on assets(book_id);

create table published_versions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  label text not null,
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending', 'building', 'success', 'failed')),
  build_log text not null default '',
  published_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index published_versions_book_id_index on published_versions(book_id, created_at desc);
