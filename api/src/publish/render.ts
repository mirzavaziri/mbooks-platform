import { pool } from '../db/pool.js';
import type { GlossaryEntry, InlineContext } from './inline.js';
import { buildNumbering, localDigits, type BlockRow, type SectionRow } from './numbering.js';
import { renderBlock, type AssetResolver } from './blocks.js';
import { renderPage, type PageFont } from './page.js';
import { renderSupportWidget, supportStyles } from './support.js';

export type PublishResult = { html: string; warnings: string[] };

function slugifyId(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

export async function renderBookToHtml(bookId: string): Promise<PublishResult> {
  const bookRes = await pool.query('select id, slug, type, title from books where id = $1 and deleted_at is null', [
    bookId,
  ]);
  const book = bookRes.rows[0];
  if (!book) throw new Error('book_not_found');

  const lang: 'en' | 'fa' = book.type === 'textbook-en' ? 'en' : 'fa';

  const settingsRes = await pool.query('select data from book_settings where book_id = $1', [bookId]);
  const settings = settingsRes.rows[0]?.data ?? {};

  const sectionsRes = await pool.query(
    `select id, chapter, title, num, "order" from sections where book_id = $1 and deleted_at is null order by "order"`,
    [bookId],
  );
  const sections: (SectionRow & { chapter: string; title: string })[] = sectionsRes.rows;

  const blocksRes = await pool.query(
    `select id, section, type, "order", fields from blocks where book_id = $1 and deleted_at is null order by "order"`,
    [bookId],
  );
  const blocksBySection = new Map<string, BlockRow[]>();
  for (const row of blocksRes.rows as BlockRow[]) {
    const list = blocksBySection.get(row.section) ?? [];
    list.push(row);
    blocksBySection.set(row.section, list);
  }

  const assetsRes = await pool.query(
    `select id, filename from assets where book_id = $1 and deleted_at is null`,
    [bookId],
  );
  const assetByBaseName = new Map<string, string>();
  for (const a of assetsRes.rows as { id: string; filename: string }[]) {
    const base = a.filename.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
    if (base) assetByBaseName.set(base, a.id);
  }
  const resolveAsset: AssetResolver = (ref) => {
    const key = ref.replace(/^local:/, '').toLowerCase();
    const id = assetByBaseName.get(key);
    return id ? { url: `/_blob/${id}` } : null;
  };

  const glossary = new Map<string, GlossaryEntry>();
  for (const g of (settings.glossary ?? []) as GlossaryEntry[] & { key: string }[]) {
    if (g && (g as any).key) glossary.set((g as any).key, g);
  }

  const numbering = buildNumbering(sections, blocksBySection, lang, settings.digits);
  const warnings: string[] = [];
  const ctx: InlineContext = { numbering, glossary, unresolvedRefs: new Set() };

  // Group sections by chapter (in document order) for both the table of
  // contents and the chapter headings in the body.
  type ChapterGroup = { chapter: string; anchor: string; numbered: boolean; sections: typeof sections };
  const chapters: ChapterGroup[] = [];
  for (const section of sections) {
    const last = chapters[chapters.length - 1];
    if (last && last.chapter === section.chapter) {
      last.sections.push(section);
      if (section.num) last.numbered = true;
    } else {
      chapters.push({ chapter: section.chapter, anchor: `ch-${slugifyId(section.chapter)}`, numbered: !!section.num, sections: [section] });
    }
  }

  const tocHtml =
    `<p><strong>${lang === 'fa' ? 'فهرست' : 'Contents'}</strong></p><ul>` +
    chapters
      .map(
        (c) =>
          `<li><a href="#${c.anchor}">${escapeHtml(c.chapter)}</a><ul>` +
          c.sections
            .map((s) => {
              const label = s.num ? `${localDigits(s.num, lang, settings.digits)} ${s.title}` : s.title;
              return `<li><a href="#sec-${s.id}">${escapeHtml(label)}</a></li>`;
            })
            .join('') +
          '</ul></li>',
      )
      .join('') +
    '</ul>';

  const bodyParts: string[] = [];
  for (const chapterGroup of chapters) {
    bodyParts.push(
      `<h1 class="unnumbered${chapterGroup.numbered ? ' chapter' : ''}" id="${chapterGroup.anchor}">${escapeHtml(chapterGroup.chapter)}</h1>`,
    );
    for (const section of chapterGroup.sections) {
      const label = section.num ? `${localDigits(section.num, lang, settings.digits)} ${section.title}` : section.title;
      bodyParts.push(`<h2 id="sec-${section.id}">${escapeHtml(label)}</h2>`);

      const blocks = (blocksBySection.get(section.id) ?? []).slice().sort((a, b) => a.order - b.order);
      for (const block of blocks) {
        try {
          bodyParts.push(renderBlock(block, { ctx, lang, resolveAsset }));
        } catch (err) {
          warnings.push(`block ${block.id} (${block.type}) failed to render: ${(err as Error).message}`);
        }
      }
    }
  }

  for (const ref of ctx.unresolvedRefs) warnings.push(`unresolved cross-reference: @${ref}`);

  const fonts: PageFont[] = [];
  for (const f of settings.fonts ?? []) {
    const url = resolveAsset(`local:${f.asset}`)?.url ?? (await resolveAssetById(f.asset));
    if (url) fonts.push({ family: f.name, url, weight: f.weight });
    else warnings.push(`font asset not found: ${f.asset}`);
  }

  // The financial-support widget goes on every published book regardless
  // of its own language/direction - this is arith.land's own voice, not
  // part of the book's running text. Placed right after the table of
  // contents (unshift, not push): a book can be hundreds of pages long
  // in one scrolling document, so appending it at the very end meant
  // almost no reader ever scrolled far enough to see it.
  bodyParts.unshift(`<style>${supportStyles()}</style>`, renderSupportWidget(book.slug));

  const html = renderPage(
    {
      lang,
      direction: lang === 'fa' ? 'rtl' : 'ltr',
      title: settings.title ?? book.title,
      subtitle: settings.subtitle,
      authors: settings.authors ?? [],
      fonts,
      bodyFont: settings.bodyFont,
      headingFont: settings.headingFont,
    },
    tocHtml,
    bodyParts.join('\n'),
    '',
  );

  return { html, warnings };
}

// Fonts are referenced by bare asset id (not "local:name"), unlike figures.
async function resolveAssetById(assetId: string): Promise<string | null> {
  const res = await pool.query('select id from assets where id = $1 and deleted_at is null', [assetId]);
  return res.rows[0] ? `/_blob/${assetId}` : null;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
