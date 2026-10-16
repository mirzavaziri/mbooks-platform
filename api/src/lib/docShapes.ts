// Maps between the Firestore-like JSON documents the studio reads/writes
// and this app's normalized Postgres columns for `sections` and `blocks`.

export type SectionDoc = {
  chapter?: string;
  title?: string;
  num?: string;
  order?: number;
  status?: string;
  notes?: string;
};

export type BlockDoc = {
  section?: string;
  order?: number;
  type?: string;
  fields?: unknown;
  voice?: unknown;
  style?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export function sectionRowToDoc(row: any): SectionDoc {
  return {
    chapter: row.chapter,
    title: row.title,
    num: row.num,
    order: Number(row.order),
    status: row.status,
    notes: row.notes,
  };
}

export function blockRowToDoc(row: any): BlockDoc {
  return {
    section: row.section,
    order: Number(row.order),
    type: row.type,
    fields: row.fields,
    voice: row.voice ?? undefined,
    style: row.style ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export function docToSectionColumns(doc: SectionDoc) {
  return {
    chapter: doc.chapter ?? '',
    title: doc.title ?? '',
    num: doc.num ?? '',
    order: doc.order ?? 0,
    status: doc.status ?? 'draft',
    notes: doc.notes ?? '',
  };
}

export function docToBlockColumns(doc: BlockDoc) {
  return {
    section: doc.section ?? '',
    order: doc.order ?? 0,
    type: doc.type ?? 'paragraph',
    fields: doc.fields ?? {},
    voice: doc.voice ?? null,
    style: doc.style ?? null,
  };
}
