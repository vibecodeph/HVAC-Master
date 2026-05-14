import { Timestamp, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

export interface BackupData {
  version: string;
  appName: string;
  timestamp: string;
  collections: Record<string, any[]>;
}

export type ProgressCallback = (message: string, current: number, total: number) => void;

// Collections without subcollections
const FLAT_COLLECTIONS = [
  'items', 'categories', 'uoms', 'tags', 'locations', 'users',
  'inventory', 'requests', 'transactions', 'boq', 'unplanned_stock',
  'assets', 'suppliers_invoices', 'supplier_pricing',
  'po_templates', 'counters', 'system',
  // rbac_config: admin can read but write is Cloud Functions only — backed up, not restored
  'rbac_config',
];

// purchase_orders is handled separately (has items + payments subcollections)
const ALL_COLLECTIONS = [...FLAT_COLLECTIONS, 'purchase_orders'];

// Collections that cannot be written by admin (Cloud Functions only) — skip during restore
const SKIP_ON_RESTORE = new Set(['rbac_config']);

const BATCH_SIZE = 400; // well under Firestore's 500-op limit

// --- Firestore Timestamp serialization ---

function serialize(val: unknown): unknown {
  if (val instanceof Timestamp) {
    return { __t__: 1, s: val.seconds, n: val.nanoseconds };
  }
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

// --- Collection helpers ---

async function fetchCollection(colPath: string): Promise<any[]> {
  const snap = await getDocs(collection(db, colPath));
  return snap.docs.map(d => serialize({ id: d.id, ...d.data() }));
}

async function deleteCollection(colPath: string, exceptId?: string): Promise<void> {
  const snap = await getDocs(collection(db, colPath));
  const targets = exceptId ? snap.docs.filter(d => d.id !== exceptId) : snap.docs;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    targets.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

async function writeCollection(colPath: string, docs: any[]): Promise<void> {
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    docs.slice(i, i + BATCH_SIZE).forEach((rawDoc: any) => {
      const deserialized = deserialize(rawDoc) as any;
      const { id, ...data } = deserialized;
      if (!id) return; // skip malformed docs
      batch.set(doc(db, colPath, String(id)), { id, ...data });
    });
    await batch.commit();
  }
}

// --- Public API ---

export const createBackup = async (onProgress: ProgressCallback): Promise<BackupData> => {
  const collections: Record<string, any[]> = {};
  const total = ALL_COLLECTIONS.length;

  // Flat collections
  for (let i = 0; i < FLAT_COLLECTIONS.length; i++) {
    const name = FLAT_COLLECTIONS[i];
    onProgress(`Fetching ${name}…`, i, total);
    collections[name] = await fetchCollection(name);
  }

  // purchase_orders with subcollections embedded
  onProgress('Fetching purchase_orders…', FLAT_COLLECTIONS.length, total);
  const poSnap = await getDocs(collection(db, 'purchase_orders'));
  collections['purchase_orders'] = await Promise.all(
    poSnap.docs.map(async d => {
      const [items, payments] = await Promise.all([
        fetchCollection(`purchase_orders/${d.id}/items`),
        fetchCollection(`purchase_orders/${d.id}/payments`),
      ]);
      return {
        ...(serialize({ id: d.id, ...d.data() }) as Record<string, unknown>),
        _items: items,
        _payments: payments,
      };
    })
  );

  return {
    version: '1.0',
    appName: 'HVAC-Master',
    timestamp: new Date().toISOString(),
    collections,
  };
};

export const downloadBackup = async (onProgress: ProgressCallback): Promise<void> => {
  const backup = await createBackup(onProgress);
  onProgress('Generating file…', 100, 100);

  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = [
    'HVAC-Master-Backup',
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  ].join('-') + '.json';

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const validateBackup = (data: unknown): data is BackupData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return (
    typeof d.timestamp === 'string' &&
    d.collections !== null &&
    typeof d.collections === 'object' &&
    !Array.isArray(d.collections)
  );
};

export const restoreFromBackup = async (
  backup: BackupData,
  onProgress: ProgressCallback,
  preserveAdminUid?: string,  // UID of the restoring admin — their user doc is written back after restore
): Promise<void> => {
  const total = ALL_COLLECTIONS.length * 2; // delete pass + write pass
  let step = 0;

  // The restoring admin's user doc is never deleted or overwritten — skip it in both passes
  // so there is no moment where it is absent and the app loses their session.

  // --- Delete pass ---
  for (const name of ALL_COLLECTIONS) {
    if (SKIP_ON_RESTORE.has(name)) { step++; continue; }
    onProgress(`Deleting ${name}…`, step++, total);

    if (name === 'purchase_orders') {
      // Must delete subcollections before (or after) deleting PO docs
      const poSnap = await getDocs(collection(db, 'purchase_orders'));
      for (const d of poSnap.docs) {
        await deleteCollection(`purchase_orders/${d.id}/items`);
        await deleteCollection(`purchase_orders/${d.id}/payments`);
      }
    }

    await deleteCollection(name, name === 'users' ? preserveAdminUid : undefined);
  }

  // --- Write pass ---
  for (const name of ALL_COLLECTIONS) {
    if (SKIP_ON_RESTORE.has(name)) { step++; continue; }
    onProgress(`Restoring ${name}…`, step++, total);
    const docs: any[] = backup.collections[name] ?? [];

    if (name === 'purchase_orders') {
      for (const po of docs) {
        const { _items = [], _payments = [], ...poData } = po;
        const poId = String(po.id);
        await writeCollection('purchase_orders', [poData]);
        if (_items.length > 0) await writeCollection(`purchase_orders/${poId}/items`, _items);
        if (_payments.length > 0) await writeCollection(`purchase_orders/${poId}/payments`, _payments);
      }
    } else {
      const filteredDocs = (name === 'users' && preserveAdminUid)
        ? docs.filter((d: any) => String(d.id) !== preserveAdminUid)
        : docs;
      await writeCollection(name, filteredDocs);
    }
  }
};
