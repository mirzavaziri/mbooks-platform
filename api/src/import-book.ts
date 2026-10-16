// One-time (but safely re-runnable) importer: reads a studio export folder
// (sections/*.json, blocks/*.json, settings/book.json) as described in
// MBOOKS_PLATFORM.md §7 and creates/updates a book from it.
//
// usage:
//   node dist/import-book.js --slug shomordaniha --type textbook-fa \
//     --data /path/to/data/shomordaniha --owner-email you@example.com \
//     [--fonts /path/to/current/fonts] [--covers /path/to/current/covers]
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pool } from './db/pool.js';

type Args = Record<string, string>;

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

// weight -> filename-suffix convention for the two font families used so
// far; extend this table (or pass richer metadata) if a third family shows up.
const FONT_FILE_CONVENTIONS: Record<string, Record<number, string>> = {
  'Yekan Bakh Fanum': { 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 700: 'Bold', 900: 'Heavy' },
  Kamand: { 300: 'Light', 400: 'Regular', 500: 'Medium', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' },
};

function fontFilenameFor(family: string, weight: number, fontsDir: string): string | null {
  const convention = FONT_FILE_CONVENTIONS[family];
  const suffix = convention?.[weight];
  if (!suffix) return null;
  const wanted = (family.replace(/\s+/g, '') + '-' + suffix + '.woff2').toLowerCase();
  const match = readdirSync(fontsDir).find((f) => f.toLowerCase() === wanted);
  return match ? join(fontsDir, match) : null;
}

const DATA_DIR = process.env.MBOOKS_DATA_DIR ?? '/data/mbooks';

async function importAsset(bookId: string, sourcePath: string, uploadedBy: string | null): Promise<string> {
  const filename = sourcePath.split('/').pop()!;
  // Re-running the importer should not pile up duplicate copies of the same
  // vendored font/cover file; reuse the asset row created by a prior run.
  const existing = await pool.query(
    `select id from assets where book_id = $1 and filename = $2 and deleted_at is null order by created_at asc limit 1`,
    [bookId, filename],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const id = randomUUID();
  const dir = join(DATA_DIR, 'books', bookId, 'assets');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, id + extname(sourcePath));
  copyFileSync(sourcePath, dest);
  const size = readFileSync(sourcePath).length;
  await pool.query(
    `insert into assets (id, book_id, filename, content_type, byte_size, storage_path, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, bookId, filename, guessContentType(sourcePath), size, dest, uploadedBy],
  );
  return id;
}

function guessContentType(path: string): string {
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function main() {
  const args = parseArgs();
  const { slug, type, data: dataDir, 'owner-email': ownerEmail, fonts: fontsDir, covers: coversDir } = args;
  if (!slug || !type || !dataDir || !ownerEmail) {
    console.error(
      'usage: import-book.js --slug <slug> --type <textbook-fa|textbook-en|fiction-fa> --data <export dir> --owner-email <email> [--fonts <dir>] [--covers <dir>]',
    );
    process.exit(1);
  }

  const owner = await pool.query('select id from users where email = $1', [ownerEmail.toLowerCase()]);
  if (!owner.rows[0]) {
    console.error(`no user with email ${ownerEmail}; seed it first (seed-admin.js) or create it in the app.`);
    process.exit(1);
  }
  const ownerId = owner.rows[0].id;

  const book = await pool.query(
    `insert into books (slug, type, created_by) values ($1, $2, $3)
     on conflict (slug) do update set type = excluded.type
     returning id`,
    [slug, type, ownerId],
  );
  const bookId = book.rows[0].id;

  await pool.query(
    `insert into book_members (book_id, user_id, role) values ($1, $2, 'owner')
     on conflict (book_id, user_id) do nothing`,
    [bookId, ownerId],
  );

  // ---- settings/book ----
  const settingsPath = join(dataDir, 'settings', 'book.json');
  let settings: any = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8'))
    : slug === 'counting-in-graphs'
      ? { title: 'Counting in Graphs', subtitle: 'A Short Path to Enumerative Graph Theory', authors: ['Madjid Mirzavaziri', 'Daniel Yaqubi'], lang: 'en', direction: 'ltr' }
      : {};

  const unresolved: string[] = [];

  if (settings.cover && coversDir && existsSync(coversDir)) {
    const files = readdirSync(coversDir);
    if (files.length === 1) {
      const newId = await importAsset(bookId, join(coversDir, files[0]), ownerId);
      settings.cover = newId;
    } else {
      unresolved.push(`settings.cover (${settings.cover}): expected exactly 1 file in ${coversDir}, found ${files.length}`);
    }
  } else if (settings.cover) {
    unresolved.push(`settings.cover (${settings.cover}): no covers dir given`);
  }

  if (Array.isArray(settings.fonts) && fontsDir && existsSync(fontsDir)) {
    for (const font of settings.fonts) {
      const file = fontFilenameFor(font.name, Number(font.weight), fontsDir);
      if (file) {
        font.asset = await importAsset(bookId, file, ownerId);
      } else {
        unresolved.push(`settings.fonts[] ${font.name} weight ${font.weight} (${font.asset}): no matching file in ${fontsDir}`);
      }
    }
  }

  await pool.query(
    `insert into book_settings (book_id, data, updated_by) values ($1, $2, $3)
     on conflict (book_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now()`,
    [bookId, settings, ownerId],
  );
  if (settings.title) {
    await pool.query('update books set title = $1 where id = $2', [settings.title, bookId]);
  }

  // ---- sections ----
  const sectionsDir = join(dataDir, 'sections');
  let sectionCount = 0;
  if (existsSync(sectionsDir)) {
    for (const file of readdirSync(sectionsDir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      const d = JSON.parse(readFileSync(join(sectionsDir, file), 'utf8'));
      await pool.query(
        `insert into sections (book_id, id, chapter, title, num, "order", status, notes, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (book_id, id) do update set
           chapter = excluded.chapter, title = excluded.title, num = excluded.num, "order" = excluded.order,
           status = excluded.status, notes = excluded.notes, version = sections.version + 1,
           updated_by = excluded.updated_by, updated_at = now()`,
        [bookId, id, d.chapter ?? '', d.title ?? '', d.num ?? '', d.order ?? 0, d.status ?? 'draft', d.notes ?? '', ownerId],
      );
      sectionCount++;
    }
  }

  // ---- blocks ----
  const blocksDir = join(dataDir, 'blocks');
  let blockCount = 0;
  const blockAssetIssues: string[] = [];
  if (existsSync(blocksDir)) {
    for (const file of readdirSync(blocksDir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      const d = JSON.parse(readFileSync(join(blocksDir, file), 'utf8'));

      const image = d.fields?.image;
      if (image && !String(image).startsWith('local:')) {
        blockAssetIssues.push(`block ${id} (${d.type}, section ${d.section}): fields.image asset ${image} not in handoff package`);
      }
      if (d.voice?.asset) {
        blockAssetIssues.push(`block ${id}: voice.asset ${d.voice.asset} not in handoff package`);
      }

      await pool.query(
        `insert into blocks (book_id, id, section, type, "order", fields, voice, style, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (book_id, id) do update set
           section = excluded.section, type = excluded.type, "order" = excluded.order, fields = excluded.fields,
           voice = excluded.voice, style = excluded.style, version = blocks.version + 1,
           updated_by = excluded.updated_by, updated_at = now()`,
        [bookId, id, d.section ?? '', d.type ?? 'paragraph', d.order ?? 0, d.fields ?? {}, d.voice ?? null, d.style ?? null, ownerId],
      );
      blockCount++;
    }
  }

  console.log(`\nbook: ${slug} (${bookId})`);
  console.log(`sections imported: ${sectionCount}`);
  console.log(`blocks imported: ${blockCount}`);
  if (unresolved.length) {
    console.log(`\nunresolved settings assets (owner must re-upload and set manually in the studio):`);
    unresolved.forEach((u) => console.log('  - ' + u));
  }
  if (blockAssetIssues.length) {
    console.log(`\nunresolved block-level assets (owner must re-upload via the studio's block editor):`);
    blockAssetIssues.forEach((u) => console.log('  - ' + u));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
