// Server-side publish without a browser session, the same steps as
// POST /api/books/:bookId/publish (routes/publish.ts):
//   node dist/publish-cli.js <slug> [<slug> ...]     or   --all-public
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db/pool.js';
import { renderBookToHtml } from './publish/render.js';

const PUBLISH_DIR = process.env.MBOOKS_PUBLISH_DIR ?? '/published';

async function main() {
  const args = process.argv.slice(2);
  const { rows } = args.includes('--all-public')
    ? await pool.query(
        `select b.id, b.slug from books b where b.deleted_at is null and b.visibility = 'public'
           and exists (select 1 from published_versions pv where pv.book_id = b.id and pv.status = 'success')`,
      )
    : await pool.query('select id, slug from books where deleted_at is null and slug = any($1)', [args]);
  if (!rows.length) {
    console.error('no matching books');
    process.exit(1);
  }
  for (const { id, slug } of rows) {
    const v = await pool.query(
      `insert into published_versions (book_id, label, status) values ($1, $2, 'building') returning id`,
      [id, new Date().toISOString()],
    );
    try {
      const { html, warnings } = await renderBookToHtml(id);
      mkdirSync(join(PUBLISH_DIR, slug), { recursive: true });
      writeFileSync(join(PUBLISH_DIR, slug, 'index.html'), html, 'utf8');
      await pool.query(`update published_versions set status='success', build_log=$1, finished_at=now() where id=$2`, [
        warnings.join('\n'),
        v.rows[0].id,
      ]);
      console.log(`published ${slug}${warnings.length ? `, warnings:\n  ${warnings.join('\n  ')}` : ''}`);
    } catch (err) {
      await pool.query(`update published_versions set status='failed', build_log=$1, finished_at=now() where id=$2`, [
        (err as Error).message,
        v.rows[0].id,
      ]);
      console.error(`failed ${slug}:`, err);
    }
  }
  await pool.end();
}
main();
