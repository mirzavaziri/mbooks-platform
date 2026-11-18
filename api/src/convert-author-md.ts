// Converts a book written in the author-guide Markdown convention (see
// docs/author-guide.md) into a studio export folder that import-book.js
// already knows how to load:
//   <out>/settings/book.json, <out>/sections/*.json, <out>/blocks/*.json
//
// usage:
//   node dist/convert-author-md.js --in book.md --out /tmp/export \
//     [--title "..."] [--subtitle "..."] [--authors "A;B"] [--labs <dir of <label>.html widgets>]
//
// Conventions handled (the same ones the uploader note at the top of such
// a file spells out):
//   # chapter      ## <num> <section title>      ### subheading
//   ::: <kind> [#label] [«title»] [[tag, tag]]   ...   :::
//   inside exercises: --- راهنمایی N / --- پاسخ / --- جواب عددی: N | کادر: «...»
//   inside free margin notes: --- چرا؟ / --- بیشتر بدانید
//   [[term]] / [[term|shown]]  -> glossary entry from the final «واژه‌نامه» chapter
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function latinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

// Same prefixes the publish renderer strips from @references
// (publish/inline.ts), so a block labelled "#ex-foo" is found by "@ex-foo".
function bareLabel(label: string): string {
  return label.replace(/^(thm|lem|prp|prop|cor|def|rem|exm|prin|ex|fig)-/, '');
}

// The studio's own reference prefixes (studio.html: "@thm-label" etc.);
// exercises are not referenceable in the studio preview, but the publish
// renderer accepts "@ex-label" for them.
const ENV_PREFIX: Record<string, string> = {
  definition: 'def', theorem: 'thm', lemma: 'lem', proposition: 'prp', corollary: 'cor',
  principle: 'prn', example: 'exm', remark: 'rem', figure: 'fig', exercise: 'ex',
};

const KIND: Record<string, string> = {
  'تعریف': 'definition',
  'قضیه': 'theorem',
  'لم': 'lemma',
  'گزاره': 'proposition',
  'نتیجه': 'corollary',
  'مثال': 'example',
  'یادداشت': 'remark',
  'اصل': 'principle',
  'اثبات': 'proof',
  'تمرین': 'exercise',
  'کد': 'code',
  'آزمایشگاه': 'lab',
  'شکل': 'figure',
  'حاشیه-شخص': 'person',
  'حاشیه-تاریخی': 'history',
  'حاشیه-نقل‌قول': 'quote',
  'حاشیه-آزاد': 'aside',
  'جعبه-پژوهشی': 'thread',
  'جعبه-کار-خودمان': 'authors',
  'جعبه-مسیر-اثبات': 'proofs',
};

const TAG: Record<string, string> = {
  'محض': 'pure',
  'المپیاد ریاضی': 'omath',
  'المپیاد کامپیوتر': 'oinf',
  'الگوریتم': 'algorithm',
  'برنامه‌نویسی': 'code',
  'علوم کامپیوتر': 'cs',
  'پروژه‌ی پژوهشی': 'research',
  'پروژه پژوهشی': 'research',
};

type Section = { id: string; chapter: string; title: string; num: string; order: number; status: string; notes: string };
type Block = { id: string; section: string; type: string; order: number; fields: Record<string, any> };

const warnings: string[] = [];

function main() {
  const args = parseArgs();
  if (!args.in || !args.out) {
    console.error('usage: convert-author-md.js --in book.md --out <dir> [--title ..] [--subtitle ..] [--authors "A;B"]');
    process.exit(1);
  }
  let src = readFileSync(args.in, 'utf8').replace(/\r\n/g, '\n');

  // Drop HTML comments (uploader notes) - but not inside code fences, which
  // never contain "<!--" in practice; keep it simple.
  // "<!-- یادداشت-بخش: ... -->" survives as a marker line and becomes part
  // of the current section's studio notes ("Notes between the authors").
  src = src.replace(/<!--\s*یادداشت-بخش:\s*([\s\S]*?)\s*-->/g, (_m, note: string) => `\u0002NOTE ${note.replace(/\n/g, ' ')}`);
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const lines = src.split('\n');

  const sections: Section[] = [];
  const blocks: Block[] = [];
  const glossaryRaw: { term: string; def: string; wiki?: string }[] = [];

  let chapter = '';
  let inGlossary = false;
  let section: Section | null = null;
  let blockOrder = 0;
  let para: string[] = [];

  function newBlock(type: string, fields: Record<string, any>) {
    if (!section) {
      warnings.push(`content outside any section dropped: ${type} ${JSON.stringify(fields).slice(0, 80)}`);
      return;
    }
    blockOrder += 1;
    blocks.push({ id: `b${String(blocks.length + 1).padStart(4, '0')}`, section: section.id, type, order: blockOrder * 10, fields });
  }
  function flushPara() {
    const text = para.join('\n').trim();
    para = [];
    if (text) newBlock('paragraph', { text });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith('\u0002NOTE ')) {
      if (section) section.notes = (section.notes ? section.notes + '\n' : '') + t.slice(6).trim();
      else warnings.push(`note outside any section dropped: ${t.slice(6)}`);
      continue;
    }

    if (inGlossary) {
      const m = /^-\s+\*\*(.+?)\*\*\s*:\s*(.+?)(?:\s+—\s+(https?:\S+))?\s*$/.exec(t);
      if (m) glossaryRaw.push({ term: m[1].trim(), def: m[2].trim(), wiki: m[3] });
      else if (t && !t.startsWith('#')) warnings.push(`glossary line not understood: ${t}`);
      if (!t.startsWith('# ')) continue;
    }

    if (t.startsWith('# ')) {
      flushPara();
      chapter = t.slice(2).trim();
      inGlossary = chapter === 'واژه‌نامه';
      section = null;
      continue;
    }
    if (t.startsWith('## ')) {
      flushPara();
      const rest = t.slice(3).trim();
      const m = /^([0-9۰-۹]+(?:\.[0-9۰-۹]+)*)\s+(.*)$/.exec(rest);
      const num = m ? latinDigits(m[1]) : '';
      const title = m ? m[2] : rest;
      section = {
        id: num ? `s${num.replace(/\./g, '-')}` : `s-${sections.length + 1}`,
        chapter,
        title,
        num,
        order: (sections.length + 1) * 10,
        status: 'draft',
        notes: '',
      };
      sections.push(section);
      blockOrder = 0;
      continue;
    }
    if (t.startsWith('### ')) {
      flushPara();
      newBlock('heading', { title: t.slice(4).trim() });
      continue;
    }

    if (t.startsWith('::: ')) {
      flushPara();
      // Collect the body up to the matching closing ":::" line, skipping
      // over ``` fences so a code line can never close the block.
      const body: string[] = [];
      let j = i + 1;
      let inFence = false;
      for (; j < lines.length; j++) {
        const tj = lines[j].trim();
        if (tj.startsWith('```')) inFence = !inFence;
        if (!inFence && tj === ':::') break;
        body.push(lines[j]);
      }
      if (j >= lines.length) warnings.push(`unclosed block at line ${i + 1}: ${t}`);
      parseSpecial(t.slice(4).trim(), body, i + 1);
      i = j;
      continue;
    }

    if (t === '') {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();

  function parseSpecial(head: string, body: string[], lineNo: number) {
    // head: "<kind>[ قابل‌اجرا] [#label|@ref] [«title»] [[tags]]"
    const kindWord = head.split(/\s+/)[0];
    const type = KIND[kindWord];
    if (!type) {
      warnings.push(`line ${lineNo}: unknown block kind «${kindWord}», kept as paragraph`);
      newBlock('paragraph', { text: body.join('\n').trim() });
      return;
    }
    let rest = head.slice(kindWord.length).trim();
    const runnable = /^قابل[‌ ]?اجرا/.test(rest);
    if (runnable) rest = rest.replace(/^قابل[‌ ]?اجرا/, '').trim();

    const label = /(?:^|\s)#([A-Za-z0-9_-]+)/.exec(rest)?.[1];
    const ofRef = /(?:^|\s)@([A-Za-z0-9_-]+)/.exec(rest)?.[1];
    const title = /«(.*)»/.exec(rest)?.[1];
    const tagsRaw = /\[([^\]]*)\]\s*$/.exec(rest)?.[1];

    const text = body.join('\n').trim();
    const f: Record<string, any> = {};

    switch (type) {
      case 'definition':
      case 'theorem':
      case 'lemma':
      case 'proposition':
      case 'corollary':
      case 'example':
      case 'remark':
      case 'principle':
        if (label) Object.assign(f, { label: bareLabel(label), __label: label });
        if (title) f.title = title;
        f.body = text;
        break;
      case 'proof':
        if (ofRef) f.of = ofRef;
        if (title) f.heading = title;
        f.body = text;
        break;
      case 'exercise': {
        if (label) Object.assign(f, { label: bareLabel(label), __label: label });
        f.tags = (tagsRaw ?? '')
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            if (!TAG[s]) warnings.push(`line ${lineNo}: unknown exercise tag «${s}»`);
            return TAG[s] ?? s;
          });
        const parts = splitDashed(body);
        f.body = parts.main;
        const hints = parts.subs.filter((p) => p.key.startsWith('راهنمایی')).map((p) => p.text);
        if (hints.length) f.hints = hints.join('\n\n---\n\n');
        const sol = parts.subs.find((p) => p.key === 'پاسخ');
        if (sol) f.solution = sol.text;
        const ans = parts.subs.find((p) => p.key.startsWith('جواب عددی'));
        if (ans) {
          const m = /جواب عددی\s*:\s*([^|]+?)\s*(?:\|\s*کادر\s*:\s*«(.*)»)?\s*$/.exec(ans.key);
          if (m) {
            f.answer = latinDigits(m[1].trim());
            if (m[2]) f.prompt = m[2];
            f.tol = '0';
          } else warnings.push(`line ${lineNo}: numeric answer line not understood: ${ans.key}`);
        }
        for (const p of parts.subs) {
          if (!/^(راهنمایی|پاسخ|جواب عددی)/.test(p.key)) warnings.push(`line ${lineNo}: unknown exercise part «${p.key}»`);
        }
        break;
      }
      case 'code': {
        const fence = /```\s*([A-Za-z]*)\s*\n([\s\S]*?)\n```/.exec(text);
        f.lang = (fence?.[1] || 'python').toLowerCase();
        if (!['python', 'sage', 'text'].includes(f.lang)) f.lang = 'text';
        f.code = fence ? fence[2] : text;
        f.runnable = runnable;
        break;
      }
      case 'lab': {
        if (label) f.__label = label;
        if (title) f.title = title;
        f.body = text;
        // A hand-built widget for this lab (see the author guide: labs are
        // bespoke), looked up as <labs dir>/<label>.html.
        const labFile = label && args.labs ? join(args.labs, label + '.html') : '';
        if (labFile && existsSync(labFile)) f.html = readFileSync(labFile, 'utf8');
        else warnings.push(`lab ${label ?? title}: no hand-built widget${args.labs ? ` (${label}.html not in ${args.labs})` : ''}; rendered as its description only`);
        break;
      }
      case 'figure': {
        if (label) Object.assign(f, { label: bareLabel(label), __label: label });
        const fileLine = body.find((l) => /^\s*پرونده\s*:/.test(l));
        const file = fileLine ? fileLine.replace(/^\s*پرونده\s*:\s*/, '').trim() : '';
        f.image = 'local:' + file.replace(/\.[A-Za-z0-9]+$/, '');
        f.caption = body.filter((l) => l !== fileLine).join('\n').trim();
        f.alt = f.caption.replace(/\$[^$]*\$/g, '').slice(0, 200);
        break;
      }
      case 'person': {
        const bio: string[] = [];
        for (const l of body) {
          const m = /^\s*(نام|سال‌ها|سالها)\s*:\s*(.*)$/.exec(l);
          if (m && m[1] === 'نام') f.name = m[2].trim();
          else if (m) f.years = m[2].trim();
          else bio.push(l);
        }
        f.bio = bio.join('\n').trim();
        break;
      }
      case 'history':
        f.body = text;
        break;
      case 'quote': {
        const q: string[] = [];
        for (const l of body) {
          const m = /^\s*(گوینده|منبع)\s*:\s*(.*)$/.exec(l);
          if (m && m[1] === 'گوینده') f.author = m[2].trim();
          else if (m) f.source = m[2].trim();
          else q.push(l);
        }
        f.text = q.join('\n').trim();
        break;
      }
      case 'aside': {
        const parts = splitDashed(body);
        f.body = parts.main;
        for (const p of parts.subs) {
          if (p.key.startsWith('چرا')) {
            f.why = p.text;
            f.why_label = p.key;
          } else {
            if (f.more) warnings.push(`line ${lineNo}: aside has more than one "more" part; extra dropped`);
            else {
              f.more = p.text;
              f.more_label = p.key;
            }
          }
        }
        break;
      }
      case 'thread':
        if (title) f.title = title;
        f.body = text;
        break;
      case 'authors':
        if (title) f.paper = title;
        f.body = text;
        break;
      case 'proofs':
        f.body = text;
        break;
    }
    newBlock(type, f);
  }

  // ---- glossary: [[term]] / [[term|shown]] -> [shown]{.gls key=g-N} ----
  const glossary = glossaryRaw.map((g, idx) => ({ key: `g-${idx + 1}`, term: g.term, def: g.def, ...(g.wiki ? { wiki: g.wiki } : {}) }));
  const keyByTerm = new Map(glossary.map((g) => [g.term, g.key]));
  const usedTerms = new Set<string>();
  const glsRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  function linkGlossary(s: string): string {
    return s.replace(glsRe, (_m, term: string, shown?: string) => {
      const key = keyByTerm.get(term.trim());
      if (!key) {
        warnings.push(`glossary term not defined: [[${term}]]`);
        return shown ?? term;
      }
      usedTerms.add(term.trim());
      return `[${(shown ?? term).trim()}]{.gls key=${key}}`;
    });
  }
  for (const b of blocks) {
    for (const k of Object.keys(b.fields)) {
      if (typeof b.fields[k] === 'string' && k !== 'code') b.fields[k] = linkGlossary(b.fields[k]);
    }
  }
  for (const g of glossary) if (!usedTerms.has(g.term)) warnings.push(`glossary entry never linked from the text: ${g.term}`);

  // ---- labels: store bare (studio convention), rewrite every @ref to the
  // studio's "@<env>-<label>" form so it resolves in the studio preview
  // and the published page alike ----
  const byOriginal = new Map<string, Block>();
  for (const b of blocks) {
    const orig = b.fields.__label as string | undefined;
    if (!orig) continue;
    if (byOriginal.has(orig)) warnings.push(`duplicate label "${orig}"`);
    byOriginal.set(orig, b);
  }
  const seenEnvLabel = new Set<string>();
  for (const b of byOriginal.values()) {
    if (!ENV_PREFIX[b.type]) continue;
    const key = `${ENV_PREFIX[b.type] ?? b.type}-${b.fields.label}`;
    if (seenEnvLabel.has(key)) warnings.push(`two blocks end up as @${key}`);
    seenEnvLabel.add(key);
  }
  function refFor(orig: string): string | null {
    const b = byOriginal.get(orig);
    if (!b || !b.fields.label) return null;
    const prefix = ENV_PREFIX[b.type];
    return prefix ? `${prefix}-${b.fields.label}` : null;
  }
  for (const b of blocks) {
    if (b.type === 'proof' && b.fields.of) {
      const r = refFor(b.fields.of);
      if (r) b.fields.of = r;
      else warnings.push(`proof ${b.id}: of=@${b.fields.of} not found`);
    }
    for (const [k, v] of Object.entries(b.fields)) {
      if (typeof v !== 'string' || k === 'code' || k === '__label') continue;
      b.fields[k] = v.replace(/(?<![\w.])@([a-zA-Z0-9-]+)/g, (m, orig: string) => {
        const r = refFor(orig);
        if (!r) {
          warnings.push(`block ${b.id}: unresolved reference @${orig}`);
          return m;
        }
        return '@' + r;
      });
    }
  }
  for (const b of blocks) delete b.fields.__label;

  // ---- write ----
  const out = args.out;
  rmSync(out, { recursive: true, force: true });
  for (const d of ['settings', 'sections', 'blocks']) mkdirSync(join(out, d), { recursive: true });
  const settings: Record<string, any> = {
    title: args.title ?? '',
    subtitle: args.subtitle ?? '',
    authors: (args.authors ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    ...(args.affiliation ? { affiliation: args.affiliation } : {}),
    lang: 'fa',
    direction: 'rtl',
    glossary,
  };
  writeFileSync(join(out, 'settings', 'book.json'), JSON.stringify(settings, null, 2));
  for (const s of sections) writeFileSync(join(out, 'sections', s.id + '.json'), JSON.stringify(s, null, 2));
  for (const b of blocks) writeFileSync(join(out, 'blocks', b.id + '.json'), JSON.stringify(b, null, 2));

  const counts: Record<string, number> = {};
  for (const b of blocks) counts[b.type] = (counts[b.type] ?? 0) + 1;
  console.log(`sections: ${sections.length}, blocks: ${blocks.length}, glossary: ${glossary.length}`);
  console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  if (warnings.length) {
    console.log(`\nwarnings (${warnings.length}):`);
    warnings.forEach((w) => console.log('  - ' + w));
  }
}

// Splits a block body on "--- <key>" lines into the leading main text and
// a list of {key, text} parts. A key line may carry its own payload (the
// numeric answer line does: "--- جواب عددی: 7 | کادر: «...»").
function splitDashed(body: string[]): { main: string; subs: { key: string; text: string }[] } {
  const subs: { key: string; text: string[] }[] = [];
  const main: string[] = [];
  let inFence = false;
  for (const l of body) {
    if (l.trim().startsWith('```')) inFence = !inFence;
    const m = !inFence ? /^---\s+(.+)$/.exec(l.trim()) : null;
    if (m) subs.push({ key: m[1].trim(), text: [] });
    else if (subs.length) subs[subs.length - 1].text.push(l);
    else main.push(l);
  }
  return { main: main.join('\n').trim(), subs: subs.map((s) => ({ key: s.key, text: s.text.join('\n').trim() })) };
}

main();
