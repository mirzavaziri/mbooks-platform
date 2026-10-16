import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { requireUser, roleAtLeast, roleInBook } from '../lib/auth.js';

const DATA_DIR = process.env.MBOOKS_DATA_DIR ?? '/data/mbooks';

function assetDir(bookId: string): string {
  const dir = join(DATA_DIR, 'books', bookId, 'assets');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromName(filename: string | undefined): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(filename ?? '');
  return m ? m[0] : '';
}

export default async function assetRoutes(app: FastifyInstance) {
  app.post<{ Params: { bookId: string } }>('/api/books/:bookId/assets', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

    const file = await (request as any).file();
    if (!file) return reply.code(400).send({ error: 'no_file' });

    const assetId = randomUUID();
    const ext = extFromName(file.filename);
    const storagePath = join(assetDir(request.params.bookId), assetId + ext);

    let byteSize = 0;
    file.file.on('data', (chunk: Buffer) => {
      byteSize += chunk.length;
    });
    await pipeline(file.file, createWriteStream(storagePath));

    await pool.query(
      `insert into assets (id, book_id, filename, content_type, byte_size, storage_path, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, request.params.bookId, file.filename ?? '', file.mimetype, byteSize, storagePath, user.id],
    );

    return reply.code(201).send({ id: assetId });
  });

  app.delete<{ Params: { bookId: string; id: string } }>('/api/books/:bookId/assets/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

    await pool.query('update assets set deleted_at = now() where id = $1 and book_id = $2', [
      request.params.id,
      request.params.bookId,
    ]);
    return reply.send({ ok: true });
  });

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/assets', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    const { rows } = await pool.query(
      `select id, filename, content_type, byte_size, created_at from assets
        where book_id = $1 and deleted_at is null order by created_at desc`,
      [request.params.bookId],
    );
    return reply.send({ assets: rows });
  });

  // Direct blob fetch; bookId is not known from the URL alone (fonts/images
  // are referenced by bare asset id throughout the studio), so look it up
  // and check membership from the asset row itself.
  app.get<{ Params: { assetId: string } }>('/_blob/:assetId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { rows } = await pool.query(
      'select book_id, storage_path, content_type, filename from assets where id = $1 and deleted_at is null',
      [request.params.assetId],
    );
    const asset = rows[0];
    if (!asset) return reply.code(404).send({ error: 'not_found' });

    const role = await roleInBook(user.id, asset.book_id);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    if (!existsSync(asset.storage_path)) return reply.code(404).send({ error: 'file_missing' });

    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.type(asset.content_type || 'application/octet-stream').send(createReadStream(asset.storage_path));
  });
}
