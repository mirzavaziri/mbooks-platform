-- Financial-support ("buy us a tea/coffee") payments through ZarinPal.
-- Deliberately independent of books/users - a donation is anonymous and
-- is not tied to the bazaar wallet/transaction system at all, even
-- though it shares bazaar's own ZarinPal merchant account.
create table donations (
  id uuid primary key default gen_random_uuid(),
  book_slug text,
  amount_toman integer not null check (amount_toman > 0),
  authority text unique,
  ref_id text,
  card_pan text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index donations_authority_index on donations(authority);
