import { renderBody, renderInline, type InlineContext } from './inline.js';
import { ENV_TYPES, localDigits } from './numbering.js';

export type AssetResolver = (ref: string) => { url: string } | null;

export type RenderDeps = {
  ctx: InlineContext;
  lang: 'en' | 'fa';
  resolveAsset: AssetResolver;
  digits?: string; // book_settings.digits: 'latin' keeps Latin digits in a fa book
};

const EX_TAG_LABEL: Record<'en' | 'fa', Record<string, string>> = {
  en: {
    pure: 'Pure',
    omath: 'Math Olympiad',
    oinf: 'Informatics Olympiad',
    algorithm: 'Algorithm',
    code: 'Code',
    cs: 'Computer Science',
    research: 'Research Project',
  },
  fa: {
    pure: 'محض',
    omath: 'المپیاد ریاضی',
    oinf: 'المپیاد کامپیوتر',
    algorithm: 'الگوریتم',
    code: 'برنامه‌نویسی',
    cs: 'علوم کامپیوتر',
    research: 'پروژه‌ی پژوهشی',
  },
};

const HINT_WORD: Record<'en' | 'fa', string> = { en: 'Hint', fa: 'راهنمایی' };
const SOLUTION_WORD: Record<'en' | 'fa', string> = { en: 'Solution', fa: 'پاسخ تشریحی' };
const PROOF_WORD: Record<'en' | 'fa', string> = { en: 'Proof', fa: 'اثبات' };
const PROOF_OF_WORD: Record<'en' | 'fa', string> = { en: 'Proof of', fa: 'اثبات' };
const CHECK_BUTTON: Record<'en' | 'fa', string> = { en: 'Check', fa: 'بررسی' };
const CORRECT_WORD: Record<'en' | 'fa', string> = { en: 'Correct.', fa: 'درست است.' };
const INCORRECT_WORD: Record<'en' | 'fa', string> = {
  en: 'Not yet. The hints above may help.',
  fa: 'هنوز نه. راهنمایی‌های بالا ممکن است کمک کنند.',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

function base64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

export function renderBlock(block: { id: string; type: string; fields: any }, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  const f = block.fields ?? {};

  if (ENV_TYPES.has(block.type)) {
    const entry = ctx.numbering.get(`__block-${block.id}`);
    const display = entry?.display ?? block.type;
    const anchorId = entry?.anchorId ?? `env-${block.id}`;
    const titled = f.title ? `${display} (${renderInline(f.title, ctx)})` : display;
    const paragraphs = renderBody(f.body ?? '', ctx);
    const withLead = withEndMark(leadParagraphWith(paragraphs, `<strong>${titled}.</strong> `), END_MARK[block.type]);
    return `<div id="${anchorId}" class="env env-${block.type}">\n${withLead}\n</div>`;
  }

  switch (block.type) {
    case 'paragraph':
      return renderBody(f.text ?? '', ctx);

    case 'heading': {
      const title = f.title ?? '';
      return `<h3 class="unnumbered" id="${slugify(title)}-${block.id.slice(0, 6)}">${renderInline(title, ctx)}</h3>`;
    }

    case 'proof': {
      const of = f.of as string | undefined;
      const target = of ? ctx.numbering.get(of) : undefined;
      // fields.heading is the studio's own "Heading (optional)" field, e.g.
      // «حل» for the solution of an example, or "Second proof".
      const word = f.heading ? renderInline(f.heading, ctx) : PROOF_WORD[lang];
      const lead = target
        ? `<em>${f.heading ? word : PROOF_OF_WORD[lang]} <a href="#${target.anchorId}">${target.display}</a>.</em> `
        : `<em>${word}.</em> `;
      const paragraphs = renderBody(f.body ?? '', ctx);
      return `<div class="proofblock">\n${withEndMark(leadParagraphWith(paragraphs, lead), '■')}\n</div>`;
    }

    case 'exercise':
      return renderExercise(block.id, f, deps);

    case 'code': {
      const lang2 = f.lang ?? 'text';
      const runnable = f.runnable ? ' runnable' : '';
      return `<pre class="${escapeAttr(lang2)}${runnable}"><code>${escapeHtml(f.code ?? '')}</code></pre>`;
    }

    case 'lab':
      return renderLab(f, lang);

    case 'figure':
      return renderFigure(f, deps);

    case 'person':
    case 'history':
    case 'quote':
    case 'aside':
      return renderMarginNote(block.type, f, deps);

    case 'thread':
      return renderThreadBox(f, deps);

    case 'authors':
      return renderAuthorsBox(f, deps);

    case 'proofs':
      return renderProofsBox(f, deps);

    default:
      return `<!-- unrecognized block type: ${escapeAttr(block.type)} -->`;
  }
}

// End-of-block marks, the same ones the studio preview draws: definition
// ♣, example ♠, remark ♦, principle ■, and ■ at the end of a proof.
// Authors never type them (see docs/author-guide.md).
const END_MARK: Record<string, string | undefined> = {
  definition: '♣',
  example: '♠',
  remark: '♦',
  principle: '■',
};

// Puts the mark at the end of the block's last line (inside its last
// paragraph, floated to the line's end), or on its own line when the block
// ends with a list or table instead of a paragraph.
function withEndMark(html: string, mark: string | undefined): string {
  if (!mark) return html;
  const span = `<span class="endmark" aria-hidden="true">${mark}</span>`;
  const trimmed = html.trimEnd();
  if (trimmed.endsWith('</p>')) return trimmed.slice(0, -'</p>'.length) + span + '</p>';
  return `${trimmed}\n<p class="endmark-line">${span}</p>`;
}

// Inserts `lead` (an inline HTML fragment, e.g. "<strong>Theorem 1.1.5.</strong> ")
// at the very start of the first rendered paragraph's text, rather than
// before the opening <p> tag, so it reads as part of that paragraph.
function leadParagraphWith(paragraphsHtml: string, lead: string): string {
  if (!paragraphsHtml.startsWith('<p>')) return `<p>${lead}</p>\n${paragraphsHtml}`;
  return '<p>' + lead + paragraphsHtml.slice('<p>'.length);
}

function renderExercise(blockId: string, f: any, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  const entry = ctx.numbering.get(`__block-${blockId}`);
  const display = entry?.display ?? (lang === 'fa' ? 'تمرین' : 'Exercise');
  const anchorId = entry?.anchorId ?? `ex-${blockId}`;

  const tags: string[] = Array.isArray(f.tags) ? f.tags : [];
  const tagSpans = tags
    .map((t) => `<span class="ex-tag ex-tag-${escapeAttr(t)}">${EX_TAG_LABEL[lang][t] ?? t}</span>`)
    .join(' ');

  const bodyHtml = renderBody(f.body ?? '', ctx);
  const leadHtml = leadParagraphWith(bodyHtml, `<strong>${display}</strong> ${tagSpans}`.trim() + ' ');

  const hints: string[] = (f.hints ?? '')
    .split(/\n-{3,}\n/)
    .map((h: string) => h.trim())
    .filter(Boolean);
  const hintsHtml = hints
    .map(
      (h, i) =>
        `<details class="reveal"><summary>${HINT_WORD[lang]} ${localDigits(String(i + 1), lang, deps.digits)}</summary><div class="reveal-body">${renderBody(h, ctx)}</div></details>`,
    )
    .join('\n');

  const solutionHtml = f.solution
    ? `<details class="reveal"><summary>${SOLUTION_WORD[lang]}</summary><div class="reveal-body">${renderBody(f.solution, ctx)}</div></details>`
    : '';

  const checkForm =
    f.answer && String(f.answer).trim() !== ''
      ? `<form class="check" data-a="${base64(String(f.answer))}" data-tol="${escapeAttr(String(f.tol ?? '0'))}"><label for="chk-${blockId}">${renderInline(f.prompt ?? '', ctx)}</label><input id="chk-${blockId}" inputmode="decimal" autocomplete="off"><button type="submit">${CHECK_BUTTON[lang]}</button><output aria-live="polite" data-ok="${escapeAttr(CORRECT_WORD[lang])}" data-no="${escapeAttr(INCORRECT_WORD[lang])}"></output></form>`
      : '';

  return `<div id="${anchorId}" class="exercise">\n${leadHtml}\n${hintsHtml}\n${solutionHtml}\n${checkForm}\n</div>`;
}

function renderLab(f: any, lang: 'en' | 'fa'): string {
  // Generic labs render as a plain description box; a genuinely
  // interactive one needs bespoke HTML/JS (see the author guide) stored
  // in fields.html and is emitted verbatim instead.
  if (f.html) return f.html;
  const kicker = lang === 'fa' ? 'آزمایشگاه تعاملی' : 'Interactive lab';
  return `<div class="lab"><div class="lab-head"><span class="lab-kicker">${kicker}</span><h3>${escapeHtml(f.title ?? '')}</h3></div><p>${escapeHtml(f.body ?? '')}</p></div>`;
}

function renderFigure(f: any, deps: RenderDeps): string {
  const asset = f.image ? deps.resolveAsset(f.image) : null;
  const caption = f.caption ? `<p>${renderInline(f.caption, deps.ctx)}</p>` : '';
  if (!asset) {
    const label = deps.lang === 'fa' ? 'تصویر هنوز بارگذاری نشده است' : 'Image not yet uploaded';
    return `<div class="bookfig"><div style="border:1px dashed var(--rule);padding:2rem;text-align:center;color:var(--ink-2)">${escapeHtml(label)}: ${escapeAttr(f.image ?? '')}</div>${caption}</div>`;
  }
  return `<div class="bookfig"><img src="${escapeAttr(asset.url)}" alt="${escapeAttr(f.alt ?? '')}">${caption}</div>`;
}

function renderMarginNote(type: string, f: any, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  let inner = '';
  if (type === 'person') {
    inner = `<p><strong>${renderInline(f.name ?? '', ctx)}</strong>${f.years ? ` (${escapeHtml(f.years)})` : ''}</p>`;
    if (f.bio) inner += `<p>${renderInline(f.bio, ctx)}</p>`;
    if (f.quote) {
      inner += `<blockquote><p>${renderInline(f.quote, ctx)}</p>${f.qsource ? `<p>${escapeHtml(f.qsource)}</p>` : ''}</blockquote>`;
    }
  } else if (type === 'history') {
    inner = `<p>${renderInline(f.body ?? '', ctx)}</p>`;
  } else if (type === 'quote') {
    const byline = [f.author, f.source].filter(Boolean).join(', ');
    inner = `<blockquote><p>${renderInline(f.text ?? '', ctx)}</p>${byline ? `<p>${escapeHtml(byline)}</p>` : ''}</blockquote>`;
  } else {
    // aside (Persian): a main note, plus optional "why"/"more" asides
    // each behind their own small reveal.
    inner = `<p>${renderInline(f.body ?? '', ctx)}</p>`;
    if (f.why) {
      const label = f.why_label || (lang === 'fa' ? 'چرا؟' : 'Why?');
      inner += `<details class="reveal"><summary>${escapeHtml(label)}</summary><div class="reveal-body"><p>${renderInline(f.why, ctx)}</p></div></details>`;
    }
    if (f.more) {
      const label = f.more_label || (lang === 'fa' ? 'بیشتر بدانید' : 'Learn more');
      inner += `<details class="reveal"><summary>${escapeHtml(label)}</summary><div class="reveal-body"><p>${renderInline(f.more, ctx)}</p></div></details>`;
    }
  }
  return `<div class="column-margin"><div class="mnote ${type}">${inner}</div></div>`;
}

function renderThreadBox(f: any, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  const kicker = lang === 'fa' ? 'رشته‌ی پژوهشی' : 'Research thread';
  const title = f.title ? ` · ${escapeHtml(f.title)}` : '';
  const reading = f.reading ? `<p><em>${lang === 'fa' ? 'مطالعه‌ی بیشتر' : 'Reading'}:</em> ${renderInline(f.reading, ctx)}</p>` : '';
  return `<div class="box box-thread"><div class="box-title">${kicker}${title}</div><p>${renderInline(f.body ?? '', ctx)}</p>${reading}</div>`;
}

function renderAuthorsBox(f: any, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  const kicker = lang === 'fa' ? 'پژوهش ما' : 'Our own work';
  const status = f.status ? ` · ${escapeHtml(f.status)}` : '';
  const paper = f.paper ? `<p><em>${renderInline(f.paper, ctx)}</em></p>` : '';
  return `<div class="box box-authors"><div class="box-title">${kicker}${status}</div>${paper}<p>${renderInline(f.body ?? '', ctx)}</p></div>`;
}

function renderProofsBox(f: any, deps: RenderDeps): string {
  const { ctx, lang } = deps;
  const kicker = lang === 'fa' ? 'مسیر اثبات' : 'Proof roadmap';
  return `<div class="box box-proofs"><div class="box-title">${kicker}</div><p>${renderInline(f.body ?? '', ctx)}</p></div>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
