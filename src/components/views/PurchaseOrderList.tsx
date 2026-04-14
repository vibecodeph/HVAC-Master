import React, { useState, useMemo } from 'react';
import { Plus, Search, FileText, Calendar, User, ChevronRight, Filter, MoreVertical, Edit2, Trash2, ExternalLink, Package } from 'lucide-react';
import { PurchaseOrder, Location, Item, UOM, UserProfile } from '../../types';
import { deletePurchaseOrder } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { format } from 'date-fns';
import { CreditCard, DollarSign } from 'lucide-react';

interface PurchaseOrderListProps {
  purchaseOrders: PurchaseOrder[];
  locations: Location[];
  items: Item[];
  uoms: UOM[];
  profile: UserProfile | null;
  onAdd: () => void;
  onEdit: (po: PurchaseOrder) => void;
}

export const PurchaseOrderList = ({ purchaseOrders, locations, items, uoms, profile, onAdd, onEdit }: PurchaseOrderListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredPOs = useMemo(() => {
    return purchaseOrders
      .filter(po => {
        const supplier = locations.find(l => l.id === po.supplierId);
        const matchesSearch = 
          po.poNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          supplier?.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || po.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => b.poNumber.localeCompare(a.poNumber));
  }, [purchaseOrders, searchTerm, statusFilter, locations]);

  const getStatusColor = (status: PurchaseOrder['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-600';
      case 'sent': return 'bg-blue-100 text-blue-600';
      case 'partially_received': return 'bg-orange-100 text-orange-600';
      case 'received': return 'bg-green-100 text-green-600';
      case 'cancelled': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getPaymentStatusColor = (status?: PurchaseOrder['paymentStatus']) => {
    switch (status) {
      case 'unpaid': return 'bg-red-50 text-red-500 border-red-100';
      case 'processing': return 'bg-orange-50 text-orange-500 border-orange-100';
      case 'prepared': return 'bg-blue-50 text-blue-500 border-blue-100';
      case 'paid': return 'bg-green-50 text-green-500 border-green-100';
      default: return 'bg-gray-50 text-gray-400 border-gray-100';
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    await deletePurchaseOrder(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Purchase Orders</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Manage supplier orders</p>
        </div>
        <button 
          onClick={onAdd}
          className="p-4 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-transform"
        >
          <Plus size={24} />
        </button>
      </div>

      <div className="flex space-x-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            placeholder="Search PO # or Supplier..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-white rounded-2xl text-sm font-medium shadow-sm border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select 
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-4 bg-white rounded-2xl text-sm font-bold shadow-sm border border-gray-100 outline-none appearance-none min-w-[120px]"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="partially_received">Partial</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="space-y-4">
        {filteredPOs.length === 0 ? (
          <div className="p-12 text-center bg-gray-50 rounded-[2.5rem] border-2 border-dashed border-gray-200">
            <FileText className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-500 font-bold">No purchase orders found</p>
          </div>
        ) : (
          filteredPOs.map(po => {
            const supplier = locations.find(l => l.id === po.supplierId);
            return (
              <div 
                key={po.id}
                onClick={() => onEdit(po)}
                className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-md transition-shadow group cursor-pointer active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      <FileText size={24} />
                    </div>
                    <div>
                      <h3 className="font-black text-gray-900 leading-none mb-1">{po.poNumber}</h3>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{supplier?.name || po.supplierId || 'Unknown Supplier'}</p>
                    </div>
                  </div>
                  <div className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    getStatusColor(po.status)
                  )}>
                    {po.status.replace('_', ' ')}
                  </div>
                </div>

                <div className="flex items-center space-x-2 mb-4">
                  <div className={cn(
                    "px-2 py-0.5 rounded-lg border text-[8px] font-black uppercase tracking-widest flex items-center space-x-1",
                    getPaymentStatusColor(po.paymentStatus)
                  )}>
                    <DollarSign size={8} />
                    <span>{po.paymentStatus || 'unpaid'}</span>
                  </div>
                  {po.paymentStatus === 'paid' && (
                    <div className="px-2 py-0.5 bg-green-500 text-white rounded-lg text-[8px] font-black uppercase tracking-widest">
                      FULLY PAID
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center space-x-2 text-gray-500">
                    <Calendar size={14} />
                    <span className="text-[10px] font-bold">
                      {po.date && typeof po.date.toDate === 'function' 
                        ? format(po.date.toDate(), 'MMM dd, yyyy') 
                        : (po.createdAt && typeof po.createdAt.toDate === 'function' 
                            ? format(po.createdAt.toDate(), 'MMM dd, yyyy') 
                            : 'Just now')}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-500">
                    <User size={14} />
                    <span className="text-[10px] font-bold truncate">{po.createdByName || 'System'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <Package size={14} className="text-gray-400" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {po.items.length} {po.items.length === 1 ? 'Item' : 'Items'}
                      </span>
                    </div>
                    {po.status !== 'draft' && po.status !== 'cancelled' && (
                      <div className="w-full max-w-[120px] h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full transition-all duration-500",
                            po.status === 'received' ? "bg-green-500" : "bg-orange-500"
                          )}
                          style={{ 
                            width: `${Math.min(100, (po.items.reduce((acc, item) => acc + (item.receivedQuantity || 0), 0) / po.items.reduce((acc, item) => acc + item.quantity, 0)) * 100)}%` 
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm font-black text-gray-900">
                      {po.totalAmount.toLocaleString()}
                    </span>
                    <div className="flex space-x-1">
                      {deletingId === po.id ? (
                        <div className="flex items-center space-x-1 bg-red-50 p-1 rounded-xl">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(po.id);
                            }}
                            className="px-2 py-1 bg-red-600 text-white text-[10px] font-black rounded-lg uppercase tracking-widest"
                          >
                            Confirm
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(null);
                            }}
                            className="px-2 py-1 bg-gray-200 text-gray-600 text-[10px] font-black rounded-lg uppercase tracking-widest"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(po.id);
                          }}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
