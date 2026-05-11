import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Archive, Loader2, MapPin, AlertCircle, Package, RefreshCw } from 'lucide-react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { useAuth, useData } from '../../../App';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Request } from '../../../types';
import { Timestamp } from 'firebase/firestore';

interface ArchivedRequest extends Request {
  archivedAt?: Timestamp;
}

const PAGE_SIZE = 100;

export const ArchivedRequestsView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms } = useData();
  const [records, setRecords] = useState<ArchivedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsiteFilter, setJobsiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = profile?.role === 'admin';

  const fetchArchive = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'requests_archive'),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as ArchivedRequest)));
    } catch (err) {
      console.error('Failed to fetch archived requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchArchive();
  }, [isAdmin]);

  const handleRunArchive = async () => {
    setIsArchiving(true);
    setArchiveMsg(null);
    try {
      const fn = httpsCallable<object, { archived: number }>(functions, 'manualArchiveRequests');
      const result = await fn({});
      const count = result.data.archived;
      setArchiveMsg({
        type: 'success',
        text: count > 0
          ? `Archived ${count} request(s) successfully. List refreshed.`
          : 'No requests qualify for archiving (none older than 30 days).',
      });
      await fetchArchive();
    } catch (err) {
      setArchiveMsg({ type: 'error', text: 'Archive failed. Check console for details.' });
      console.error(err);
    } finally {
      setIsArchiving(false);
    }
  };

  if (!isAdmin) return <Navigate to="/settings" replace />;

  const itemMap = new Map(items.map(i => [i.id, i.name]));
  const uomMap = new Map(uoms.map(u => [u.id, u.symbol]));
  const jobsiteMap = new Map(locations.map(l => [l.id, l.name]));
  const jobsites = locations.filter(l => l.type === 'jobsite' && l.isActive);

  const formatDate = (ts: Timestamp | undefined | null) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts as unknown as number);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
  const toMs = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;

  const filtered = records.filter(r => {
    if (jobsiteFilter && r.jobsiteId !== jobsiteFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (dateFrom || dateTo) {
      const ts = r.timestamp?.toDate ? r.timestamp.toDate().getTime() : 0;
      if (ts < fromMs || ts > toMs) return false;
    }
    return true;
  });

  const statusColor = (s: string) => {
    if (s === 'delivered') return 'bg-emerald-100 text-emerald-700';
    if (s === 'rejected') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="pb-20">
      <Header title="Archived Requests" />
      <div className="p-4 space-y-4">

        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Manual Archive</p>
              <p className="text-[10px] text-gray-500 font-medium leading-tight mt-0.5">
                Moves all delivered/rejected/cancelled requests older than 30 days here.
                The scheduled job also runs automatically every 24 hours.
              </p>
            </div>
            <button
              onClick={handleRunArchive}
              disabled={isArchiving}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform",
                isArchiving && "opacity-60 cursor-not-allowed"
              )}
            >
              {isArchiving ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
              {isArchiving ? 'Archiving…' : 'Run Now'}
            </button>
          </div>
          {archiveMsg && (
            <div className={cn(
              "flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold",
              archiveMsg.type === 'success' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            )}>
              <AlertCircle size={12} />
              {archiveMsg.text}
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Filters</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={jobsiteFilter}
              onChange={e => setJobsiteFilter(e.target.value)}
              className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Jobsites</option>
              {jobsites.map(j => (
                <option key={j.id} value={j.id}>{j.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 outline-none"
            />
          </div>
          <button
            onClick={fetchArchive}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-bold text-blue-500 active:opacity-60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </Card>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-2">
            <Archive size={36} className="text-gray-200" />
            <p className="text-xs font-bold text-gray-400">No archived requests found</p>
            <p className="text-[10px] text-gray-300 font-medium">Requests older than 30 days will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
              {filtered.length} of {records.length} record{records.length !== 1 ? 's' : ''} shown
            </p>
            <Card className="divide-y divide-gray-100">
              {filtered.map(r => (
                <div key={r.id} className="p-3.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Package size={14} className="text-gray-300 shrink-0 mt-0.5" />
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {itemMap.get(r.itemId) || r.itemId}
                      </p>
                    </div>
                    <span className={cn(
                      "shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md",
                      statusColor(r.status)
                    )}>
                      {r.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 font-medium">
                    <span>
                      Qty: <span className="font-bold text-gray-700">
                        {r.deliveredQty ?? r.approvedQty ?? r.requestedQty}{' '}
                        {uomMap.get(r.uomId) || ''}
                      </span>
                    </span>
                    {r.batchId && (
                      <span className="font-bold text-blue-600">{r.batchId}</span>
                    )}
                    {r.requestorName && (
                      <span>by <span className="font-bold text-gray-700">{r.requestorName}</span></span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                    <MapPin size={10} className="shrink-0" />
                    <span className="truncate">{jobsiteMap.get(r.jobsiteId) || r.jobsiteId}</span>
                    <span className="ml-auto shrink-0">{formatDate(r.timestamp)}</span>
                  </div>
                  {r.archivedAt && (
                    <p className="text-[9px] text-gray-300 font-medium">
                      Archived {formatDate(r.archivedAt)}
                    </p>
                  )}
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
