import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, query, orderBy, limit, getDocs, startAfter,
  doc, updateDoc, deleteDoc, serverTimestamp, QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import {
  Loader2, RefreshCw, Search, ChevronUp, ChevronDown, Trash2,
  AlertTriangle, Edit3, CheckCircle, ChevronLeft, ChevronRight, Database,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../../firebase';
import { useAuth, useData } from '../../../App';
import { Transaction } from '../../../types';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';

const PAGE_SIZE = 50;

type SortField = 'timestamp' | 'type' | 'quantity';
type SortDir = 'asc' | 'desc';

const TYPE_COLORS: Record<string, string> = {
  delivery: 'bg-blue-100 text-blue-700',
  usage: 'bg-red-100 text-red-700',
  return: 'bg-orange-100 text-orange-700',
  adjustment: 'bg-amber-100 text-amber-700',
  pick: 'bg-green-100 text-green-700',
};

const TYPE_BORDER: Record<string, string> = {
  delivery: 'border-l-blue-400',
  usage: 'border-l-red-400',
  return: 'border-l-orange-400',
  adjustment: 'border-l-amber-400',
  pick: 'border-l-green-400',
};

const SENSITIVE_FIELDS = ['type', 'fromLocationId', 'toLocationId'];
const ALL_TYPES = ['delivery', 'usage', 'return', 'adjustment', 'pick'] as const;

const formatTs = (ts: Timestamp | undefined | null): string => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts as unknown as number);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

const truncateId = (id: string) => id.length > 12 ? `${id.slice(0, 8)}…` : id;

interface EditState {
  txId: string;
  field: string;
  value: string;
  saving: boolean;
  error: string | null;
}

interface DeleteState {
  txId: string;
  deleting: boolean;
  error: string | null;
}

export const TransactionsManager = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, categories } = useData();

  const [records, setRecords] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [edit, setEdit] = useState<EditState | null>(null);
  const [del, setDel] = useState<DeleteState | null>(null);

  const isAdmin = profile?.role === 'admin';

  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const uomMap = useMemo(() => new Map(uoms.map(u => [u.id, u.symbol])), [uoms]);
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l.name])), [locations]);
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

  const fetchPage = async (pageIndex: number) => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'transactions'),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE + 1),
      );
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
        const newCursors = [...cursors];
        newCursors[pageIndex] = docs[docs.length - 1];
        setCursors(newCursors);
      }
      setRecords(docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'transactions', false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchPage(0);
  }, [isAdmin]);

  const handleRefresh = () => {
    setPage(0);
    setCursors([]);
    fetchPage(0);
  };

  const handleNextPage = () => {
    const next = page + 1;
    setPage(next);
    fetchPage(next);
  };

  const handlePrevPage = () => {
    const prev = page - 1;
    setPage(prev);
    fetchPage(prev);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const displayed = useMemo(() => {
    let list = [...records];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(tx =>
        tx.id.toLowerCase().includes(q) ||
        tx.itemId.toLowerCase().includes(q) ||
        (tx.userName || '').toLowerCase().includes(q) ||
        (tx.batchId || '').toLowerCase().includes(q) ||
        (tx.poNumber || '').toLowerCase().includes(q) ||
        (tx.supplierDR || '').toLowerCase().includes(q) ||
        (itemMap.get(tx.itemId)?.name || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter) {
      list = list.filter(tx => tx.type === typeFilter);
    }
    if (locationFilter) {
      list = list.filter(tx => tx.fromLocationId === locationFilter || tx.toLocationId === locationFilter);
    }
    if (categoryFilter) {
      const itemIds = itemsByCategoryId.get(categoryFilter);
      list = list.filter(tx => itemIds?.has(tx.itemId));
    }
    list.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortField === 'timestamp') {
        av = a.timestamp?.toDate?.()?.getTime() ?? 0;
        bv = b.timestamp?.toDate?.()?.getTime() ?? 0;
      } else if (sortField === 'quantity') {
        av = a.baseQuantity ?? 0;
        bv = b.baseQuantity ?? 0;
      } else {
        av = String((a as any)[sortField] ?? '');
        bv = String((b as any)[sortField] ?? '');
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [records, search, typeFilter, locationFilter, categoryFilter, sortField, sortDir, itemMap, itemsByCategoryId]);

  const startEdit = (txId: string, field: string, currentValue: string) => {
    setEdit({ txId, field, value: currentValue, saving: false, error: null });
  };

  const cancelEdit = () => setEdit(null);

  const saveEdit = async () => {
    if (!edit) return;
    setEdit(e => e ? { ...e, saving: true, error: null } : null);
    try {
      const ref = doc(db, 'transactions', edit.txId);
      await updateDoc(ref, {
        [edit.field]: edit.value,
        updatedAt: serverTimestamp(),
      });
      setRecords(prev => prev.map(tx =>
        tx.id === edit.txId ? { ...tx, [edit.field]: edit.value } : tx
      ));
      setEdit(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `transactions/${edit.txId}`, false);
      setEdit(e => e ? { ...e, saving: false, error: 'Save failed. Check permissions.' } : null);
    }
  };

  const startDelete = (txId: string) => {
    setDel({ txId, deleting: false, error: null });
  };

  const cancelDelete = () => setDel(null);

  const confirmDelete = async () => {
    if (!del) return;
    setDel(d => d ? { ...d, deleting: true, error: null } : null);
    try {
      await deleteDoc(doc(db, 'transactions', del.txId));
      setRecords(prev => prev.filter(tx => tx.id !== del.txId));
      setDel(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${del.txId}`, false);
      setDel(d => d ? { ...d, deleting: false, error: 'Delete failed. Check permissions.' } : null);
    }
  };

  if (!isAdmin) return <Navigate to="/settings" replace />;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronUp size={10} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={10} className="text-blue-500" />
      : <ChevronDown size={10} className="text-blue-500" />;
  };

  const FieldRow = ({ tx, field, label, readOnly }: { tx: Transaction; field: string; label: string; readOnly?: boolean }) => {
    const isSensitive = SENSITIVE_FIELDS.includes(field);
    const raw = (tx as any)[field];
    const isTimestamp = raw instanceof Timestamp;
    const isArray = Array.isArray(raw);
    let display: string;
    if (isTimestamp) {
      display = formatTs(raw);
    } else if (isArray) {
      display = raw.length > 0 ? raw.join(', ') : '—';
    } else if (field === 'fromLocationId' || field === 'toLocationId') {
      display = locMap.get(raw) ? `${locMap.get(raw)} (${truncateId(raw || '')})` : (raw || '—');
    } else {
      display = (raw !== undefined && raw !== null && raw !== '') ? String(raw) : '—';
    }
    const isEditing = edit?.txId === tx.id && edit.field === field;

    return (
      <div className="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
        <div className="w-32 shrink-0">
          <span className={cn(
            "text-[9px] font-black uppercase tracking-widest",
            isSensitive ? "text-amber-500" : "text-gray-400"
          )}>
            {label}
            {isSensitive && <AlertTriangle size={8} className="inline ml-0.5 mb-0.5" />}
          </span>
        </div>
        {isEditing ? (
          <div className="flex-1 space-y-1.5">
            {field === 'type' ? (
              <select
                value={edit.value}
                onChange={e => setEdit(ev => ev ? { ...ev, value: e.target.value } : null)}
                className="w-full px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-medium outline-none"
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={edit.value}
                onChange={e => setEdit(ev => ev ? { ...ev, value: e.target.value } : null)}
                className="w-full px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            )}
            {isSensitive && (
              <p className="text-[9px] text-amber-600 font-semibold flex items-center gap-1">
                <AlertTriangle size={9} />
                Editing this field does NOT update inventory balances.
              </p>
            )}
            {edit.error && (
              <p className="text-[9px] text-red-600 font-semibold">{edit.error}</p>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={saveEdit}
                disabled={edit.saving}
                className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 text-white rounded-lg text-[10px] font-bold active:scale-95 transition-transform disabled:opacity-50"
              >
                {edit.saving ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle size={9} />}
                Save
              </button>
              <button
                onClick={cancelEdit}
                className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-bold active:scale-95 transition-transform"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-start justify-between gap-2 min-w-0">
            {field === 'type' ? (
              <span className={cn(
                "text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                TYPE_COLORS[raw] || 'bg-gray-100 text-gray-500'
              )}>
                {raw || '—'}
              </span>
            ) : (
              <span
                className="text-xs font-medium text-gray-700 break-all"
                title={isTimestamp || isArray ? undefined : String(raw ?? '')}
              >
                {display}
              </span>
            )}
            {!readOnly && !isTimestamp && !isArray && raw !== undefined && (
              <button
                onClick={() => startEdit(tx.id, field, String(raw ?? ''))}
                className="shrink-0 p-1 text-gray-300 hover:text-blue-500 transition-colors"
              >
                <Edit3 size={11} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pb-20">
      <Header title="Transactions Manager" />
      <div className="p-4 space-y-4">

        {/* Warning banner */}
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-amber-800">Admin Debug Tool</p>
            <p className="text-[10px] text-amber-700 font-medium leading-snug">
              Direct Firestore edits bypass all inventory logic. Editing <span className="font-black">type</span>, <span className="font-black">fromLocationId</span>, or <span className="font-black">toLocationId</span> will NOT update inventory balances. Deleting a transaction will NOT reverse stock changes.
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
                placeholder="Search by ID, item, user, batch, PO, DR…"
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="shrink-0 p-2 text-gray-400 hover:text-blue-500 transition-colors"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Types</option>
              {ALL_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Locations</option>
              {allLocations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Categories</option>
              {categories.filter(c => c.isActive).sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              <span>Sort:</span>
              {(['timestamp', 'type', 'quantity'] as SortField[]).map(f => (
                <button
                  key={f}
                  onClick={() => handleSort(f)}
                  className={cn(
                    "flex items-center gap-0.5 px-2 py-1 rounded-lg transition-colors",
                    sortField === f ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"
                  )}
                >
                  {f === 'timestamp' ? 'Date' : f === 'quantity' ? 'Qty' : f}
                  <SortIcon field={f} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium">
            <span>{displayed.length} of {records.length} on this page — Page {page + 1}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevPage}
                disabled={page === 0 || loading}
                className="p-1 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={handleNextPage}
                disabled={!hasMore || loading}
                className="p-1 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </Card>

        {/* Records */}
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
            {displayed.map(tx => {
              const isDeleting = del?.txId === tx.id;
              const itemName = itemMap.get(tx.itemId)?.name;
              const fromName = locMap.get(tx.fromLocationId || '');
              const toName = locMap.get(tx.toLocationId || '');
              const uomSymbol = uomMap.get(tx.uomId) || '';
              const hasLinks = !!(tx.batchId || (tx.requestIds && tx.requestIds.length > 0));

              return (
                <Card key={tx.id} className={cn(
                  "overflow-hidden border-l-2",
                  TYPE_BORDER[tx.type] || 'border-l-gray-300',
                )}>
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2 p-3 pb-2 bg-gray-50 border-b border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {itemName || tx.itemId}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[9px] font-mono text-gray-400" title={tx.id}>
                          {truncateId(tx.id)}
                        </span>
                        {fromName && toName && (
                          <span className="text-[10px] font-medium text-gray-500">{fromName} → {toName}</span>
                        )}
                        {fromName && !toName && (
                          <span className="text-[10px] font-medium text-gray-500">From: {fromName}</span>
                        )}
                        {!fromName && toName && (
                          <span className="text-[10px] font-medium text-gray-500">To: {toName}</span>
                        )}
                        {tx.batchId && (
                          <span className="text-[9px] font-bold text-blue-500" title={tx.batchId}>
                            Batch: {truncateId(tx.batchId)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={cn(
                      "shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                      TYPE_COLORS[tx.type] || 'bg-gray-100 text-gray-500'
                    )}>
                      {tx.type}
                    </span>
                  </div>

                  {/* Fields */}
                  <div className="p-3 space-y-0">
                    <FieldRow tx={tx} field="type" label="Type" />
                    <FieldRow tx={tx} field="userName" label="User" />
                    <FieldRow tx={tx} field="fromLocationId" label="From Location" />
                    <FieldRow tx={tx} field="toLocationId" label="To Location" />
                    <FieldRow tx={tx} field="notes" label="Notes" />
                    <FieldRow tx={tx} field="batchId" label="Batch ID" />
                    <FieldRow tx={tx} field="poNumber" label="PO Number" />
                    <FieldRow tx={tx} field="supplierDR" label="Supplier DR" />
                    <FieldRow tx={tx} field="supplierInvoice" label="Invoice" />

                    {/* Read-only rows */}
                    <div className="flex items-start gap-2 py-1 border-b border-gray-50">
                      <div className="w-32 shrink-0">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Quantity</span>
                      </div>
                      <span className="text-xs font-medium text-gray-700">
                        {tx.quantity}{uomSymbol && ` ${uomSymbol}`}
                        {tx.conversionFactor !== 1 && ` (base: ${tx.baseQuantity})`}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 py-1 border-b border-gray-50">
                      <div className="w-32 shrink-0">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Timestamp</span>
                      </div>
                      <span className="text-xs font-medium text-gray-700">{formatTs(tx.timestamp)}</span>
                    </div>
                    {tx.requestIds && tx.requestIds.length > 0 && (
                      <div className="flex items-start gap-2 py-1">
                        <div className="w-32 shrink-0">
                          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Request IDs</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-600 break-all">
                          {tx.requestIds.map(truncateId).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Delete section */}
                  <div className="px-3 pb-3">
                    {isDeleting ? (
                      <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-red-700">
                              Permanently delete this transaction? This will NOT reverse any inventory stock changes.
                            </p>
                            {hasLinks && (
                              <p className="text-[10px] font-bold text-red-600">
                                ⚠ This transaction has linked {tx.batchId ? 'batch' : ''}{tx.batchId && tx.requestIds?.length ? ' and ' : ''}{tx.requestIds?.length ? 'requests' : ''} — deleting may cause data inconsistencies.
                              </p>
                            )}
                          </div>
                        </div>
                        {del.error && (
                          <p className="text-[10px] font-semibold text-red-600">{del.error}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={confirmDelete}
                            disabled={del.deleting}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50"
                          >
                            {del.deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                            Delete
                          </button>
                          <button
                            onClick={cancelDelete}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startDelete(tx.id)}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors active:opacity-60"
                      >
                        <Trash2 size={11} />
                        Delete Transaction
                      </button>
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
            <button
              onClick={handlePrevPage}
              disabled={page === 0 || loading}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors",
                page === 0 ? "text-gray-300 cursor-not-allowed" : "text-gray-600 hover:bg-gray-100 active:scale-95"
              )}
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <span className="text-[10px] text-gray-400 font-bold">Page {page + 1}</span>
            <button
              onClick={handleNextPage}
              disabled={!hasMore || loading}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors",
                !hasMore ? "text-gray-300 cursor-not-allowed" : "text-gray-600 hover:bg-gray-100 active:scale-95"
              )}
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
