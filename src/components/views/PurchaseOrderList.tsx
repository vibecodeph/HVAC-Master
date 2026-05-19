import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Search, FileText, Calendar, User, ChevronRight, Filter, MoreVertical, Edit2, Trash2, ExternalLink, Package, Download, Upload, Loader2, AlertCircle, CheckCircle2, Printer, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PurchaseOrder, Location, Item, UOM, UserProfile } from '../../types';
import { deletePurchaseOrder, getAllPOPayments } from '../../services/inventoryService';
import { POPayment } from '../../types';
import { cn } from '../../lib/utils';
import { format } from 'date-fns';
import { CreditCard, DollarSign } from 'lucide-react';
import { exportPurchaseOrdersToCSV, importPurchaseOrdersFromCSV } from '../../services/csvService';

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
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [isExporting, setIsExporting] = useState(false);

  // Bulk selection
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const allFilteredSelected = filteredPOs.length > 0 && filteredPOs.every(po => selectedIds.has(po.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPOs.map(po => po.id)));
    }
  };

  const exitSelectMode = () => {
    setIsSelecting(false);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    await Promise.all([...selectedIds].map(id => deletePurchaseOrder(id)));
    setIsBulkDeleting(false);
    exitSelectMode();
  };

  const handleDelete = async (id: string) => {
    await deletePurchaseOrder(id);
    setDeletingId(null);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const paymentsMap = new Map<string, POPayment[]>();
      await Promise.all(
        purchaseOrders.map(async po => {
          const payments = await getAllPOPayments(po.id);
          if (payments.length > 0) paymentsMap.set(po.id, payments);
        })
      );
      exportPurchaseOrdersToCSV(purchaseOrders, locations, items, uoms, paymentsMap);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);
    setImportProgress({ current: 0, total: 0 });

    try {
      const result = await importPurchaseOrdersFromCSV(file, items, locations, uoms, purchaseOrders, (current, total) => {
        setImportProgress({ current, total });
      });
      setImportResult(result);
    } catch (error) {
      console.error('Import failed:', error);
      setImportResult({ success: 0, errors: ['Failed to parse CSV file.'] });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <input 
        type="file"
        ref={fileInputRef}
        onChange={handleImport}
        accept=".csv"
        className="hidden"
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight underline underline-offset-8 decoration-blue-600 decoration-4">Purchase Orders</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2 ml-1">Manage supplier orders & template</p>
        </div>
        <div className="flex items-center space-x-3">
          {profile?.role === 'admin' && !isSelecting && (
            <button
              onClick={() => navigate('/purchase-orders/template')}
              title="Template Settings"
              className="p-4 bg-white text-gray-600 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform flex items-center space-x-2"
            >
              <Settings size={20} />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Template</span>
            </button>
          )}
          {!isSelecting && (
            <>
              <button
                onClick={handleExport}
                disabled={isExporting}
                title="Export to CSV"
                className={cn("p-4 bg-white text-gray-600 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform", isExporting && "opacity-60 cursor-not-allowed")}
              >
                {isExporting ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Import from CSV"
                className="p-4 bg-white text-gray-600 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform"
              >
                <Upload size={24} />
              </button>
            </>
          )}
          {profile?.role === 'admin' && !isSelecting && (
            <button
              onClick={() => setIsSelecting(true)}
              title="Select POs"
              className="p-4 bg-white text-gray-600 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform flex items-center space-x-2"
            >
              <CheckCircle2 size={20} />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Select</span>
            </button>
          )}
          {isSelecting ? (
            <button
              onClick={exitSelectMode}
              className="p-4 bg-white text-gray-500 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform"
            >
              <X size={24} />
            </button>
          ) : (
            <button
              onClick={onAdd}
              className="p-4 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-transform"
            >
              <Plus size={24} />
            </button>
          )}
        </div>
      </div>

      {isImporting && (
        <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl flex items-center space-x-4 animate-pulse">
          <Loader2 className="text-blue-500 animate-spin" size={24} />
          <div>
            <p className="text-sm font-black text-blue-900 uppercase tracking-widest">Importing Purchase Orders...</p>
            <p className="text-[10px] font-bold text-blue-400">Processed {importProgress.current} of {importProgress.total} orders</p>
          </div>
        </div>
      )}

      {importResult && (
        <div className={cn(
          "p-6 rounded-3xl border flex flex-col space-y-4",
          importResult.errors.length > 0 ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {importResult.errors.length > 0 ? (
                <AlertCircle className="text-red-500" size={24} />
              ) : (
                <CheckCircle2 className="text-green-500" size={24} />
              )}
              <div>
                <p className={cn(
                  "text-sm font-black uppercase tracking-widest",
                  importResult.errors.length > 0 ? "text-red-900" : "text-green-900"
                )}>
                   Import {importResult.errors.length > 0 ? 'Completed with Errors' : 'Successful'}
                </p>
                <p className={cn(
                  "text-[10px] font-bold",
                  importResult.errors.length > 0 ? "text-red-400" : "text-green-400"
                )}>
                  {importResult.success} orders imported successfully
                </p>
              </div>
            </div>
            <button 
              onClick={() => setImportResult(null)}
              className="text-xs font-black uppercase tracking-widest opacity-50 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
          
          {importResult.errors.length > 0 && (
            <div className="max-h-32 overflow-y-auto bg-white/50 rounded-xl p-3 space-y-1">
              {importResult.errors.map((err, i) => (
                <p key={i} className="text-[10px] font-medium text-red-600 truncate">{err}</p>
              ))}
            </div>
          )}
        </div>
      )}

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
            const isSelected = selectedIds.has(po.id);
            return (
              <div
                key={po.id}
                onClick={() => isSelecting ? toggleSelect(po.id) : onEdit(po)}
                className={cn(
                  "bg-white p-5 rounded-[2rem] shadow-sm border transition-shadow group cursor-pointer active:scale-[0.98] transition-transform",
                  isSelecting && isSelected ? "border-blue-400 ring-2 ring-blue-200" : "border-gray-100 hover:shadow-md"
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center",
                      isSelected ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                    )}>
                      {isSelecting
                        ? isSelected
                          ? <CheckCircle2 size={24} />
                          : <div className="w-6 h-6 rounded-full border-2 border-blue-300" />
                        : <FileText size={24} />
                      }
                    </div>
                    <div>
                      <h3 className={cn('font-black leading-none mb-1', po.poNumber ? 'text-gray-900' : 'text-gray-400 italic font-medium')}>
                        {po.poNumber || 'DRAFT'}
                      </h3>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{supplier?.name || po.supplierId || 'Unknown Supplier'}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {!isSelecting && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/purchase-orders/${po.id}/print`);
                        }}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors bg-blue-50/50"
                        title="View/Print PO"
                      >
                        <Printer size={18} />
                      </button>
                    )}
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                      getStatusColor(po.status)
                    )}>
                      {po.status.replace('_', ' ')}
                    </div>
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
                        {po.items?.length || 0} {po.items?.length === 1 ? 'Item' : 'Items'}
                      </span>
                    </div>
                    {po.status !== 'draft' && po.status !== 'cancelled' && po.items && po.items.length > 0 && (
                      <div className="w-full max-w-[120px] h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full transition-all duration-500",
                            po.status === 'received' ? "bg-green-500" : "bg-orange-500"
                          )}
                          style={{ 
                            width: `${Math.min(100, (po.items.reduce((acc, item) => acc + (item.receivedQuantity || 0), 0) / po.items.reduce((acc, item) => acc + (item.quantity || 0), 0)) * 100)}%` 
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm font-black text-gray-900">
                      {po.totalAmount.toLocaleString()}
                    </span>
                    {!isSelecting && (
                      <div className="flex space-x-1">
                        {deletingId === po.id ? (
                          <div className="flex items-center space-x-1 bg-red-50 p-1 rounded-xl">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(po.id); }}
                              className="px-2 py-1 bg-red-600 text-white text-[10px] font-black rounded-lg uppercase tracking-widest"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                              className="px-2 py-1 bg-gray-200 text-gray-600 text-[10px] font-black rounded-lg uppercase tracking-widest"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingId(po.id); }}
                            disabled={po.status !== 'draft' && po.status !== 'cancelled'}
                            title={po.status !== 'draft' && po.status !== 'cancelled' ? 'Only draft or cancelled POs can be deleted' : 'Delete'}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bulk action bar */}
      {isSelecting && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 px-4 pointer-events-none">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-3 flex items-center space-x-3 pointer-events-auto max-w-lg w-full">
            <button
              onClick={toggleSelectAll}
              className={cn(
                "flex items-center space-x-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors",
                allFilteredSelected ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <CheckCircle2 size={14} />
              <span>{allFilteredSelected ? 'Deselect All' : 'Select All'}</span>
            </button>

            <span className="flex-1 text-xs font-black text-gray-500 text-center">
              {selectedIds.size} selected
            </span>

            {confirmBulkDelete ? (
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-black text-red-600 uppercase tracking-widest whitespace-nowrap">
                  Delete {selectedIds.size}?
                </span>
                <button
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting}
                  className="px-4 py-2 bg-red-600 text-white text-[10px] font-black rounded-2xl uppercase tracking-widest disabled:opacity-50 flex items-center space-x-1"
                >
                  {isBulkDeleting && <Loader2 size={12} className="animate-spin" />}
                  <span>Yes, Delete</span>
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  disabled={isBulkDeleting}
                  className="px-4 py-2 bg-gray-100 text-gray-600 text-[10px] font-black rounded-2xl uppercase tracking-widest"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-red-100 transition-colors"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
