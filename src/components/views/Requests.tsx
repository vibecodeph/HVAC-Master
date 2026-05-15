import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, ChevronDown, MapPin, Truck, Wrench, Package, ArrowLeftRight, History, Check, X, AlertTriangle, Search, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { serverTimestamp } from 'firebase/firestore';
import { approveRequest, updateRequest, deleteRequest, recordBulkPick, recordBulkReceive, approveBulkRequests, updateDeliveryQuantity, cancelApproval, unpickRequest } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { PickingModal, RequestApprovalModal, DeliveryQuantityEditModal } from '../Forms';
import { Request } from '../../types';

export const RequestsView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, users, inventory, requests, loadMoreRequests, requestsHasMore } = useData();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [filter, setFilter] = useState<'pending' | 'approved' | 'for delivery' | 'delivered' | 'rejected' | 'for_pull_out'>('pending');
  const [hasSetDefaultFilter, setHasSetDefaultFilter] = useState(false);

  useEffect(() => {
    if (profile && !hasSetDefaultFilter) {
      if (tabParam === 'for-delivery') {
        setFilter('for delivery');
      } else if (tabParam === 'pending') {
        setFilter('pending');
      } else if (profile.role === 'warehouseman') {
        setFilter('approved');
      } else if (profile.role === 'worker' || profile.role === 'engineer') {
        setFilter('for delivery');
      }
      setHasSetDefaultFilter(true);
    }
  }, [profile, hasSetDefaultFilter, tabParam]);
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<Request | null>(null);
  const [adjustingRequest, setAdjustingRequest] = useState<Request | null>(null);
  const [pickingRequests, setPickingRequests] = useState<Request[]>([]);
  const [isPickingModalOpen, setIsPickingModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editRequestForm, setEditRequestForm] = useState<Request | null>(null);
  const [editItemId, setEditItemId] = useState('');
  const [editVariant, setEditVariant] = useState<Record<string, string>>({});
  const [editCustomSpec, setEditCustomSpec] = useState('');
  const [editQty, setEditQty] = useState(1);
  const [editNote, setEditNote] = useState('');
  const [editSourceLocationId, setEditSourceLocationId] = useState('');
  const [editItemSearch, setEditItemSearch] = useState('');
  const [editShowItemSearch, setEditShowItemSearch] = useState(false);
  const [deletingRequest, setDeletingRequest] = useState<Request | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expandedDRs, setExpandedDRs] = useState<Set<string>>(new Set());
  const [expandedJobsites, setExpandedJobsites] = useState<Set<string>>(new Set());

  const handleUpdateDeliveryQty = async (requestId: string, newQty: number, createBackorder: boolean) => {
    setIsProcessing(true);
    setError(null);
    try {
      await updateDeliveryQuantity(
        requestId, 
        newQty, 
        profile?.uid || 'unknown', 
        profile?.displayName || 'Warehouseman',
        createBackorder
      );
      setAdjustingRequest(null);
    } catch (error: any) {
      setError(error.message || 'Failed to update delivery quantity');
    } finally {
      setIsProcessing(false);
    }
  };
  const storageKey = profile?.uid ? `lastSite_${profile.uid}` : null;
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>(() => {
    if (profile?.uid) {
      const saved = localStorage.getItem(`lastSite_${profile.uid}`);
      return saved || 'all';
    }
    return 'all';
  });
  const [hasSetDefaultJobsite, setHasSetDefaultJobsite] = useState(false);

  // Sync with localStorage changes
  useEffect(() => {
    if (!storageKey) return;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        setSelectedJobsiteId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey]);

  // Persist selected jobsite
  useEffect(() => {
    if (selectedJobsiteId && profile?.uid) {
      localStorage.setItem(`lastSite_${profile.uid}`, selectedJobsiteId);
    }
  }, [selectedJobsiteId, profile]);

  useEffect(() => {
    if (profile && locations.length > 0 && !hasSetDefaultJobsite) {
      const storageKey = `lastSite_${profile.uid}`;
      const savedSite = localStorage.getItem(storageKey);
      
      const userAssignedJobsites = locations.filter(l => 
        l.type === 'jobsite' && 
        l.isActive && 
        profile.assignedLocationIds?.includes(l.id)
      );

      if (savedSite && savedSite !== 'all') {
        // Verify user still has access
        const hasAccess = profile.role === 'admin' || profile.role === 'manager' || profile.role === 'warehouseman' || profile.assignedLocationIds?.includes(savedSite);
        if (hasAccess) {
          setSelectedJobsiteId(savedSite);
        }
      }
      setHasSetDefaultJobsite(true);
    }
  }, [profile, locations, hasSetDefaultJobsite]);
  
  const formatDate = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const userJobsites = locations.filter(l => 
    l.type === 'jobsite' && 
    (profile?.role === 'admin' || l.isActive) &&
    (profile?.role === 'admin' || profile?.assignedLocationIds?.includes(l.id))
  );

  const { filteredRequests, groupedByJobsite, sortedJobsiteIds } = useMemo(() => {
    const filtered = requests.filter(r => {
      const matchesStatus = r.status === filter;
      const matchesJobsiteFilter = selectedJobsiteId === 'all' || r.jobsiteId === selectedJobsiteId;
      
      const jobsite = locations.find(l => l.id === r.jobsiteId);
      const isJobsiteActive = profile?.role === 'admin' || jobsite?.isActive;
      
      const hasJobsiteAccess = (profile?.role === 'admin' || 
                               (profile?.assignedLocationIds && profile.assignedLocationIds.includes(r.jobsiteId))) && isJobsiteActive;

      return matchesStatus && matchesJobsiteFilter && hasJobsiteAccess;
    });

    const grouped = filtered.reduce((acc, r) => {
      const showBatch = filter === 'for delivery' || filter === 'delivered';
      const key = showBatch && r.batchId ? `${r.jobsiteId}|${r.batchId}` : r.jobsiteId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(r);
      return acc;
    }, {} as Record<string, Request[]>);

    const parseDrNum = (key: string) => {
      const batch = key.split('|')[1] || '';
      const m = batch.match(/DR#(\d+)-(\d+)/);
      return m ? parseInt(m[1]) * 10000 + parseInt(m[2]) : 0;
    };

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      if (filter === 'delivered') return parseDrNum(b) - parseDrNum(a);
      const [siteA] = a.split('|');
      const [siteB] = b.split('|');
      const nameA = locations.find(l => l.id === siteA)?.name || '';
      const nameB = locations.find(l => l.id === siteB)?.name || '';
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.localeCompare(b);
    });

    return { filteredRequests: filtered, groupedByJobsite: grouped, sortedJobsiteIds: sortedKeys };
  }, [requests, filter, selectedJobsiteId, locations, profile]);

  // For "all jobsites" mode: outer grouping by jobsite so each can collapse
  const { jobsiteGroupMap, sortedJobsiteKeys } = useMemo(() => {
    if (selectedJobsiteId !== 'all') return { jobsiteGroupMap: {} as Record<string, string[]>, sortedJobsiteKeys: [] as string[] };
    const map: Record<string, string[]> = {};
    for (const key of sortedJobsiteIds) {
      const jsId = key.split('|')[0];
      if (!map[jsId]) map[jsId] = [];
      map[jsId].push(key);
    }
    const sorted = Object.keys(map).sort((a, b) => {
      const na = locations.find(l => l.id === a)?.name || '';
      const nb = locations.find(l => l.id === b)?.name || '';
      return na.localeCompare(nb);
    });
    return { jobsiteGroupMap: map, sortedJobsiteKeys: sorted };
  }, [sortedJobsiteIds, selectedJobsiteId, locations]);

  const handleApprove = async (request: Request, approvedQty: number, note?: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      await approveRequest(request.id, approvedQty, profile?.uid || 'unknown', profile?.displayName, note);
      setEditingRequest(null);
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Failed to approve request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (request: Request) => {
    setIsProcessing(true);
    setError(null);
    try {
      await updateRequest(request.id, {
        status: 'rejected',
        approverId: profile?.uid || 'unknown',
        approverName: profile?.displayName || '',
        approvedAt: serverTimestamp() as any
      });
      setRejectingRequest(null);
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Failed to reject request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeliver = async (
    selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[],
    options?: { customBatchId?: string; customDate?: Date }
  ) => {
    setIsProcessing(true);
    setError(null);
    try {
      await recordBulkPick(selections, profile?.uid || 'unknown', profile?.displayName, options);
      setIsPickingModalOpen(false);
      setPickingRequests([]);
    } catch (error: any) {
      setError(error.message || 'Failed to prepare delivery');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReceive = async (requestIds: string[]) => {
    setIsProcessing(true);
    setError(null);
    try {
      await recordBulkReceive(requestIds, profile?.uid || 'unknown', profile?.displayName);
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Failed to receive items');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveBulk = async (requestIds: string[]) => {
    setIsProcessing(true);
    setError(null);
    try {
      await approveBulkRequests(requestIds, profile?.uid || 'unknown', profile?.displayName);
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Failed to approve requests');
    } finally {
      setIsProcessing(false);
    }
  };

  const canEditRequest = (r: Request) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    if (profile.role === 'engineer' || profile.role === 'manager') return r.status !== 'delivered';
    if (profile.role === 'worker') return r.status === 'pending' && r.requestorId === profile.uid;
    return false;
  };

  const canDeleteRequest = (r: Request) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    if (profile.role === 'engineer' || profile.role === 'manager') return r.status !== 'delivered';
    if (profile.role === 'worker') return r.status === 'pending' && r.requestorId === profile.uid;
    return false;
  };

  const openEditModal = (r: Request) => {
    setEditRequestForm(r);
    setEditItemId(r.itemId);
    setEditVariant(r.variant ? { ...r.variant } : {});
    setEditCustomSpec(r.customSpec || '');
    setEditQty(r.requestedQty);
    setEditNote(r.workerNote || '');
    setEditSourceLocationId(r.sourceLocationId || '');
    setEditItemSearch('');
    setEditShowItemSearch(false);
  };

  const closeEditModal = () => {
    setEditRequestForm(null);
    setEditItemSearch('');
    setEditShowItemSearch(false);
  };

  const handleEditSave = async () => {
    if (!editRequestForm || editQty <= 0) return;
    const editItem = items.find(i => i.id === editItemId);
    if (editItem?.variantAttributes && editItem.variantAttributes.length > 0) {
      const dimReqs = editItem.variantConfigs?.[0]?.dimensionRequirements;
      const missingRequired = editItem.variantAttributes.some(attr => {
        const isRequired = !dimReqs || dimReqs[attr.name] !== false;
        return isRequired && !editVariant[attr.name];
      });
      if (missingRequired) {
        setError('Please select all required variant options.');
        return;
      }
    }
    setIsProcessing(true);
    setError(null);
    try {
      await updateRequest(editRequestForm.id, {
        itemId: editItemId,
        variant: Object.keys(editVariant).length > 0 ? editVariant : undefined,
        customSpec: editCustomSpec || undefined,
        requestedQty: editQty,
        uomId: editItem?.uomId || editRequestForm.uomId,
        workerNote: editNote || undefined,
        sourceLocationId: editSourceLocationId || undefined,
      });
      closeEditModal();
      setSuccessMsg('Request updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteRequest = async () => {
    if (!deletingRequest) return;
    const deleted = deletingRequest;
    setDeletingRequest(null);
    try {
      await deleteRequest(deleted.id);
      setSuccessMsg('Request deleted.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete request');
    }
  };

  const handleCancelApproval = async (requestId: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      await cancelApproval(requestId);
      setSuccessMsg('Approval cancelled. Request returned to pending.');
    } catch (err: any) {
      setError(err.message || 'Failed to cancel approval');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnpick = async (requestId: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      await unpickRequest(requestId);
      setSuccessMsg('Items unpicked. Request returned to approved status.');
    } catch (err: any) {
      setError(err.message || 'Failed to unpick request');
    } finally {
      setIsProcessing(false);
    }
  };

  const canCancelApproval = (r: Request) =>
    (profile?.role === 'admin' || profile?.role === 'engineer') && r.status === 'approved';

  const canUnpick = (r: Request) =>
    (profile?.role === 'admin' || profile?.role === 'warehouseman') && r.status === 'for delivery' && !r.deliveredAt;

  return (
    <div className="pb-20 relative">
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/60 backdrop-blur-[2px] z-[100] flex flex-col items-center justify-center"
          >
            <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center space-y-4 border border-gray-100">
              <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Processing Request...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Header title="Requests" />
      
      <div className="p-4">
        {error && (
          <motion.div 
            initial={{ height: 0, opacity: 0, margin: 0 }}
            animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
            exit={{ height: 0, opacity: 0, margin: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="text-red-500 shrink-0" size={18} />
                <p className="text-xs font-bold text-red-700">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 p-1 hover:text-red-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
        {successMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0, margin: 0 }}
            animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
            exit={{ height: 0, opacity: 0, margin: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Check className="text-green-500 shrink-0" size={18} />
                <p className="text-xs font-bold text-green-700">{successMsg}</p>
              </div>
              <button onClick={() => setSuccessMsg(null)} className="text-green-400 p-1 hover:text-green-600 transition-colors">
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
        <div className="space-y-4 mb-6">
          {userJobsites.length > 1 && (
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={selectedJobsiteId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedJobsiteId(val);
                  if (profile?.uid) {
                    localStorage.setItem(`lastSite_${profile.uid}`, val);
                  }
                }}
                className="w-full pl-10 pr-10 py-3 bg-gray-100 border-none rounded-2xl text-base font-medium focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
              >
                <option value="all">All Jobsites</option>
                {userJobsites.sort((a, b) => a.name.localeCompare(b.name)).map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
            </div>
          )}
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-6 overflow-x-auto no-scrollbar">
          {(['pending', 'approved', 'for delivery', 'delivered', 'rejected', 'for_pull_out'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "flex-1 py-2 px-4 text-xs font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap",
                filter === s ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
              )}
            >
              {s === 'for_pull_out' ? 'Pull-Out' : s}
            </button>
          ))}
        </div>

        {(() => {
          const renderGroup = (groupKey: string) => {
            const [jobsiteId, batchId] = groupKey.split('|');
            const jobsite = locations.find(l => l.id === jobsiteId);
            const jobsiteRequests = (groupedByJobsite[groupKey] || []).slice().sort((a, b) => {
              const itemA = items.find(i => i.id === a.itemId)?.name || '';
              const itemB = items.find(i => i.id === b.itemId)?.name || '';
              return itemA.localeCompare(itemB);
            });

            if (filter === 'delivered') {
              const receiverNames = [...new Set(
                jobsiteRequests.map(r => r.receiverName).filter((n): n is string => Boolean(n))
              )];
              const receiverDisplay = receiverNames.length === 0
                ? 'Pending receipt'
                : receiverNames.length === 1
                  ? `Received by ${receiverNames[0]}`
                  : receiverNames.length === 2
                    ? `Received by ${receiverNames.join(' & ')}`
                    : 'Received by multiple';

              const latestDeliveredAt = jobsiteRequests
                .map(r => r.deliveredAt)
                .filter(Boolean)
                .sort((a, b) => {
                  const aT = a?.toDate ? a.toDate().getTime() : 0;
                  const bT = b?.toDate ? b.toDate().getTime() : 0;
                  return bT - aT;
                })[0];

              const isDRExpanded = expandedDRs.has(groupKey);

              return (
                <Card
                  key={groupKey}
                  className="cursor-pointer active:scale-[0.99] transition-all duration-200 p-4"
                  onClick={() => setExpandedDRs(prev => {
                    const next = new Set(prev);
                    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
                    return next;
                  })}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      {selectedJobsiteId === 'all' && (
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest truncate">{jobsite?.name || 'Unknown Jobsite'}</p>
                      )}
                      <p className="text-base font-bold text-blue-600 uppercase tracking-widest mt-0.5">DR# {batchId?.replace('DR#', '') || 'Unassigned'}</p>
                      <p className="text-xs font-semibold text-gray-700 mt-1">{receiverDisplay}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {jobsiteRequests.length} item{jobsiteRequests.length !== 1 ? 's' : ''}{latestDeliveredAt ? ` · ${formatDate(latestDeliveredAt)}` : ''}
                      </p>
                    </div>
                    <div className="ml-3 text-gray-400 shrink-0 mt-1">
                      {isDRExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </div>

                  {isDRExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                      {jobsiteRequests.map(r => {
                        const item = items.find(i => i.id === r.itemId);
                        const receiverLine = [
                          r.receiverName ? `Received by ${r.receiverName}` : '',
                          r.deliveredAt ? formatDate(r.deliveredAt) : ''
                        ].filter(Boolean).join(' · ');
                        return (
                          <div key={r.id} className="flex justify-between items-start">
                            <div className="flex-1 min-w-0 mr-3">
                              <p className="text-sm font-bold text-gray-900 truncate">{item?.name}</p>
                              {r.variant && Object.keys(r.variant).length > 0 && (
                                <p className="text-[10px] text-gray-500 uppercase font-bold">{Object.values(r.variant).join(', ')}</p>
                              )}
                              {r.customSpec && (
                                <p className="text-[10px] text-purple-600 uppercase font-bold">{r.customSpec}</p>
                              )}
                              {receiverLine && (
                                <p className="text-[10px] text-gray-400 mt-0.5">{receiverLine}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-base font-black text-blue-600">{r.deliveredQty ?? r.approvedQty}</p>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === r.uomId || u.symbol === r.uomId)?.symbol || r.uomId}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            }

            return (
              <div key={groupKey} className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <div className="flex flex-col">
                    {selectedJobsiteId !== 'all' && (
                      <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">{jobsite?.name || jobsiteId || 'Unknown Jobsite'}</h3>
                    )}
                    {batchId && (
                      <span className="text-[16px] leading-[16px] font-bold text-blue-600 uppercase tracking-widest mt-0.5">DR# {batchId.replace('DR#', '')}</span>
                    )}
                  </div>
                  {filter === 'approved' && (profile?.role === 'warehouseman' || profile?.role === 'admin') && jobsiteRequests.length > 0 && (
                    <button
                      disabled={isProcessing}
                      onClick={() => {
                        setPickingRequests(jobsiteRequests);
                        setIsPickingModalOpen(true);
                      }}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline active:scale-95 transition-transform disabled:opacity-50"
                    >
                      Pick All for {jobsite?.name}
                    </button>
                  )}
                  {filter === 'pending' && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'warehouseman' || profile?.role === 'engineer') && jobsiteRequests.length > 0 && (
                    <button
                      disabled={isProcessing}
                      onClick={() => handleApproveBulk(jobsiteRequests.map(r => r.id))}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline active:scale-95 transition-transform disabled:opacity-50"
                    >
                      Approve All
                    </button>
                  )}
                  {filter === 'for delivery' && profile?.role !== 'warehouseman' && jobsiteRequests.length > 0 && (
                    <button
                      disabled={isProcessing}
                      onClick={() => handleReceive(jobsiteRequests.map(r => r.id))}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline active:scale-95 transition-transform disabled:opacity-50"
                    >
                      Receive All
                    </button>
                  )}
                </div>
                {jobsiteRequests.map(r => {
                  const item = items.find(i => i.id === r.itemId);
                  const requestor = users.find(u => u.uid === r.requestorId);
                  const isWarehouseman = profile?.role === 'warehouseman' || profile?.role === 'admin';
                  const canReceive = filter === 'for delivery' && profile?.role !== 'warehouseman';
                  const isEditable = filter === 'for delivery' && isWarehouseman && !canReceive;

                  return (
                    <Card
                      key={r.id}
                      className={cn(
                        "p-4 transition-all duration-200",
                        isEditable && "cursor-pointer hover:border-orange-200 hover:bg-orange-50/30 active:scale-[0.99] group"
                      )}
                      onClick={() => { if (isEditable) setAdjustingRequest(r); }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-bold text-gray-900 truncate">{item?.name}</h4>
                            {isEditable && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-orange-100 p-1 rounded-md">
                                <Wrench size={10} className="text-orange-600" />
                              </div>
                            )}
                          </div>
                          {r.variant && Object.keys(r.variant).length > 0 && (
                            <p className="text-xs text-gray-500 uppercase font-bold">{Object.values(r.variant).join(', ')}</p>
                          )}
                          {r.customSpec && (
                            <p className="text-[10px] text-purple-600 uppercase font-bold">{r.customSpec}</p>
                          )}
                        </div>
                        <div className="text-right">
                          {r.batchId && (
                            <div className="mb-1">
                              <span className="text-[10px] font-normal text-white bg-blue-600 px-1.5 py-0.5 rounded-md uppercase tracking-tighter shadow-sm">
                                {r.batchId}
                              </span>
                            </div>
                          )}
                          <p className="text-lg font-black text-blue-600">{filter === 'pending' ? r.requestedQty : r.approvedQty}</p>
                          <p className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === r.uomId || u.symbol === r.uomId)?.symbol || r.uomId}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
                        <div className="flex flex-col space-y-3 min-w-0 flex-1 mr-4">
                          <div className="flex items-center space-x-2">
                            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {(r.requestorName || requestor?.displayName)?.[0] || '?'}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-baseline space-x-2">
                                <span className="text-xs font-bold text-gray-500 whitespace-nowrap">{(r.requestorName || requestor?.displayName || 'Worker').split(' ')[0]}</span>
                                {r.workerNote && (
                                  <span className="text-xs text-gray-400 font-medium italic truncate max-w-[120px] sm:max-w-xs transition-all">"{r.workerNote}"</span>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 font-medium">{formatDate(r.timestamp)}</span>
                            </div>
                          </div>
                          {r.approverId && (
                            <div className="flex items-center space-x-2 pl-3 border-l-2 border-blue-100">
                              <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                                {(r.approverName || users.find(u => u.uid === r.approverId)?.displayName)?.[0] || '?'}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-baseline space-x-2">
                                  <span className="text-xs font-bold text-blue-600 whitespace-nowrap">{(r.approverName || users.find(u => u.uid === r.approverId)?.displayName || 'Approver').split(' ')[0]}</span>
                                  {r.engineerNote && (
                                    <span className="text-xs text-blue-400 font-medium italic truncate max-w-[120px] sm:max-w-xs transition-all">"{r.engineerNote}"</span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-400 font-medium italic">Appr. {formatDate(r.approvedAt)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-2 self-end shrink-0">
                          {filter === 'pending' && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'warehouseman' || profile?.role === 'engineer') && (
                            <>
                              <button onClick={() => setRejectingRequest(r)} className="w-10 h-10 flex items-center justify-center text-red-600 bg-red-50 rounded-xl active:scale-95 transition-transform">
                                <X size={16} />
                              </button>
                              <button onClick={() => setEditingRequest(r)} className="w-10 h-10 flex items-center justify-center text-blue-600 bg-blue-50 rounded-xl active:scale-95 transition-transform">
                                <Check size={16} />
                              </button>
                            </>
                          )}
                          {filter === 'approved' && (profile?.role === 'warehouseman' || profile?.role === 'admin') && (
                            <button
                              onClick={() => { setPickingRequests([r]); setIsPickingModalOpen(true); }}
                              className="px-4 h-10 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform"
                            >
                              Pick
                            </button>
                          )}
                          {canCancelApproval(r) && (
                            <button onClick={() => handleCancelApproval(r.id)} title="Cancel Approval" className="w-9 h-9 flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl active:scale-95 transition-transform hover:text-amber-500 hover:bg-amber-50">
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {filter === 'for delivery' && profile?.role !== 'warehouseman' && (
                            <button onClick={() => handleReceive([r.id])} className="px-4 h-10 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform">
                              Receive
                            </button>
                          )}
                          {canUnpick(r) && (
                            <button onClick={() => handleUnpick(r.id)} title="Unpick" className="w-9 h-9 flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl active:scale-95 transition-transform hover:text-amber-500 hover:bg-amber-50">
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {canEditRequest(r) && (
                            <button onClick={() => openEditModal(r)} title="Edit request" className="w-9 h-9 flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl active:scale-95 transition-transform hover:text-blue-500 hover:bg-blue-50">
                              <Pencil size={14} />
                            </button>
                          )}
                          {canDeleteRequest(r) && (
                            <button onClick={() => setDeletingRequest(r)} title="Delete request" className="w-9 h-9 flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl active:scale-95 transition-transform hover:text-red-500 hover:bg-red-50">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          };

          const isEmpty = selectedJobsiteId === 'all' ? sortedJobsiteKeys.length === 0 : sortedJobsiteIds.length === 0;

          return (
            <>
              {selectedJobsiteId === 'all' ? (
                <div className="space-y-3">
                  {sortedJobsiteKeys.map(jsId => {
                    const jobsite = locations.find(l => l.id === jsId);
                    const groupKeys = jobsiteGroupMap[jsId] || [];
                    const totalCount = groupKeys.reduce((sum, k) => sum + (groupedByJobsite[k]?.length || 0), 0);
                    const isJsExpanded = expandedJobsites.has(jsId);

                    return (
                      <div key={jsId} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer active:bg-gray-50 transition-colors"
                          onClick={() => setExpandedJobsites(prev => {
                            const next = new Set(prev);
                            if (next.has(jsId)) next.delete(jsId); else next.add(jsId);
                            return next;
                          })}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <MapPin size={14} className="text-gray-400 shrink-0" />
                            <span className="text-sm font-black text-gray-900 truncate">{jobsite?.name || 'Unknown Jobsite'}</span>
                            <span className="text-xs font-bold text-gray-400">({totalCount})</span>
                          </div>
                          {isJsExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                        </button>

                        {isJsExpanded && (
                          <div className={cn("px-4 pb-4 border-t border-gray-100", filter === 'delivered' ? 'space-y-3 pt-3' : 'space-y-8 pt-4')}>
                            {groupKeys.map(renderGroup)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={filter === 'delivered' ? 'space-y-3' : 'space-y-8'}>
                  {sortedJobsiteIds.map(renderGroup)}
                </div>
              )}

              {isEmpty && (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                    <Search size={32} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">No {filter === 'for_pull_out' ? 'pull-out' : filter} requests</h3>
                    <p className="text-xs text-gray-500 mt-1">Everything is up to date!</p>
                  </div>
                </div>
              )}

              {requestsHasMore && (
                <button onClick={loadMoreRequests} className="w-full py-4 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-2xl transition-colors">
                  Load More
                </button>
              )}
            </>
          );
        })()}
      </div>

      <Modal isOpen={!!rejectingRequest} onClose={() => setRejectingRequest(null)} title="Reject Request">
        {rejectingRequest && (
          <div className="space-y-6">
            <div className="p-4 bg-red-50 rounded-2xl">
              <p className="text-sm text-red-800 font-medium">Are you sure you want to reject this request?</p>
              <p className="text-xs text-red-600 mt-1">This action cannot be undone.</p>
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setRejectingRequest(null)} className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
                Cancel
              </button>
              <button 
                onClick={() => handleReject(rejectingRequest)}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
              >
                Yes, Reject
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!editingRequest} onClose={() => setEditingRequest(null)} title="Approve Request">
        {editingRequest && (
          <RequestApprovalModal 
            request={editingRequest}
            items={items}
            uoms={uoms}
            onApprove={handleApprove}
            onClose={() => setEditingRequest(null)}
          />
        )}
      </Modal>

      <Modal isOpen={isPickingModalOpen} onClose={() => { setIsPickingModalOpen(false); setPickingRequests([]); }} title="Prepare for Delivery">
        {pickingRequests.length > 0 && (
          <PickingModal 
            requests={pickingRequests}
            items={items}
            locations={locations}
            inventory={inventory}
            uoms={uoms}
            onDeliver={handleDeliver}
            onClose={() => { setIsPickingModalOpen(false); setPickingRequests([]); }}
          />
        )}
      </Modal>

      <Modal isOpen={!!adjustingRequest} onClose={() => setAdjustingRequest(null)} title="Adjust Delivery Quantity">
        {adjustingRequest && (
          <DeliveryQuantityEditModal
            request={adjustingRequest}
            items={items}
            uoms={uoms}
            onUpdate={handleUpdateDeliveryQty}
            onClose={() => setAdjustingRequest(null)}
          />
        )}
      </Modal>

      <Modal isOpen={!!editRequestForm} onClose={closeEditModal} title="Edit Request">
        {editRequestForm && (() => {
          const editItem = items.find(i => i.id === editItemId);
          const warehouses = locations.filter(l => l.type === 'warehouse' && l.isActive);
          const matchingItems = editItemSearch
            ? items.filter(i => i.isActive && i.name.toLowerCase().includes(editItemSearch.toLowerCase())).slice(0, 8)
            : [];
          return (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Item</label>
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-sm font-bold text-gray-900">{editItem?.name || 'Unknown item'}</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    value={editItemSearch}
                    onChange={e => { setEditItemSearch(e.target.value); setEditShowItemSearch(true); }}
                    onFocus={() => setEditShowItemSearch(true)}
                    onBlur={() => setTimeout(() => setEditShowItemSearch(false), 150)}
                    placeholder="Search to change item..."
                    className="w-full pl-8 pr-4 py-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {editShowItemSearch && matchingItems.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white shadow-xl rounded-xl border border-gray-100 z-10 max-h-48 overflow-y-auto mt-1">
                      {matchingItems.map(i => (
                        <button
                          key={i.id}
                          onMouseDown={() => {
                            setEditItemId(i.id);
                            setEditVariant({});
                            setEditCustomSpec('');
                            setEditItemSearch('');
                            setEditShowItemSearch(false);
                          }}
                          className="w-full p-3 text-left text-sm font-medium hover:bg-gray-50 transition-colors"
                        >
                          {i.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {editItem?.variantAttributes && editItem.variantAttributes.length > 0 && (() => {
                const dimReqs = editItem.variantConfigs?.[0]?.dimensionRequirements;
                return (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Variant</label>
                    <div className="grid grid-cols-2 gap-2">
                      {editItem.variantAttributes.map(attr => {
                        const isRequired = !dimReqs || dimReqs[attr.name] !== false;
                        const isMissing = isRequired && !editVariant[attr.name];
                        return (
                          <div key={attr.name} className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                              {attr.name}{isRequired && <span className="text-red-500 ml-0.5">*</span>}
                            </label>
                            <select
                              value={editVariant[attr.name] || ''}
                              onChange={e => setEditVariant(prev => ({ ...prev, [attr.name]: e.target.value }))}
                              className={cn(
                                "w-full p-2 bg-gray-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500",
                                isMissing && "ring-2 ring-red-300"
                              )}
                            >
                              <option value="">Select...</option>
                              {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {editItem?.requireCustomSpec && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{editItem.customSpecLabel || 'Specification'}</label>
                  <input
                    value={editCustomSpec}
                    onChange={e => setEditCustomSpec(e.target.value)}
                    className="w-full p-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Quantity ({uoms.find(u => u.id === editItem?.uomId || u.symbol === editItem?.uomId)?.symbol || editItem?.uomId})
                </label>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={editQty}
                  onChange={e => setEditQty(Number(e.target.value))}
                  className="w-full p-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Note (optional)</label>
                <textarea
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="w-full p-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              {warehouses.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Preferred Source (optional)</label>
                  <select
                    value={editSourceLocationId}
                    onChange={e => setEditSourceLocationId(e.target.value)}
                    className="w-full p-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Any warehouse</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex space-x-3">
                <button onClick={closeEditModal} className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
                  Cancel
                </button>
                <button
                  disabled={editQty <= 0 || !editItemId || (() => {
                    if (!editItem?.variantAttributes?.length) return false;
                    const dimReqs = editItem.variantConfigs?.[0]?.dimensionRequirements;
                    return editItem.variantAttributes.some(attr => {
                      const isRequired = !dimReqs || dimReqs[attr.name] !== false;
                      return isRequired && !editVariant[attr.name];
                    });
                  })()}
                  onClick={handleEditSave}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal isOpen={!!deletingRequest} onClose={() => setDeletingRequest(null)} title="Delete Request">
        {deletingRequest && (
          <div className="space-y-6">
            {deletingRequest.batchId ? (
              <div className="p-4 bg-red-50 rounded-2xl">
                <p className="text-sm font-bold text-red-800">Cannot delete — linked delivery exists</p>
                <p className="text-xs text-red-600 mt-1">
                  This request is part of delivery DR#{deletingRequest.batchId.replace('DR#', '')}. Contact an admin to reverse this delivery first.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-red-50 rounded-2xl">
                <p className="text-sm text-red-800 font-medium">Are you sure you want to delete this request?</p>
                <p className="text-xs text-red-600 mt-1">This action cannot be undone.</p>
              </div>
            )}
            <div className="flex space-x-3">
              <button
                onClick={() => setDeletingRequest(null)}
                className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
              >
                {deletingRequest.batchId ? 'Close' : 'Cancel'}
              </button>
              {!deletingRequest.batchId && (
                <button
                  onClick={handleDeleteRequest}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
                >
                  Yes, Delete
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
