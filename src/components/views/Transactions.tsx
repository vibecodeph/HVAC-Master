import React, { useState, useEffect, useMemo } from 'react';
import { Truck, Wrench, ArrowLeftRight, History, Package, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { deleteTransaction, subscribeToTransactions } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Swipeable } from '../common/Swipeable';
import { Modal } from '../common/Modal';
import { TransactionForm } from '../Forms';
import { Transaction } from '../../types';

export const Transactions = () => {
  const { profile } = useAuth();
  const { items, locations, assets, uoms, inventory, purchaseOrders } = useData();
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferType, setTransferType] = useState<'delivery' | 'usage' | 'return' | 'adjustment'>('delivery');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Pagination state
  const [limitCount, setLimitCount] = useState(50);
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    const assigned = profile?.role === 'admin' ? undefined : (profile?.assignedLocationIds || []);
    const unsub = subscribeToTransactions((data) => {
      setLocalTransactions(data);
      if (data.length < limitCount) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
    }, assigned, limitCount);
    return () => unsub();
  }, [profile, limitCount]);

  const toggleBatch = (batchId: string) => {
    setExpandedBatches(prev => ({ ...prev, [batchId]: !prev[batchId] }));
  };

  const openTransfer = (type: 'delivery' | 'usage' | 'return' | 'adjustment') => {
    setTransferType(type);
    setIsTransferModalOpen(true);
  };

  const handleDelete = async (t: Transaction) => {
    setDeletingId(t.id);
    try {
      await deleteTransaction(t);
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoadMore = () => {
    setLimitCount(prev => prev + 50);
  };

  const { renderedBatches, renderedSingles } = useMemo(() => {
    const batches: Record<string, Transaction[]> = {};
    const singleTransactions: Transaction[] = [];

    localTransactions.forEach(t => {
      if (t.batchId) {
        if (!batches[t.batchId]) batches[t.batchId] = [];
        batches[t.batchId].push(t);
      } else {
        singleTransactions.push(t);
      }
    });

    const batchesList = Object.entries(batches).map(([batchId, batchTransactions]) => {
      const first = batchTransactions[0];
      const from = locations.find(l => l.id === first.fromLocationId);
      const to = locations.find(l => l.id === first.toLocationId);
      const isExpanded = expandedBatches[batchId];

      return (
        <Card key={batchId} className="overflow-hidden">
          <div 
            onClick={() => toggleBatch(batchId)}
            className="flex items-center space-x-3 p-3 bg-blue-50/50 cursor-pointer hover:bg-blue-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Truck size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">
                {from?.name || first.fromLocationId || 'Warehouse'} &rarr; {to?.name || (first.toLocationId === 'in-transit' ? 'In Transit' : (first.toLocationId || 'Jobsite'))}
              </p>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                {first.type === 'pick' ? 'Bulk Pick' : 'Bulk Delivery'}: {batchTransactions.length} items
              </p>
            </div>
            <div className="text-right flex items-center space-x-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase">
                {typeof first.timestamp?.toDate === 'function' ? first.timestamp.toDate().toLocaleDateString() : 'Just now'}
              </p>
              <ChevronRight size={16} className={cn("text-gray-400 transition-transform", isExpanded && "rotate-90")} />
            </div>
          </div>
          
          <AnimatePresence>
            {isExpanded && (
              <motion.div 
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                className="border-t border-blue-100 bg-white"
              >
                {batchTransactions.map(t => {
                  const item = items.find(i => i.id === t.itemId);
                  return (
                    <div key={t.id} className="p-3 border-b border-gray-50 last:border-0 flex justify-between items-center">
                      <div>
                        <p className="text-xs font-bold text-gray-900">{item?.name}</p>
                        {t.variant && Object.keys(t.variant).length > 0 && (
                          <p className="text-[10px] text-blue-500 font-bold uppercase">
                            {Object.values(t.variant).join(', ')}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {t.serialNumber && <span className="text-orange-600 font-black uppercase text-[7px]">SN: {t.serialNumber}</span>}
                          {t.propertyNumber && <span className="text-purple-600 font-black uppercase text-[7px]">PN: {t.propertyNumber}</span>}
                          {t.poNumber && <span className="text-blue-600 font-black uppercase text-[7px]">{t.poNumber}</span>}
                          {t.supplierInvoice && <span className="text-blue-600 font-black uppercase text-[7px]">INV: {t.supplierInvoice}</span>}
                          {t.supplierDR && <span className="text-blue-600 font-black uppercase text-[7px]">SDR: {t.supplierDR}</span>}
                        </div>
                      </div>
                      <p className="text-xs font-black text-gray-900">{t.quantity} <span className="text-[8px] text-gray-400 uppercase">{uoms.find(u => u.id === t.uomId || u.symbol === t.uomId)?.symbol || t.uomId}</span></p>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      );
    });

    const singlesList = singleTransactions.map(t => {
      const item = items.find(i => i.id === t.itemId);
      const from = locations.find(l => l.id === t.fromLocationId);
      const to = locations.find(l => l.id === t.toLocationId);
      
      const isDeleting = deletingId === t.id;
      
      return (
        <div key={t.id} className={cn(isDeleting && "opacity-50 pointer-events-none")}>
          <Swipeable
            canEdit={profile?.role === 'admin'}
            canDelete={profile?.role === 'admin'}
            onEdit={() => setEditingTransaction(t)}
            onDelete={() => handleDelete(t)}
            confirmMessage="Are you sure you want to delete this transaction? This will revert the inventory changes."
          >
            <div className="flex items-center space-x-3 p-3 bg-white relative">
              {isDeleting && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                  <Loader2 className="animate-spin text-blue-600" size={20} />
                </div>
              )}
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0",
                t.type === 'delivery' ? "bg-blue-600" : 
                t.type === 'pick' ? "bg-purple-600" :
                t.type === 'usage' ? "bg-orange-600" : 
                t.type === 'return' ? "bg-green-600" : "bg-gray-900"
              )}>
                {t.type === 'delivery' ? <Truck size={16} /> : 
                 t.type === 'pick' ? <Package size={16} /> :
                 t.type === 'usage' ? <Wrench size={16} /> : 
                 t.type === 'return' ? <ArrowLeftRight size={16} /> : <History size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">
                  {from?.name || t.fromLocationId || 'External'} &rarr; {to?.name || (t.toLocationId === 'in-transit' ? 'In Transit' : (t.toLocationId || 'External'))}
                </p>
                <div className="flex items-center space-x-2">
                  <p className="text-xs text-gray-500">
                    {t.quantity} {uoms.find(u => u.id === t.uomId || u.symbol === t.uomId)?.symbol || t.uomId} x {item?.name || 'Unknown Item'}
                    {t.variant && Object.keys(t.variant).length > 0 && (
                      <span className="ml-1 text-[10px] text-blue-500 font-bold">({Object.values(t.variant).join(', ')})</span>
                    )}
                    {t.serialNumber && <span className="ml-1 text-orange-600 font-black uppercase text-[8px]">SN: {t.serialNumber}</span>}
                    {t.propertyNumber && <span className="ml-1 text-purple-600 font-black uppercase text-[8px]">PN: {t.propertyNumber}</span>}
                    {t.poNumber && <span className="ml-1 text-blue-600 font-black uppercase text-[8px]">{t.poNumber}</span>}
                    {t.supplierInvoice && <span className="ml-1 text-blue-600 font-black uppercase text-[8px]">INV: {t.supplierInvoice}</span>}
                    {t.supplierDR && <span className="ml-1 text-blue-600 font-black uppercase text-[8px]">SDR: {t.supplierDR}</span>}
                  </p>
                  {t.userName && (
                    <>
                      <span className="text-gray-300">•</span>
                      <span className="text-[10px] font-bold text-gray-400">{t.userName}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-gray-400 uppercase">
                  {typeof t.timestamp?.toDate === 'function' ? t.timestamp.toDate().toLocaleDateString() : 'Just now'}
                </p>
              </div>
            </div>
          </Swipeable>
        </div>
      );
    });

    return { renderedBatches: batchesList, renderedSingles: singlesList };
  }, [localTransactions, locations, expandedBatches, items, uoms, profile, deletingId]);

  return (
    <div className="pb-20">
      <Header title="Move Items" />
      <div className="p-4 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {(profile?.role === 'admin' || profile?.role === 'warehouseman') && (
            <button 
              onClick={() => openTransfer('delivery')}
              className="p-6 bg-blue-600 rounded-3xl text-white flex flex-col items-center space-y-3 active:scale-95 transition-transform"
            >
              <Truck size={32} />
              <span className="text-sm font-bold">Delivery</span>
            </button>
          )}
          <button 
            onClick={() => openTransfer('usage')}
            className="p-6 bg-orange-600 rounded-3xl text-white flex flex-col items-center space-y-3 active:scale-95 transition-transform"
          >
            <Wrench size={32} />
            <span className="text-sm font-bold">Usage</span>
          </button>
          <button 
            onClick={() => openTransfer('return')}
            className="p-6 bg-green-600 rounded-3xl text-white flex flex-col items-center space-y-3 active:scale-95 transition-transform"
          >
            <ArrowLeftRight size={32} />
            <span className="text-sm font-bold">Return</span>
          </button>
          <button 
            onClick={() => openTransfer('adjustment')}
            className="p-6 bg-gray-900 rounded-3xl text-white flex flex-col items-center space-y-3 active:scale-95 transition-transform"
          >
            <History size={32} />
            <span className="text-sm font-bold">Adjust</span>
          </button>
        </div>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Recent Transfers</h3>
          <div className="space-y-3">
            {renderedBatches}
            {renderedSingles}
            {hasMore && (
              <button 
                onClick={handleLoadMore}
                className="w-full py-4 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-2xl transition-colors"
              >
                Load More
              </button>
            )}
          </div>
        </section>
      </div>

      <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title={`New ${transferType.charAt(0).toUpperCase() + transferType.slice(1)}`}>
        <TransactionForm 
          items={items} 
          locations={locations} 
          uoms={uoms}
          inventory={inventory}
          purchaseOrders={purchaseOrders}
          profile={profile}
          initialType={transferType}
          onComplete={() => setIsTransferModalOpen(false)} 
        />
      </Modal>

      <Modal isOpen={!!editingTransaction} onClose={() => setEditingTransaction(null)} title="Edit Transaction">
        {editingTransaction && (
          <TransactionForm 
            items={items} 
            locations={locations} 
            uoms={uoms}
            inventory={inventory}
            purchaseOrders={purchaseOrders}
            profile={profile}
            initialData={editingTransaction}
            onComplete={() => setEditingTransaction(null)} 
          />
        )}
      </Modal>
    </div>
  );
};
