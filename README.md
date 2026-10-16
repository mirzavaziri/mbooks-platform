# mbooks-platform

Self-hosted replacement for the claude.ai "M-book Studio" artifact: a
multi-user, multi-book editor (the same bilingual block editor used for
*Counting in Graphs* and «شمردنی‌ها را بشمار!») with per-book roles, and a
publish step that will build and serve the reader edition at
`mbooks.arith.land/<slug>/`.

See `MBOOKS_PLATFORM.md`-derived design in the handoff this repo was built
from; this README covers what exists *in this repo* today.

## Status (phase 2 of the plan: "Core")

Done:
- Postgres schema, migrations (`api/migrations`)
- Auth: password login + one-time admin-issued links for invites/password
  resets (no SMTP configured yet, so these are links an admin hands over
  manually, not emails)
- Per-book roles: owner / author / editor / reviewer
- A REST + Server-Sent-Events API (`api/src/routes/adapter.ts`) that mirrors
  the Firestore-shaped `window.claude` runtime the studio already calls
  (`db.collection(...).onSnapshot(...)`, `db.doc(...).set/update/delete`),
  with optimistic concurrency (a `version` per document, `x-doc-version`
  header, 409 on conflict)
- A browser-side adapter (`studio/adapter.js`) implementing that runtime
  against the API instead of the claude.ai artifact host
- Asset upload/serving at `/_blob/:id` (fonts, covers, images, voice notes)
- `studio/studio.html` is the existing bilingual editor with one injected
  `<script>` bootstrap; no other changes to its own logic
- `studio/login.html`, `studio/library.html`, `studio/people.html`: new
  screens for signing in, the book list, and per-book membership
- `api/src/import-book.ts`: re-runnable importer from a studio export
  folder (`sections/*.json`, `blocks/*.json`, `settings/book.json`);
  resolves font/cover assets by filename convention and reports anything
  it could not resolve instead of failing
- marked.js, DOMPurify and MathJax are vendored in `studio/vendor/` instead
  of loaded from cdnjs/jsdelivr at runtime (some Iranian networks cannot
  reach those CDNs reliably)

Not done yet:
- Publish (phase 3): the build worker that turns studio data into the
  static reader edition (port of `build-fa`/`build-en` from the handoff),
  versioned `mbooks.arith.land/<slug>/` switching, rollback
- PDF export (phase 4)
- The `fiction-fa` block types/templates (phase 5)
- Comments and block-history have API routes (`/api/books/:id/comments`,
  `/api/books/:id/blocks/:id/history`) but no studio UI yet
- Google Fonts (`fonts.googleapis.com`) is still loaded live in
  `studio.html`'s `<head>`; not yet vendored
- Backups, monitoring (phase 6)

## Running it locally

```
cd mbooks-platform
echo "POSTGRES_PASSWORD=$(openssl rand -hex 20)" > .env
docker compose up -d
docker compose exec api node dist/db/migrate.js
docker compose exec api node dist/seed-admin.js you@example.com "Your Name"
# open the printed one-time token at http://localhost:3300/login -> "one-time link"
```

Import a book from a studio export:

```
docker run --rm --network mbooks-platform_default \
  -v /path/to/export:/pkg:ro \
  -v mbooks-platform_mbooks_data:/data \
  -e DATABASE_URL="postgres://mbooks:<password>@postgres:5432/mbooks" \
  -e MBOOKS_DATA_DIR=/data \
  mbooks-platform-api node dist/import-book.js \
  --slug <slug> --type <textbook-fa|textbook-en|fiction-fa> \
  --data /pkg/data/<book> --owner-email you@example.com \
  [--fonts /pkg/current/fonts] [--covers /pkg/current/covers]
```

## Production

Runs on the Germany dev server (not Arvan — see the architecture decision
in the project chat: Arvan is already tight on disk/CPU and has a history
of disk-full incidents; the studio, API, Postgres and future build worker
run here instead, while published reader output still gets synced to and
served from Arvan). Reached from the internet through
`mbooks.arith.land` / `mbooks.arith.ir`, via an nginx proxy on Arvan
(`nginx/mbooks.conf` in the `arithland` repo) that reaches this server
through `mbooks-tunnel.service` (a local-forward autossh tunnel, restricted
to port 3300 only) on the Arvan server.
