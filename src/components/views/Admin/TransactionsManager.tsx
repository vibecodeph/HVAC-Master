import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, query, orderBy, limit, getDocs, startAfter,
  doc, updateDoc, deleteDoc, serverTimestamp,
  QueryDocumentSnapshot, DocumentData, writeBatch as firestoreWriteBatch,
} from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import {
  Loader2, RefreshCw, Search, ChevronUp, ChevronDown, Trash2,
  AlertTriangle, Edit3, CheckCircle, ChevronLeft, ChevronRight,
  Database, Package, MapPin, RotateCcw,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../../firebase';
import { useAuth, useData } from '../../../App';
import { Transaction, Request } from '../../../types';
import { reverseDeliveryBatch } from '../../../services/inventoryService';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';

const PAGE_SIZE = 50;
type SortDir = 'asc' | 'desc';

const STATUS_STYLES: Record<string, { badge: string; border: string }> = {
  Delivered:    { badge: 'bg-emerald-100 text-emerald-700', border: 'border-l-emerald-400' },
  'In Transit': { badge: 'bg-amber-100 text-amber-700',     border: 'border-l-amber-400'   },
  Partial:      { badge: 'bg-blue-100 text-blue-700',       border: 'border-l-blue-400'    },
  Returned:     { badge: 'bg-purple-100 text-purple-700',   border: 'border-l-purple-400'  },
  Other:        { badge: 'bg-gray-100 text-gray-500',       border: 'border-l-gray-300'    },
};

const TYPE_COLORS: Record<string, string> = {
  delivery:   'bg-blue-100 text-blue-700',
  usage:      'bg-red-100 text-red-700',
  return:     'bg-orange-100 text-orange-700',
  adjustment: 'bg-amber-100 text-amber-700',
  pick:       'bg-green-100 text-green-700',
};

const ALL_TYPES = ['delivery', 'usage', 'return', 'adjustment', 'pick'] as const;

const formatTs = (ts: Timestamp | undefined | null): string => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts as unknown as number);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

const truncateId = (id: string) => id.length > 14 ? `${id.slice(0, 10)}…` : id;

// --- Batch grouping types ---
interface ItemSummary {
  itemId: string;
  name: string;
  qty: number;
  uomSymbol: string;
  serialNumbers: string[];
}

interface BatchGroup {
  key: string;                   // batchId, or 'tx-{id}' for ungrouped
  batchId?: string;
  transactions: Transaction[];
  items: ItemSummary[];
  toLocationId?: string;
  fromLocationId?: string;
  timestamp: Timestamp;
  pickerName?: string;
  receiverName?: string;
  receiverMixed: boolean;
  status: 'Delivered' | 'In Transit' | 'Partial' | 'Other' | 'Returned';
  txTypes: string[];
  allRequestIds: string[];
  returnTxs: Transaction[];
}

// --- Edit / Delete / Reverse state ---
interface EditState { key: string; notes: string; saving: boolean; error: string | null }
interface DeleteState { key: string; txCount: number; requestIds: string[]; deleting: boolean; error: string | null }
interface ReverseState { key: string; batchId: string; items: ItemSummary[]; requestIds: string[]; reversing: boolean; error: string | null }

// --- Location label: type-aware FROM/TO/AT display ---
function renderLocationLabel(
  txTypes: string[],
  fromName: string | undefined,
  toName: string | undefined,
  hasPO: boolean,
  pendingDestName?: string,   // destination from requests when delivery not yet recorded
) {
  if (!fromName && !toName && !hasPO && !pendingDestName) return null;
  const isAdjustment = txTypes.length === 1 && txTypes[0] === 'adjustment';
  const isUsage = txTypes.every(t => t === 'usage' || t === 'consumption');
  const atLoc = fromName || toName;
  const cls = 'flex items-center gap-1 text-[10px] font-medium text-gray-500';

  if (hasPO) return (
    <div className={cls}>
      <MapPin size={10} className="shrink-0" />
      <span>FROM</span>
      <span className="font-semibold text-gray-600">{fromName || 'External Supplier'}</span>
      {toName && <><span>→</span><span className="text-gray-400">TO</span><span className="font-bold text-gray-700">{toName}</span></>}
    </div>
  );

  if (isAdjustment && atLoc) return (
    <div className={cls}>
      <MapPin size={10} className="shrink-0" />
      <span>AT</span>
      <span className="font-bold text-gray-700">{atLoc}</span>
    </div>
  );

  if (isUsage && atLoc) return (
    <div className={cls}>
      <MapPin size={10} className="shrink-0" />
      <span className="font-bold text-gray-700">{atLoc}</span>
      <span className="italic">(consumed)</span>
    </div>
  );

  // delivery / pick — use confirmed toName, or fall back to request-derived destination
  const effectiveDest = toName || pendingDestName;
  const isPending = !toName && !!pendingDestName;

  return (
    <div className={cls}>
      <MapPin size={10} className="shrink-0" />
      {fromName && <><span>FROM</span><span className="font-semibold text-gray-600">{fromName}</span></>}
      {effectiveDest && <span>→</span>}
      {effectiveDest && (
        <>
          <span className={isPending ? 'text-amber-500 font-semibold' : ''}>{isPending ? 'FOR' : 'TO'}</span>
          <span className={cn('font-bold', isPending ? 'text-amber-700' : 'text-gray-700')}>{effectiveDest}</span>
        </>
      )}
    </div>
  );
}

// --- Helper: build item summary from a set of transactions ---
function buildItems(
  txs: Transaction[],
  itemMap: Map<string, { name: string }>,
  uomMap: Map<string, string>,
): ItemSummary[] {
  // Prefer pick transactions for "what was sent"; fall back to all
  const source = txs.filter(t => t.type === 'pick');
  const pool = source.length > 0 ? source : txs;

  const map = new Map<string, ItemSummary>();
  pool.forEach(tx => {
    const key = tx.itemId;
    const cur = map.get(key);
    if (cur) {
      cur.qty += tx.quantity ?? 0;
      if (tx.serialNumber) cur.serialNumbers.push(tx.serialNumber);
    } else {
      map.set(key, {
        itemId: tx.itemId,
        name: itemMap.get(tx.itemId)?.name || tx.itemId,
        qty: tx.quantity ?? 0,
        uomSymbol: uomMap.get(tx.uomId) || '',
        serialNumbers: tx.serialNumber ? [tx.serialNumber] : [],
      });
    }
  });
  return Array.from(map.values());
}

// --- Helper: derive batch status ---
function deriveStatus(
  txs: Transaction[],
  requestMap: Map<string, Request>,
): 'Delivered' | 'In Transit' | 'Partial' | 'Other' | 'Returned' {
  const types = new Set(txs.map(t => t.type));
  // Reversed delivery: has return transactions alongside pick/delivery
  if (types.has('return') && (types.has('pick') || types.has('delivery'))) return 'Returned';
  // Non-delivery/pick transactions → Other
  if (!types.has('delivery') && !types.has('pick')) return 'Other';

  // Try requests first (most accurate)
  const allRequestIds = txs.flatMap(t => t.requestIds ?? []);
  const found = allRequestIds.map(id => requestMap.get(id)).filter(Boolean) as Request[];
  if (found.length > 0) {
    const deliveredCount = found.filter(r => r.status === 'delivered').length;
    if (deliveredCount === found.length) return 'Delivered';
    if (deliveredCount === 0) return 'In Transit';
    return 'Partial';
  }

  // Fallback: transaction types
  if (types.has('delivery')) return 'Delivered';
  return 'In Transit';
}

export const TransactionsManager = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, categories, requests } = useData();

  const [records, setRecords] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<EditState | null>(null);
  const [del, setDel] = useState<DeleteState | null>(null);
  const [rev, setRev] = useState<ReverseState | null>(null);

  const isAdmin = profile?.role === 'admin';

  // --- Lookup maps ---
  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const uomMap  = useMemo(() => new Map(uoms.map(u => [u.id, u.symbol])), [uoms]);
  const locMap  = useMemo(() => new Map(locations.map(l => [l.id, l.name])), [locations]);
  const requestMap = useMemo(() => new Map(requests.map(r => [r.id, r])), [requests]);
  const allLocations = useMemo(() => [...locations].sort((a, b) => a.name.localeCompare(b.name)), [locations]);
  const itemsByCategoryId = useMemo(() => {
    const m = new Map<string, Set<string>>();
    items.forEach(i => {
      if (!i.categoryId) return;
      if (!m.has(i.categoryId)) m.set(i.categoryId, new Set());
      m.get(i.categoryId)!.add(i.id);
    });
    return m;
  }, [items]);

  // --- Fetch ---
  const fetchPage = async (pageIndex: number) => {
    setLoading(true);
    try {
      let q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE + 1));
      if (pageIndex > 0 && cursors[pageIndex - 1]) {
        q = query(
          collection(db, 'transactions'),
          orderBy('timestamp', 'desc'),
          startAfter(cursors[pageIndex - 1]),
          limit(PAGE_SIZE + 1),
        );
      }
      const snap = await getDocs(q);
      const docs = snap.docs.slice(0, PAGE_SIZE);
      setHasMore(snap.docs.length > PAGE_SIZE);
      if (docs.length > 0) {
        const next = [...cursors];
        next[pageIndex] = docs[docs.length - 1];
        setCursors(next);
      }
      setRecords(docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'transactions', false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) fetchPage(0); }, [isAdmin]);

  const handleRefresh = () => { setPage(0); setCursors([]); fetchPage(0); };
  const handleNext    = () => { const n = page + 1; setPage(n); fetchPage(n); };
  const handlePrev    = () => { const p = page - 1; setPage(p); fetchPage(p); };

  // --- Group by batchId ---
  const grouped = useMemo((): BatchGroup[] => {
    const batchMap = new Map<string, Transaction[]>();
    const ungrouped: Transaction[] = [];

    records.forEach(tx => {
      if (tx.batchId) {
        if (!batchMap.has(tx.batchId)) batchMap.set(tx.batchId, []);
        batchMap.get(tx.batchId)!.push(tx);
      } else {
        ungrouped.push(tx);
      }
    });

    const groups: BatchGroup[] = [];

    // Batched groups
    batchMap.forEach((txs, batchId) => {
      const pickTxs     = txs.filter(t => t.type === 'pick');
      const deliveryTxs = txs.filter(t => t.type === 'delivery');

      // Earliest timestamp
      const ts = txs.reduce<Timestamp | undefined>((best, tx) => {
        if (!best) return tx.timestamp;
        const tMs = tx.timestamp?.toDate?.()?.getTime() ?? 0;
        const bMs = best?.toDate?.()?.getTime() ?? 0;
        return tMs < bMs ? tx.timestamp : best;
      }, undefined);

      const pickerName   = pickTxs[0]?.userName || txs[0]?.userName;
      const receiverNames = [...new Set(deliveryTxs.map(t => t.userName).filter(Boolean))];
      const receiverMixed = receiverNames.length > 1;
      const receiverName  = receiverMixed ? 'Multiple' : (receiverNames[0] || undefined);

      const destTxs = deliveryTxs.length > 0 ? deliveryTxs : txs;
      const toLocationId   = destTxs.find(t => t.toLocationId && t.toLocationId !== 'in-transit')?.toLocationId;
      // Prefer pick tx for source; fall back to delivery tx (older DRs may lack a pick step)
      const fromLocationId =
        pickTxs.find(t => t.fromLocationId && t.fromLocationId !== 'in-transit')?.fromLocationId ??
        deliveryTxs.find(t => t.fromLocationId && t.fromLocationId !== 'in-transit')?.fromLocationId;

      groups.push({
        key: batchId,
        batchId,
        transactions: txs,
        items: buildItems(txs, itemMap, uomMap),
        toLocationId,
        fromLocationId,
        timestamp: ts ?? txs[0]?.timestamp,
        pickerName,
        receiverName,
        receiverMixed,
        status: deriveStatus(txs, requestMap),
        txTypes: [...new Set(txs.map(t => t.type))],
        allRequestIds: [...new Set(txs.flatMap(t => t.requestIds ?? []))],
        returnTxs: txs.filter(t => t.type === 'return'),
      });
    });

    // Ungrouped (individual transactions)
    ungrouped.forEach(tx => {
      groups.push({
        key: `tx-${tx.id}`,
        batchId: undefined,
        transactions: [tx],
        items: buildItems([tx], itemMap, uomMap),
        toLocationId: tx.toLocationId !== 'in-transit' ? tx.toLocationId : undefined,
        fromLocationId: tx.fromLocationId !== 'in-transit' ? tx.fromLocationId : undefined,
        timestamp: tx.timestamp,
        pickerName: tx.userName,
        receiverName: undefined,
        receiverMixed: false,
        status: tx.type === 'delivery' ? 'Delivered' : tx.type === 'pick' ? 'In Transit' : 'Other',
        txTypes: [tx.type],
        allRequestIds: tx.requestIds ?? [],
        returnTxs: tx.type === 'return' ? [tx] : [],
      });
    });

    // Sort by timestamp
    groups.sort((a, b) => {
      const at = a.timestamp?.toDate?.()?.getTime() ?? 0;
      const bt = b.timestamp?.toDate?.()?.getTime() ?? 0;
      return sortDir === 'desc' ? bt - at : at - bt;
    });

    return groups;
  }, [records, requestMap, itemMap, uomMap, sortDir]);

  // --- Filter ---
  const displayed = useMemo(() => {
    let list = [...grouped];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(g =>
        (g.batchId || '').toLowerCase().includes(q) ||
        (g.pickerName || '').toLowerCase().includes(q) ||
        (g.receiverName || '').toLowerCase().includes(q) ||
        g.items.some(item => item.name.toLowerCase().includes(q)) ||
        (locMap.get(g.toLocationId || '') || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter) {
      list = list.filter(g => g.txTypes.includes(typeFilter));
    }
    if (locationFilter) {
      list = list.filter(g => g.toLocationId === locationFilter || g.fromLocationId === locationFilter);
    }
    if (categoryFilter) {
      const ids = itemsByCategoryId.get(categoryFilter);
      list = list.filter(g => g.items.some(item => ids?.has(item.itemId)));
    }
    return list;
  }, [grouped, search, typeFilter, locationFilter, categoryFilter, locMap, itemsByCategoryId]);

  // --- Expand toggle ---
  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // --- Edit (notes on all transactions in batch) ---
  const startEdit = (g: BatchGroup) => {
    const existingNotes = g.transactions[0]?.notes || '';
    setEdit({ key: g.key, notes: existingNotes, saving: false, error: null });
    setDel(null);
  };
  const cancelEdit = () => setEdit(null);

  const saveEdit = async () => {
    if (!edit) return;
    setEdit(e => e ? { ...e, saving: true, error: null } : null);
    const group = grouped.find(g => g.key === edit.key);
    if (!group) return;
    try {
      const batch = firestoreWriteBatch(db);
      group.transactions.forEach(tx => {
        batch.update(doc(db, 'transactions', tx.id), { notes: edit.notes, updatedAt: serverTimestamp() });
      });
      await batch.commit();
      setRecords(prev => prev.map(tx =>
        group.transactions.some(gt => gt.id === tx.id) ? { ...tx, notes: edit.notes } : tx
      ));
      setEdit(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'transactions', false);
      setEdit(e => e ? { ...e, saving: false, error: 'Save failed.' } : null);
    }
  };

  // --- Delete (all transactions in batch) ---
  const startDelete = (g: BatchGroup) => {
    setDel({ key: g.key, txCount: g.transactions.length, requestIds: g.allRequestIds, deleting: false, error: null });
    setEdit(null);
  };
  const cancelDelete = () => setDel(null);

  // --- Reverse delivery ---
  const startReverse = (g: BatchGroup) => {
    if (!g.batchId) return;
    setRev({ key: g.key, batchId: g.batchId, items: g.items, requestIds: g.allRequestIds, reversing: false, error: null });
    setEdit(null);
    setDel(null);
  };
  const cancelReverse = () => setRev(null);

  const confirmReverse = async () => {
    if (!rev || !profile) return;
    setRev(r => r ? { ...r, reversing: true, error: null } : null);
    try {
      await reverseDeliveryBatch(rev.batchId, profile.uid, profile.displayName || '');
      setRev(null);
      fetchPage(page);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions', false);
      setRev(r => r ? { ...r, reversing: false, error: 'Reversal failed. Check console.' } : null);
    }
  };

  const confirmDelete = async () => {
    if (!del) return;
    setDel(d => d ? { ...d, deleting: true, error: null } : null);
    const group = grouped.find(g => g.key === del.key);
    if (!group) return;
    try {
      const batch = firestoreWriteBatch(db);
      group.transactions.forEach(tx => batch.delete(doc(db, 'transactions', tx.id)));
      await batch.commit();
      const deletedIds = new Set(group.transactions.map(t => t.id));
      setRecords(prev => prev.filter(tx => !deletedIds.has(tx.id)));
      setDel(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'transactions', false);
      setDel(d => d ? { ...d, deleting: false, error: 'Delete failed.' } : null);
    }
  };

  if (!isAdmin) return <Navigate to="/settings" replace />;

  return (
    <div className="pb-20">
      <Header title="Transactions Manager" />
      <div className="p-4 space-y-4">

        {/* Warning */}
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-amber-800">Admin Debug Tool</p>
            <p className="text-[10px] text-amber-700 font-medium leading-snug">
              Transactions are grouped by delivery batch (DR number). Deleting a batch removes all linked transaction documents but does <span className="font-black">not</span> reverse inventory changes. Fetches {PAGE_SIZE} transactions per page.
            </p>
          </div>
        </div>

        {/* Controls */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by DR#, item, picker, receiver, jobsite…"
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button onClick={handleRefresh} disabled={loading} className="shrink-0 p-2 text-gray-400 hover:text-blue-500 transition-colors">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none">
              <option value="">All Types</option>
              {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none">
              <option value="">All Locations</option>
              {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none">
              <option value="">All Categories</option>
              {categories.filter(c => c.isActive).sort((a, b) => a.name.localeCompare(b.name)).map(c =>
                <option key={c.id} value={c.id}>{c.name}</option>
              )}
            </select>
            <button
              onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700"
            >
              Date {sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium">
            <span>{displayed.length} batch{displayed.length !== 1 ? 'es' : ''} from {records.length} transactions — Page {page + 1}</span>
            <div className="flex items-center gap-1">
              <button onClick={handlePrev} disabled={page === 0 || loading}
                className="p-1 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={handleNext} disabled={!hasMore || loading}
                className="p-1 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </Card>

        {/* Batch cards */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-2">
            <Database size={36} className="text-gray-200" />
            <p className="text-xs font-bold text-gray-400">No transactions found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(g => {
              const isExpanded = expandedKeys.has(g.key);
              const isEditing = edit?.key === g.key;
              const isDeleting = del?.key === g.key;
              const isReversing = rev?.key === g.key;
              const s = STATUS_STYLES[g.status] ?? STATUS_STYLES.Other;
              const toName   = locMap.get(g.toLocationId   || '');
              const fromName = locMap.get(g.fromLocationId || '');
              const hasPO    = g.txTypes.includes('supplier_invoice') || g.transactions.some(t => !!t.poId);
              // For pending DRs (no confirmed delivery destination), resolve from linked requests
              const pendingDestId = !toName
                ? g.allRequestIds.map(id => requestMap.get(id)?.jobsiteId).find(Boolean)
                : undefined;
              const pendingDestName = pendingDestId ? locMap.get(pendingDestId) : undefined;
              // For supplier_invoice batches: extract supplier name from notes field
              const supplierLabel = g.txTypes.includes('supplier_invoice')
                ? (g.transactions[0]?.notes?.match(/^Supplier: (.+?) —/)?.[1]
                    || g.transactions[0]?.supplierInvoice
                    || null)
                : null;

              return (
                <Card key={g.key} className={cn('overflow-hidden border-l-2', s.border)}>

                  {/* ── Header ── */}
                  <div className="p-3 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        {/* Batch ID + status + count */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {supplierLabel ? (
                            <span className="text-xs font-bold text-gray-900">{supplierLabel}</span>
                          ) : g.batchId ? (
                            <span className="text-xs font-black text-gray-900 tracking-tight">{g.batchId}</span>
                          ) : (
                            <span className="text-[10px] font-mono text-gray-400" title={g.transactions[0]?.id}>
                              {truncateId(g.transactions[0]?.id || '')}
                            </span>
                          )}
                          <span className={cn('text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded', s.badge)}>
                            {g.status}
                          </span>
                          {g.txTypes.map(t => (
                            <span key={t} className={cn('text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded', TYPE_COLORS[t] || 'bg-gray-100 text-gray-500')}>
                              {t}
                            </span>
                          ))}
                          <span className="text-[10px] font-semibold text-gray-500 flex items-center gap-0.5">
                            <Package size={10} />
                            {g.items.length} item{g.items.length !== 1 ? 's' : ''}
                            {g.transactions.length > g.items.length && ` (${g.transactions.length} txs)`}
                          </span>
                        </div>

                        {/* Location */}
                        {renderLocationLabel(g.txTypes, fromName, toName, hasPO, pendingDestName)}

                        {/* Picker + timestamp */}
                        <div className="text-[10px] text-gray-400 font-medium">
                          {g.pickerName && <span>Picked by <span className="font-bold text-gray-600">{g.pickerName}</span> · </span>}
                          {formatTs(g.timestamp)}
                        </div>

                        {/* Receiver */}
                        {g.receiverName && (
                          <div className="text-[10px] text-emerald-600 font-semibold">
                            Received by {g.receiverMixed ? 'multiple people' : g.receiverName}
                          </div>
                        )}

                        {/* Reversal info */}
                        {g.status === 'Returned' && g.returnTxs.length > 0 && (
                          <div className="text-[10px] text-purple-600 font-semibold flex items-center gap-1">
                            <RotateCcw size={9} />
                            Reversed by {g.returnTxs[0].userName || 'admin'} · {formatTs(g.returnTxs[0].timestamp)}
                          </div>
                        )}
                      </div>

                      {/* Expand toggle */}
                      <button
                        onClick={() => toggleExpand(g.key)}
                        className="shrink-0 p-1.5 rounded-xl bg-gray-100 text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        {isExpanded
                          ? <ChevronUp size={14} />
                          : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* ── Item list (expandable) ── */}
                  {isExpanded && (
                    <div className="px-3 py-2 border-b border-gray-100 bg-white">
                      <div className="space-y-1">
                        {g.items.map(item => (
                          <div key={item.itemId} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-700 truncate flex-1">{item.name}</span>
                            <span className="shrink-0 font-bold text-gray-900 ml-3">
                              {item.qty}{item.uomSymbol && ` ${item.uomSymbol}`}
                            </span>
                          </div>
                        ))}
                        {g.items.length === 0 && (
                          <p className="text-[10px] text-gray-400 font-medium">No item data</p>
                        )}
                      </div>
                      {/* Serial numbers if any */}
                      {g.items.some(i => i.serialNumbers.length > 0) && (
                        <div className="mt-2 pt-2 border-t border-gray-50">
                          {g.items.filter(i => i.serialNumbers.length > 0).map(item => (
                            <div key={item.itemId} className="text-[9px] text-gray-400 font-mono">
                              {item.name}: {item.serialNumbers.join(', ')}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Linked request IDs (truncated) */}
                      {g.allRequestIds.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-50">
                          <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-widest mb-1">
                            Linked Requests ({g.allRequestIds.length})
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {g.allRequestIds.map(id => (
                              <span key={id} className="text-[9px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded" title={id}>
                                {truncateId(id)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Edit / Delete / Reverse ── */}
                  <div className="px-3 py-2.5 space-y-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          Notes — updates all {g.transactions.length} transaction{g.transactions.length !== 1 ? 's' : ''} in this batch
                        </label>
                        <textarea
                          value={edit.notes}
                          onChange={e => setEdit(ev => ev ? { ...ev, notes: e.target.value } : null)}
                          rows={2}
                          className="w-full px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          autoFocus
                        />
                        {edit.error && <p className="text-[9px] text-red-600 font-semibold">{edit.error}</p>}
                        <div className="flex gap-1.5">
                          <button onClick={saveEdit} disabled={edit.saving}
                            className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 text-white rounded-lg text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-50">
                            {edit.saving ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle size={9} />}
                            Save
                          </button>
                          <button onClick={cancelEdit}
                            className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-bold active:scale-95 transition-transform">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : isDeleting ? (
                      <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-red-700">
                              Delete {del.txCount} transaction document{del.txCount !== 1 ? 's' : ''} for this batch?
                              This will <span className="underline">not</span> reverse inventory changes.
                            </p>
                            {del.requestIds.length > 0 && (
                              <p className="text-[10px] font-bold text-red-600">
                                ⚠ {del.requestIds.length} linked request{del.requestIds.length !== 1 ? 's' : ''} will lose their transaction reference.
                              </p>
                            )}
                          </div>
                        </div>
                        {del.error && <p className="text-[10px] font-semibold text-red-600">{del.error}</p>}
                        <div className="flex gap-2">
                          <button onClick={confirmDelete} disabled={del.deleting}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">
                            {del.deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                            Delete
                          </button>
                          <button onClick={cancelDelete}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : isReversing ? (
                      <div className="p-2.5 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className="text-purple-500 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-purple-800">
                              Reverse delivery for {rev.items.length} item type{rev.items.length !== 1 ? 's' : ''} ({rev.batchId})?
                            </p>
                            <p className="text-[10px] text-purple-700 font-medium leading-snug">
                              Items will be decremented at the jobsite and returned to the source warehouse. Linked requests will revert to <span className="font-black">"For Delivery"</span> status.
                            </p>
                            {rev.requestIds.length > 0 && (
                              <p className="text-[10px] font-semibold text-purple-600">
                                {rev.requestIds.length} linked request{rev.requestIds.length !== 1 ? 's' : ''} will be affected.
                              </p>
                            )}
                          </div>
                        </div>
                        {rev.error && <p className="text-[10px] font-semibold text-red-600">{rev.error}</p>}
                        <div className="flex gap-2">
                          <button onClick={confirmReverse} disabled={rev.reversing}
                            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">
                            {rev.reversing ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                            Reverse
                          </button>
                          <button onClick={cancelReverse}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button onClick={() => startEdit(g)}
                          className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-blue-500 transition-colors">
                          <Edit3 size={11} /> Edit Notes
                        </button>
                        <button onClick={() => startDelete(g)}
                          className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors">
                          <Trash2 size={11} /> Delete Batch
                        </button>
                        {g.batchId && (g.status === 'Delivered' || g.status === 'Partial') && g.txTypes.includes('delivery') && (
                          <button onClick={() => startReverse(g)}
                            className="flex items-center gap-1 text-[10px] font-bold text-purple-400 hover:text-purple-600 transition-colors">
                            <RotateCcw size={11} /> Reverse Delivery
                          </button>
                        )}
                        {g.batchId && (g.status === 'Delivered' || g.status === 'Partial') && !g.txTypes.includes('delivery') && (
                          <span className="text-[9px] text-gray-400 font-medium italic" title="Delivery transactions were recorded under a different DR number. Find the batch with type 'delivery' to reverse it.">
                            Delivery in separate DR
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Bottom pagination */}
        {!loading && displayed.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button onClick={handlePrev} disabled={page === 0 || loading}
              className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors',
                page === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100 active:scale-95')}>
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="text-[10px] text-gray-400 font-bold">Page {page + 1}</span>
            <button onClick={handleNext} disabled={!hasMore || loading}
              className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors',
                !hasMore ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100 active:scale-95')}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
