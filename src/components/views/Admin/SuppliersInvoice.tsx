import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, Plus, X, ChevronLeft, Loader2, Trash2, Pencil, Receipt } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { useAuth, useData } from '../../../App';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Pagination } from '../../common/Pagination';
import { SuppliersInvoice, SuppliersInvoiceItem } from '../../../types';
import {
  subscribeToSuppliersInvoices,
  createSuppliersInvoice,
  updateSuppliersInvoice,
  deleteSuppliersInvoice,
} from '../../../services/suppliersInvoiceService';

const ITEMS_PER_PAGE = 15;
const todayStr = () => new Date().toISOString().slice(0, 10);

interface FormItemState {
  key: string;
  itemId: string;
  itemSearch: string;
  showSearch: boolean;
  variant: Record<string, string>;
  quantity: string;
  unitPrice: string;
}

const emptyFormItem = (): FormItemState => ({
  key: Math.random().toString(36).slice(2),
  itemId: '',
  itemSearch: '',
  showSearch: false,
  variant: {},
  quantity: '',
  unitPrice: '',
});

export const SuppliersInvoiceView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms } = useData();

  const [invoices, setInvoices] = useState<SuppliersInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingInvoice, setEditingInvoice] = useState<SuppliersInvoice | null>(null);

  // List state
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formBillNumber, setFormBillNumber] = useState('');
  const [formDate, setFormDate] = useState(todayStr());
  const [formLocationId, setFormLocationId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<FormItemState[]>([emptyFormItem()]);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    return subscribeToSuppliersInvoices(data => {
      setInvoices(data);
      setLoading(false);
    });
  }, [isAdmin]);

  // Default to Main Warehouse on mount
  useEffect(() => {
    if (formLocationId || locations.length === 0) return;
    const mainWh = locations.find(l => l.type === 'warehouse' && l.name === 'Main Warehouse' && l.isActive)
      || locations.find(l => l.type === 'warehouse' && l.isActive);
    if (mainWh) setFormLocationId(mainWh.id);
  }, [locations, formLocationId]);

  if (!isAdmin) return <Navigate to="/" replace />;

  // ─── List computed ────────────────────────────────────────────────────────
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const s = search.toLowerCase();
      const matchesSearch = !s ||
        inv.supplierName.toLowerCase().includes(s) ||
        inv.billNumber.toLowerCase().includes(s);
      const invDate = inv.purchaseDate?.toDate?.() ?? new Date(0);
      const matchesFrom = !dateFrom || invDate >= new Date(dateFrom);
      const matchesTo = !dateTo || invDate <= new Date(dateTo + 'T23:59:59');
      return matchesSearch && matchesFrom && matchesTo;
    });
  }, [invoices, search, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE);
  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // ─── Form computed ────────────────────────────────────────────────────────
  const computedTotal = useMemo(() =>
    formItems.reduce((sum, fi) => {
      const qty = parseFloat(fi.quantity) || 0;
      const price = parseFloat(fi.unitPrice) || 0;
      return sum + qty * price;
    }, 0),
    [formItems]
  );

  const availableLocations = useMemo(() =>
    locations.filter(l => (l.type === 'warehouse' || l.type === 'jobsite') && l.isActive),
    [locations]
  );

  // ─── Form helpers ─────────────────────────────────────────────────────────
  const resetForm = () => {
    const mainWh = locations.find(l => l.type === 'warehouse' && l.name === 'Main Warehouse' && l.isActive)
      || locations.find(l => l.type === 'warehouse' && l.isActive);
    setFormSupplierName('');
    setFormBillNumber('');
    setFormDate(todayStr());
    setFormLocationId(mainWh?.id || '');
    setFormNotes('');
    setFormItems([emptyFormItem()]);
    setFormError(null);
    setEditingInvoice(null);
  };

  const openCreate = () => { resetForm(); setView('form'); };

  const openEdit = (invoice: SuppliersInvoice) => {
    setEditingInvoice(invoice);
    setFormSupplierName(invoice.supplierName);
    setFormBillNumber(invoice.billNumber);
    setFormDate(invoice.purchaseDate?.toDate?.().toISOString().slice(0, 10) ?? todayStr());
    setFormLocationId(invoice.locationId);
    setFormNotes(invoice.notes || '');
    setFormItems(invoice.items.map(item => ({
      key: Math.random().toString(36).slice(2),
      itemId: item.itemId,
      itemSearch: '',
      showSearch: false,
      variant: item.variant || {},
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
    })));
    setFormError(null);
    setView('form');
  };

  const updateFormItem = (idx: number, patch: Partial<FormItemState>) => {
    setFormItems(prev => prev.map((fi, i) => i === idx ? { ...fi, ...patch } : fi));
  };

  const removeFormItem = (idx: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== idx));
  };

  const selectItem = (idx: number, itemId: string) => {
    const item = items.find(i => i.id === itemId);
    updateFormItem(idx, { itemId, itemSearch: '', showSearch: false, variant: {} });
    // Pre-fill variant keys if required
    if (item?.variantAttributes?.length) {
      const v: Record<string, string> = {};
      item.variantAttributes.forEach(attr => { v[attr.name] = ''; });
      updateFormItem(idx, { itemId, itemSearch: '', showSearch: false, variant: v });
    }
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setFormError(null);

    if (!formSupplierName.trim()) { setFormError('Supplier name is required'); return; }
    if (!formBillNumber.trim()) { setFormError('Bill number is required'); return; }
    if (!formDate) { setFormError('Date is required'); return; }
    if (!formLocationId) { setFormError('Location is required'); return; }
    if (formItems.length === 0) { setFormError('Add at least one item'); return; }

    for (let i = 0; i < formItems.length; i++) {
      const fi = formItems[i];
      if (!fi.itemId) { setFormError(`Row ${i + 1}: select an item`); return; }
      const qty = parseFloat(fi.quantity);
      if (!fi.quantity || isNaN(qty) || qty <= 0) { setFormError(`Row ${i + 1}: quantity must be > 0`); return; }
      const price = parseFloat(fi.unitPrice);
      if (fi.unitPrice === '' || isNaN(price) || price < 0) { setFormError(`Row ${i + 1}: enter a valid unit price`); return; }
      const itemDef = items.find(it => it.id === fi.itemId);
      if (itemDef?.requireVariant) {
        const filled = itemDef.variantAttributes?.every(attr => fi.variant[attr.name]);
        if (!filled) { setFormError(`Row ${i + 1}: variant selection required`); return; }
      }
    }

    const location = locations.find(l => l.id === formLocationId);
    const invoiceItems: SuppliersInvoiceItem[] = formItems.map(fi => {
      const itemDef = items.find(it => it.id === fi.itemId)!;
      const uom = uoms.find(u => u.id === itemDef.uomId || u.symbol === itemDef.uomId);
      const qty = parseFloat(fi.quantity);
      const price = parseFloat(fi.unitPrice);
      return {
        itemId: fi.itemId,
        itemName: itemDef.name,
        variant: Object.keys(fi.variant).length > 0 && Object.values(fi.variant).every(v => v)
          ? fi.variant : undefined,
        quantity: qty,
        unitPrice: price,
        uomId: itemDef.uomId,
        uomSymbol: uom?.symbol || itemDef.uomId,
        totalPrice: qty * price,
      };
    });

    const formData = {
      supplierName: formSupplierName.trim(),
      billNumber: formBillNumber.trim(),
      purchaseDate: Timestamp.fromDate(new Date(formDate)),
      items: invoiceItems,
      locationId: formLocationId,
      locationName: location?.name || '',
      totalAmount: computedTotal,
      notes: formNotes.trim() || undefined,
    };

    setFormSubmitting(true);
    try {
      if (editingInvoice) {
        await updateSuppliersInvoice(editingInvoice, formData);
      } else {
        await createSuppliersInvoice(formData);
      }
      resetForm();
      setView('list');
    } catch (e: any) {
      setFormError(e.message || 'Failed to save invoice');
    } finally {
      setFormSubmitting(false);
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (invoice: SuppliersInvoice) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteSuppliersInvoice(invoice);
      setConfirmDeleteId(null);
    } catch (e: any) {
      setDeleteError(e.message || 'Failed to delete invoice');
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Form View ────────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div className="pb-20">
        <Header title={editingInvoice ? 'Edit Invoice' : 'New Invoice'} />
        <div className="p-4 space-y-5">
          <button
            onClick={() => { resetForm(); setView('list'); }}
            className="flex items-center space-x-2 text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft size={16} />
            <span>Back to list</span>
          </button>

          {formError && (
            <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-center justify-between">
              <p className="text-xs font-bold text-red-700">{formError}</p>
              <button onClick={() => setFormError(null)} className="text-red-400 hover:text-red-600 ml-2"><X size={14} /></button>
            </div>
          )}

          {/* Supplier Info */}
          <Card className="p-4 space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Invoice Details</h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Supplier Name *</label>
                <input
                  type="text"
                  value={formSupplierName}
                  onChange={e => setFormSupplierName(e.target.value)}
                  placeholder="e.g. ABC Hardware"
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bill Number *</label>
                <input
                  type="text"
                  value={formBillNumber}
                  onChange={e => setFormBillNumber(e.target.value)}
                  placeholder="e.g. INV-2025-001"
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Date *</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Receive At *</label>
                <select
                  value={formLocationId}
                  onChange={e => setFormLocationId(e.target.value)}
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select location...</option>
                  {availableLocations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* Items */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Items</h3>
              <button
                onClick={() => setFormItems(prev => [...prev, emptyFormItem()])}
                className="flex items-center space-x-1 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors"
              >
                <Plus size={12} />
                <span>Add Item</span>
              </button>
            </div>

            <div className="space-y-4">
              {formItems.map((fi, idx) => {
                const itemDef = items.find(i => i.id === fi.itemId);
                const uom = itemDef ? uoms.find(u => u.id === itemDef.uomId || u.symbol === itemDef.uomId) : null;
                const lineTotal = (parseFloat(fi.quantity) || 0) * (parseFloat(fi.unitPrice) || 0);
                const matchingItems = fi.itemSearch
                  ? items.filter(i => i.isActive && i.name.toLowerCase().includes(fi.itemSearch.toLowerCase())).slice(0, 8)
                  : [];

                return (
                  <div key={fi.key} className="p-3 bg-gray-50 rounded-xl space-y-3 relative">
                    <div className="flex items-start justify-between">
                      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Item {idx + 1}</span>
                      {formItems.length > 1 && (
                        <button onClick={() => removeFormItem(idx)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Item selector */}
                    <div className="space-y-1.5">
                      {itemDef ? (
                        <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{itemDef.name}</p>
                            {uom && <p className="text-[10px] text-gray-400 font-medium">{uom.name}</p>}
                          </div>
                          <button
                            onClick={() => updateFormItem(idx, { itemId: '', variant: {}, itemSearch: '' })}
                            className="text-gray-400 hover:text-red-500 ml-2 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
                          <input
                            value={fi.itemSearch}
                            onChange={e => updateFormItem(idx, { itemSearch: e.target.value, showSearch: true })}
                            onFocus={() => updateFormItem(idx, { showSearch: true })}
                            onBlur={() => setTimeout(() => updateFormItem(idx, { showSearch: false }), 150)}
                            placeholder="Search item..."
                            className="w-full pl-8 pr-3 py-2 bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 border border-gray-200"
                          />
                          {fi.showSearch && matchingItems.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-white shadow-xl rounded-xl border border-gray-100 z-20 max-h-40 overflow-y-auto mt-1">
                              {matchingItems.map(i => (
                                <button
                                  key={i.id}
                                  onMouseDown={() => selectItem(idx, i.id)}
                                  className="w-full p-3 text-left text-sm font-medium hover:bg-gray-50 transition-colors"
                                >
                                  {i.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Variant selector */}
                    {itemDef?.variantAttributes && itemDef.variantAttributes.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {itemDef.variantAttributes.map(attr => (
                          <div key={attr.name} className="space-y-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{attr.name}</label>
                            <select
                              value={fi.variant[attr.name] || ''}
                              onChange={e => updateFormItem(idx, { variant: { ...fi.variant, [attr.name]: e.target.value } })}
                              className="w-full p-2 bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 border border-gray-200"
                            >
                              <option value="">Select...</option>
                              {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Qty, Price, UOM row */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Qty *</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={fi.quantity}
                          onChange={e => updateFormItem(idx, { quantity: e.target.value })}
                          placeholder="0"
                          className="w-full p-2 bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 border border-gray-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                          Unit Price *
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={fi.unitPrice}
                          onChange={e => updateFormItem(idx, { unitPrice: e.target.value })}
                          placeholder="0.00"
                          className="w-full p-2 bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 border border-gray-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">UOM</label>
                        <div className="p-2 bg-gray-100 rounded-xl text-sm text-gray-500 font-medium">
                          {uom?.symbol || (itemDef?.uomId ?? '—')}
                        </div>
                      </div>
                    </div>

                    {lineTotal > 0 && (
                      <div className="text-right text-xs font-bold text-gray-700">
                        Line total: ₱{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Notes + Total */}
          <Card className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
              <textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
                className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-900 rounded-xl">
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Total Invoice</span>
              <span className="text-lg font-black text-white">
                ₱{computedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </Card>

          <button
            onClick={handleSubmit}
            disabled={formSubmitting}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {formSubmitting ? <Loader2 className="animate-spin" size={16} /> : (editingInvoice ? 'Save Changes' : 'Save Invoice')}
          </button>
        </div>
      </div>
    );
  }

  // ─── List View ────────────────────────────────────────────────────────────
  return (
    <div className="pb-20">
      <Header title="Supplier Invoices" />
      <div className="p-4 space-y-4">

        {/* Search + New button */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              placeholder="Search supplier, bill number..."
              className="w-full pl-9 pr-9 py-3 bg-gray-100 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            )}
          </div>
          <button
            onClick={openCreate}
            className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all shadow-lg shadow-blue-500/20"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
              className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
              className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-[10px] font-bold text-blue-600 uppercase tracking-widest flex items-center gap-1"
          >
            <X size={11} />
            Clear dates
          </button>
        )}

        {deleteError && (
          <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-center justify-between">
            <p className="text-xs font-bold text-red-700">{deleteError}</p>
            <button onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600 ml-2"><X size={14} /></button>
          </div>
        )}

        {/* Invoice list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
              <Receipt size={32} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">No invoices found</h3>
              <p className="text-xs text-gray-500 mt-1">
                {search || dateFrom || dateTo ? 'Try adjusting your filters.' : 'Create your first supplier invoice.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedInvoices.map(inv => {
              const isConfirmingDelete = confirmDeleteId === inv.id;
              const dateStr = inv.purchaseDate?.toDate?.().toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
              }) ?? '—';

              return (
                <Card key={inv.id} className="p-4 space-y-3 border-gray-100 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-gray-900">{inv.supplierName}</h4>
                        <span className="text-[9px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-bold uppercase tracking-wider">
                          {inv.billNumber}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">{dateStr} · {inv.locationName}</p>
                    </div>
                    <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
                      <button
                        onClick={() => openEdit(inv)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteId(inv.id); setDeleteError(null); }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-medium">
                      {inv.items.length} item{inv.items.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-base font-black text-gray-900">
                      ₱{inv.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {inv.notes && (
                    <p className="text-[10px] text-gray-400 italic">{inv.notes}</p>
                  )}

                  {isConfirmingDelete && (
                    <div className="p-3 bg-red-50 rounded-xl border border-red-100 space-y-2">
                      <p className="text-xs font-bold text-red-700">
                        Delete this invoice? Items will be removed from inventory.
                      </p>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleDelete(inv)}
                          disabled={isDeleting}
                          className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isDeleting ? <Loader2 className="animate-spin" size={12} /> : 'Delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex-1 py-2 bg-white text-gray-600 border border-gray-200 rounded-xl text-xs font-black uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              className="mt-4"
            />
          </div>
        )}
      </div>
    </div>
  );
};
