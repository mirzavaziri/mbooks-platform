import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { requireUser, roleAtLeast, roleInBook } from '../lib/auth.js';
import { renderBookToHtml } from '../publish/render.js';
import { writeRobotsTxt } from '../publish/robots.js';

// Where the published static reader output is actually served from - see
// nginx/mbooks.conf (EducationMarket repo) and the publish_output bind
// mount in this repo's docker-compose.yml. Deliberately a different
// directory from MBOOKS_DATA_DIR (uploaded assets, etc.): that volume is
// private to this container, this one is nginx's own static root.
const PUBLISH_DIR = process.env.MBOOKS_PUBLISH_DIR ?? '/published';

export default async function publishRoutes(app: FastifyInstance) {
  app.post<{ Params: { bookId: string } }>('/api/books/:bookId/publish', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!roleAtLeast(role, 'author')) return reply.code(403).send({ error: 'forbidden' });

    const bookRes = await pool.query('select slug from books where id = $1 and deleted_at is null', [
      request.params.bookId,
    ]);
    const slug = bookRes.rows[0]?.slug;
    if (!slug) return reply.code(404).send({ error: 'not_found' });

    const versionRes = await pool.query(
      `insert into published_versions (book_id, label, status, published_by)
       values ($1, $2, 'building', $3) returning id`,
      [request.params.bookId, new Date().toISOString(), user.id],
    );
    const versionId = versionRes.rows[0].id;

    try {
      const { html, warnings } = await renderBookToHtml(request.params.bookId);

      const outDir = join(PUBLISH_DIR, slug);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'index.html'), html, 'utf8');
      await writeRobotsTxt(PUBLISH_DIR);

      await pool.query(
        `update published_versions set status = 'success', build_log = $1, finished_at = now() where id = $2`,
        [warnings.join('\n'), versionId],
      );

      return reply.send({ ok: true, url: `/${slug}/`, warnings });
    } catch (err) {
      await pool.query(
        `update published_versions set status = 'failed', build_log = $1, finished_at = now() where id = $2`,
        [(err as Error).message, versionId],
      );
      app.log.error(err);
      return reply.code(500).send({ error: 'publish_failed', message: (err as Error).message });
    }
  });

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/publish/history', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    const { rows } = await pool.query(
      `select id, label, status, build_log, created_at, finished_at from published_versions
        where book_id = $1 order by created_at desc limit 20`,
      [request.params.bookId],
    );
    return reply.send({ versions: rows });
  });
}
