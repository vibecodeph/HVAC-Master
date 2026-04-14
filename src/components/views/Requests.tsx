import React, { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Truck, Wrench, Package, ArrowLeftRight, History, Check, X, AlertTriangle, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { onSnapshot, collection, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { subscribeToRequests, approveRequest, updateRequest, recordBulkPick, recordBulkReceive, approveBulkRequests } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { PickingModal, RequestApprovalModal } from '../Forms';
import { Request } from '../../types';

export const RequestsView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms, users, inventory } = useData();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'for delivery' | 'delivered' | 'rejected'>('pending');
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
  const [pickingRequests, setPickingRequests] = useState<Request[]>([]);
  const [isPickingModalOpen, setIsPickingModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>('all');
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>('all');
  
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
      const matchesItemFilter = filter !== 'delivered' || selectedItemId === 'all' || r.itemId === selectedItemId;
      const matchesJobsiteFilter = selectedJobsiteId === 'all' || r.jobsiteId === selectedJobsiteId;
      
      const jobsite = locations.find(l => l.id === r.jobsiteId);
      const isJobsiteActive = profile?.role === 'admin' || jobsite?.isActive;
      
      const hasJobsiteAccess = (profile?.role === 'admin' || 
                               (profile?.assignedLocationIds && profile.assignedLocationIds.includes(r.jobsiteId))) && isJobsiteActive;

      return matchesStatus && matchesItemFilter && matchesJobsiteFilter && hasJobsiteAccess;
    });

    const grouped = filtered.reduce((acc, r) => {
      if (!acc[r.jobsiteId]) acc[r.jobsiteId] = [];
      acc[r.jobsiteId].push(r);
      return acc;
    }, {} as Record<string, Request[]>);

    const sortedIds = Object.keys(grouped).sort((a, b) => {
      const nameA = locations.find(l => l.id === a)?.name || '';
      const nameB = locations.find(l => l.id === b)?.name || '';
      return nameA.localeCompare(nameB);
    });

    return { filteredRequests: filtered, groupedByJobsite: grouped, sortedJobsiteIds: sortedIds };
  }, [localRequests, filter, selectedItemId, selectedJobsiteId, locations, profile]);

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

  const handleDeliver = async (selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean }[]) => {
    setIsProcessing(true);
    try {
      await recordBulkPick(selections, profile?.uid || 'unknown', profile?.displayName);
      setIsPickingModalOpen(false);
      setPickingRequests([]);
    } catch (error) {
      console.error(error);
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
              <select 
                value={selectedJobsiteId}
                onChange={(e) => setSelectedJobsiteId(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="all">All Jobsites</option>
                {userJobsites.sort((a, b) => a.name.localeCompare(b.name)).map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronRight className="rotate-90" size={16} />
              </div>
            </div>
          )}

          {filter === 'delivered' && (
            <div className="relative">
              <select 
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="all">All Delivered Items</option>
                {Array.from(new Set(localRequests.filter(r => r.status === 'delivered').map(r => r.itemId))).map(itemId => {
                  const item = items.find(i => i.id === itemId);
                  return (
                    <option key={itemId} value={itemId}>{item?.name}</option>
                  );
                })}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronRight className="rotate-90" size={16} />
              </div>
            </div>
          )}
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-6 overflow-x-auto no-scrollbar">
          {(['pending', 'approved', 'for delivery', 'delivered', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "flex-1 py-2 px-4 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap",
                filter === s ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-8">
          {sortedJobsiteIds.map((jobsiteId) => {
            const jobsite = locations.find(l => l.id === jobsiteId);
            const jobsiteRequests = groupedByJobsite[jobsiteId].sort((a, b) => {
              const itemA = items.find(i => i.id === a.itemId)?.name || '';
              const itemB = items.find(i => i.id === b.itemId)?.name || '';
              return itemA.localeCompare(itemB);
            });

            return (
              <div key={jobsiteId} className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">{jobsite?.name || jobsiteId || 'Unknown Jobsite'}</h3>
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
                  {filter === 'pending' && profile?.role === 'admin' && jobsiteRequests.length > 0 && (
                    <button
                      disabled={isProcessing}
                      onClick={() => handleApproveBulk(jobsiteRequests.map(r => r.id))}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline active:scale-95 transition-transform disabled:opacity-50"
                    >
                      Approve All
                    </button>
                  )}
                  {filter === 'for delivery' && jobsiteRequests.length > 0 && (
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
                  
                  return (
                    <Card key={r.id} className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-bold text-gray-900">{item?.name}</h4>
                          {r.variant && Object.keys(r.variant).length > 0 && (
                            <p className="text-[10px] text-gray-500 uppercase font-bold">
                              {Object.values(r.variant).join(', ')}
                            </p>
                          )}
                          {r.workerNote && (
                            <p className="text-[10px] text-blue-600 font-medium mt-1 italic">
                              "{r.workerNote}"
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-blue-600">{filter === 'pending' ? r.requestedQty : r.approvedQty}</p>
                          <p className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === r.uomId || u.symbol === r.uomId)?.symbol || r.uomId}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold">
                            {(r.requestorName || requestor?.displayName)?.[0] || '?'}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-gray-500">{r.requestorName || requestor?.displayName || 'Worker'}</span>
                            <span className="text-[8px] text-gray-400 font-medium">{formatDate(r.timestamp)}</span>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          {filter === 'pending' && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'engineer') && (
                            <>
                              <button 
                                onClick={() => setRejectingRequest(r)}
                                className="p-2 text-red-600 bg-red-50 rounded-xl active:scale-95 transition-transform"
                              >
                                <X size={16} />
                              </button>
                              <button 
                                onClick={() => setEditingRequest(r)}
                                className="p-2 text-blue-600 bg-blue-50 rounded-xl active:scale-95 transition-transform"
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
                              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                            >
                              Pick
                            </button>
                          )}
                          {filter === 'for delivery' && (
                            <button 
                              onClick={() => handleReceive([r.id])}
                              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
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
    </div>
  );
};
