// A deliberately small markdown-ish subset for block `body`/`text` fields,
// matching the syntax already used in the two imported books (see the
// author guide: this is the format new authors write in too):
//   **bold**, *italic*, $inline math$, $$display math$$,
//   [term]{.gls key=glossary-key}, @label (cross-reference),
//   "a. "/"1. " consecutive lines -> an ordered list, "- " -> unordered.
// Not a general markdown engine - anything outside this list is escaped
// and shown literally rather than silently mis-rendered.

export type NumberingEntry = { kind: string; display: string; anchorId: string };
export type GlossaryEntry = { term: string; def: string; wiki?: string; mathworld?: string };

export type InlineContext = {
  numbering: Map<string, NumberingEntry>;
  glossary: Map<string, GlossaryEntry>;
  unresolvedRefs: Set<string>;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Splits on $$...$$ and $...$ first (so bold/italic never run across a
// math span), escapes everything else, then applies the remaining inline
// rules only to the non-math text.
export function renderInline(raw: string, ctx: InlineContext): string {
  if (!raw) return '';

  const parts: Array<{ math: 'display' | 'inline' | null; text: string }> = [];
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('$$', i)) {
      const end = raw.indexOf('$$', i + 2);
      if (end !== -1) {
        parts.push({ math: 'display', text: raw.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (raw[i] === '$') {
      const end = raw.indexOf('$', i + 1);
      if (end !== -1) {
        parts.push({ math: 'inline', text: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const nextDollar = raw.indexOf('$', i + 1);
    const chunkEnd = nextDollar === -1 ? raw.length : nextDollar;
    parts.push({ math: null, text: raw.slice(i, chunkEnd) });
    i = chunkEnd;
  }

  return parts
    .map((p) => {
      // The TeX source is HTML-escaped (MathJax reads the text content, so
      // \\(r<n\\) still typesets): unescaped, "<n" opened a bogus tag that
      // swallowed the rest of the paragraph.
      if (p.math === 'display') return `<span class="math display">\\[${escapeHtml(p.text)}\\]</span>`;
      if (p.math === 'inline') return `<span class="math inline">\\(${escapeHtml(p.text)}\\)</span>`;
      return renderPlainInline(p.text, ctx);
    })
    .join('');
}

function renderPlainInline(text: string, ctx: InlineContext): string {
  // `inline code` is pulled out first so nothing inside it (an "@", a "*")
  // is treated as markup, then restored at the end.
  const codeSpans: string[] = [];
  let out = escapeHtml(text).replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codeSpans.push(`<code>${c}</code>`);
    return `\u0001${codeSpans.length - 1}\u0001`;
  });

  // [term]{.gls key=some-key} - must run before bold/italic, which would
  // otherwise see the brackets as plain text.
  out = out.replace(/\[([^\]]+)\]\{\.gls key=([a-zA-Z0-9-]+)\}/g, (_m, term: string, key: string) => {
    const entry = ctx.glossary.get(key);
    if (!entry) return term;
    const attrs = [
      `data-key="${escapeHtml(key)}"`,
      `data-term="${escapeHtml(entry.term)}"`,
      `data-def="${escapeHtml(entry.def)}"`,
      entry.wiki ? `data-wiki="${escapeHtml(entry.wiki)}"` : '',
      entry.mathworld ? `data-mw="${escapeHtml(entry.mathworld)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<span class="gls" ${attrs} tabindex="0">${term}</span>`;
  });

  // @label - a cross-reference to a numbered environment, figure or
  // exercise. Written with a genre prefix (@thm-handshake, @fig-lgv), but
  // the block's own `label` field is stored bare ("handshake"), matching
  // the two already-imported books - so the prefix is stripped before
  // looking the rest up.
  // (?<![\w.]) so an email address like "x@gmail.com" is left alone -
  // a real cross-reference is never preceded by a letter/digit/dot.
  out = out.replace(/(?<![\w.])@([a-zA-Z0-9-]+)/g, (m, refWithPrefix: string) => {
    const bareLabel = refWithPrefix.replace(
      /^(thm|lem|prp|prop|cor|def|rem|exm|prin|prn|ex|fig)-/,
      '',
    );
    // Exact (prefixed) match first: numbering registers "fig-x" and
    // "exm-x" separately, so a figure and an example may share a bare label.
    const entry = ctx.numbering.get(refWithPrefix) ?? ctx.numbering.get(bareLabel);
    if (!entry) {
      ctx.unresolvedRefs.add(refWithPrefix);
      return m;
    }
    return `<a href="#${entry.anchorId}">${entry.display}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<![a-zA-Z0-9*])\*([^*]+)\*(?![a-zA-Z0-9*])/g, '<em>$1</em>');

  return out.replace(/\u0001(\d+)\u0001/g, (_m, i) => codeSpans[Number(i)]);
}

const SEPARATOR_ROW = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

// Splits a pipe-table row into cells, without breaking on a "|" that is
// inside a $...$/$$...$$ math span (e.g. "$n!/|\mathrm{Aut}(G)|$" has a
// literal pipe in it) - masks math spans with a placeholder first, splits,
// then restores them.
function splitTableRow(line: string): string[] {
  const spans: string[] = [];
  const masked = line.replace(/\$\$[^$]*\$\$|\$[^$]*\$/g, (m) => {
    spans.push(m);
    return `\u0000${spans.length - 1}\u0000`;
  });
  const trimmed = masked.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed
    .split('|')
    .map((cell) => cell.trim().replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]));
}

// Splits a body into block-level pieces: paragraphs, runs of consecutive
// "a. "/"1. " lines (ordered list) or "- " lines (unordered), and pipe
// tables (a header row, a "| --- | --- |" separator, then body rows).
export function renderBody(raw: string, ctx: InlineContext): string {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let para: string[] = [];
  let list: { type: 'a' | '1' | '-'; items: string[] } | null = null;

  function flushPara() {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(' '), ctx)}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (list) {
      const tag = list.type === '-' ? 'ul' : 'ol';
      const typeAttr = list.type === '-' ? '' : ` type="${list.type}"`;
      html.push(
        `<${tag}${typeAttr}>${list.items.map((it) => `<li><p>${renderInline(it, ctx)}</p></li>`).join('')}</${tag}>`,
      );
      list = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') {
      flushPara();
      flushList();
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1].trim())) {
      flushPara();
      flushList();
      const headerCells = splitTableRow(trimmed);
      let j = i + 2;
      const bodyRows: string[][] = [];
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        bodyRows.push(splitTableRow(lines[j].trim()));
        j++;
      }
      html.push(
        '<table><thead><tr>' +
          headerCells.map((c) => `<th>${renderInline(c, ctx)}</th>`).join('') +
          '</tr></thead><tbody>' +
          bodyRows.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c, ctx)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
      i = j - 1;
      continue;
    }

    const orderedMatch = /^([a-z]|\d+)\.\s+(.*)$/.exec(trimmed);
    const bulletMatch = /^-\s+(.*)$/.exec(trimmed);
    if (orderedMatch) {
      flushPara();
      const marker = /^[a-z]$/.test(orderedMatch[1]) ? 'a' : '1';
      if (!list || list.type !== marker) {
        flushList();
        list = { type: marker, items: [] };
      }
      list.items.push(orderedMatch[2]);
    } else if (bulletMatch) {
      flushPara();
      if (!list || list.type !== '-') {
        flushList();
        list = { type: '-', items: [] };
      }
      list.items.push(bulletMatch[1]);
    } else {
      flushList();
      para.push(trimmed);
    }
  }
  flushPara();
  flushList();
  return html.join('\n');
}
