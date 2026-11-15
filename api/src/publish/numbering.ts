import type { NumberingEntry } from './inline.js';

export type SectionRow = { id: string; num: string; order: number };
export type BlockRow = { id: string; section: string; type: string; order: number; fields: any };

export const ENV_TYPES = new Set([
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'example',
  'principle',
]);

const ENV_TITLE: Record<'en' | 'fa', Record<string, string>> = {
  en: {
    theorem: 'Theorem',
    lemma: 'Lemma',
    proposition: 'Proposition',
    corollary: 'Corollary',
    definition: 'Definition',
    remark: 'Remark',
    example: 'Example',
    principle: 'Principle',
  },
  fa: {
    theorem: 'قضیه',
    lemma: 'لم',
    proposition: 'گزاره',
    corollary: 'نتیجه',
    definition: 'تعریف',
    remark: 'یادداشت',
    example: 'مثال',
    principle: 'اصل',
  },
};

export const EXERCISE_TITLE: Record<'en' | 'fa', string> = { en: 'Exercise', fa: 'تمرین' };
export const FIGURE_TITLE: Record<'en' | 'fa', string> = { en: 'Figure', fa: 'شکل' };

// One pass over every section's blocks in document order, computing:
// - a shared counter per section for the "theorem-like" environments
//   (Definition 1.1.1, Remark 1.1.2, Definition 1.1.3, Theorem 1.1.4, ...
//   all share one sequence, matching the two already-published books),
// - a separate per-section counter for exercises,
// - a per-chapter counter for figures,
// so that @label cross-references anywhere in the book (including ones
// that appear before the target in reading order) resolve correctly.
export function buildNumbering(
  sections: SectionRow[],
  blocksBySection: Map<string, BlockRow[]>,
  lang: 'en' | 'fa',
): Map<string, NumberingEntry> {
  const numbering = new Map<string, NumberingEntry>();
  let figureCounter = 0;
  let currentChapterNum = '';

  for (const section of [...sections].sort((a, b) => a.order - b.order)) {
    if (!section.num) continue; // front matter etc. is unnumbered and has no labelled environments
    const chapterNum = section.num.split('.')[0];
    if (chapterNum !== currentChapterNum) {
      currentChapterNum = chapterNum;
      figureCounter = 0;
    }

    let envCounter = 0;
    let exerciseCounter = 0;
    const blocks = (blocksBySection.get(section.id) ?? []).slice().sort((a, b) => a.order - b.order);

    for (const block of blocks) {
      const label = block.fields?.label as string | undefined;

      if (ENV_TYPES.has(block.type)) {
        envCounter += 1;
        const display = `${ENV_TITLE[lang][block.type]} ${section.num}.${envCounter}`;
        const anchorId = `env-${block.id}`;
        if (label) numbering.set(label, { kind: block.type, display, anchorId });
        numbering.set(`__block-${block.id}`, { kind: block.type, display, anchorId });
      } else if (block.type === 'exercise') {
        exerciseCounter += 1;
        const display = `${EXERCISE_TITLE[lang]} ${section.num}.${exerciseCounter}`;
        const anchorId = `ex-${block.id}`;
        if (label) numbering.set(label, { kind: 'exercise', display, anchorId });
        numbering.set(`__block-${block.id}`, { kind: 'exercise', display, anchorId });
      } else if (block.type === 'figure') {
        figureCounter += 1;
        const display = `${FIGURE_TITLE[lang]} ${chapterNum}.${figureCounter}`;
        const anchorId = `fig-${block.id}`;
        if (label) numbering.set(label, { kind: 'figure', display, anchorId });
        numbering.set(`__block-${block.id}`, { kind: 'figure', display, anchorId });
      }
    }
  }

  return numbering;
}
