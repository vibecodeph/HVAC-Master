import { Timestamp, collection, getDocs, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export type MetadataCollection = 'categories' | 'uoms' | 'tags' | 'locations' | 'suppliers' | 'users';

export const METADATA_COLLECTIONS: MetadataCollection[] = [
  'categories', 'uoms', 'tags', 'locations', 'suppliers', 'users',
];

export const COLLECTION_LABELS: Record<MetadataCollection, string> = {
  categories: 'Categories',
  uoms: 'Units of Measure',
  tags: 'Tags',
  locations: 'Locations',
  suppliers: 'Suppliers',
  users: 'Users',
};

const BATCH_SIZE = 400;

// Firestore Timestamp serialization (same pattern as backupService)
function serialize(val: unknown): unknown {
  if (val instanceof Timestamp) return { __t__: 1, s: val.seconds, n: val.nanoseconds };
  if (Array.isArray(val)) return val.map(serialize);
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
    );
  }
  return val;
}

function deserialize(val: unknown): unknown {
  if (val !== null && typeof val === 'object' && (val as any).__t__ === 1) {
    const v = val as any;
    return new Timestamp(v.s, v.n);
  }
  if (Array.isArray(val)) return val.map(deserialize);
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, deserialize(v)])
    );
  }
  return val;
}

// locations and suppliers both live in the 'locations' Firestore collection
function getFirestoreCollection(col: MetadataCollection) {
  if (col === 'locations') return query(collection(db, 'locations'), where('type', 'in', ['warehouse', 'jobsite']));
  if (col === 'suppliers') return query(collection(db, 'locations'), where('type', '==', 'supplier'));
  return collection(db, col as string);
}

async function fetchCol(col: MetadataCollection): Promise<any[]> {
  const snap = await getDocs(getFirestoreCollection(col));
  return snap.docs.map(d => serialize({ id: d.id, ...d.data() }));
}

async function countCol(col: MetadataCollection): Promise<number> {
  const snap = await getDocs(getFirestoreCollection(col));
  return snap.size;
}

async function deleteCol(col: MetadataCollection): Promise<void> {
  const snap = await getDocs(getFirestoreCollection(col));
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

async function writeCol(col: MetadataCollection, docs: any[]): Promise<void> {
  const fsCol = col === 'locations' || col === 'suppliers' ? 'locations' : (col as string);
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    docs.slice(i, i + BATCH_SIZE).forEach((raw: any) => {
      const des = deserialize(raw) as any;
      const { id, ...data } = des;
      if (!id) return;
      batch.set(doc(db, fsCol, String(id)), { id, ...data });
    });
    await batch.commit();
  }
}

export interface MetadataExport {
  timestamp: string;
  metadata: Partial<Record<MetadataCollection, any[]>>;
}

export const validateMetadataExport = (data: unknown): data is MetadataExport => {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  if (typeof d.timestamp !== 'string') return false;
  if (!d.metadata || typeof d.metadata !== 'object' || Array.isArray(d.metadata)) return false;
  return true;
};

export const getExistingCounts = async (
  cols: MetadataCollection[]
): Promise<Record<string, number>> => {
  const entries = await Promise.all(cols.map(async c => [c, await countCol(c)]));
  return Object.fromEntries(entries);
};

async function getExistingIds(col: MetadataCollection): Promise<Set<string>> {
  const snap = await getDocs(getFirestoreCollection(col));
  return new Set(snap.docs.map(d => d.id));
}

export interface CollectionAnalysis {
  existing: number;
  newCount: number;
  duplicates: number;
}

export const analyzeImport = async (
  data: MetadataExport,
  cols: MetadataCollection[]
): Promise<Record<string, CollectionAnalysis>> => {
  const result: Record<string, CollectionAnalysis> = {};
  await Promise.all(
    cols.map(async col => {
      const existingIds = await getExistingIds(col);
      const incoming = data.metadata[col] || [];
      const duplicates = incoming.filter((d: any) => d.id && existingIds.has(String(d.id))).length;
      result[col] = {
        existing: existingIds.size,
        newCount: incoming.length - duplicates,
        duplicates,
      };
    })
  );
  return result;
};

export const exportMetadata = async (
  selected: MetadataCollection[],
  onProgress: (msg: string) => void
): Promise<void> => {
  const metadata: Partial<Record<MetadataCollection, any[]>> = {};

  for (let i = 0; i < selected.length; i++) {
    const col = selected[i];
    onProgress(`Fetching ${COLLECTION_LABELS[col]}… (${i + 1}/${selected.length})`);
    metadata[col] = await fetchCol(col);
  }

  const payload: MetadataExport = { timestamp: new Date().toISOString(), metadata };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const a = document.createElement('a');
  a.href = url;
  a.download = `Metadata-${datePart}-${timePart}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const importMetadata = async (
  data: MetadataExport,
  selectedCollections: MetadataCollection[],
  isMerge: boolean,
  onProgress: (msg: string) => void
): Promise<{ totalImported: number }> => {
  const available = new Set(Object.keys(data.metadata) as MetadataCollection[]);
  const cols = selectedCollections.filter(c => available.has(c));
  let totalImported = 0;

  for (const col of cols) {
    const docs = data.metadata[col] || [];
    if (isMerge) {
      onProgress(`Analyzing ${COLLECTION_LABELS[col] || col}…`);
      const existingIds = await getExistingIds(col);
      const newDocs = docs.filter((d: any) => d.id && !existingIds.has(String(d.id)));
      onProgress(`Writing ${COLLECTION_LABELS[col] || col} (${newDocs.length} new)…`);
      await writeCol(col, newDocs);
      totalImported += newDocs.length;
    } else {
      onProgress(`Clearing ${COLLECTION_LABELS[col] || col}…`);
      await deleteCol(col);
      onProgress(`Writing ${COLLECTION_LABELS[col] || col} (${docs.length})…`);
      await writeCol(col, docs);
      totalImported += docs.length;
    }
  }

  return { totalImported };
};
