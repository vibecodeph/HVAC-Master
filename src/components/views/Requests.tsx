import React, { useState, useEffect, useMemo } from 'react';
import { ChevronRight, ChevronDown, MapPin, Truck, Wrench, Package, ArrowLeftRight, History, Check, X, AlertTriangle, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { onSnapshot, collection, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { subscribeToRequests, approveRequest, updateRequest, recordBulkPick, recordBulkReceive, approveBulkRequests, updateDeliveryQuantity, cancelRequest } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { PickingModal, RequestApprovalModal, DeliveryQuantityEditModal } from '../Forms';
import { Request } from '../../types';

export const RequestsView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, users, inventory } = useData();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'for delivery' | 'delivered' | 'rejected' | 'cancelled'>('pending');
  const [hasSetDefaultFilter, setHasSetDefaultFilter] = useState(false);

  useEffect(() => {
    if (profile && !hasSetDefaultFilter) {
      if (profile.role === 'warehouseman') {
        setFilter('approved');
      } else if (profile.role === 'worker' || profile.role === 'engineer') {
        setFilter('for delivery');
      }
      setHasSetDefaultFilter(true);
    }
  }, [profile, hasSetDefaultFilter]);
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<Request | null>(null);
  const [adjustingRequest, setAdjustingRequest] = useState<Request | null>(null);
  const [pickingRequests, setPickingRequests] = useState<Request[]>([]);
  const [isPickingModalOpen, setIsPickingModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // ... mid sections omitted for brevity in multi_edit if possible, but edit_file requires precision

  const handleUpdateDeliveryQty = async (requestId: string, newQty: number, createBackorder: boolean) => {
    setIsProcessing(true);
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
      alert(error.message || 'Failed to update delivery quantity');
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
      } else if (profile.role !== 'admin') {
        if (userAssignedJobsites.length > 0) {
          setSelectedJobsiteId(userAssignedJobsites[0].id);
        }
      }
      setHasSetDefaultJobsite(true);
    }
  }, [profile, locations, hasSetDefaultJobsite]);
  
  // Pagination state
  const [limitCount, setLimitCount] = useState(50);
  const [localRequests, setLocalRequests] = useState<Request[]>([]);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    const assigned = profile?.role === 'admin' ? undefined : (profile?.assignedLocationIds || []);
    const unsub = subscribeToRequests((data) => {
      setLocalRequests(data);
      if (data.length < limitCount) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
    }, assigned, limitCount);
    return () => unsub();
  }, [profile, limitCount]);

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
    const filtered = localRequests.filter(r => {
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

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const [siteA] = a.split('|');
      const [siteB] = b.split('|');
      const nameA = locations.find(l => l.id === siteA)?.name || '';
      const nameB = locations.find(l => l.id === siteB)?.name || '';
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.localeCompare(b);
    });

    return { filteredRequests: filtered, groupedByJobsite: grouped, sortedJobsiteIds: sortedKeys };
  }, [localRequests, filter, selectedJobsiteId, locations, profile]);

  const handleApprove = async (request: Request, approvedQty: number, note?: string) => {
    setIsProcessing(true);
    try {
      await approveRequest(request.id, approvedQty, profile?.uid || 'unknown', profile?.displayName, note);
      setEditingRequest(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (request: Request) => {
    setIsProcessing(true);
    try {
      await updateRequest(request.id, { 
        status: 'rejected',
        approverId: profile?.uid || 'unknown',
        approverName: profile?.displayName || '',
        approvedAt: serverTimestamp() as any
      });
      setRejectingRequest(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async (request: Request) => {
    if (!confirm('Are you sure you want to cancel this request?')) return;
    setIsProcessing(true);
    try {
      await cancelRequest(request.id);
    } catch (error) {
      console.error(error);
      alert('Failed to cancel request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeliver = async (
    selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[],
    options?: { customBatchId?: string; customDate?: Date }
  ) => {
    setIsProcessing(true);
    try {
      await recordBulkPick(selections, profile?.uid || 'unknown', profile?.displayName, options);
      setIsPickingModalOpen(false);
      setPickingRequests([]);
    } catch (error: any) {
      alert(error.message || 'Failed to prepare delivery');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReceive = async (requestIds: string[]) => {
    setIsProcessing(true);
    try {
      await recordBulkReceive(requestIds, profile?.uid || 'unknown', profile?.displayName);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveBulk = async (requestIds: string[]) => {
    setIsProcessing(true);
    try {
      await approveBulkRequests(requestIds, profile?.uid || 'unknown', profile?.displayName);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadMore = () => {
    setLimitCount(prev => prev + 50);
  };

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
        <div className="space-y-4 mb-6">
          {userJobsites.length > 1 && (
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select 
                value={selectedJobsiteId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedJobsiteId(val);
                  if (profile?.uid && val !== 'all') {
                    localStorage.setItem(`lastSite_${profile.uid}`, val);
                  }
                }}
                className="w-full pl-10 pr-10 py-3 bg-gray-100 border-none rounded-2xl text-base font-medium focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
              >
                {profile?.role === 'admin' && (
                  <option value="all">All Jobsites</option>
                )}
                {userJobsites.sort((a, b) => a.name.localeCompare(b.name)).map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
            </div>
          )}
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-6 overflow-x-auto no-scrollbar">
          {(['pending', 'approved', 'for delivery', 'delivered', 'rejected', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "flex-1 py-2 px-4 text-xs font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap",
                filter === s ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-8">
          {sortedJobsiteIds.map((groupKey) => {
            const [jobsiteId, batchId] = groupKey.split('|');
            const jobsite = locations.find(l => l.id === jobsiteId);
            const jobsiteRequests = groupedByJobsite[groupKey].sort((a, b) => {
              const itemA = items.find(i => i.id === a.itemId)?.name || '';
              const itemB = items.find(i => i.id === b.itemId)?.name || '';
              return itemA.localeCompare(itemB);
            });

            return (
              <div key={groupKey} className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <div className="flex flex-col">
                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">{jobsite?.name || jobsiteId || 'Unknown Jobsite'}</h3>
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
                  {filter === 'pending' && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'engineer') && jobsiteRequests.length > 0 && (
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
                      onClick={() => {
                        if (isEditable) setAdjustingRequest(r);
                      }}
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
                            <p className="text-xs text-gray-500 uppercase font-bold">
                              {Object.values(r.variant).join(', ')}
                            </p>
                          )}
                          {r.customSpec && (
                            <p className="text-[10px] text-purple-600 uppercase font-bold">
                              {r.customSpec}
                            </p>
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
                          {filter === 'pending' && r.requestorId === profile?.uid && (
                            <button 
                              onClick={() => handleCancel(r)}
                              className="w-10 h-10 flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl active:scale-95 transition-transform hover:text-red-500"
                              title="Cancel Request"
                            >
                              <X size={16} />
                            </button>
                          )}
                          {filter === 'pending' && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'engineer') && (
                            <>
                              <button 
                                onClick={() => setRejectingRequest(r)}
                                className="w-10 h-10 flex items-center justify-center text-red-600 bg-red-50 rounded-xl active:scale-95 transition-transform"
                              >
                                <X size={16} />
                              </button>
                              <button 
                                onClick={() => setEditingRequest(r)}
                                className="w-10 h-10 flex items-center justify-center text-blue-600 bg-blue-50 rounded-xl active:scale-95 transition-transform"
                              >
                                <Check size={16} />
                              </button>
                            </>
                          )}
                          {filter === 'approved' && (profile?.role === 'warehouseman' || profile?.role === 'admin') && (
                            <button 
                              onClick={() => {
                                setPickingRequests([r]);
                                setIsPickingModalOpen(true);
                              }}
                              className="px-4 h-10 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform"
                            >
                              Pick
                            </button>
                          )}
                          {filter === 'for delivery' && profile?.role !== 'warehouseman' && (
                            <button 
                              onClick={() => handleReceive([r.id])}
                              className="px-4 h-10 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform"
                            >
                              Receive
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          })}

          {sortedJobsiteIds.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                <Search size={32} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">No {filter} requests</h3>
                <p className="text-xs text-gray-500 mt-1">Everything is up to date!</p>
              </div>
            </div>
          )}

          {hasMore && (
            <button 
              onClick={handleLoadMore}
              className="w-full py-4 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-2xl transition-colors"
            >
              Load More
            </button>
          )}
        </div>
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
    </div>
  );
};
