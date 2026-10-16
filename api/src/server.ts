import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';

import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import adapterRoutes from './routes/adapter.js';
import assetRoutes from './routes/assets.js';
import adminRoutes from './routes/admin.js';
import { currentUser, roleInBook } from './lib/auth.js';
import { pool } from './db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const studioDir = process.env.MBOOKS_STUDIO_DIR ?? join(here, '..', '..', 'studio');

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cookie);
await app.register(cors, { origin: false });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

await app.register(authRoutes);
await app.register(bookRoutes);
await app.register(adapterRoutes);
await app.register(assetRoutes);
await app.register(adminRoutes);

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

app.get('/', async (request, reply) => {
  const user = await currentUser(request);
  if (!user) return reply.redirect('/login');
  return reply.redirect('/library');
});

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

  const bootstrap = `<script>
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
