import React, { useState, useMemo, useEffect } from 'react';
import { Check, Loader2, Plus, X, Wrench, Box, Settings2, ChevronDown, ChevronUp, Search, Calendar, ChevronRight, Package, ArrowLeftRight, MapPin } from 'lucide-react';
import {
  addItem, updateItem,
  recordTransaction, updateTransaction,
  addRequest, recordBulkPullout,
  recordBulkReceivePO,
  addPOPayment,
  getExistingDRForJobsite,
  getNoVariantInventoryExists
} from '../services/inventoryService';
import { createPurchaseOrder, updatePurchaseOrder as updatePO } from '../services/purchaseOrderService';
import { cn, normalizeVariant } from '../lib/utils';
import { Modal } from './common/Modal';
import { 
  Item, Category, UOM, Location, Inventory, Transaction, Request, 
  UserProfile, Asset, VariantConfig, ItemComponent,
  PurchaseOrder, PurchaseOrderItem, POPayment
} from '../types';
import { useData } from '../App';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { DollarSign, MinusCircle } from 'lucide-react';

interface RequestFormProps {
  item: Item;
  locations: Location[];
  uoms: UOM[];
  profile: UserProfile | null;
  defaultJobsiteId?: string;
  initialVariant?: Record<string, string>;
  initialCustomSpec?: string;
  onComplete: () => void;
}

export const RequestForm = ({
  item, locations, uoms, profile,
  defaultJobsiteId, initialVariant, initialCustomSpec,
  onComplete
}: RequestFormProps) => {
  const { inventory } = useData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>(initialVariant || {});
  const [selectedUomId, setSelectedUomId] = useState(() => {
    return uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.id || item.uomId;
  });

  // Reset variant when initialVariant changes (e.g. user clicks request on a different item variant)
  useEffect(() => {
    if (initialVariant) {
      setSelectedVariant(initialVariant);
    }
  }, [initialVariant]);

  const isVariantComplete = useMemo(() => {
    if (!item.requireVariant || !item.variantAttributes || item.variantAttributes.length === 0) return true;
    const dimReqs = item.variantConfigs?.[0]?.dimensionRequirements;
    return item.variantAttributes.every(attr => {
      const isRequired = !dimReqs || dimReqs[attr.name] !== false;
      return !isRequired || !!selectedVariant[attr.name];
    });
  }, [item, selectedVariant]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isVariantComplete) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const qty = Number(formData.get('quantity'));
      const jobsiteId = defaultJobsiteId || (formData.get('jobsiteId') as string);

      if (!jobsiteId) {
        throw new Error('Please select a jobsite');
      }

      const isEngineer = profile?.role === 'engineer' || profile?.role === 'admin' || profile?.role === 'manager';

      // Jobsite assignment check: block requests if item is locked to a different jobsite
      const variantKey = Object.keys(selectedVariant).length > 0 ? normalizeVariant(selectedVariant) : null;
      const assignedInv = inventory.filter(inv =>
        inv.itemId === item.id &&
        inv.assignedJobsiteId &&
        (variantKey === null || normalizeVariant(inv.variant) === variantKey)
      );
      if (assignedInv.length > 0 && !assignedInv.some(inv => inv.assignedJobsiteId === jobsiteId)) {
        throw new Error(`This item is assigned to ${assignedInv[0].assignedJobsiteName || 'another jobsite'} only.`);
      }

      await addRequest({
        itemId: item.id,
        requestedQty: qty,
        uomId: selectedUomId,
        jobsiteId,
        requestorId: profile?.uid || '',
        requestorName: profile?.displayName || '',
        variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
        customSpec: formData.get('customSpec') as string,
        workerNote: formData.get('note') as string,
        status: isEngineer ? 'approved' : 'pending',
        ...(isEngineer ? {
          approvedQty: qty,
          approverId: profile?.uid,
          approverName: profile?.displayName,
          approvedAt: serverTimestamp()
        } : {})
      });

      onComplete();
    } catch (error) {
      console.error(error);
      setErrorMsg(error instanceof Error ? error.message : 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const baseUom = uoms.find(u => u.id === item.uomId || u.symbol === item.uomId);

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div className="p-4 bg-blue-50 rounded-2xl flex items-center space-x-4">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
            {item.isTool ? <Wrench size={24} /> : <Box size={24} />}
          </div>
          <div>
            <h4 className="font-bold text-blue-900">{item.name}</h4>
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Requesting Item</p>
          </div>
        </div>

        {item.variantAttributes && item.variantAttributes.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {item.variantAttributes.map(attr => {
              const dimReqs = item.variantConfigs?.[0]?.dimensionRequirements;
              const dimRequired = item.requireVariant && (!dimReqs || dimReqs[attr.name] !== false);
              return (
                <div key={attr.name} className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">{attr.name}</label>
                  <select
                    required={dimRequired}
                    value={selectedVariant[attr.name] || ''}
                    onChange={e => setSelectedVariant({...selectedVariant, [attr.name]: e.target.value})}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                  >
                    <option value="">{dimRequired ? 'Select...' : 'Optional...'}</option>
                    {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        {item.requireCustomSpec && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black underline decoration-blue-500/30">
              {item.customSpecLabel || 'Specification'}
            </label>
            <input 
              name="customSpec" 
              type="text" 
              required 
              defaultValue={initialCustomSpec}
              placeholder={`Enter ${item.customSpecLabel || 'detail'}...`}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
        )}

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Quantity</label>
          <input 
            name="quantity" 
            type="number" 
            step="any" 
            required 
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            placeholder="0" 
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Unit of Measure</label>
          <div className="relative">
            <select 
              value={selectedUomId}
              onChange={e => setSelectedUomId(e.target.value)}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-bold text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-10"
            >
              {(() => {
                const baseUom = uoms.find(u => u.id === item.uomId || u.symbol === item.uomId);
                const validUoms = new Set();
                if (baseUom) validUoms.add(baseUom.id);
                item.uomConversions?.forEach(c => {
                  const convUom = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId);
                  if (convUom) validUoms.add(convUom.id);
                });

                return uoms.filter(u => validUoms.has(u.id) || u.id === selectedUomId)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                  ));
              })()}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
          </div>
        </div>
      </div>

        {!defaultJobsiteId && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Jobsite</label>
            <select 
              name="jobsiteId" 
              required 
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">Select Jobsite...</option>
              {locations.filter(l => 
                l.type === 'jobsite' && 
                (profile?.role === 'admin' || (l.isActive && profile?.assignedLocationIds?.includes(l.id)))
              ).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Note (Optional)</label>
          <textarea name="note" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" placeholder="Add instructions or specific requirements..." />
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting || !isVariantComplete}
        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
        <span>{isSubmitting ? 'Submitting...' : 'Submit Request'}</span>
      </button>
    </form>
  );
};

interface WorkerRequestFormProps {
  items: Item[];
  locations: Location[];
  uoms: UOM[];
  inventory: Inventory[];
  profile: UserProfile | null;
  mode: 'material' | 'pullout';
  defaultJobsiteId?: string;
  onComplete: () => void;
}

export const WorkerRequestForm = ({ items, locations, uoms, inventory, profile, mode, defaultJobsiteId, onComplete }: WorkerRequestFormProps) => {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [customSpec, setCustomSpec] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobsiteId, setJobsiteId] = useState(defaultJobsiteId || '');
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [selectedUomId, setSelectedUomId] = useState('');

  const [pulloutQuantities, setPulloutQuantities] = useState<Record<string, number | ''>>({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Initialize pulloutQuantities when inventory or jobsiteId changes
  useEffect(() => {
    if (mode === 'pullout' && jobsiteId) {
      const initial: Record<string, number> = {};
      inventory.filter(inv => inv.locationId === jobsiteId && inv.quantity > 0).forEach(inv => {
        initial[inv.id] = 0;
      });
      setPulloutQuantities(initial);
    }
  }, [mode, jobsiteId, inventory]);

  const filteredPulloutInventory = useMemo(() => {
    if (mode !== 'pullout' || !jobsiteId) return [];
    let list = inventory.filter(inv => inv.locationId === jobsiteId && inv.quantity > 0);
    if (itemSearch.trim()) {
      const s = itemSearch.toLowerCase();
      list = list.filter(inv => {
        const itm = items.find(i => i.id === inv.itemId);
        return itm?.name.toLowerCase().includes(s) || 
               (inv.variant && Object.values(inv.variant).some(v => v.toLowerCase().includes(s)));
      });
    }
    return list.sort((a, b) => {
      const itmA = items.find(i => i.id === a.itemId)?.name || '';
      const itmB = items.find(i => i.id === b.itemId)?.name || '';
      return itmA.localeCompare(itmB);
    });
  }, [mode, jobsiteId, inventory, items, itemSearch]);

  const selectedItem = items.find(i => i.id === selectedItemId);

  // Sync jobsiteId if defaultJobsiteId changes (though it usually won't while modal is open)
  useEffect(() => {
    if (defaultJobsiteId) {
      setJobsiteId(defaultJobsiteId);
    }
  }, [defaultJobsiteId]);

  // Handle UOM initialization when item changes
  useEffect(() => {
    if (selectedItem) {
      const baseUomId = uoms.find(u => u.id === selectedItem.uomId || u.symbol === selectedItem.uomId)?.id || selectedItem.uomId;
      setSelectedUomId(baseUomId);
    } else {
      setSelectedUomId('');
    }
  }, [selectedItem, uoms]);

  const filteredItems = useMemo(() => {
    let list = items.filter(i => i.isActive);
    if (mode === 'pullout' && jobsiteId) {
      const siteItemIds = new Set(inventory.filter(inv => inv.locationId === jobsiteId && inv.quantity > 0).map(inv => inv.itemId));
      list = list.filter(i => siteItemIds.has(i.id));
    }
    
    if (itemSearch.trim() !== '') {
      const search = itemSearch.toLowerCase();
      list = list.filter(i => 
        i.name.toLowerCase().includes(search) || 
        i.tags?.some(t => t.toLowerCase().includes(search))
      );
    }
    
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [items, itemSearch, mode, jobsiteId, inventory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (mode === 'pullout') {
      const warehouse = locations.find(l => l.type === 'warehouse' && l.isActive);
      const selections = Object.entries(pulloutQuantities)
        .filter(([_, qty]) => Number(qty) > 0)
        .map(([invId, qty]) => {
          const inv = inventory.find(i => i.id === invId);
          const item = items.find(i => i.id === inv?.itemId);
          return {
            itemId: inv!.itemId,
            invId,
            quantity: Number(qty),
            variant: inv!.variant || null,
            customSpec: inv!.customSpec || null,
            uomId: uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.id || item?.uomId || ''
          };
        });

      if (selections.length === 0) return;
      setIsSubmitting(true);
      try {
        await recordBulkPullout(
          selections,
          jobsiteId,
          warehouse?.id || null,
          profile?.uid || '',
          profile?.displayName || 'Worker',
          note
        );
        onComplete();
      } catch (error) {
        console.error(error);
        setErrorMsg(error instanceof Error ? error.message : 'Failed to submit pullout');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!selectedItemId) { setErrorMsg('Please select an item.'); return; }
    if (!quantity || Number(quantity) <= 0) { setErrorMsg('Quantity must be greater than 0.'); return; }
    if (!jobsiteId) { setErrorMsg('No jobsite selected.'); return; }
    if (!selectedUomId) { setErrorMsg('Please select a unit of measure.'); return; }
    setIsSubmitting(true);
    try {
      const targetUom = uoms.find(u => u.id === selectedUomId);
      const baseUomId = uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId)?.id || selectedItem?.uomId;

      const conversionFactor = (selectedUomId === baseUomId || targetUom?.symbol === selectedItem?.uomId)
        ? 1 
        : (selectedItem?.uomConversions?.find(c => {
            const convUomId = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId)?.id || c.uomId;
            return convUomId === selectedUomId;
          })?.factor || 1);

      const isEngineer = profile?.role === 'engineer' || profile?.role === 'admin' || profile?.role === 'manager';

      // Jobsite assignment check
      const wVariantKey = Object.keys(selectedVariant).length > 0 ? normalizeVariant(selectedVariant) : null;
      const wAssignedInv = inventory.filter(inv =>
        inv.itemId === selectedItemId &&
        inv.assignedJobsiteId &&
        (wVariantKey === null || normalizeVariant(inv.variant) === wVariantKey)
      );
      if (wAssignedInv.length > 0 && !wAssignedInv.some(inv => inv.assignedJobsiteId === jobsiteId)) {
        throw new Error(`This item is assigned to ${wAssignedInv[0].assignedJobsiteName || 'another jobsite'} only.`);
      }

      await addRequest({
        itemId: selectedItemId,
        requestedQty: Number(quantity),
        uomId: selectedUomId,
        jobsiteId,
        requestorId: profile?.uid || '',
        requestorName: profile?.displayName || '',
        variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
        customSpec: customSpec || undefined,
        workerNote: note,
        status: isEngineer ? 'approved' : 'pending',
        ...(isEngineer ? {
          approvedQty: Number(quantity),
          approverId: profile?.uid,
          approverName: profile?.displayName,
          approvedAt: serverTimestamp() as any
        } : {})
      });
      onComplete();
    } catch (error) {
      console.error(error);
      setErrorMsg(error instanceof Error ? error.message : 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-6">
        <div className="space-y-1 relative">
          <div className="flex items-center justify-between px-1 mb-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              {mode === 'material' ? 'Item' : 'Inventory for Pullout'}
            </label>
            <div className="flex items-center space-x-2 px-4 py-1.5 bg-blue-600 rounded-full shadow-lg shadow-blue-200 border border-blue-500">
              <MapPin size={14} className="text-white fill-blue-400" />
              <span className="text-xs font-black text-white uppercase tracking-widest leading-none">
                {locations.find(l => l.id === jobsiteId)?.name || 'Loading...'}
              </span>
            </div>
          </div>

          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text"
              placeholder={mode === 'material' ? "Search items..." : "Filter items at jobsite..."}
              value={mode === 'material' && selectedItemId ? (selectedItem?.name || '') : itemSearch}
              onFocus={() => {
                if (mode === 'material') {
                  setIsDropdownOpen(true);
                  if (selectedItemId) {
                    setItemSearch('');
                    setSelectedItemId('');
                  }
                }
              }}
              onChange={e => {
                setItemSearch(e.target.value);
                if (mode === 'material') {
                  setSelectedItemId('');
                  setIsDropdownOpen(true);
                }
              }}
              className="w-full pl-12 pr-10 py-4 bg-gray-100 border-none rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400 placeholder:font-medium"
            />
            {mode === 'material' && isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[100] max-h-[250px] overflow-y-auto no-scrollbar animate-in fade-in zoom-in-95 duration-200">
                {filteredItems.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {filteredItems.map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setSelectedItemId(i.id);
                          setItemSearch('');
                          setIsDropdownOpen(false);
                        }}
                        className="w-full p-3 text-left hover:bg-blue-50 rounded-xl transition-colors group flex items-center justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-700">{i.name}</p>
                          <div className="flex items-center space-x-2">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{uoms.find(u => u.id === i.uomId || u.symbol === i.uomId)?.symbol || i.uomId}</p>
                            {i.isTool && <span className="text-[8px] px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full font-black uppercase">Tool</span>}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-400">
                    <Package className="mx-auto mb-2 opacity-20" size={32} />
                    <p className="text-xs font-bold uppercase tracking-widest">No items found</p>
                  </div>
                )}
              </div>
            )}
            {mode === 'material' && isDropdownOpen && (
              <div 
                className="fixed inset-0 z-[90]" 
                onClick={() => setIsDropdownOpen(false)}
              />
            )}
          </div>
        </div>

        {mode === 'pullout' ? (
          <div className="space-y-3 max-h-[400px] overflow-y-auto no-scrollbar pr-1">
            {filteredPulloutInventory.map(inv => {
              const item = items.find(i => i.id === inv.itemId);
              return (
                <div key={inv.id} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm flex items-center justify-between space-x-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-black text-gray-900 truncate">{item?.name}</h4>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {inv.variant && Object.entries(inv.variant).map(([k, v]) => (
                        <span key={k} className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-1.5 py-0.5 rounded">
                          {v}
                        </span>
                      ))}
                      {inv.customSpec && (
                        <span className="text-[10px] font-black text-purple-600 uppercase tracking-widest bg-purple-50 px-1.5 py-0.5 rounded">
                          {inv.customSpec}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center space-x-2">
                       <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current Stock:</span>
                       <span className="text-xs font-black text-gray-900">{inv.quantity} {uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.symbol}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                     <input 
                       type="number"
                       min="0"
                       max={inv.quantity}
                       step="any"
                       value={pulloutQuantities[inv.id] ?? ''}
                       onChange={e => {
                          const val = e.target.value === '' ? '' : Number(e.target.value);
                          setPulloutQuantities(prev => ({ ...prev, [inv.id]: val }));
                       }}
                       className="w-20 p-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-center text-sm font-black text-purple-600 focus:border-purple-500 focus:bg-white outline-none transition-all"
                     />
                  </div>
                </div>
              );
            })}
            {filteredPulloutInventory.length === 0 && (
              <div className="p-12 text-center text-gray-400">
                <Package className="mx-auto mb-2 opacity-20" size={48} />
                <p className="text-sm font-black uppercase tracking-widest">Nothing to pullout here</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {selectedItem?.variantAttributes && selectedItem.variantAttributes.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                {selectedItem.variantAttributes.map(attr => {
                  const dimReqs = selectedItem.variantConfigs?.[0]?.dimensionRequirements;
                  const dimRequired = selectedItem.requireVariant && (!dimReqs || dimReqs[attr.name] !== false);
                  return (
                    <div key={attr.name} className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">{attr.name}</label>
                      <div className="relative">
                        <select
                          required={dimRequired}
                          value={selectedVariant[attr.name] || ''}
                          onChange={e => setSelectedVariant({...selectedVariant, [attr.name]: e.target.value})}
                          className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-10"
                        >
                          <option value="">{dimRequired ? 'Select...' : 'Optional...'}</option>
                          {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedItem?.requireCustomSpec && (
              <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">
                  {selectedItem.customSpecLabel || 'Specification'}
                </label>
                <input 
                  required
                  type="text"
                  value={customSpec}
                  onChange={e => setCustomSpec(e.target.value)}
                  placeholder={`Enter ${selectedItem.customSpecLabel || 'spec'}...`}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Quantity</label>
                <input 
                  required
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {selectedItemId && (
                <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Unit of Measure</label>
                  <div className="relative">
                    <select 
                      required
                      value={selectedUomId}
                      onChange={e => setSelectedUomId(e.target.value)}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-bold text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-10"
                    >
                      {(() => {
                        const baseUom = uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId);
                        const validUoms = new Set();
                        if (baseUom) validUoms.add(baseUom.id);
                        selectedItem?.uomConversions?.forEach(c => {
                          const convUom = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId);
                          if (convUom) validUoms.add(convUom.id);
                        });
                        
                        return uoms.filter(u => (validUoms.has(u.id) && u.isActive) || u.id === selectedUomId)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(u => (
                            <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                          ));
                      })()}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" size={16} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">Note (Optional)</label>
          <textarea 
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder={mode === 'material' ? "Reason for request..." : "Pullout instructions..."} 
          />
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting || (mode === 'material' ? (!selectedItemId || !quantity) : (Object.values(pulloutQuantities).every(q => !q || q === 0))) || !jobsiteId}
        className={cn(
          "w-full py-4 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50 shadow-lg transition-all active:scale-95",
          mode === 'material' ? "bg-blue-600 shadow-blue-100" : "bg-purple-600 shadow-purple-100"
        )}
      >
        {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
        <span>{isSubmitting ? 'Submitting...' : mode === 'material' ? 'Submit Request' : 'Submit Pullout'}</span>
      </button>
    </form>
  );
};

interface POPaymentFormProps {
  po: PurchaseOrder;
  onComplete: () => void;
  onCancel: () => void;
}

export const POPaymentForm = ({ po, onComplete, onCancel }: POPaymentFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amount, setAmount] = useState<number | string>('');
  const [grossAmount, setGrossAmount] = useState<number | string>(po.totalAmount);
  const [cvNumber, setCvNumber] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [status, setStatus] = useState<POPayment['status']>('processing');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [deductions, setDeductions] = useState<{ type: string; amount: number }[]>([]);
  const [notes, setNotes] = useState('');

  const addDeduction = () => {
    setDeductions([...deductions, { type: '', amount: 0 }]);
  };

  const updateDeduction = (idx: number, data: Partial<{ type: string; amount: number }>) => {
    const newDeductions = [...deductions];
    newDeductions[idx] = { ...newDeductions[idx], ...data };
    setDeductions(newDeductions);

    // Auto-calculate net amount
    const totalDeductions = newDeductions.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    setAmount(Number(grossAmount) - totalDeductions);
  };

  const removeDeduction = (idx: number) => {
    const newDeductions = deductions.filter((_, i) => i !== idx);
    setDeductions(newDeductions);
    const totalDeductions = newDeductions.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    setAmount(Number(grossAmount) - totalDeductions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addPOPayment(po.id, {
        poId: po.id,
        date: Timestamp.fromDate(new Date(date)),
        amount: Number(amount),
        grossAmount: Number(grossAmount),
        cvNumber,
        chequeNumber: chequeNumber || undefined,
        status,
        deductions,
        notes: notes || undefined,
      } as any);
      onComplete();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Payment Date</label>
            <input 
              type="date" 
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Status</label>
            <select 
              value={status}
              onChange={e => setStatus(e.target.value as any)}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="processing">For Processing</option>
              <option value="prepared">Cheque Prepared</option>
              <option value="collected">Collected (Paid)</option>
              <option value="bank_deposit">Bank Deposit</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">CV #</label>
            <input 
              type="text" 
              value={cvNumber}
              onChange={e => setCvNumber(e.target.value)}
              required
              placeholder="Voucher Number"
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Cheque # (Optional)</label>
            <input 
              type="text" 
              value={chequeNumber}
              onChange={e => setChequeNumber(e.target.value)}
              placeholder="Cheque Number"
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Gross Amount</label>
          <input 
            type="number" 
            value={grossAmount}
            onChange={e => {
              setGrossAmount(e.target.value);
              const totalDeductions = deductions.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
              setAmount(Number(e.target.value) - totalDeductions);
            }}
            required
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between pl-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Deductions</label>
            <button 
              type="button"
              onClick={addDeduction}
              className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center space-x-1"
            >
              <Plus size={12} />
              <span>Add Deduction</span>
            </button>
          </div>
          
          {deductions.map((d, idx) => (
            <div key={idx} className="flex items-center space-x-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
              <input 
                type="text"
                placeholder="Type (e.g. WHT)"
                value={d.type}
                onChange={e => updateDeduction(idx, { type: e.target.value })}
                className="flex-1 bg-transparent text-xs font-bold outline-none"
              />
              <input 
                type="number"
                placeholder="Amount"
                value={d.amount}
                onChange={e => updateDeduction(idx, { amount: Number(e.target.value) })}
                className="w-24 bg-transparent text-xs font-bold text-right outline-none"
              />
              <button 
                type="button"
                onClick={() => removeDeduction(idx)}
                className="text-red-400 hover:text-red-600"
              >
                <MinusCircle size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 bg-green-50 rounded-2xl flex items-center justify-between border border-green-100">
          <div>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">Net Payment Amount</p>
            <p className="text-xl font-black text-green-700">₱ {Number(amount).toLocaleString()}</p>
          </div>
          <DollarSign className="text-green-200" size={32} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Notes</label>
          <textarea 
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder="Payment remarks..."
          />
        </div>
      </div>

      <div className="flex space-x-3">
        <button 
          type="button"
          onClick={onCancel}
          className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold active:scale-95 transition-transform"
        >
          Cancel
        </button>
        <button 
          type="submit" 
          disabled={isSubmitting}
          className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 shadow-lg shadow-blue-200 disabled:opacity-50 active:scale-95 transition-transform"
        >
          {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
          <span>Save Payment</span>
        </button>
      </div>
    </form>
  );
};

interface ItemFormProps {
  uoms: UOM[];
  categories: Category[];
  locations: Location[];
  items: Item[];
  initialData?: Item;
  isDuplicate?: boolean;
  onComplete: (newItemId?: string) => void;
}

export const ItemForm = ({ uoms, categories, locations, items, initialData, isDuplicate, onComplete }: ItemFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isTool, setIsTool] = useState(initialData?.isTool || false);
  const [requireVariant, setRequireVariant] = useState(initialData?.requireVariant || false);
  const [variantWarnShown, setVariantWarnShown] = useState(false);
  const [variantWarnAcknowledged, setVariantWarnAcknowledged] = useState(false);
  const [variantWarnChecking, setVariantWarnChecking] = useState(false);
  const [requireCustomSpec, setRequireCustomSpec] = useState(initialData?.requireCustomSpec || false);
  const [customSpecLabel, setCustomSpecLabel] = useState(initialData?.customSpecLabel || '');
  
  // Resolve legacy category data
  const getInitialCategories = () => {
    let main = initialData?.categoryId || '';
    let sub = initialData?.subcategoryId || '';
    
    if (main) {
      const cat = categories.find(c => c.id === main);
      if (cat?.parentId) {
        // If the stored categoryId is actually a subcategory
        sub = main;
        main = cat.parentId;
      }
    }
    return { main, sub };
  };

  const initialCats = getInitialCategories();
  const [mainCategoryId, setMainCategoryId] = useState(initialCats.main);
  const [subCategoryId, setSubCategoryId] = useState(initialCats.sub);
  
  // Resolve UOM ID (handle cases where symbol might be stored instead of ID)
  const getInitialUomId = () => {
    if (!initialData?.uomId) return '';
    const uom = uoms.find(u => u.id === initialData.uomId || u.symbol === initialData.uomId);
    return uom?.id || initialData.uomId;
  };

  const [uomId, setUomId] = useState(getInitialUomId());
  const [uomConversions, setUomConversions] = useState<{ uomId: string; factor: number }[]>(initialData?.uomConversions || []);
  const [newConversionUomId, setNewConversionUomId] = useState('');
  const [newConversionFactor, setNewConversionFactor] = useState<number | ''>('');
  const [attributes, setAttributes] = useState<{ name: string; values: string[] }[]>(initialData?.variantAttributes || []);
  const [newAttrName, setNewAttrName] = useState('');
  const [variantConfigs, setVariantConfigs] = useState<Record<string, { reorderLevel?: number; latestPrice?: number; isRequired?: boolean }>>(() => {
    const initial: Record<string, { reorderLevel?: number; latestPrice?: number; isRequired?: boolean }> = {};
    initialData?.variantConfigs?.forEach(vc => {
      initial[normalizeVariant(vc.variant)] = { reorderLevel: vc.reorderLevel, latestPrice: vc.latestPrice, isRequired: vc.isRequired };
    });
    return initial;
  });
  const [dimensionRequirements, setDimensionRequirements] = useState<Record<string, boolean>>(
    () => initialData?.variantConfigs?.[0]?.dimensionRequirements ?? {}
  );
  const [showVariantConfigs, setShowVariantConfigs] = useState(false);

  // Components (BOM) state
  const [components, setComponents] = useState<ItemComponent[]>(initialData?.components || []);
  const [componentSearch, setComponentSearch] = useState('');
  const [showComponentSearch, setShowComponentSearch] = useState(false);

  const combinations = useMemo(() => {
    if (attributes.length === 0 || attributes.some(a => a.values.length === 0)) return [];
    let results: Record<string, string>[] = [{}];
    for (const attr of attributes) {
      const nextResults: Record<string, string>[] = [];
      for (const res of results) {
        for (const val of attr.values) {
          nextResults.push({ ...res, [attr.name]: val });
        }
      }
      results = nextResults;
    }
    return results;
  }, [attributes]);

  const addAttribute = () => {
    if (newAttrName.trim()) {
      setAttributes([...attributes, { name: newAttrName.trim(), values: [] }]);
      setNewAttrName('');
    }
  };

  const addValue = (attrIdx: number, value: string) => {
    if (value.trim()) {
      const next = [...attributes];
      next[attrIdx].values.push(value.trim());
      setAttributes(next);
    }
  };

  const removeValue = (attrIdx: number, valIdx: number) => {
    const next = [...attributes];
    next[attrIdx].values.splice(valIdx, 1);
    setAttributes(next);
  };

  const removeAttribute = (idx: number) => {
    setAttributes(attributes.filter((_, i) => i !== idx));
  };

  const handleRequireVariantToggle = async () => {
    const next = !requireVariant;
    setRequireVariant(next);
    if (!next) {
      setVariantWarnShown(false);
      setVariantWarnAcknowledged(false);
      return;
    }
    if (!initialData?.id || isDuplicate) return;
    setVariantWarnChecking(true);
    try {
      const hasLegacy = await getNoVariantInventoryExists(initialData.id);
      setVariantWarnShown(hasLegacy);
    } finally {
      setVariantWarnChecking(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault();
      if (requireVariant && variantWarnShown && !variantWarnAcknowledged) {
        setSaveError('Please acknowledge the variant migration warning before saving.');
        return;
      }
      setIsSubmitting(true);
      try {
        const formData = new FormData(e.currentTarget);
        const data = {
          name: formData.get('name') as string,
          description: formData.get('description') as string || null,
          categoryId: mainCategoryId,
          subcategoryId: subCategoryId,
          uomId: uomId,
          uomConversions: uomConversions.length > 0 ? uomConversions : undefined,
          isTool,
          isActive: formData.get('isActive') === 'on',
          variantAttributes: attributes,
          requireVariant,
          requireCustomSpec,
          customSpecLabel: customSpecLabel.trim() || null,
          tags: (formData.get('tags') as string || '').split(',').map(t => t.trim()).filter(Boolean),
          reorderLevel: Number(formData.get('reorderLevel')) || 0,
          latestPrice: Number(formData.get('latestPrice')) || undefined,
          variantConfigs: (() => {
            const hasDimOverrides = Object.values(dimensionRequirements).some(v => !v);
            return combinations
              .map(variant => {
                const key = normalizeVariant(variant);
                const config = variantConfigs[key] || {};
                const hasData = config.reorderLevel !== undefined || config.latestPrice !== undefined || config.isRequired === false || hasDimOverrides;
                if (!hasData) return null;
                return {
                  variant,
                  ...(config.reorderLevel !== undefined ? { reorderLevel: config.reorderLevel } : {}),
                  ...(config.latestPrice !== undefined ? { latestPrice: config.latestPrice } : {}),
                  ...(config.isRequired === false ? { isRequired: false } : {}),
                  ...(hasDimOverrides ? { dimensionRequirements } : {}),
                };
              })
              .filter((vc): vc is any => vc !== null);
          })(),
          components: components
        };

        let newItemId: string | undefined;
        if (initialData?.id && !isDuplicate) {
          await updateItem(initialData.id, data);
        } else {
          newItemId = await addItem(data);
        }
        onComplete(newItemId);
      } catch (error: any) {
        console.error('Error saving item:', error);
        setSaveError(error.message || 'Failed to save item');
      } finally {
        setIsSubmitting(false);
      }
    }}>
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Item Name</label>
          <input 
            name="name" 
            required 
            defaultValue={isDuplicate ? `${initialData?.name} (Copy)` : initialData?.name} 
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            placeholder="e.g. Copper Pipe 1/2 inch" 
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] pl-1">Description</label>
          <textarea 
            name="description" 
            defaultValue={initialData?.description} 
            rows={2}
            className="w-full p-4 bg-gray-100 rounded-2xl text-[13px] font-medium outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all placeholder:text-gray-300" 
            placeholder="Technical specs, dimensions, or usage notes..." 
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Main Category</label>
            <select 
              value={mainCategoryId} 
              onChange={(e) => {
                setMainCategoryId(e.target.value);
                setSubCategoryId('');
              }}
              required
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">Select Category...</option>
              {categories.filter(c => !c.parentId && (c.isActive || c.id === mainCategoryId))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Unit</label>
            <select 
              value={uomId} 
              onChange={(e) => setUomId(e.target.value)}
              required
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">Select Unit...</option>
              {uoms.filter(u => u.isActive || u.id === uomId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                ))}
            </select>
          </div>
        </div>

        {/* UOM Conversions Section */}
        <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1 font-black">UOM Conversions (Secondary Units)</label>
          <div className="space-y-2">
            {uomConversions.map((conv, idx) => {
              const targetUom = uoms.find(u => u.id === conv.uomId);
              const baseUom = uoms.find(u => u.id === uomId);
              return (
                <div key={idx} className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-100 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                      <ArrowLeftRight size={14} />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-gray-900">1 {targetUom?.symbol || conv.uomId}</span>
                      <span className="mx-2 text-gray-300">=</span>
                      <span className="text-xs font-bold text-blue-600">{conv.factor} {baseUom?.symbol || 'Base Units'}</span>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setUomConversions(uomConversions.filter((_, i) => i !== idx))}
                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}

            <div className="grid grid-cols-12 gap-2 mt-3">
              <div className="col-span-6">
                <select 
                  value={newConversionUomId}
                  onChange={e => setNewConversionUomId(e.target.value)}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="">Select UOM...</option>
                  {uoms.filter(u => u.isActive && u.id !== uomId && !uomConversions.some(c => c.uomId === u.id))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                    ))}
                </select>
              </div>
              <div className="col-span-4">
                <input 
                  type="number"
                  placeholder="Factor"
                  value={newConversionFactor}
                  onChange={e => setNewConversionFactor(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <button 
                  type="button"
                  onClick={() => {
                    if (newConversionUomId && newConversionFactor) {
                      setUomConversions([...uomConversions, { uomId: newConversionUomId, factor: Number(newConversionFactor) }]);
                      setNewConversionUomId('');
                      setNewConversionFactor('');
                    }
                  }}
                  className="w-full h-full flex items-center justify-center bg-gray-900 text-white rounded-xl active:scale-95 transition-transform disabled:opacity-50"
                  disabled={!newConversionUomId || !newConversionFactor}
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>
          <p className="text-[9px] text-gray-400 font-medium leading-relaxed italic px-1 bg-white/50 p-2 rounded-lg border border-dashed border-gray-200">
            * Example: If 1 BOX contains 50 PCS (Base Unit), select BOX and set Factor to 50.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Subcategory</label>
          <select 
            value={subCategoryId}
            onChange={(e) => setSubCategoryId(e.target.value)}
            disabled={!mainCategoryId}
            required
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none disabled:opacity-50"
          >
            <option value="">Select Subcategory...</option>
            {categories.filter(c => c.parentId === mainCategoryId && (c.isActive || c.id === subCategoryId))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div>
            <p className="text-sm font-bold text-gray-900">Require Custom Spec?</p>
            <p className="text-[10px] text-gray-500 font-medium">Force users to input a specific detail (e.g. Size, Length)</p>
          </div>
          <button 
            type="button"
            onClick={() => setRequireCustomSpec(!requireCustomSpec)}
            className={cn(
              "w-12 h-6 rounded-full transition-colors relative",
              requireCustomSpec ? "bg-blue-600" : "bg-gray-300"
            )}
          >
            <div className={cn(
              "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
              requireCustomSpec ? "left-7" : "left-1"
            )} />
          </button>
        </div>

        {requireCustomSpec && (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Custom Spec Label</label>
            <input 
              value={customSpecLabel}
              onChange={(e) => setCustomSpecLabel(e.target.value)}
              placeholder="e.g. Size, Length, Dimensions"
              required={requireCustomSpec}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div>
            <p className="text-sm font-bold text-gray-900">Is this a Tool?</p>
            <p className="text-[10px] text-gray-500 font-medium">Tools are tracked by serial numbers</p>
          </div>
          <button 
            type="button"
            onClick={() => setIsTool(!isTool)}
            className={cn(
              "w-12 h-6 rounded-full transition-colors relative",
              isTool ? "bg-blue-600" : "bg-gray-300"
            )}
          >
            <div className={cn(
              "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
              isTool ? "left-7" : "left-1"
            )} />
          </button>
        </div>

        {attributes.length > 0 && (
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <div>
              <p className="text-sm font-bold text-blue-900">Require Variant?</p>
              <p className="text-[10px] text-blue-500 font-medium uppercase tracking-widest">Force users to select a variant for this item</p>
            </div>
            <button
              type="button"
              onClick={handleRequireVariantToggle}
              disabled={variantWarnChecking}
              className={cn(
                "w-12 h-6 rounded-full transition-colors relative disabled:opacity-60",
                requireVariant ? "bg-blue-600" : "bg-gray-300"
              )}
            >
              <div className={cn(
                "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                requireVariant ? "left-7" : "left-1"
              )} />
            </button>
          </div>
        )}

        {variantWarnShown && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl space-y-3">
            <p className="text-sm font-bold text-amber-900">&#9888; Existing stock without variant detected</p>
            <p className="text-xs text-amber-800 leading-relaxed">
              This item has existing inventory without a variant assigned. Setting <strong>Require Variant</strong> to ON will split your stock — old stock will remain on a separate record and won't be counted with variant stock.
            </p>
            <p className="text-xs font-semibold text-amber-900">Before saving, you should:</p>
            <ol className="text-xs text-amber-800 space-y-1 list-decimal list-inside">
              <li>Migrate existing stock by manually transferring quantities to the correct variant docs</li>
              <li>Cancel and resubmit any pending requests for this item</li>
              <li>Revise any open POs for this item before receiving</li>
            </ol>
            <label className="flex items-center space-x-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={variantWarnAcknowledged}
                onChange={e => setVariantWarnAcknowledged(e.target.checked)}
                className="w-4 h-4 accent-amber-600"
              />
              <span className="text-xs font-bold text-amber-900">I understand — proceed anyway</span>
            </label>
          </div>
        )}

        {attributes.length > 0 && requireVariant && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Dimension Settings</label>
            {attributes.map(attr => {
              const isReq = dimensionRequirements[attr.name] !== false;
              return (
                <div key={attr.name} className="flex items-center justify-between px-3 py-2.5 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-xs font-bold text-blue-900">{attr.name}</span>
                  <div className="flex items-center space-x-2">
                    <span className={cn("text-[9px] font-black uppercase tracking-widest", isReq ? "text-blue-600" : "text-gray-400")}>
                      {isReq ? "Required" : "Optional"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDimensionRequirements(prev => ({ ...prev, [attr.name]: !isReq }))}
                      className={cn("w-10 h-5 rounded-full transition-colors relative flex-shrink-0", isReq ? "bg-blue-600" : "bg-gray-300")}
                    >
                      <div className={cn("absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all", isReq ? "left-5" : "left-0.5")} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {combinations.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Variant Required Settings</label>
            {combinations.map((variant, idx) => {
              const key = normalizeVariant(variant);
              const isReq = variantConfigs[key]?.isRequired !== false;
              return (
                <div key={idx} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(variant).map(([k, v]) => (
                      <span key={k} className="px-2 py-0.5 bg-white border border-gray-200 text-gray-700 text-[9px] font-black uppercase rounded tracking-widest">{v}</span>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <span className={cn("text-[9px] font-black uppercase tracking-widest", isReq ? "text-blue-600" : "text-gray-400")}>
                      {isReq ? "Required" : "Optional"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setVariantConfigs(prev => ({
                        ...prev,
                        [key]: { ...(prev[key] || {}), isRequired: !isReq }
                      }))}
                      className={cn(
                        "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                        isReq ? "bg-blue-600" : "bg-gray-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                        isReq ? "left-5" : "left-0.5"
                      )} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Variants (e.g. Size, Color)</label>
          <div className="space-y-3">
            {attributes.map((attr, attrIdx) => (
              <div key={attrIdx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-900 uppercase tracking-widest">{attr.name}</span>
                  <button type="button" onClick={() => removeAttribute(attrIdx)} className="text-red-500"><X size={16} /></button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {attr.values.map((val, valIdx) => (
                    <span key={valIdx} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-[10px] font-bold flex items-center space-x-1">
                      <span>{val}</span>
                      <button type="button" onClick={() => removeValue(attrIdx, valIdx)}><X size={10} /></button>
                    </span>
                  ))}
                  <input 
                    type="text" 
                    placeholder="Add value..." 
                    className="bg-transparent border-none text-[10px] font-bold outline-none w-20"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addValue(attrIdx, (e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="flex space-x-2">
              <input 
                value={newAttrName}
                onChange={e => setNewAttrName(e.target.value)}
                placeholder="New attribute (e.g. Size)" 
                className="flex-1 p-3 bg-gray-100 rounded-xl text-xs font-medium outline-none" 
              />
              <button type="button" onClick={addAttribute} className="p-3 bg-gray-900 text-white rounded-xl"><Plus size={18} /></button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Bill of Materials (Components)</label>
          <div className="space-y-3">
            {components.map((comp, idx) => {
              const compItem = items.find(i => i.id === comp.itemId);
              return (
                <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-blue-600 shadow-sm">
                      {compItem?.isTool ? <Wrench size={16} /> : <Box size={16} />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{compItem?.name || 'Unknown Item'}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {uoms.find(u => u.id === compItem?.uomId || u.symbol === compItem?.uomId)?.symbol || compItem?.uomId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Qty:</span>
                      <input 
                        type="number"
                        value={comp.quantity}
                        onChange={e => {
                          const next = [...components];
                          next[idx].quantity = Number(e.target.value);
                          setComponents(next);
                        }}
                        className="w-16 p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button type="button" onClick={() => setComponents(components.filter((_, i) => i !== idx))} className="text-red-500 p-1">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="relative">
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input 
                    value={componentSearch}
                    onChange={e => {
                      setComponentSearch(e.target.value);
                      setShowComponentSearch(true);
                    }}
                    onFocus={() => setShowComponentSearch(true)}
                    placeholder="Search items to add as components..." 
                    className="w-full pl-10 pr-4 py-3 bg-gray-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
                {componentSearch && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setComponentSearch('');
                      setShowComponentSearch(false);
                    }} 
                    className="p-3 bg-gray-200 text-gray-600 rounded-xl"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {showComponentSearch && componentSearch && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                  {items
                    .filter(i => 
                      i.isActive && 
                      i.id !== initialData?.id && 
                      !components.some(c => c.itemId === i.id) &&
                      i.name.toLowerCase().includes(componentSearch.toLowerCase())
                    )
                    .map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setComponents([...components, { itemId: i.id, quantity: 1 }]);
                          setComponentSearch('');
                          setShowComponentSearch(false);
                        }}
                        className="w-full p-3 flex items-center space-x-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
                      >
                        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                          {i.isTool ? <Wrench size={16} /> : <Box size={16} />}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">{i.name}</p>
                          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {uoms.find(u => u.id === i.uomId || u.symbol === i.uomId)?.symbol || i.uomId}
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Re-order Level</label>
            <input name="reorderLevel" type="number" defaultValue={initialData?.reorderLevel} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Latest Price</label>
            <input name="latestPrice" type="number" step="any" min="0" defaultValue={initialData?.latestPrice} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Tags (comma separated)</label>
          <input name="tags" defaultValue={initialData?.tags?.join(', ')} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. plumbing, copper, urgent" />
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div>
            <p className="text-sm font-bold text-gray-900">Active Status</p>
            <p className="text-[10px] text-gray-500 font-medium">Inactive items are hidden from main lists</p>
          </div>
          <input 
            type="checkbox" 
            name="isActive" 
            defaultChecked={initialData ? initialData.isActive : true}
            className="w-6 h-6 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>

        {combinations.length > 0 && (
          <div className="space-y-4">
            <button 
              type="button"
              onClick={() => setShowVariantConfigs(!showVariantConfigs)}
              className="w-full p-4 bg-blue-50 rounded-2xl flex items-center justify-between text-blue-600 hover:bg-blue-100 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Settings2 size={20} />
                <span className="text-sm font-bold">Configure Variant-specific Levels & Costs</span>
              </div>
              {showVariantConfigs ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

            {showVariantConfigs && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
                  <p className="text-[10px] font-bold text-orange-800 uppercase tracking-widest">Note</p>
                  <p className="text-xs text-orange-700 mt-1">Leave blank to use the default re-order level and latest price defined above.</p>
                </div>
                
                <div className="space-y-3">
                  {combinations.map((variant, idx) => {
                    const key = normalizeVariant(variant);
                    const config = variantConfigs[key] || {};
                    
                    return (
                      <div key={idx} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(variant).map(([k, v]) => (
                              <span key={k} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[8px] font-black uppercase rounded tracking-widest">
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Re-order Level</label>
                            <input 
                              type="number"
                              value={config.reorderLevel ?? ''}
                              onChange={e => setVariantConfigs({
                                ...variantConfigs,
                                [key]: { ...config, reorderLevel: e.target.value === '' ? undefined : Number(e.target.value) }
                              })}
                              className="w-full p-2 bg-gray-50 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Default"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Latest Price</label>
                            <input
                              type="number"
                              step="0.01"
                              value={config.latestPrice ?? ''}
                              onChange={e => setVariantConfigs({
                                ...variantConfigs,
                                [key]: { ...config, latestPrice: e.target.value === '' ? undefined : Number(e.target.value) }
                              })}
                              className="w-full p-2 bg-gray-50 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Default"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {saveError && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <span>{saveError}</span>
          <button type="button" onClick={() => setSaveError(null)} className="ml-2 text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
        <span>{isSubmitting ? 'Saving...' : 'Save Item'}</span>
      </button>
    </form>
  );
};

interface TransactionFormProps {
  items: Item[];
  locations: Location[];
  inventory: Inventory[];
  uoms: UOM[];
  purchaseOrders?: PurchaseOrder[];
  profile: UserProfile | null;
  initialType?: 'delivery' | 'usage' | 'return' | 'adjustment';
  initialData?: Transaction;
  onComplete: () => void;
}

const groupLocations = (locations: Location[]) => {
  const groups: Record<string, Location[]> = {};
  locations.forEach(l => {
    const t = l.type || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(l);
  });
  const order = { warehouse: 1, jobsite: 2, supplier: 3, system: 4 };
  return Object.keys(groups).sort((a, b) => {
    return (order[a as keyof typeof order] || 99) - (order[b as keyof typeof order] || 99);
  }).map(type => ({
    type,
    locations: groups[type].sort((a, b) => a.name.localeCompare(b.name))
  }));
};

export const TransactionForm = ({ items, locations, inventory, uoms, purchaseOrders = [], profile, initialType, initialData, onComplete }: TransactionFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(initialData?.itemId || '');
  const [type, setType] = useState<'delivery' | 'usage' | 'return' | 'adjustment'>(initialType || (initialData?.type as any) || 'delivery');
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>(initialData?.variant || {});
  const [itemSearch, setItemSearch] = useState('');
  const [fromLocationId, setFromLocationId] = useState(initialData?.fromLocationId || '');
  const [toLocationId, setToLocationId] = useState(initialData?.toLocationId || '');
  const [poId, setPoId] = useState(initialData?.poId || '');
  const [poNumber, setPoNumber] = useState(initialData?.poNumber || '');
  const [selectedUomId, setSelectedUomId] = useState(initialData?.uomId || '');
  const [quantity, setQuantity] = useState<number | string>(initialData?.quantity || '');
  const [poItemQuantities, setPoItemQuantities] = useState<Record<string, number>>({});
  const [poItemSerials, setPoItemSerials] = useState<Record<string, string>>({});
  const [poItemProperties, setPoItemProperties] = useState<Record<string, string>>({});
  const [totalPrice, setTotalPrice] = useState<number | string>(initialData?.totalPrice || '');
  const [date, setDate] = useState(() => {
    if (initialData?.timestamp) {
      const d = initialData.timestamp.toDate();
      return d.toISOString().split('T')[0];
    }
    const now = new Date();
    const gmt8Date = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return gmt8Date.toISOString().split('T')[0];
  });

  const selectedPO = useMemo(() => purchaseOrders.find(p => p.id === poId), [purchaseOrders, poId]);

  useEffect(() => {
    if (type === 'delivery' && !initialData) {
      const role = profile?.role;
      if (role === 'worker' || role === 'engineer') {
        const assignedIds = profile?.assignedLocationIds || [];
        const firstAssigned = locations.find(l => assignedIds.includes(l.id) && l.type === 'jobsite');
        if (firstAssigned) setToLocationId(firstAssigned.id);
      } else {
        const mainWarehouse = locations.find(l => l.name.toLowerCase() === 'main warehouse');
        if (mainWarehouse) setToLocationId(mainWarehouse.id);
      }
    }
  }, [type, locations, initialData, profile?.role, profile?.assignedLocationIds]);

  const selectedItem = items.find(i => i.id === selectedItemId);

  useEffect(() => {
    if (selectedItem && !selectedUomId) {
      const baseUomId = uoms.find(u => u.id === selectedItem.uomId || u.symbol === selectedItem.uomId)?.id || selectedItem.uomId;
      setSelectedUomId(baseUomId);
    }
  }, [selectedItem, selectedUomId, uoms]);

  const currentVariantConfig = useMemo(() => {
    if (!selectedItem || Object.keys(selectedVariant).length === 0) return null;
    return selectedItem.variantConfigs?.find(vc => 
      normalizeVariant(vc.variant) === normalizeVariant(selectedVariant)
    );
  }, [selectedItem, selectedVariant]);

  const displayLatestPrice = currentVariantConfig?.latestPrice ?? selectedItem?.latestPrice;

  const [serialNumber, setSerialNumber] = useState(initialData?.serialNumber || '');
  const [propertyNumber, setPropertyNumber] = useState(initialData?.propertyNumber || '');
  const [customSpec, setCustomSpec] = useState(initialData?.customSpec || '');
  const [error, setError] = useState<string | null>(null);
  const [pendingPOReceive, setPendingPOReceive] = useState<{
    items: any[];
    formData: { toLocationId: string; date: string; supplierInvoice?: string; supplierDR?: string; notes?: string };
  } | null>(null);

  const isTool = selectedItem?.isTool;
  const isToolValid = !isTool || serialNumber.trim() !== '' || propertyNumber.trim() !== '';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (type === 'delivery' && selectedPO && !initialData) {
      // Bulk PO Receiving
      const itemsToReceive = selectedPO.items
        .map(poi => {
          const key = `${poi.itemId}_${JSON.stringify(poi.variant || {})}_${poi.customSpec || ''}`;
          const qty = poItemQuantities[key] || 0;
          if (qty <= 0) return null;

          return {
            itemId: poi.itemId,
            variant: poi.variant,
            customSpec: poi.customSpec || undefined,
            quantity: qty,
            uomId: poi.uomId,
            unitPrice: poi.unitPrice,
            totalPrice: poi.unitPrice * qty,
            serialNumber: poItemSerials[key] || undefined,
            propertyNumber: poItemProperties[key] || undefined,
            assignedJobsiteId: poi.assignedJobsiteId,
            assignedJobsiteName: poi.assignedJobsiteName,
          };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null);

      if (itemsToReceive.length === 0) {
        setError('Please enter quantity for at least one item.');
        return;
      }

      const formData = new FormData(e.currentTarget);
      setPendingPOReceive({
        items: itemsToReceive,
        formData: {
          toLocationId,
          date,
          supplierInvoice: formData.get('supplierInvoice') as string || undefined,
          supplierDR: formData.get('supplierDR') as string || undefined,
          notes: formData.get('note') as string || undefined,
        }
      });
      return;
    }

    if (isTool && !isToolValid) {
      setError('Tools require either a Serial Number or Property Number.');
      return;
    }
    if (!fromLocationId && !toLocationId) {
      setError('Please select at least one location (From or To).');
      return;
    }
    if (fromLocationId && toLocationId && fromLocationId === toLocationId) {
      setError('From and To locations cannot be the same.');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      setError('Quantity must be greater than 0.');
      return;
    }
    if (!selectedItemId) {
      setError('Please select an item.');
      return;
    }
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const fromLoc = formData.get('fromLocationId') as string;
      const toLoc = formData.get('toLocationId') as string;
      const sn = formData.get('serialNumber') as string;
      const pn = formData.get('propertyNumber') as string;
      const customSpecVal = formData.get('customSpec') as string;
      const supplierInvoice = formData.get('supplierInvoice') as string;
      const supplierDR = formData.get('supplierDR') as string;

      const poItem = (poId && type === 'delivery' && selectedPO) ? selectedPO.items.find(i => i.itemId === selectedItemId) : null;
      const targetUomId = selectedUomId || poItem?.uomId || uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId)?.id || selectedItem?.uomId || '';
      
      const baseUomId = uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId)?.id || selectedItem?.uomId;
      const conversionFactor = (targetUomId === baseUomId) 
        ? 1 
        : (selectedItem?.uomConversions?.find(c => {
            const convUomId = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId)?.id || c.uomId;
            return convUomId === targetUomId;
          })?.factor || 1);

      const transactionData = {
        itemId: selectedItemId,
        type,
        quantity: Number(quantity),
        fromLocationId: fromLoc || null,
        toLocationId: toLoc || null,
        serialNumber: sn || null,
        propertyNumber: pn || null,
        customSpec: customSpecVal || null,
        variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : null,
        notes: formData.get('note') as string,
        uomId: targetUomId,
        conversionFactor,
        baseQuantity: Number(quantity) * conversionFactor,
        totalPrice: totalPrice === '' ? undefined : Number(totalPrice),
        poNumber: poNumber || null,
        poId: poId || null,
        supplierInvoice: supplierInvoice || null,
        supplierDR: supplierDR || null,
        timestamp: Timestamp.fromDate(new Date(date))
      };

      if (initialData) {
        await updateTransaction(initialData.id, initialData, transactionData);
      } else {
        await recordTransaction(transactionData);
      }

      onComplete();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const executePOReceive = async (updateLatestPrice: boolean) => {
    if (!pendingPOReceive || !selectedPO) return;
    const { items, formData } = pendingPOReceive;
    setPendingPOReceive(null);
    setIsSubmitting(true);
    try {
      await recordBulkReceivePO(
        selectedPO.id,
        items,
        profile?.uid || 'unknown',
        profile?.displayName || 'Unknown',
        {
          toLocationId: formData.toLocationId,
          date: new Date(formData.date),
          supplierInvoice: formData.supplierInvoice,
          supplierDR: formData.supplierDR,
          notes: formData.notes,
          updateLatestPrice,
        }
      );
      onComplete();
    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  if (pendingPOReceive) {
    const prices = pendingPOReceive.items.map(i => {
      const item = items.find(it => it.id === i.itemId);
      return `${item?.name || i.itemId}: ₱${i.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    });
    return (
      <div className="space-y-6 p-2">
        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
          <p className="text-sm font-bold text-blue-900 mb-1">Update Latest Price?</p>
          <p className="text-xs text-blue-700 mb-3">Do you want to update the latest price for the received items?</p>
          <div className="space-y-1 mb-4">
            {prices.map((p, i) => (
              <p key={i} className="text-xs text-blue-800 font-medium">{p}</p>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => executePOReceive(true)}
              className="flex-1 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 transition-colors"
            >
              Yes, Update
            </button>
            <button
              type="button"
              onClick={() => executePOReceive(false)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-300 transition-colors"
            >
              No, Keep Current
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPendingPOReceive(null)}
            className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div className="flex p-1 bg-gray-100 rounded-2xl">
          {['delivery', 'usage', 'return', 'adjustment'].map((t) => {
            if (t === 'delivery' && !['admin', 'warehouseman', 'worker', 'engineer'].includes(profile?.role || '')) return null;
            return (
              <button 
                key={t}
                type="button"
                onClick={() => setType(t as any)}
                className={cn(
                  "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors",
                  type === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-400"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>

        {type === 'delivery' && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Link to Purchase Order (Optional)</label>
            <select 
              value={poId}
              onChange={e => {
                const id = e.target.value;
                setPoId(id);
                const po = purchaseOrders.find(p => p.id === id);
                if (po) {
                  setFromLocationId(po.supplierId);
                  setPoNumber(po.poNumber);
                  // Reset single item selection
                  setSelectedItemId('');
                  setSelectedVariant({});
                  setQuantity('');
                  setTotalPrice('');
                  // Pre-populate quantities from remaining PO amounts
                  const initialQtys: Record<string, number> = {};
                  (po.items || [])
                    .filter(poi => (poi.receivedQuantity || 0) < poi.quantity)
                    .forEach(poi => {
                      const key = `${poi.itemId}_${JSON.stringify(poi.variant || {})}_${poi.customSpec || ''}`;
                      initialQtys[key] = poi.quantity - (poi.receivedQuantity || 0);
                    });
                  setPoItemQuantities(initialQtys);
                  setPoItemSerials({});
                  setPoItemProperties({});
                  if (po.destinationLocationId) {
                    setToLocationId(po.destinationLocationId);
                  }
                }
              }}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">No Purchase Order</option>
              {purchaseOrders
                .filter(po => {
                  if (po.status === 'cancelled' || po.status === 'draft') return false;
                  if (po.id === poId) return true; // Always show currently selected PO
                  
                  // A PO is selectable if it's not fully received yet based on item quantities
                  const isFullyReceived = po.items.length > 0 && po.items.every(item => (item.receivedQuantity || 0) >= item.quantity);
                  
                  // Allow if not fully received OR if status is not 'received'
                  return !isFullyReceived || po.status !== 'received';
                })
                .sort((a, b) => b.poNumber.localeCompare(a.poNumber)) // POs usually descending number but alphabetical otherwise
                .map(po => {
                  const supplier = locations.find(l => l.id === po.supplierId);
                  return (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} ({supplier?.name || po.supplierId || 'Unknown Supplier'}) - {po.status.replace('_', ' ')}
                    </option>
                  );
                })}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Transaction Date</label>
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full pl-12 pr-4 py-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
        </div>

        {type === 'delivery' && selectedPO && !initialData ? (
          <div className="space-y-4 border-2 border-blue-50 p-6 rounded-[2.5rem] bg-blue-50/30">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-black text-blue-900 uppercase tracking-widest">Items from {selectedPO.poNumber}</h4>
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{selectedPO.items.filter(poi => (poi.receivedQuantity || 0) < poi.quantity).length} Items Remaining</span>
            </div>
            
            <div className="space-y-3">
              {selectedPO.items
                .filter(poi => (poi.receivedQuantity || 0) < poi.quantity)
                .map((poi, idx) => {
                  const item = items.find(i => i.id === poi.itemId);
                  const key = `${poi.itemId}_${JSON.stringify(poi.variant || {})}_${poi.customSpec || ''}`;
                  const remaining = poi.quantity - (poi.receivedQuantity || 0);

                  return (
                    <div key={key} className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 hover:border-blue-200 transition-colors space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <p className="text-sm font-black text-gray-900 uppercase tracking-tight">{item?.name || 'Unknown Item'}</p>
                          {poi.variant && Object.entries(poi.variant).map(([k, v]) => (
                            <span key={k} className="inline-block px-2 py-0.5 bg-gray-100 rounded-lg text-[9px] font-bold text-gray-500 uppercase mr-1">{k}: {v}</span>
                          ))}
                          {poi.customSpec && (
                            <span className="inline-block px-2 py-0.5 bg-purple-50 rounded-lg text-[9px] font-bold text-purple-600 uppercase mr-1">{poi.customSpec}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.1em]">{poi.receivedQuantity || 0} / {poi.quantity} RECEIVED</p>
                          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mt-1">{remaining} TO BE DELIVERED</p>
                        </div>
                      </div>

                      <div className="flex space-x-3">
                        <div className="flex-1 space-y-1">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Quantity</label>
                          <input 
                            type="number"
                            min="0"
                            max={remaining}
                            placeholder="0"
                            value={poItemQuantities[key] || ''}
                            onChange={e => {
                              const val = Math.min(remaining, Math.max(0, Number(e.target.value)));
                              setPoItemQuantities(prev => ({ ...prev, [key]: val }));
                            }}
                            className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        
                        {item?.isTool && (
                          <div className="flex-[2] space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Serial (If Qty 1)</label>
                            <input 
                              type="text"
                              placeholder={(poItemQuantities[key] || 0) !== 1 ? "Qty must be 1" : "Enter SN..."}
                              value={poItemSerials[key] || ''}
                              onChange={e => setPoItemSerials(prev => ({ ...prev, [key]: e.target.value }))}
                              disabled={(poItemQuantities[key] || 0) !== 1}
                              className="w-full p-4 bg-gray-50 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-30"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

              {selectedPO.items.every(poi => (poi.receivedQuantity || 0) >= poi.quantity) && (
                <div className="text-center py-8 bg-green-50 rounded-[2rem] border border-green-100">
                  <Check className="mx-auto text-green-500 mb-2" size={32} />
                  <p className="text-sm font-black text-green-900 uppercase tracking-widest">Fully Received</p>
                  <p className="text-[10px] font-bold text-green-500">This Purchase Order has been completed.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Item</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text"
                  placeholder="Search items..."
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {itemSearch && (
                  <button 
                    type="button"
                    onClick={() => setItemSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select 
                required
                value={selectedItemId}
                onChange={e => {
                  const itemId = e.target.value;
                  setSelectedItemId(itemId);
                  setSelectedVariant({});
                  
                  if (selectedPO) {
                    const poItem = selectedPO.items.find(i => i.itemId === itemId);
                    if (poItem) {
                      const remaining = poItem.quantity - (poItem.receivedQuantity || 0);
                      setQuantity(remaining > 0 ? remaining : 0);
                      setTotalPrice(poItem.unitPrice * (remaining > 0 ? remaining : 0));
                      if (poItem.variant) {
                        setSelectedVariant(poItem.variant);
                      }
                    }
                  }
                }}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="">Select an item...</option>
                {items
                  .filter(i => {
                    const matchesSearch = i.isActive && (itemSearch === '' || i.name.toLowerCase().includes(itemSearch.toLowerCase()));
                    if (selectedPO) {
                      return matchesSearch && selectedPO.items.some(poi => poi.itemId === i.id);
                    }
                    return matchesSearch;
                  })
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
              </select>
            </div>

            {selectedItem?.variantAttributes && selectedItem.variantAttributes.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                {selectedItem.variantAttributes.map(attr => {
                  const dimReqs = selectedItem.variantConfigs?.[0]?.dimensionRequirements;
                  const dimRequired = selectedItem.requireVariant && (!dimReqs || dimReqs[attr.name] !== false);
                  return (
                    <div key={attr.name} className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">{attr.name}</label>
                      <select
                        required={dimRequired}
                        value={selectedVariant[attr.name] || ''}
                        onChange={e => setSelectedVariant({...selectedVariant, [attr.name]: e.target.value})}
                        className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                      >
                        <option value="">{dimRequired ? 'Select...' : 'Optional...'}</option>
                        {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedItem?.requireCustomSpec && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">
                  {selectedItem.customSpecLabel || 'Specification'} <span className="text-red-500">*</span>
                </label>
                <input 
                  name="customSpec" 
                  type="text" 
                  required 
                  value={customSpec}
                  onChange={(e) => setCustomSpec(e.target.value)}
                  placeholder={`Enter ${selectedItem.customSpecLabel || 'detail'}...`}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                />
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Quantity</label>
                <div className="relative">
                  <input 
                    name="quantity" 
                    type="number" 
                    required 
                    value={quantity}
                    onChange={e => {
                      const val = e.target.value;
                      setQuantity(val === '' ? '' : Number(val));
                      
                      if (selectedPO && selectedItemId) {
                        const poItem = selectedPO.items.find(i => i.itemId === selectedItemId);
                        if (poItem) {
                          setTotalPrice(poItem.unitPrice * Number(val));
                        }
                      }
                    }}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
              </div>

              {selectedItemId && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Unit of Measure</label>
                  <div className="relative">
                    <select 
                      required
                      value={selectedUomId}
                      onChange={e => {
                        setSelectedUomId(e.target.value);
                        if (selectedPO && selectedItemId) {
                          const poItem = selectedPO.items.find(i => i.itemId === selectedItemId && i.uomId === e.target.value);
                          if (poItem) {
                            setTotalPrice(poItem.unitPrice * Number(quantity));
                          }
                        }
                      }}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-bold text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-10"
                    >
                      {(() => {
                        const baseUom = uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId);
                        const validUoms = new Set();
                        if (baseUom) validUoms.add(baseUom.id);
                        selectedItem?.uomConversions?.forEach(c => {
                          const convUom = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId);
                          if (convUom) validUoms.add(convUom.id);
                        });
                        
                        return uoms.filter(u => (validUoms.has(u.id) && u.isActive) || u.id === selectedUomId)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(u => (
                            <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                          ));
                      })()}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" size={16} />
                  </div>
                </div>
              )}

              {selectedItem?.isTool && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Serial Number</label>
                    <input 
                      name="serialNumber" 
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                      placeholder="SN-XXXX" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Property Number</label>
                    <input 
                      name="propertyNumber" 
                      value={propertyNumber}
                      onChange={(e) => setPropertyNumber(e.target.value)}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                      placeholder="PN-XXXX" 
                    />
                  </div>
                  {error && (
                    <p className="col-span-2 text-xs text-red-500 font-bold px-1">
                      {error}
                    </p>
                  )}
                  <p className="col-span-2 text-[10px] text-orange-600 font-bold px-1 italic">
                    * Tools require either a Serial Number or Property Number for tracking.
                  </p>
                </div>
              )}
            </div>

            {(type === 'delivery' || type === 'adjustment') && (
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Amount (Optional)</label>
                  {displayLatestPrice !== undefined && (
                    <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">
                      Latest: ₱{displayLatestPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">P</span>
                  <input 
                    name="totalPrice" 
                    type="number" 
                    step="0.01" 
                    value={totalPrice}
                    onChange={e => setTotalPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full pl-8 pr-4 py-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">From Location</label>
            <select 
              name="fromLocationId" 
              value={fromLocationId}
              onChange={e => setFromLocationId(e.target.value)}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">None</option>
              {groupLocations(locations.filter(l => {
                if (type === 'delivery') return l.type === 'supplier';
                return (profile?.role === 'admin' || (l.isActive && profile?.assignedLocationIds?.includes(l.id)));
              })).map(group => (
                <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                  {group.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">To Location</label>
            <select 
              name="toLocationId" 
              value={toLocationId}
              onChange={e => setToLocationId(e.target.value)}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">None</option>
              {groupLocations(locations.filter(l => {
                const isBaseAllowed = (profile?.role === 'admin' || (l.isActive && profile?.assignedLocationIds?.includes(l.id)));
                if (!isBaseAllowed) return false;
                
                if (type === 'delivery') {
                  if (profile?.role === 'warehouseman') {
                    return l.type === 'warehouse' || l.type === 'supplier';
                  }
                  if (profile?.role === 'worker' || profile?.role === 'engineer') {
                    return l.type === 'jobsite';
                  }
                }
                return true;
              })).map(group => (
                <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                  {group.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {type === 'delivery' && selectedPO?.destinationLocationId && toLocationId && toLocationId !== selectedPO.destinationLocationId && (
              <p className="text-[10px] font-bold text-amber-600 pl-1 pt-1">
                ⚠ Differs from PO destination ({selectedPO.destinationLocationName || locations.find(l => l.id === selectedPO.destinationLocationId)?.name || 'unknown'})
              </p>
            )}
          </div>
        </div>

        {type === 'delivery' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">PO Number</label>
              <input 
                name="poNumber" 
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                placeholder="PO-XXXX" 
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Invoice #</label>
              <input name="supplierInvoice" defaultValue={initialData?.supplierInvoice} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="INV-XXXX" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Supplier DR</label>
              <input name="supplierDR" defaultValue={initialData?.supplierDR} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="DR-XXXX" />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Note</label>
          <textarea 
            name="note" 
            defaultValue={initialData?.notes}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder="Add details about this movement..." 
          />
        </div>
      </div>

      <button 
        type="submit" 
        disabled={isSubmitting}
        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
        <span>{isSubmitting ? (initialData ? 'Updating...' : 'Recording...') : (initialData ? 'Update Transaction' : 'Record Transaction')}</span>
      </button>
    </form>
  );
};

interface PickingModalProps {
  requests: Request[];
  items: Item[];
  locations: Location[];
  inventory: Inventory[];
  uoms: UOM[];
  onDeliver: (
    selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[],
    options?: { customBatchId?: string; customDate?: Date }
  ) => void;
  onClose: () => void;
}

const normalizeDR = (val: string): string => {
  const trimmed = val.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('DR#') ? trimmed : `DR#${trimmed}`;
};

export const PickingModal = ({ requests, items, locations, inventory, uoms, onDeliver, onClose }: PickingModalProps) => {
  const [customBatchId, setCustomBatchId] = useState('');
  const [foundDR, setFoundDR] = useState<string | null>(null);
  const [drLookupDone, setDrLookupDone] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);

  const jobsiteId = requests[0]?.jobsiteId;

  useEffect(() => {
    if (!jobsiteId) { setDrLookupDone(true); return; }
    getExistingDRForJobsite(jobsiteId).then(existing => {
      if (existing) {
        setFoundDR(existing);
        setCustomBatchId(existing);
      }
      setDrLookupDone(true);
    });
  }, [jobsiteId]);
  
  const [selections, setSelections] = useState<Record<string, { deliveredQty: number; sourceLocationId: string; serialNumbers?: string[]; backorder?: boolean }>>(() => {
    const initial: Record<string, { deliveredQty: number; sourceLocationId: string; serialNumbers?: string[]; backorder?: boolean }> = {};
    requests.forEach(r => {
      initial[r.id] = {
        deliveredQty: r.approvedQty || r.requestedQty,
        sourceLocationId: (
          locations.find(l => l.isActive && l.id !== r.jobsiteId && l.name.toLowerCase() === 'main warehouse') ||
          locations.find(l => l.type === 'warehouse' && l.isActive && l.id !== r.jobsiteId)
        )?.id || '',
        serialNumbers: [],
        backorder: true // Default to true as per common warehouse practice
      };
    });
    return initial;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = requests.map(r => ({
      requestId: r.id,
      deliveredQty: selections[r.id].deliveredQty,
      sourceLocationId: selections[r.id].sourceLocationId,
      variant: r.variant,
      serialNumbers: selections[r.id].serialNumbers,
      backorder: selections[r.id].deliveredQty < (r.approvedQty || r.requestedQty) ? selections[r.id].backorder : false
    }));
    
    onDeliver(data, {
      customBatchId: normalizeDR(customBatchId) || undefined,
      customDate: deliveryDate ? new Date(deliveryDate) : undefined
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 rounded-2xl border border-blue-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2 pl-1">
            <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest">DR Number</label>
            {drLookupDone && (
              foundDR && customBatchId === foundDR
                ? <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">Reusing existing</span>
                : customBatchId.trim()
                  ? <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">Custom</span>
                  : <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-md">New (auto)</span>
            )}
          </div>
          <input
            type="text"
            value={customBatchId}
            onChange={e => setCustomBatchId(e.target.value)}
            onBlur={e => setCustomBatchId(normalizeDR(e.target.value))}
            placeholder={drLookupDone ? 'Auto-generate' : 'Checking…'}
            disabled={!drLookupDone}
            className="w-full p-3 bg-white border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest pl-1">Delivery Date</label>
          <input 
            type="date"
            value={deliveryDate}
            onChange={e => setDeliveryDate(e.target.value)}
            className="w-full p-3 bg-white border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {requests.map((req) => {
          const item = items.find(i => i.id === req.itemId);
          const uom = uoms.find(u => u.id === req.uomId || u.symbol === req.uomId);
          const selection = selections[req.id];
          const approvedQty = req.approvedQty || req.requestedQty;
          const remaining = approvedQty - selection.deliveredQty;
          
          // Find available serial numbers for this item at the selected source location
          const availableSerials = item?.isTool ? inventory.filter(inv => 
            inv.itemId === req.itemId && 
            inv.locationId === selection?.sourceLocationId && 
            inv.quantity > 0 &&
            inv.serialNumber
          ) : [];

          return (
            <div key={req.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-gray-900">{item?.name}</h4>
                  {req.variant && Object.keys(req.variant).length > 0 && (
                    <p className="text-[10px] text-gray-500 uppercase font-bold">
                      {Object.values(req.variant).join(', ')}
                    </p>
                  )}
                  {item?.isTool && (
                    <span className="text-[8px] px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded font-black uppercase tracking-widest">
                      Serialized Tool
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-blue-600">Approved: {approvedQty}</p>
                  <p className="text-[8px] font-bold text-gray-400 uppercase">{uom?.symbol || req.uomId}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Source</label>
                  <div className="relative">
                    <select 
                      required
                      value={selection?.sourceLocationId}
                      onChange={e => setSelections({
                        ...selections,
                        [req.id]: { ...selection, sourceLocationId: e.target.value, serialNumbers: [] }
                      })}
                      className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-8"
                    >
                      <option value="">Select Source...</option>
                      {groupLocations(locations.filter(l => (l.type === 'warehouse' || l.type === 'supplier') && l.isActive && l.id !== req.jobsiteId)).map(group => (
                        <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                          {group.locations.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Delivering</label>
                  <input 
                    type="number"
                    step="any"
                    required
                    readOnly={item?.isTool}
                    value={selection?.deliveredQty}
                    onChange={e => setSelections({
                      ...selections,
                      [req.id]: { ...selection, deliveredQty: e.target.value === '' ? 0 : Number(e.target.value) }
                    })}
                    className={cn(
                      "w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500",
                      item?.isTool && "bg-gray-50 text-gray-400 cursor-not-allowed"
                    )}
                  />
                </div>
              </div>

              {remaining > 0 && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between animate-in fade-in slide-in-from-top-1">
                  <div>
                    <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest">Backorder the balance?</p>
                    <p className="text-[8px] text-blue-600 font-bold">Unpicked: {remaining} {uom?.symbol}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelections({
                      ...selections,
                      [req.id]: { ...selection, backorder: !selection.backorder }
                    })}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                      selection.backorder 
                        ? "bg-blue-600 text-white shadow-sm" 
                        : "bg-white text-gray-400 border border-gray-200"
                    )}
                  >
                    {selection.backorder ? 'YES' : 'NO'}
                  </button>
                </div>
              )}

              {item?.isTool && selection?.sourceLocationId && (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">
                    Select Serial Numbers ({selection.serialNumbers?.length || 0} selected)
                  </label>
                  {availableSerials.length === 0 ? (
                    <p className="text-[10px] text-red-500 font-bold italic">No serialized units available at this location.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-1">
                      {availableSerials.map(inv => (
                        <label 
                          key={inv.id} 
                          className={cn(
                            "flex items-center p-2 rounded-xl border transition-colors cursor-pointer",
                            selection.serialNumbers?.includes(inv.serialNumber!) 
                              ? "bg-blue-50 border-blue-200" 
                              : "bg-white border-gray-100 hover:border-gray-200"
                          )}
                        >
                          <input 
                            type="checkbox"
                            className="hidden"
                            checked={selection.serialNumbers?.includes(inv.serialNumber!)}
                            onChange={e => {
                              const serials = selection.serialNumbers || [];
                              const newSerials = e.target.checked 
                                ? [...serials, inv.serialNumber!]
                                : serials.filter(s => s !== inv.serialNumber);
                              
                              setSelections({
                                ...selections,
                                [req.id]: { 
                                  ...selection, 
                                  serialNumbers: newSerials,
                                  deliveredQty: newSerials.length
                                }
                              });
                            }}
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-black text-gray-900 truncate">{inv.serialNumber}</span>
                            {inv.propertyNumber && <span className="text-[8px] text-gray-400 font-bold">PN: {inv.propertyNumber}</span>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex space-x-3">
        <button type="button" onClick={onClose} className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
          Cancel
        </button>
        <button type="submit" className="flex-2 py-4 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
          Schedule for Delivery
        </button>
      </div>
    </form>
  );
};

interface RequestApprovalModalProps {
  request: Request;
  items: Item[];
  uoms: UOM[];
  onApprove: (request: Request, approvedQty: number, note?: string) => void;
  onClose: () => void;
}

export const RequestApprovalModal = ({ request, items, uoms, onApprove, onClose }: RequestApprovalModalProps) => {
  const [approvedQty, setApprovedQty] = useState(request.requestedQty);
  const [note, setNote] = useState('');
  const item = items.find(i => i.id === request.itemId);
  const uom = uoms.find(u => u.id === request.uomId || u.symbol === request.uomId);

  return (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 rounded-2xl space-y-2">
        <div className="flex justify-between items-start">
            <div>
              <h4 className="font-bold text-blue-900">{item?.name}</h4>
              {request.variant && Object.keys(request.variant).length > 0 && (
                <p className="text-[10px] text-blue-400 uppercase font-black tracking-widest">
                  {Object.values(request.variant).join(', ')}
                </p>
              )}
            </div>
          <div className="text-right">
            <p className="text-lg font-black text-blue-600">{request.requestedQty}</p>
            <p className="text-[10px] font-bold text-blue-400 uppercase">{uom?.symbol || request.uomId}</p>
          </div>
        </div>
        {request.workerNote && (
          <div className="pt-2 border-t border-blue-100">
            <p className="text-[10px] text-blue-800 font-medium italic">"{request.workerNote}"</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Approved Quantity</label>
          <div className="relative">
            <input 
              type="number" 
              value={approvedQty}
              onChange={e => setApprovedQty(Number(e.target.value))}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 uppercase">
              {uom?.symbol || request.uomId}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Engineer Note (Optional)</label>
          <textarea 
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder="Add instructions or reason for quantity change..." 
          />
        </div>
      </div>

      {approvedQty > request.requestedQty && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700 flex items-center gap-2">
          <span>⚠</span>
          <span>Approved qty ({approvedQty}) exceeds requested qty ({request.requestedQty}). Double-check before approving.</span>
        </div>
      )}

      <div className="flex space-x-3 pt-2">
        <button onClick={onClose} className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
          Cancel
        </button>
        <button
          onClick={() => onApprove(request, approvedQty, note)}
          className="flex-2 py-4 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
        >
          Approve Request
        </button>
      </div>
    </div>
  );
};

export const DeliveryQuantityEditModal = ({ request, items, uoms, onUpdate, onClose }: { request: Request; items: Item[]; uoms: UOM[]; onUpdate: (requestId: string, newQty: number, createBackorder: boolean) => void; onClose: () => void }) => {
  const [newQty, setNewQty] = useState(request.deliveredQty || request.approvedQty || 0);
  const [createBackorder, setCreateBackorder] = useState(true);
  const item = items.find(i => i.id === request.itemId);
  const uom = uoms.find(u => u.id === request.uomId || u.symbol === request.uomId);
  
  const oldQty = request.deliveredQty || request.approvedQty || 0;
  const difference = oldQty - newQty;

  return (
    <div className="space-y-6">
      <div className="p-4 bg-orange-50 rounded-2xl space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-bold text-orange-900">{item?.name}</h4>
            {request.variant && Object.keys(request.variant).length > 0 && (
              <p className="text-[10px] text-orange-400 uppercase font-black tracking-widest">
                {Object.values(request.variant).join(', ')}
              </p>
            )}
            <p className="text-[10px] text-orange-600 font-bold mt-1">Batch: {request.batchId}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-orange-600">{oldQty}</p>
            <p className="text-[10px] font-bold text-orange-400 uppercase">Original Delivery Qty</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Adjusted Quantity</label>
          <div className="relative">
            <input 
              type="number" 
              step="any"
              value={newQty}
              onChange={e => setNewQty(Number(e.target.value))}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 uppercase">
              {uom?.symbol || request.uomId}
            </span>
          </div>
        </div>

        {difference > 0 && (
          <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between animate-in fade-in slide-in-from-top-1">
            <div>
              <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest">Create backorder for balance?</p>
              <p className="text-[8px] text-blue-600 font-bold">Balance: {difference} {uom?.symbol}</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateBackorder(!createBackorder)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                createBackorder 
                  ? "bg-blue-600 text-white shadow-sm" 
                  : "bg-white text-gray-400 border border-gray-200"
              )}
            >
              {createBackorder ? 'YES' : 'NO'}
            </button>
          </div>
        )}
      </div>

      <div className="flex space-x-3 pt-2">
        <button onClick={onClose} className="flex-1 py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
          Cancel
        </button>
        <button 
          disabled={newQty === oldQty || newQty < 0}
          onClick={() => onUpdate(request.id, newQty, difference > 0 ? createBackorder : false)}
          className="flex-2 py-4 bg-orange-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-50"
        >
          Update Delivery
        </button>
      </div>
    </div>
  );
};

interface PurchaseOrderFormProps {
  items: Item[];
  locations: Location[];
  uoms: UOM[];
  profile: UserProfile | null;
  initialData?: PurchaseOrder;
  onComplete: () => void;
}

export const PurchaseOrderForm = ({ items, locations, uoms, profile, initialData, onComplete }: PurchaseOrderFormProps) => {
  const { purchaseOrders, loading, categories } = useData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAddingNewItem, setIsAddingNewItem] = useState(false);
  const [pendingNewItemId, setPendingNewItemId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initialData?.supplierId || '');
  
  // Format: PO 26-001
  const generatePONumber = () => {
    const now = new Date();
    // Use GMT+8 for the year
    const gmt8Date = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const year = gmt8Date.getUTCFullYear().toString().slice(-2);
    const prefix = `PO ${year}-`;
    
    const yearPOs = purchaseOrders.filter(po => po.poNumber.startsWith(prefix));
    let nextNum = 1;
    
    if (yearPOs.length > 0) {
      const nums = yearPOs.map(po => {
        const parts = po.poNumber.split('-');
        return parseInt(parts[1]) || 0;
      });
      nextNum = Math.max(...nums) + 1;
    }
    
    return `${prefix}${nextNum.toString().padStart(3, '0')}`;
  };

  const [poNumber, setPoNumber] = useState(initialData?.poNumber || '');
  
  useEffect(() => {
    if (initialData?.poNumber && !poNumber) {
      setPoNumber(initialData.poNumber);
    }
  }, [initialData]);

  const [date, setDate] = useState(() => {
    if (initialData?.date) {
      const d = initialData.date.toDate();
      return d.toISOString().split('T')[0];
    }
    const now = new Date();
    const gmt8Date = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return gmt8Date.toISOString().split('T')[0];
  });

  const [status, setStatus] = useState<PurchaseOrder['status']>(initialData?.status || 'draft');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [generalNotes, setGeneralNotes] = useState(initialData?.generalNotes || '');
  const [project, setProject] = useState(initialData?.project || '');
  const [destinationLocationId, setDestinationLocationId] = useState(initialData?.destinationLocationId || '');
  const [terms, setTerms] = useState(initialData?.terms || '');
  const [deliverTo, setDeliverTo] = useState(initialData?.deliverTo || '');
  const [requestedBy, setRequestedBy] = useState(initialData?.requestedBy || '');
  const [discount, setDiscount] = useState(initialData?.discount || 0);
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>(initialData?.discountType || 'amount');
  const [vatEnabled, setVatEnabled] = useState(initialData?.vatEnabled !== false);
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>(initialData?.items || []);

  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);

  const subtotal = useMemo(() => {
    return poItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [poItems]);

  const globalDiscountAmount = useMemo(() => {
    if (discountType === 'percentage') {
      return subtotal * (discount / 100);
    }
    return discount;
  }, [subtotal, discount, discountType]);

  const totalAmount = useMemo(() => {
    return Math.max(0, subtotal - globalDiscountAmount);
  }, [subtotal, globalDiscountAmount]);

  const vatAmount = useMemo(() => {
    if (!vatEnabled) return 0;
    return totalAmount / 1.12 * 0.12;
  }, [totalAmount, vatEnabled]);

  const suppliers = useMemo(() => {
    return locations.filter(l => l.type === 'supplier' && l.isActive);
  }, [locations]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    if (!supplierId) { setErrorMsg('Please select a supplier'); return; }
    if (poItems.length === 0) { setErrorMsg('Please add at least one item'); return; }

    // Check for zero/missing quantity, required variants, and custom spec
    for (const poItem of poItems) {
      const item = items.find(i => i.id === poItem.itemId);
      if (!poItem.quantity || poItem.quantity <= 0) {
        setErrorMsg(`${item?.name || 'An item'} has a quantity of 0. Remove it or enter a valid quantity.`);
        return;
      }
      if (item?.requireVariant && item.variantAttributes) {
        const dimReqs = item.variantConfigs?.[0]?.dimensionRequirements;
        for (const attr of item.variantAttributes) {
          const isRequired = !dimReqs || dimReqs[attr.name] !== false;
          if (isRequired && !poItem.variant?.[attr.name]) {
            setErrorMsg(`Please select ${attr.name} for ${item.name}`);
            return;
          }
        }
      }
      if (item?.requireCustomSpec && !poItem.customSpec?.trim()) {
        setErrorMsg(`${item.name} requires a ${item.customSpecLabel || 'specification'}`);
        return;
      }
    }

    // Check for duplicate line items (same item + variant + customSpec)
    const lineKeys = poItems.map(pi => `${pi.itemId}_${JSON.stringify(pi.variant || {})}_${pi.customSpec || ''}`);
    const dupKey = lineKeys.find((k, i) => lineKeys.indexOf(k) !== i);
    if (dupKey) {
      const dupItem = items.find(i => i.id === poItems[lineKeys.indexOf(dupKey)].itemId);
      setErrorMsg(`${dupItem?.name || 'An item'} appears more than once. Merge duplicates before saving.`);
      return;
    }

    let finalPoNumber = poNumber;
    if (status !== 'draft' && !poNumber) {
      finalPoNumber = generatePONumber();
      setPoNumber(finalPoNumber);
    }

    setIsSubmitting(true);
    try {
      const supplier = suppliers.find(s => s.id === supplierId);
      const data = {
        poNumber: finalPoNumber,
        supplierId,
        supplierName: supplier?.name || '',
        supplierLongName: supplier?.longName || supplier?.name || '',
        supplierAddress: supplier?.address || '',
        requestedBy,
        status,
        notes,
        generalNotes,
        attention: supplier?.contactPerson || '',
        contactNo: supplier?.contactNumber || '',
        project,
        destinationLocationId: destinationLocationId || undefined,
        destinationLocationName: destinationLocationId
          ? locations.find(l => l.id === destinationLocationId)?.name
          : undefined,
        terms,
        deliverTo,
        discount,
        discountType,
        discountAmount: globalDiscountAmount,
        vatEnabled,
        vatAmount: vatEnabled ? vatAmount : 0,
        items: poItems,
        totalAmount,
        date: Timestamp.fromDate(new Date(date))
      };

      if (initialData) {
        await updatePO(initialData.id, data as any, poItems.map(pi => {
          const item = items.find(i => i.id === pi.itemId);
          const uom = uoms.find(u => u.id === pi.uomId || u.symbol === pi.uomId);
          let desc = item?.name || 'Unknown Item';
          if (pi.variant) {
            const variantStr = Object.values(pi.variant).join(', ');
            if (variantStr) desc += ` [${variantStr}]`;
          }
          if (pi.customSpec) desc += ` (${pi.customSpec})`;

          return {
            ...pi,
            description: desc,
            uom: uom?.symbol || pi.uomId,
          } as PurchaseOrderItem;
        }));
      } else {
        await createPurchaseOrder(data as any, poItems.map(pi => {
          const item = items.find(i => i.id === pi.itemId);
          const uom = uoms.find(u => u.id === pi.uomId || u.symbol === pi.uomId);
          let desc = item?.name || 'Unknown Item';
          if (pi.variant) {
            const variantStr = Object.values(pi.variant).join(', ');
            if (variantStr) desc += ` [${variantStr}]`;
          }
          if (pi.customSpec) desc += ` (${pi.customSpec})`;

          return {
            ...pi,
            description: desc,
            uom: uom?.symbol || pi.uomId,
          } as PurchaseOrderItem;
        }));
      }
      onComplete();
    } catch (error) {
      console.error(error);
      setErrorMsg(error instanceof Error ? error.message : 'Failed to save purchase order');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (pendingNewItemId) {
      const newItem = items.find(i => i.id === pendingNewItemId);
      if (newItem) {
        addItemToPO(newItem);
        setPendingNewItemId(null);
      }
    }
  }, [items, pendingNewItemId]);

  const addItemToPO = (item: Item) => {
    const largestConv = item.uomConversions?.length
      ? item.uomConversions.reduce((best, curr) => curr.factor > best.factor ? curr : best)
      : null;
    const baseCost = item.latestPrice && item.latestPrice > 0 ? item.latestPrice : undefined;
    const destLoc = destinationLocationId ? locations.find(l => l.id === destinationLocationId) : null;
    const newItem: PurchaseOrderItem = {
      itemId: item.id,
      quantity: 1,
      uomId: largestConv ? largestConv.uomId : item.uomId,
      conversionFactor: largestConv ? largestConv.factor : 1,
      srp: baseCost,
      discount: 0,
      discountType: 'amount',
      unitPrice: baseCost || 0,
      totalPrice: baseCost || 0,
      receivedQuantity: 0,
      note: '',
      ...(destLoc ? { assignedJobsiteId: destLoc.id, assignedJobsiteName: destLoc.name } : {})
    };
    setPoItems([...poItems, newItem]);
    setItemSearch('');
    setShowItemSearch(false);
  };

  const handleNewItemComplete = (newItemId?: string) => {
    setIsAddingNewItem(false);
    if (newItemId) {
      setPendingNewItemId(newItemId);
    }
  };

  const updatePOItem = (idx: number, updates: Partial<PurchaseOrderItem>) => {
    const next = [...poItems];
    const item = { ...next[idx], ...updates };

    // When variant changes, update SRP from variantConfigs or base latestPrice
    if ('variant' in updates) {
      const fullItem = items.find(i => i.id === item.itemId);
      if (fullItem) {
        const newVariant = updates.variant;
        let cost: number | undefined;
        if (newVariant && Object.keys(newVariant).some(k => newVariant[k])) {
          const config = fullItem.variantConfigs?.find(
            vc => normalizeVariant(vc.variant) === normalizeVariant(newVariant)
          );
          cost = config?.latestPrice && config.latestPrice > 0 ? config.latestPrice : undefined;
          if (cost === undefined && fullItem.latestPrice && fullItem.latestPrice > 0) {
            cost = fullItem.latestPrice;
          }
        } else {
          cost = fullItem.latestPrice && fullItem.latestPrice > 0 ? fullItem.latestPrice : undefined;
        }
        item.srp = cost;
      }
    }

    // Recalculate unit price based on srp and discount
    const srp = item.srp || 0;
    const disc = item.discount || 0;
    const discType = item.discountType || 'amount';

    let unitPrice = srp;
    if (disc > 0) {
      if (discType === 'percentage') {
        unitPrice = srp * (1 - disc / 100);
      } else {
        unitPrice = Math.max(0, srp - disc);
      }
    }

    item.unitPrice = unitPrice;
    item.totalPrice = item.quantity * unitPrice;

    next[idx] = item;
    setPoItems(next);
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">PO Number</label>
            <input
              value={poNumber}
              onChange={e => setPoNumber(e.target.value)}
              readOnly={!initialData && status === 'draft' && !poNumber}
              placeholder={!initialData && status === 'draft' ? 'Auto-assigned on confirm' : 'PO 26-001'}
              className={cn(
                'w-full p-4 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500',
                !initialData && status === 'draft' && !poNumber ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-gray-100'
              )}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">PO Date</label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Status</label>
            <div className="relative">
              <select
                value={status}
                onChange={e => {
                  const newStatus = e.target.value as PurchaseOrder['status'];
                  setStatus(newStatus);
                  if (newStatus !== 'draft' && !poNumber) {
                    setPoNumber(generatePONumber());
                  }
                }}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="partially_received">Partially Received</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Supplier</label>
            <div className="relative">
              <select 
                value={supplierId}
                onChange={e => {
                  const sid = e.target.value;
                  setSupplierId(sid);
                  const supplier = suppliers.find(s => s.id === sid);
                  if (supplier) {
                    setTerms(supplier.terms || '');
                  }
                }}
                required
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="">Select Supplier...</option>
                {suppliers
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Requested By</label>
            <input 
              value={requestedBy}
              onChange={e => setRequestedBy(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Ship To / Destination</label>
            <div className="relative">
              <select
                value={destinationLocationId}
                onChange={e => {
                  const id = e.target.value;
                  const loc = id ? locations.find(l => l.id === id) : null;
                  setDestinationLocationId(id);
                  setProject(loc?.name || '');
                  setPoItems(prev => prev.map(pi => ({
                    ...pi,
                    ...(loc
                      ? { assignedJobsiteId: loc.id, assignedJobsiteName: loc.name }
                      : { assignedJobsiteId: undefined, assignedJobsiteName: undefined })
                  })));
                }}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="">Select Destination...</option>
                {locations
                  .filter(l => l.type === 'jobsite' && l.isActive)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Terms</label>
            <input 
              value={terms}
              onChange={e => setTerms(e.target.value)}
              placeholder="e.g. Net 30"
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Deliver To</label>
            <div className="relative">
              <select 
                value={deliverTo}
                onChange={e => setDeliverTo(e.target.value)}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                <option value="">Select Destination...</option>
                <option value="WP Head Office">WP Head Office</option>
                <option value="Store Pick-up">Store Pick-up</option>
                <option value="Jobsite">Jobsite</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">General Notes (Printed on PO)</label>
          <textarea 
            value={generalNotes}
            onChange={e => setGeneralNotes(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder="Notes to be displayed above the items..." 
          />
        </div>

        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Items</label>
          <div className="space-y-3">
            {poItems.map((poItem, idx) => {
              const item = items.find(i => i.id === poItem.itemId);
              const baseUom = uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId);
              const selectedUom = uoms.find(u => u.id === poItem.uomId || u.symbol === poItem.uomId);
              const selectedUomSymbol = selectedUom?.symbol || poItem.uomId;
              const availableUoms = [
                { uomId: item?.uomId || '', symbol: baseUom?.symbol || item?.uomId || '', factor: 1 },
                ...(item?.uomConversions || []).map(conv => {
                  const convUom = uoms.find(u => u.id === conv.uomId || u.symbol === conv.uomId);
                  return { uomId: conv.uomId, symbol: convUom?.symbol || conv.uomId, factor: conv.factor };
                })
              ];
              const hasConversions = availableUoms.length > 1;
              const conversionFactor = poItem.conversionFactor || 1;

              return (
                <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
                  <div className="flex flex-col lg:flex-row gap-4 items-start">
                    {/* Item Info */}
                    <div className="flex gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-blue-600 shadow-sm shrink-0">
                        {item?.isTool ? <Wrench size={16} /> : <Box size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="mb-2">
                          <p className="text-sm font-bold text-gray-900 truncate">{item?.name || 'Unknown Item'}</p>
                          {hasConversions ? (
                            <div className="mt-1 space-y-0.5">
                              <select
                                value={poItem.uomId}
                                onChange={e => {
                                  const sel = availableUoms.find(u => u.uomId === e.target.value);
                                  updatePOItem(idx, { uomId: e.target.value, conversionFactor: sel?.factor || 1 });
                                }}
                                className="w-full p-1.5 bg-white border border-gray-200 rounded-lg text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {availableUoms.map(u => (
                                  <option key={u.uomId} value={u.uomId}>{u.symbol}</option>
                                ))}
                              </select>
                              {conversionFactor > 1 && (
                                <p className="text-[9px] text-blue-500 font-bold pl-1">
                                  1 {selectedUomSymbol} = {conversionFactor} {baseUom?.symbol || item?.uomId}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{selectedUomSymbol}</p>
                          )}
                        </div>
                        <textarea
                          value={poItem.note || ''}
                          ref={el => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                            }
                          }}
                          onChange={e => updatePOItem(idx, { note: e.target.value })}
                          placeholder="Add item note (Size, Color, Brand, etc.)"
                          rows={1}
                          className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden min-h-[36px]"
                        />

                        {/* Variant Selection if exists */}
                        {item?.variantAttributes && item.variantAttributes.length > 0 && (
                          <div className="grid grid-cols-2 gap-2 mt-2 px-1">
                            {item.variantAttributes.map(attr => {
                              const dimReqs = item.variantConfigs?.[0]?.dimensionRequirements;
                              const dimRequired = item.requireVariant && (!dimReqs || dimReqs[attr.name] !== false);
                              return (
                                <div key={attr.name} className="space-y-1">
                                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">{attr.name}</label>
                                  <select
                                    required={dimRequired}
                                    value={poItem.variant?.[attr.name] || ''}
                                    onChange={e => {
                                      const nextVariant = { ...(poItem.variant || {}), [attr.name]: e.target.value };
                                      updatePOItem(idx, { variant: nextVariant });
                                    }}
                                    className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none"
                                  >
                                    <option value="">{dimRequired ? 'Select...' : 'Optional...'}</option>
                                    {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Custom Spec Input */}
                        {item?.requireCustomSpec && (
                          <div className="mt-2 px-1 space-y-1">
                            <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">
                              {item.customSpecLabel || 'Specification'} <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={poItem.customSpec || ''}
                              onChange={e => updatePOItem(idx, { customSpec: e.target.value })}
                              placeholder={`Enter ${item.customSpecLabel || 'specification'}...`}
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        )}

                        {/* Jobsite Assignment - read-only, inherited from PO project */}
                        <div className="mt-2 px-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Assigned Jobsite</p>
                          {poItem.assignedJobsiteName ? (
                            <p className="text-[10px] font-bold text-blue-600">{poItem.assignedJobsiteName}</p>
                          ) : (
                            <p className="text-[10px] font-bold text-gray-400">Unassigned</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Pricing Inputs - In-line with the top row */}
                    <div className="flex flex-wrap items-start gap-2 shrink-0">
                      <div className="w-[70px] space-y-1">
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Quantity</label>
                        <input 
                          type="number"
                          value={poItem.quantity}
                          onChange={e => updatePOItem(idx, { quantity: Number(e.target.value) })}
                          className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 text-center"
                        />
                      </div>

                      <div className="w-[90px] space-y-1">
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">SRP</label>
                        <input
                          type="number"
                          step="0.01"
                          value={poItem.srp !== undefined ? poItem.srp : ''}
                          placeholder="0.00"
                          onChange={e => updatePOItem(idx, { srp: e.target.value === '' ? undefined : Number(e.target.value) })}
                          className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="w-[110px] space-y-1">
                        <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Discount</label>
                        <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                          <input 
                            type="number"
                            step="0.01"
                            value={poItem.discount || 0}
                            onChange={e => updatePOItem(idx, { discount: Number(e.target.value) })}
                            className="flex-1 min-w-0 p-2 text-xs font-bold outline-none"
                          />
                          <select
                            value={poItem.discountType || 'amount'}
                            onChange={e => updatePOItem(idx, { discountType: e.target.value as any })}
                            className="p-1 px-2 text-[10px] font-bold bg-gray-50 outline-none border-l border-gray-100"
                          >
                            <option value="amount">₱</option>
                            <option value="percentage">%</option>
                          </select>
                        </div>
                      </div>

                      <div className="w-[100px] space-y-1">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Total</p>
                        <div className="w-full p-2 bg-gray-100 rounded-xl text-xs font-bold text-gray-600 h-[34px] flex items-center justify-end">
                          {poItem.totalPrice.toLocaleString()}
                        </div>
                      </div>

                      <button type="button" onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))} className="text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  value={itemSearch}
                  onChange={e => {
                    setItemSearch(e.target.value);
                    setShowItemSearch(true);
                  }}
                  onFocus={() => setShowItemSearch(true)}
                  placeholder="Search items to add to PO..." 
                  className="w-full pl-10 pr-4 py-3 bg-gray-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                />
              </div>

              {showItemSearch && itemSearch && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                  {items
                    .filter(i => i.isActive && i.name.toLowerCase().includes(itemSearch.toLowerCase()))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => addItemToPO(i)}
                        className="w-full p-3 flex items-center space-x-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
                      >
                        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                          {i.isTool ? <Wrench size={16} /> : <Box size={16} />}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">{i.name}</p>
                          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {uoms.find(u => u.id === i.uomId || u.symbol === i.uomId)?.symbol || i.uomId}
                          </p>
                        </div>
                      </button>
                    ))}
                  
                  <button
                    type="button"
                    onClick={() => setIsAddingNewItem(true)}
                    className="w-full p-4 flex items-center justify-center space-x-2 hover:bg-blue-50 transition-colors text-blue-600 border-t border-gray-50"
                  >
                    <Plus size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">Add "{itemSearch}" as new item</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Notes</label>
          <textarea 
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
            placeholder="Add special instructions or terms..." 
          />
        </div>

        <div className="pt-4 border-t border-gray-100 space-y-3">
          <div className="flex justify-between items-center text-gray-500 px-1">
            <span className="text-xs font-bold uppercase tracking-wider">Subtotal</span>
            <span className="text-sm font-bold tracking-tight">₱ {subtotal.toLocaleString()}</span>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="space-y-0.5">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">PO Discount</label>
              <p className="text-[10px] text-gray-300 font-medium">Extra deduction for whole PO</p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex bg-gray-50 border border-gray-100 rounded-xl overflow-hidden h-10 w-48 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                <input
                  type="number"
                  value={discount}
                  onChange={e => setDiscount(Number(e.target.value))}
                  placeholder="0.00"
                  className="flex-1 min-w-0 px-4 text-sm font-bold outline-none bg-transparent"
                />
                <select
                  value={discountType}
                  onChange={e => setDiscountType(e.target.value as any)}
                  className="px-3 text-xs font-black bg-gray-100 outline-none border-l border-gray-100 uppercase tracking-widest text-gray-500"
                >
                  <option value="amount">₱</option>
                  <option value="percentage">%</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="space-y-0.5">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">VAT (12%)</label>
              <p className="text-[10px] text-gray-300 font-medium">
                {vatEnabled ? 'Prices are VAT-inclusive' : 'DR Price — no VAT'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setVatEnabled(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${vatEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${vatEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {vatEnabled && (
            <div className="flex justify-between items-center text-blue-600 px-1">
              <span className="text-xs font-bold uppercase tracking-wider">VAT Amount</span>
              <span className="text-sm font-bold tracking-tight">₱ {vatAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          <button type="submit" onClick={() => handleSubmit()} disabled={isSubmitting} className="w-full relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative w-full p-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-between overflow-hidden shadow-lg">
              <span className="text-xs uppercase tracking-[0.2em] relative z-10">Total Amount</span>
              <div className="flex items-center space-x-3 relative z-10">
                <span className="text-2xl font-black tracking-tight">
                  {totalAmount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }).replace('PHP', '₱')}
                </span>
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  {isSubmitting ? <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin"></div> : <Check size={18} />}
                </div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
            </div>
          </button>
        </div>

        <Modal 
          isOpen={isAddingNewItem} 
          onClose={() => setIsAddingNewItem(false)} 
          title="Create New Item"
        >
          <ItemForm 
            uoms={uoms} 
            categories={categories} 
            locations={locations}
            items={items}
            initialData={{ name: itemSearch } as any}
            onComplete={handleNewItemComplete} 
          />
        </Modal>

      </div>

      <div className="fixed bottom-16 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-100 lg:bottom-0 lg:left-72 z-40">
        <div className="max-w-5xl mx-auto space-y-2">
          {status === 'received' && poItems.some(pi => (pi.receivedQuantity || 0) < pi.quantity) && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700 flex items-center gap-2">
              <span>⚠</span>
              <span>
                {poItems.filter(pi => (pi.receivedQuantity || 0) < pi.quantity).length} item(s) have not been fully received. Double-check before saving as Received.
              </span>
            </div>
          )}
          {poItems.some(pi => pi.unitPrice === 0) && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700 flex items-center gap-2">
              <span>⚠</span>
              <span>
                {poItems.filter(pi => pi.unitPrice === 0).length} item(s) have a unit price of ₱0. Double-check before saving.
              </span>
            </div>
          )}
          {errorMsg && (
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
              <span>{errorMsg}</span>
              <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-600"><X size={16} /></button>
            </div>
          )}
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isSubmitting}
              className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 shadow-lg shadow-blue-200 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
              <span>{isSubmitting ? 'Saving...' : 'Save Purchase Order'}</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
