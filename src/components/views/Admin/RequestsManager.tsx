import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, query, orderBy, limit, getDocs, startAfter,
  doc, updateDoc, deleteDoc, serverTimestamp, QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import {
  Loader2, RefreshCw, Search, ChevronUp, ChevronDown, Trash2,
  AlertTriangle, Edit3, CheckCircle, X, ChevronLeft, ChevronRight, Database,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../../firebase';
import { useAuth, useData } from '../../../App';
import { Request, UserProfile } from '../../../types';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { bulkUpdateRequests } from '../../../services/inventoryService';
import { Timestamp } from 'firebase/firestore';

const PAGE_SIZE = 50;

type SortField = 'timestamp' | 'status' | 'itemId' | 'jobsiteId' | 'requestorName';
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  'for delivery': 'bg-purple-100 text-purple-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const SENSITIVE_FIELDS = ['status', 'batchId'];
const ALL_STATUSES = ['pending', 'approved', 'for delivery', 'delivered', 'rejected', 'cancelled'] as const;

type BulkFieldType = 'status' | 'text' | 'user';
interface BulkFieldDef {
  field: string;
  label: string;
  type: BulkFieldType;
  nameField?: string;
  sensitive?: boolean;
  roleFilter?: (u: UserProfile) => boolean;
}

const BULK_FIELDS: BulkFieldDef[] = [
  { field: 'status',         label: 'Status',       type: 'status', sensitive: true },
  { field: 'batchId',        label: 'Batch / DR',   type: 'text',   sensitive: true },
  { field: 'requestorId',    label: 'Requestor',    type: 'user',   nameField: 'requestorName' },
  { field: 'approverId',     label: 'Approver',     type: 'user',   nameField: 'approverName',
    roleFilter: (u: UserProfile) => ['engineer', 'manager', 'admin'].includes(u.role) },
  { field: 'warehousemanId', label: 'Warehouseman', type: 'user',   nameField: 'warehousemanName',
    roleFilter: (u: UserProfile) => ['warehouseman', 'manager', 'admin'].includes(u.role) },
  { field: 'workerNote',     label: 'Worker Note',  type: 'text' },
  { field: 'engineerNote',   label: 'Eng. Note',    type: 'text' },
];

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
  requestId: string;
  field: string;
  value: string;
  saving: boolean;
  error: string | null;
  nameField?: string;
  nameValue?: string;
}

interface DeleteState {
  requestId: string;
  confirming: boolean;
  deleting: boolean;
  error: string | null;
}

export const RequestsManager = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, categories, users } = useData();

  const [records, setRecords] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [jobsiteFilter, setJobsiteFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [drFilter, setDrFilter] = useState('');

  const [edit, setEdit] = useState<EditState | null>(null);
  const [del, setDel] = useState<DeleteState | null>(null);
  const [isBulkEdit, setIsBulkEdit] = useState(false);
  const [bulkField, setBulkField] = useState<string>('status');
  const [bulkValue, setBulkValue] = useState<string>('');
  const [bulkNameValue, setBulkNameValue] = useState<string>('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const uomMap = useMemo(() => new Map(uoms.map(u => [u.id, u.symbol])), [uoms]);
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l.name])), [locations]);
  const jobsites = useMemo(() => locations.filter(l => l.type === 'jobsite' && l.isActive).sort((a, b) => a.name.localeCompare(b.name)), [locations]);
  const uniqueDRs = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.batchId) set.add(r.batchId); });
    return Array.from(set).sort();
  }, [records]);
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
        collection(db, 'requests'),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE + 1),
      );
      if (pageIndex > 0 && cursors[pageIndex - 1]) {
        q = query(
          collection(db, 'requests'),
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
      setRecords(docs.map(d => ({ id: d.id, ...d.data() } as Request)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'requests', false);
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
      list = list.filter(r =>
        r.id.toLowerCase().includes(q) ||
        r.itemId.toLowerCase().includes(q) ||
        (r.requestorName || '').toLowerCase().includes(q) ||
        (r.batchId || '').toLowerCase().includes(q) ||
        (itemMap.get(r.itemId)?.name || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      list = list.filter(r => r.status === statusFilter);
    }
    if (jobsiteFilter) {
      list = list.filter(r => r.jobsiteId === jobsiteFilter);
    }
    if (categoryFilter) {
      const itemIds = itemsByCategoryId.get(categoryFilter);
      list = list.filter(r => itemIds?.has(r.itemId));
    }
    if (drFilter === '__none__') {
      list = list.filter(r => !r.batchId);
    } else if (drFilter) {
      list = list.filter(r => r.batchId === drFilter);
    }
    list.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortField === 'timestamp') {
        av = a.timestamp?.toDate?.()?.getTime() ?? 0;
        bv = b.timestamp?.toDate?.()?.getTime() ?? 0;
      } else {
        av = String((a as any)[sortField] ?? '');
        bv = String((b as any)[sortField] ?? '');
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [records, search, statusFilter, jobsiteFilter, categoryFilter, drFilter, sortField, sortDir, itemMap, itemsByCategoryId]);

  const hasActiveFilters = !!(search.trim() || statusFilter || jobsiteFilter || categoryFilter || drFilter);

  const currentBulkDef = BULK_FIELDS.find(f => f.field === bulkField);

  const bulkUsers = useMemo(() => {
    const def = BULK_FIELDS.find(f => f.field === bulkField);
    if (!def || def.type !== 'user') return [] as UserProfile[];
    return users
      .filter(u => u.isActive && u.isApproved !== false)
      .filter(u => jobsiteFilter ? (u.assignedLocationIds?.includes(jobsiteFilter) ?? false) : true)
      .filter(u => def.roleFilter ? def.roleFilter(u) : true)
      .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  }, [bulkField, users, jobsiteFilter]);

  const startEdit = (requestId: string, field: string, currentValue: string, nameField?: string, nameValue?: string) => {
    setEdit({ requestId, field, value: currentValue, saving: false, error: null, nameField, nameValue });
  };

  const cancelEdit = () => setEdit(null);

  const saveEdit = async () => {
    if (!edit) return;
    setEdit(e => e ? { ...e, saving: true, error: null } : null);
    try {
      const ref = doc(db, 'requests', edit.requestId);
      const updates: Record<string, any> = {
        [edit.field]: edit.value,
        updatedAt: serverTimestamp(),
      };
      if (edit.nameField !== undefined) {
        updates[edit.nameField] = edit.nameValue ?? '';
      }
      await updateDoc(ref, updates);
      setRecords(prev => prev.map(r => {
        if (r.id !== edit.requestId) return r;
        const patch: any = { [edit.field]: edit.value };
        if (edit.nameField !== undefined) patch[edit.nameField] = edit.nameValue ?? '';
        return { ...r, ...patch };
      }));
      setEdit(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `requests/${edit.requestId}`, false);
      setEdit(e => e ? { ...e, saving: false, error: 'Save failed. Check permissions.' } : null);
    }
  };

  const startDelete = (requestId: string) => {
    setDel({ requestId, confirming: true, deleting: false, error: null });
  };

  const cancelDelete = () => setDel(null);

  const handleBulkUpdate = async () => {
    if (!currentBulkDef || !bulkValue || bulkApplying) return;
    setBulkApplying(true);
    setBulkSuccess(null);
    setBulkError(null);
    try {
      const ids = displayed.map(r => r.id);
      await bulkUpdateRequests(
        ids,
        bulkField,
        bulkValue,
        currentBulkDef.nameField,
        currentBulkDef.type === 'user' ? bulkNameValue : undefined,
      );
      setRecords(prev => prev.map(r => {
        if (!ids.includes(r.id)) return r;
        const patch: any = { [bulkField]: bulkValue };
        if (currentBulkDef.nameField) patch[currentBulkDef.nameField] = bulkNameValue;
        return { ...r, ...patch };
      }));
      setBulkValue('');
      setBulkNameValue('');
      const msg = `Updated ${ids.length} request${ids.length !== 1 ? 's' : ''}.`;
      setBulkSuccess(msg);
      setTimeout(() => setBulkSuccess(null), 6000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'requests/bulk', false);
      setBulkError('Bulk update failed. Check console.');
    } finally {
      setBulkApplying(false);
    }
  };

  const confirmDelete = async () => {
    if (!del) return;
    setDel(d => d ? { ...d, deleting: true, error: null } : null);
    try {
      await deleteDoc(doc(db, 'requests', del.requestId));
      setRecords(prev => prev.filter(r => r.id !== del.requestId));
      setDel(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `requests/${del.requestId}`, false);
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

  const FieldRow = ({ req, field, label }: { req: Request; field: string; label: string }) => {
    const isSensitive = SENSITIVE_FIELDS.includes(field);
    const raw = (req as any)[field];
    const isTimestamp = raw instanceof Timestamp;
    const display = isTimestamp ? formatTs(raw) : (raw !== undefined && raw !== null && raw !== '') ? String(raw) : '—';
    const isEditing = edit?.requestId === req.id && edit.field === field;

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
            {field === 'status' ? (
              <select
                value={edit.value}
                onChange={e => setEdit(ev => ev ? { ...ev, value: e.target.value } : null)}
                className="w-full px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-medium outline-none"
              >
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
                Editing sensitive field — changes affect app behavior.
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
            {field === 'status' ? (
              <span className={cn(
                "text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                STATUS_COLORS[raw] || 'bg-gray-100 text-gray-500'
              )}>
                {raw || '—'}
              </span>
            ) : (
              <span
                className="text-xs font-medium text-gray-700 break-all"
                title={isTimestamp ? undefined : String(raw ?? '')}
              >
                {display}
              </span>
            )}
            {!isTimestamp && raw !== undefined && (
              <button
                onClick={() => !isBulkEdit && startEdit(req.id, field, String(raw ?? ''))}
                disabled={isBulkEdit}
                className={cn(
                  "shrink-0 p-1 transition-colors",
                  isBulkEdit ? "text-gray-200 cursor-not-allowed" : "text-gray-300 hover:text-blue-500"
                )}
              >
                <Edit3 size={11} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const UserFieldRow = ({
    req,
    idField,
    nameField,
    label,
    roleFilter,
  }: {
    req: Request;
    idField: keyof Request;
    nameField: keyof Request;
    label: string;
    roleFilter?: (u: UserProfile) => boolean;
  }) => {
    const currentId   = (req as any)[idField]   as string | undefined;
    const currentName = (req as any)[nameField]  as string | undefined;
    const isEditing   = edit?.requestId === req.id && edit.field === String(idField);

    const filteredUsers = users
      .filter(u => u.isActive && u.isApproved !== false)
      .filter(u => u.assignedLocationIds?.includes(req.jobsiteId) ?? false)
      .filter(u => roleFilter ? roleFilter(u) : true)
      .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

    const userName = (u: UserProfile) => u.displayName || u.email;

    return (
      <div className="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
        <div className="w-32 shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</span>
        </div>
        {isEditing ? (
          <div className="flex-1 space-y-1.5">
            <select
              value={edit.value}
              onChange={e => {
                const u = users.find(u => u.uid === e.target.value);
                setEdit(ev => ev ? { ...ev, value: e.target.value, nameValue: u ? userName(u) : '' } : null);
              }}
              className="w-full px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— select user —</option>
              {filteredUsers.map(u => (
                <option key={u.uid} value={u.uid}>{userName(u)}</option>
              ))}
            </select>
            {filteredUsers.length === 0 && (
              <p className="text-[9px] text-amber-600 font-semibold">
                No eligible users found for this jobsite.
              </p>
            )}
            {edit.error && <p className="text-[9px] text-red-600 font-semibold">{edit.error}</p>}
            <div className="flex gap-1.5">
              <button
                onClick={saveEdit}
                disabled={edit.saving || !edit.value}
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
            <span
              className="text-xs font-medium text-gray-700 break-all"
              title={currentId || ''}
            >
              {currentName || '—'}
            </span>
            <button
              onClick={() => !isBulkEdit && startEdit(req.id, String(idField), currentId || '', String(nameField), currentName || '')}
              disabled={isBulkEdit}
              className={cn(
                "shrink-0 p-1 transition-colors",
                isBulkEdit ? "text-gray-200 cursor-not-allowed" : "text-gray-300 hover:text-blue-500"
              )}
            >
              <Edit3 size={11} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pb-20">
      <Header title="Requests Manager" />
      <div className="p-4 space-y-4">

        {/* Warning banner */}
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-amber-800">Admin Debug Tool</p>
            <p className="text-[10px] text-amber-700 font-medium leading-snug">
              Direct Firestore edits bypass all business logic and inventory transactions.
              Changes to <span className="font-black">status</span>, <span className="font-black">batchId</span>, and <span className="font-black">requestorId</span> can break app state. Use with caution.
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
                placeholder="Search by ID, item, requestor, batch…"
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
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Statuses</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={jobsiteFilter}
              onChange={e => setJobsiteFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Jobsites</option>
              {jobsites.map(j => (
                <option key={j.id} value={j.id}>{j.name}</option>
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
            <select
              value={drFilter}
              onChange={e => setDrFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All DRs</option>
              <option value="__none__">Unassigned (no DR)</option>
              {uniqueDRs.map(dr => (
                <option key={dr} value={dr}>{dr}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              <span>Sort:</span>
              {(['timestamp', 'status', 'requestorName'] as SortField[]).map(f => (
                <button
                  key={f}
                  onClick={() => handleSort(f)}
                  className={cn(
                    "flex items-center gap-0.5 px-2 py-1 rounded-lg transition-colors",
                    sortField === f ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"
                  )}
                >
                  {f === 'timestamp' ? 'Date' : f === 'requestorName' ? 'Name' : f}
                  <SortIcon field={f} />
                </button>
              ))}
            </div>
          </div>
          {hasActiveFilters && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isBulkEdit}
                onChange={e => {
                  setIsBulkEdit(e.target.checked);
                  setEdit(null);
                  if (!e.target.checked) {
                    setBulkSuccess(null);
                    setBulkError(null);
                  }
                }}
                className="w-4 h-4 rounded accent-amber-500"
              />
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                Bulk edit — apply to all {displayed.length} filtered request{displayed.length !== 1 ? 's' : ''}
              </span>
            </label>
          )}
          <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium">
            <span>
              {displayed.length} of {records.length} on this page — Page {page + 1}
            </span>
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

        {/* Bulk edit panel */}
        {isBulkEdit && (
          <Card className="p-4 space-y-3 bg-amber-50 border border-amber-200">
            <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Bulk Edit — {displayed.length} request{displayed.length !== 1 ? 's' : ''} will be updated
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkField}
                onChange={e => { setBulkField(e.target.value); setBulkValue(''); setBulkNameValue(''); }}
                className="px-2.5 py-1.5 bg-white border border-amber-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-amber-400"
              >
                {BULK_FIELDS.map(f => (
                  <option key={f.field} value={f.field}>{f.label}{f.sensitive ? ' ⚠' : ''}</option>
                ))}
              </select>

              {currentBulkDef?.type === 'status' && (
                <select
                  value={bulkValue}
                  onChange={e => setBulkValue(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-amber-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">— select status —</option>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}

              {currentBulkDef?.type === 'text' && (
                <input
                  type="text"
                  value={bulkValue}
                  onChange={e => setBulkValue(e.target.value)}
                  placeholder={`New ${currentBulkDef.label.toLowerCase()}…`}
                  className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-white border border-amber-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-400"
                />
              )}

              {currentBulkDef?.type === 'user' && (
                <select
                  value={bulkValue}
                  onChange={e => {
                    const u = users.find(u => u.uid === e.target.value);
                    setBulkValue(e.target.value);
                    setBulkNameValue(u ? (u.displayName || u.email) : '');
                  }}
                  className="px-2.5 py-1.5 bg-white border border-amber-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">— select user —</option>
                  {bulkUsers.map(u => (
                    <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
                  ))}
                </select>
              )}

              <button
                onClick={handleBulkUpdate}
                disabled={!bulkValue || bulkApplying}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-40"
              >
                {bulkApplying && <Loader2 size={10} className="animate-spin" />}
                Apply to {displayed.length}
              </button>
            </div>

            {currentBulkDef?.sensitive && (
              <p className="text-[9px] font-bold text-amber-700 flex items-center gap-1">
                <AlertTriangle size={9} />
                Sensitive field — changes affect app behavior for all {displayed.length} requests.
              </p>
            )}
            {currentBulkDef?.type === 'user' && bulkUsers.length === 0 && (
              <p className="text-[9px] font-bold text-amber-600">
                No eligible users found{jobsiteFilter ? ' for selected jobsite' : ''}.
              </p>
            )}

            {bulkSuccess && (
              <div className="p-2.5 bg-green-50 rounded-xl border border-green-200 flex items-center gap-2">
                <CheckCircle size={12} className="text-green-500 shrink-0" />
                <span className="text-[10px] font-bold text-green-700">{bulkSuccess}</span>
              </div>
            )}
            {bulkError && (
              <p className="text-[9px] font-semibold text-red-600">{bulkError}</p>
            )}
          </Card>
        )}

        {/* Records */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-2">
            <Database size={36} className="text-gray-200" />
            <p className="text-xs font-bold text-gray-400">No requests found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(req => {
              const isDeleting = del?.requestId === req.id;
              const itemName = itemMap.get(req.itemId)?.name;
              const jobsiteName = locMap.get(req.jobsiteId);
              const uomSymbol = uomMap.get(req.uomId) || '';

              return (
                <Card key={req.id} className={cn(
                  "overflow-hidden",
                  req.status === 'pending' && "border-l-2 border-l-amber-400",
                  req.status === 'approved' && "border-l-2 border-l-blue-400",
                  req.status === 'for delivery' && "border-l-2 border-l-purple-400",
                  req.status === 'delivered' && "border-l-2 border-l-emerald-400",
                  req.status === 'rejected' && "border-l-2 border-l-red-400",
                  req.status === 'cancelled' && "border-l-2 border-l-gray-300",
                )}>
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2 p-3 pb-2 bg-gray-50 border-b border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {itemName || req.itemId}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[9px] font-mono text-gray-400" title={req.id}>
                          {truncateId(req.id)}
                        </span>
                        {jobsiteName && (
                          <span className="text-[10px] font-medium text-gray-500">{jobsiteName}</span>
                        )}
                        {req.batchId && (
                          <span className="text-[9px] font-bold text-blue-500" title={req.batchId}>
                            Batch: {truncateId(req.batchId)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
                        STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500'
                      )}>
                        {req.status}
                      </span>
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="p-3 space-y-0">
                    <FieldRow req={req} field="status" label="Status" />
                    <UserFieldRow
                      req={req}
                      idField="requestorId"
                      nameField="requestorName"
                      label="Requestor"
                    />
                    <UserFieldRow
                      req={req}
                      idField="approverId"
                      nameField="approverName"
                      label="Approver"
                      roleFilter={u => ['engineer', 'manager', 'admin'].includes(u.role)}
                    />
                    <UserFieldRow
                      req={req}
                      idField="warehousemanId"
                      nameField="warehousemanName"
                      label="Warehouseman"
                      roleFilter={u => ['warehouseman', 'manager', 'admin'].includes(u.role)}
                    />
                    <FieldRow req={req} field="batchId" label="Batch / DR" />
                    <FieldRow req={req} field="workerNote" label="Worker Note" />
                    <FieldRow req={req} field="engineerNote" label="Eng. Note" />

                    {/* Read-only computed row */}
                    <div className="flex items-start gap-2 py-1 border-b border-gray-50">
                      <div className="w-32 shrink-0">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Quantity</span>
                      </div>
                      <span className="text-xs font-medium text-gray-700">
                        Req: {req.requestedQty}{uomSymbol && ` ${uomSymbol}`}
                        {req.approvedQty != null && ` · Appr: ${req.approvedQty}${uomSymbol && ` ${uomSymbol}`}`}
                        {req.deliveredQty != null && ` · Del: ${req.deliveredQty}${uomSymbol && ` ${uomSymbol}`}`}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 py-1 border-b border-gray-50">
                      <div className="w-32 shrink-0">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Timestamps</span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium space-y-0.5">
                        <div>Created: {formatTs(req.timestamp)}</div>
                        {req.approvedAt && <div>Approved: {formatTs(req.approvedAt)}</div>}
                        {req.deliveredAt && <div>Delivered: {formatTs(req.deliveredAt)}</div>}
                      </div>
                    </div>
                    {req.backorderOf && (
                      <div className="flex items-start gap-2 py-1 border-b border-gray-50">
                        <div className="w-32 shrink-0">
                          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Backorder Of</span>
                        </div>
                        <span className="text-[10px] font-mono text-orange-500" title={req.backorderOf}>
                          {truncateId(req.backorderOf)}
                        </span>
                      </div>
                    )}
                    {req.serialNumbers && req.serialNumbers.length > 0 && (
                      <div className="flex items-start gap-2 py-1">
                        <div className="w-32 shrink-0">
                          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Serial Nos</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-600 break-all">
                          {req.serialNumbers.join(', ')}
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
                          <p className="text-[10px] font-bold text-red-700">
                            Permanently delete this request? This cannot be undone and will NOT reverse any inventory changes.
                          </p>
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
                        onClick={() => startDelete(req.id)}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors active:opacity-60"
                      >
                        <Trash2 size={11} />
                        Delete Request
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
