import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import compress from '@fastify/compress';

import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import adapterRoutes from './routes/adapter.js';
import assetRoutes from './routes/assets.js';
import adminRoutes from './routes/admin.js';
import publishRoutes from './routes/publish.js';
import donateRoutes from './routes/donate.js';
import { currentUser, roleInBook } from './lib/auth.js';
import { pool } from './db/pool.js';
import { FA_FONTS_CSS } from './publish/page.js';

const here = dirname(fileURLToPath(import.meta.url));
const studioDir = process.env.MBOOKS_STUDIO_DIR ?? join(here, '..', '..', 'studio');

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cookie);
await app.register(cors, { origin: false });
await app.register(compress, { global: true, threshold: 512 });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

await app.register(authRoutes);
await app.register(bookRoutes);
await app.register(adapterRoutes);
await app.register(assetRoutes);
await app.register(adminRoutes);
await app.register(publishRoutes);
await app.register(donateRoutes);

app.get('/healthz', async () => ({ ok: true }));

// ---- HTML pages (login / library / the studio itself) ----
const loginHtml = readFileSync(join(studioDir, 'login.html'), 'utf8');
const libraryHtml = readFileSync(join(studioDir, 'library.html'), 'utf8');
const peopleTemplate = readFileSync(join(studioDir, 'people.html'), 'utf8');
const studioTemplate = readFileSync(join(studioDir, 'studio.html'), 'utf8');
const adapterJs = readFileSync(join(studioDir, 'adapter.js'), 'utf8');
const adapterJsGz = gzipSync(adapterJs, { level: 9 });
const STUDIO_ANCHOR = '<script src="/vendor/mathjax-tex-svg.js" async></script>\n<script>';

const HTML = 'text/html; charset=utf-8';

app.get('/login', async (_request, reply) => reply.type(HTML).send(loginHtml));

// nginx auth_request target for the published reader pages (static files
// under /var/www/mbooks/<slug>/, see nginx/mbooks.conf in the
// EducationMarket repo). nginx passes the requested path in
// X-Original-URI; 204 lets the static file through, 401 makes nginx send
// the visitor to /login?next=..., 403 means signed in but not a member.
// Public and unlisted books are open to everyone; private ones only to
// their members and admins. Paths that are not a book's folder are
// allowed (nginx then serves them or 404s as before).
app.get('/_access', async (request, reply) => {
  const uri = String(request.headers['x-original-uri'] ?? '');
  const slug = decodeURIComponent(uri.split('?')[0].split('/')[1] ?? '');
  if (!slug) return reply.code(204).send();
  const { rows } = await pool.query('select id, visibility from books where slug = $1 and deleted_at is null', [slug]);
  const book = rows[0];
  if (!book || book.visibility !== 'private') return reply.code(204).send();
  const user = await currentUser(request);
  if (!user) return reply.code(401).send();
  const role = await roleInBook(user.id, book.id);
  return reply.code(role ? 204 : 403).send();
});

// The public catalog of every published book - what a plain visit to
// mbooks.arith.land now shows, replacing the old hardcoded redirect to
// one specific book (nginx/mbooks.conf in the EducationMarket repo used
// to `return 302 /counting-in-graphs/` straight from nginx, before this
// route ever existed to redirect to instead).
app.get('/', async (_request, reply) => {
  const { rows } = await pool.query(
    `select b.slug, b.type, coalesce(bs.data->>'title', b.title) as title, bs.data->>'subtitle' as subtitle
       from books b
       join book_settings bs on bs.book_id = b.id
      where b.visibility = 'public' and b.deleted_at is null
        and exists (select 1 from published_versions pv where pv.book_id = b.id and pv.status = 'success')
      order by b.updated_at desc`,
  );

  const TYPE_LABEL: Record<string, string> = {
    'textbook-fa': 'کتاب درسی فارسی',
    'textbook-en': 'English textbook',
    'fiction-fa': 'داستان فارسی',
  };

  const cards = rows
    .map(
      (b) => `
    <a class="card" href="/${b.slug}/">
      <h2>${escapeHtmlPage(b.title)}</h2>
      ${b.subtitle ? `<p class="subtitle">${escapeHtmlPage(b.subtitle)}</p>` : ''}
      <span class="type">${TYPE_LABEL[b.type] ?? b.type}</span>
    </a>`,
    )
    .join('\n');

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ام‌بوک‌ها</title>
<style>
  :root{ color-scheme: light dark; --paper:#f7f8f6; --sheet:#fdfdfb; --ink:#1f2a44; --ink-2:#4a5570; --rule:#d9ddd8; --moss:#2f6b5a; }
  @media (prefers-color-scheme: dark){ :root{ --paper:#11151d; --sheet:#161b25; --ink:#e3e6ec; --ink-2:#a9b1c2; --rule:#2c3442; --moss:#7fc2ab; } }
  ${FA_FONTS_CSS}
  body{ font-family: "Yekan Bakh", "Vazirmatn", Tahoma, sans-serif; background:var(--paper); color:var(--ink); margin:0; padding:2rem 1.2rem; }
  .wrap{ max-width:46rem; margin:0 auto; }
  h1, .card h2{ font-family: "Kamand", "Yekan Bakh", Tahoma, sans-serif; }
  h1{ font-size:1.7rem; margin:0 0 .3rem }
  .lede{ color:var(--ink-2); margin:0 0 2rem; font-size:.95rem }
  .grid{ display:grid; gap:1rem; grid-template-columns:repeat(auto-fill, minmax(14rem, 1fr)); }
  .card{ display:block; background:var(--sheet); border:1px solid var(--rule); border-radius:10px; padding:1.1rem 1.2rem; text-decoration:none; color:inherit; }
  .card h2{ font-size:1.1rem; margin:0 0 .3rem }
  .card .subtitle{ font-size:.85rem; color:var(--ink-2); margin:0 0 .6rem }
  .card .type{ font-size:.78rem; color:var(--moss); }
  .empty{ color:var(--ink-2) }
</style></head><body>
<div class="wrap">
  <h1>ام‌بوک‌ها</h1>
  <p class="lede">کتاب‌هایی از آریث‌لند که برای خواندن آزادند.</p>
  <div class="grid">${cards || '<p class="empty">هنوز کتابی منتشر نشده است.</p>'}</div>
</div>
</body></html>`;

  return reply.type(HTML).send(html);
});

function escapeHtmlPage(s: string | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

app.get('/library', async (request, reply) => {
  const user = await currentUser(request);
  if (!user) return reply.redirect('/login');
  return reply.type(HTML).send(libraryHtml);
});

app.get<{ Params: { bookId: string } }>('/book/:bookId', async (request, reply) => {
  const user = await currentUser(request);
  if (!user) return reply.redirect('/login');
  const role = await roleInBook(user.id, request.params.bookId);
  if (!role) return reply.code(404).type(HTML).send('<p>Book not found, or you are not a member of it.</p>');

  // Starts by putting back the exact text STUDIO_ANCHOR matches (the
  // MathJax <script> tag + the next tag's opening) - a plain
  // .replace(STUDIO_ANCHOR, bootstrap) without this silently dropped the
  // MathJax <script src> tag itself (it's inside the matched anchor),
  // leaving window.MathJax as just the inline config object with no
  // typesetPromise ever defined - every formula on every page rendered
  // as raw, un-typeset $...$ text, with no console error anywhere to
  // point at it (confirmed in production 2026-10-21 via a headless
  // Chromium check: window.MathJax existed, window.MathJax.typesetPromise
  // did not, and the vendor script tag was simply missing from the DOM).
  const bootstrap = `${STUDIO_ANCHOR}
    window.__MBOOK_ID__=${JSON.stringify(request.params.bookId)};
    window.__MBOOK_USER__=${JSON.stringify({ id: user.id, name: user.name, color: user.color, role })};
  </script>
  <script src="/adapter.js"></script>
  <script>`;

  if (!studioTemplate.includes(STUDIO_ANCHOR)) {
    app.log.error('studio.html anchor not found; adapter bootstrap was not injected');
    return reply.code(500).send('studio template misconfigured');
  }

  const html = studioTemplate.replace(STUDIO_ANCHOR, bootstrap);
  return reply.type(HTML).send(html);
});

app.get<{ Params: { bookId: string } }>('/book/:bookId/people', async (request, reply) => {
  const user = await currentUser(request);
  if (!user) return reply.redirect('/login');
  const role = await roleInBook(user.id, request.params.bookId);
  if (!role) return reply.code(404).type(HTML).send('<p>Book not found, or you are not a member of it.</p>');

  const bootstrap = `<script>window.__MBOOK_ID__=${JSON.stringify(request.params.bookId)};window.__MBOOK_ROLE__=${JSON.stringify(role)};</script>`;
  return reply.type(HTML).send(peopleTemplate.replace('<script>', bootstrap + '\n<script>'));
});

app.get('/adapter.js', async (request, reply) => {
  reply.type('application/javascript; charset=utf-8');
  if (acceptsGzip(request)) {
    reply.header('content-encoding', 'gzip');
    return reply.send(adapterJsGz);
  }
  return reply.send(adapterJs);
});

// Pre-gzipped once at startup: these never change at runtime, and the
// Arvan<->Germany link (an SSH tunnel) is slow enough that shipping the
// ~2MB MathJax bundle uncompressed made it the dominant cost of opening
// the studio. nginx also proxy_caches these paths (see nginx/mbooks.conf
// in the arithland repo), so in practice this tunnel is only hit once.
const vendorFiles = new Map(
  ['marked.min.js', 'purify.min.js', 'mathjax-tex-svg.js'].map((name) => {
    const raw = readFileSync(join(studioDir, 'vendor', name));
    return [name, { raw, gz: gzipSync(raw, { level: 9 }) }] as const;
  }),
);
app.get<{ Params: { name: string } }>('/vendor/:name', async (request, reply) => {
  const file = vendorFiles.get(request.params.name);
  if (!file) return reply.code(404).send();
  reply.header('cache-control', 'public, max-age=31536000, immutable');
  reply.type('application/javascript; charset=utf-8');
  if (acceptsGzip(request)) {
    reply.header('content-encoding', 'gzip');
    return reply.send(file.gz);
  }
  return reply.send(file.raw);
});

function acceptsGzip(request: { headers: Record<string, unknown> }): boolean {
  const h = request.headers['accept-encoding'];
  return typeof h === 'string' && h.includes('gzip');
}

const port = Number(process.env.PORT ?? 3300);
const host = process.env.HOST ?? '0.0.0.0';
app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
