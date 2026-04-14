import React, { useState, useMemo, useEffect } from 'react';
import { Check, Loader2, Plus, X, Wrench, Box, Settings2, ChevronDown, ChevronUp, Search, Calendar } from 'lucide-react';
import { 
  addItem, updateItem, 
  recordTransaction, updateTransaction,
  addRequest,
  addPurchaseOrder, updatePurchaseOrder,
  addPOPayment, updatePOPayment, deletePOPayment, subscribeToPOPayments
} from '../services/inventoryService';
import { cn } from '../lib/utils';
import { 
  Item, Category, UOM, Location, Inventory, Transaction, Request, 
  UserProfile, Asset, VariantConfig, ItemComponent,
  PurchaseOrder, PurchaseOrderItem, POPayment
} from '../types';
import { useData } from '../App';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { CreditCard, Receipt, Trash2, AlertCircle, DollarSign, MinusCircle } from 'lucide-react';

interface RequestFormProps {
  item: Item;
  locations: Location[];
  uoms: UOM[];
  profile: UserProfile | null;
  defaultJobsiteId?: string;
  onComplete: () => void;
}

export const RequestForm = ({ item, locations, uoms, profile, defaultJobsiteId, onComplete }: RequestFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});

  const isVariantComplete = useMemo(() => {
    if (!item.requireVariant || !item.variantAttributes || item.variantAttributes.length === 0) return true;
    return item.variantAttributes.every(attr => selectedVariant[attr.name]);
  }, [item, selectedVariant]);

  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault();
      if (!isVariantComplete) return;
      setIsSubmitting(true);
      try {
        const formData = new FormData(e.currentTarget);
        const qty = Number(formData.get('quantity'));
        const jobsiteId = formData.get('jobsiteId') as string;

        await addRequest({
          itemId: item.id,
          requestedQty: qty,
          uomId: uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.id || item.uomId,
          jobsiteId,
          requestorId: profile?.uid || '',
          requestorName: profile?.displayName || '',
          variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
          workerNote: formData.get('note') as string,
          status: 'pending',
        });

        onComplete();
      } catch (error) {
        console.error(error);
      } finally {
        setIsSubmitting(false);
      }
    }}>
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
            {item.variantAttributes.map(attr => (
              <div key={attr.name} className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">{attr.name}</label>
                <select 
                  required={item.requireVariant}
                  value={selectedVariant[attr.name] || ''}
                  onChange={e => setSelectedVariant({...selectedVariant, [attr.name]: e.target.value})}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="">{item.requireVariant ? 'Select...' : 'Optional...'}</option>
                  {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Quantity</label>
            <div className="relative">
              <input name="quantity" type="number" required className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 uppercase">
                {uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Jobsite</label>
            <select 
              name="jobsiteId" 
              required 
              defaultValue={defaultJobsiteId || ''}
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
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Note (Optional)</label>
          <textarea name="note" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" placeholder="Add instructions or specific requirements..." />
        </div>
      </div>

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
  onComplete: () => void;
}

export const ItemForm = ({ uoms, categories, locations, items, initialData, isDuplicate, onComplete }: ItemFormProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTool, setIsTool] = useState(initialData?.isTool || false);
  const [requireVariant, setRequireVariant] = useState(initialData?.requireVariant || false);
  
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
  const [attributes, setAttributes] = useState<{ name: string; values: string[] }[]>(initialData?.variantAttributes || []);
  const [newAttrName, setNewAttrName] = useState('');
  const [variantConfigs, setVariantConfigs] = useState<Record<string, { reorderLevel?: number; averageCost?: number }>>(() => {
    const initial: Record<string, { reorderLevel?: number; averageCost?: number }> = {};
    initialData?.variantConfigs?.forEach(vc => {
      initial[JSON.stringify(vc.variant)] = { reorderLevel: vc.reorderLevel, averageCost: vc.averageCost };
    });
    return initial;
  });
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

  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault();
      setIsSubmitting(true);
      try {
        const formData = new FormData(e.currentTarget);
        const data = {
          name: formData.get('name') as string,
          categoryId: mainCategoryId,
          subcategoryId: subCategoryId,
          uomId: uomId,
          isTool,
          isActive: formData.get('isActive') === 'on',
          variantAttributes: attributes,
          requireVariant,
          tags: (formData.get('tags') as string).split(',').map(t => t.trim()).filter(Boolean),
          reorderLevel: Number(formData.get('reorderLevel')) || 0,
          averageCost: Number(formData.get('averageCost')) || 0,
          variantConfigs: combinations
            .map(variant => {
              const key = JSON.stringify(variant);
              const config = variantConfigs[key];
              if (!config) return null;
              if (config.reorderLevel === undefined && config.averageCost === undefined) return null;
              return {
                variant,
                reorderLevel: config.reorderLevel,
                averageCost: config.averageCost
              };
            })
            .filter((vc): vc is any => vc !== null),
          components: components.length > 0 ? components : undefined
        };

        if (initialData && !isDuplicate) {
          await updateItem(initialData.id, data);
        } else {
          await addItem(data);
        }
        console.log('Item saved successfully, calling onComplete');
        onComplete();
      } catch (error) {
        console.error('Error saving item:', error);
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
              {categories.filter(c => !c.parentId && (c.isActive || c.id === mainCategoryId)).map(c => (
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
              {uoms.filter(u => u.isActive || u.id === uomId).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
              ))}
            </select>
          </div>
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
            {categories.filter(c => c.parentId === mainCategoryId && (c.isActive || c.id === subCategoryId)).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

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
              onClick={() => setRequireVariant(!requireVariant)}
              className={cn(
                "w-12 h-6 rounded-full transition-colors relative",
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
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Avg. Cost</label>
            <input name="averageCost" type="number" step="0.01" defaultValue={initialData?.averageCost} className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
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
                  <p className="text-xs text-orange-700 mt-1">Leave blank to use the default re-order level and average cost defined above.</p>
                </div>
                
                <div className="space-y-3">
                  {combinations.map((variant, idx) => {
                    const key = JSON.stringify(variant);
                    const config = variantConfigs[key] || {};
                    
                    return (
                      <div key={idx} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(variant).map(([k, v]) => (
                              <span key={k} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[8px] font-black uppercase rounded tracking-widest">
                                {k}: {v}
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
                            <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Avg. Cost</label>
                            <input 
                              type="number"
                              step="0.01"
                              value={config.averageCost ?? ''}
                              onChange={e => setVariantConfigs({
                                ...variantConfigs,
                                [key]: { ...config, averageCost: e.target.value === '' ? undefined : Number(e.target.value) }
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
  const [quantity, setQuantity] = useState<number | string>(initialData?.quantity || '');
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
      const mainWarehouse = locations.find(l => l.name.toLowerCase() === 'main warehouse');
      if (mainWarehouse) {
        setToLocationId(mainWarehouse.id);
      }
    }
  }, [type, locations, initialData]);

  const selectedItem = items.find(i => i.id === selectedItemId);

  const currentVariantConfig = useMemo(() => {
    if (!selectedItem || Object.keys(selectedVariant).length === 0) return null;
    return selectedItem.variantConfigs?.find(vc => 
      JSON.stringify(vc.variant) === JSON.stringify(selectedVariant)
    );
  }, [selectedItem, selectedVariant]);

  const displayAverageCost = currentVariantConfig?.averageCost ?? selectedItem?.averageCost;

  const [serialNumber, setSerialNumber] = useState(initialData?.serialNumber || '');
  const [propertyNumber, setPropertyNumber] = useState(initialData?.propertyNumber || '');
  const [error, setError] = useState<string | null>(null);

  const isTool = selectedItem?.isTool;
  const isToolValid = !isTool || serialNumber.trim() !== '' || propertyNumber.trim() !== '';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (isTool && !isToolValid) {
      setError('Tools require either a Serial Number or Property Number.');
      return;
    }
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const fromLoc = formData.get('fromLocationId') as string;
      const toLoc = formData.get('toLocationId') as string;
      const sn = formData.get('serialNumber') as string;
      const pn = formData.get('propertyNumber') as string;
      const supplierInvoice = formData.get('supplierInvoice') as string;
      const supplierDR = formData.get('supplierDR') as string;

      const poItem = (poId && type === 'delivery' && selectedPO) ? selectedPO.items.find(i => i.itemId === selectedItemId) : null;
      const targetUomId = poItem?.uomId || uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId)?.id || selectedItem?.uomId || '';
      const conversionFactor = (targetUomId === selectedItem?.uomId) ? 1 : (selectedItem?.uomConversions?.find(c => c.uomId === targetUomId)?.factor || 1);

      const transactionData = {
        itemId: selectedItemId,
        type,
        quantity: Number(quantity),
        fromLocationId: fromLoc || null,
        toLocationId: toLoc || null,
        serialNumber: sn || null,
        propertyNumber: pn || null,
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

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div className="flex p-1 bg-gray-100 rounded-2xl">
          {['delivery', 'usage', 'return', 'adjustment'].map((t) => {
            if (t === 'delivery' && profile?.role !== 'admin' && profile?.role !== 'warehouseman') return null;
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
                  // Reset item selection when PO changes
                  setSelectedItemId('');
                  setSelectedVariant({});
                  setQuantity('');
                  setTotalPrice('');
                }
              }}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">No Purchase Order</option>
              {purchaseOrders
                .filter(po => {
                  if (po.status === 'cancelled') return false;
                  if (po.id === poId) return true; // Always show currently selected PO
                  
                  // A PO is selectable if it's not fully received yet based on item quantities
                  const isFullyReceived = po.items.length > 0 && po.items.every(item => (item.receivedQuantity || 0) >= item.quantity);
                  
                  // Allow if not fully received OR if status is not 'received'
                  return !isFullyReceived || po.status !== 'received';
                })
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
              .map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
          </select>
        </div>

        {selectedItem?.variantAttributes && selectedItem.variantAttributes.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {selectedItem.variantAttributes.map(attr => (
              <div key={attr.name} className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">{attr.name}</label>
                <select 
                  required={selectedItem.requireVariant}
                  value={selectedVariant[attr.name] || ''}
                  onChange={e => setSelectedVariant({...selectedVariant, [attr.name]: e.target.value})}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="">{selectedItem.requireVariant ? 'Select...' : 'Optional...'}</option>
                  {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ))}
          </div>
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
              {groupLocations(locations.filter(l => 
                (profile?.role === 'admin' || (l.isActive && profile?.assignedLocationIds?.includes(l.id)))
              )).map(group => (
                <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                  {group.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
                  
                  // If PO is selected, try to update total price based on PO unit price
                  if (selectedPO && selectedItemId) {
                    const poItem = selectedPO.items.find(i => i.itemId === selectedItemId);
                    if (poItem) {
                      setTotalPrice(poItem.unitPrice * Number(val));
                    }
                  }
                }}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 uppercase">
                {(() => {
                  if (selectedPO && selectedItemId) {
                    const poItem = selectedPO.items.find(i => i.itemId === selectedItemId);
                    if (poItem) {
                      return uoms.find(u => u.id === poItem.uomId || u.symbol === poItem.uomId)?.symbol || poItem.uomId;
                    }
                  }
                  return uoms.find(u => u.id === selectedItem?.uomId || u.symbol === selectedItem?.uomId)?.symbol || selectedItem?.uomId;
                })()}
              </span>
            </div>
          </div>
          {selectedItem?.isTool && (
            <>
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
            </>
          )}
        </div>

        {(type === 'delivery' || type === 'adjustment') && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Amount (Optional)</label>
              {displayAverageCost !== undefined && (
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">
                  Avg: ₱{displayAverageCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
  onDeliver: (selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[]) => void;
  onClose: () => void;
}

export const PickingModal = ({ requests, items, locations, inventory, uoms, onDeliver, onClose }: PickingModalProps) => {
  const [selections, setSelections] = useState<Record<string, { deliveredQty: number; sourceLocationId: string; serialNumbers?: string[] }>>(() => {
    const initial: Record<string, { deliveredQty: number; sourceLocationId: string; serialNumbers?: string[] }> = {};
    requests.forEach(r => {
      initial[r.id] = { 
        deliveredQty: r.approvedQty || r.requestedQty, 
        sourceLocationId: locations.find(l => l.type === 'warehouse' && l.isActive)?.id || '',
        serialNumbers: []
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
      serialNumbers: selections[r.id].serialNumbers
    }));
    onDeliver(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {requests.map((req) => {
          const item = items.find(i => i.id === req.itemId);
          const uom = uoms.find(u => u.id === req.uomId || u.symbol === req.uomId);
          const selection = selections[req.id];
          
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
                  <p className="text-xs font-black text-blue-600">Approved: {req.approvedQty}</p>
                  <p className="text-[8px] font-bold text-gray-400 uppercase">{uom?.symbol || req.uomId}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Source</label>
                  <select 
                    required
                    value={selection?.sourceLocationId}
                    onChange={e => setSelections({
                      ...selections,
                      [req.id]: { ...selection, sourceLocationId: e.target.value, serialNumbers: [] }
                    })}
                    className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Source...</option>
                    {groupLocations(locations.filter(l => (l.type === 'warehouse' || l.type === 'supplier') && l.isActive)).map(group => (
                      <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                        {group.locations.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Delivering</label>
                  <input 
                    type="number"
                    required
                    readOnly={item?.isTool}
                    value={selection?.deliveredQty}
                    onChange={e => setSelections({
                      ...selections,
                      [req.id]: { ...selection, deliveredQty: Number(e.target.value) }
                    })}
                    className={cn(
                      "w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500",
                      item?.isTool && "bg-gray-50 text-gray-400 cursor-not-allowed"
                    )}
                  />
                </div>
              </div>

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
          Confirm Delivery
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

interface PurchaseOrderFormProps {
  items: Item[];
  locations: Location[];
  uoms: UOM[];
  profile: UserProfile | null;
  initialData?: PurchaseOrder;
  onComplete: () => void;
}

export const PurchaseOrderForm = ({ items, locations, uoms, profile, initialData, onComplete }: PurchaseOrderFormProps) => {
  const { purchaseOrders, loading } = useData();
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    } else if (year === '26') {
      // User mentioned PO 26-091 is the last one
      nextNum = 92;
    }
    
    return `${prefix}${nextNum.toString().padStart(3, '0')}`;
  };

  const [poNumber, setPoNumber] = useState(initialData?.poNumber || '');
  
  useEffect(() => {
    if (!initialData && !poNumber && !loading) {
      setPoNumber(generatePONumber());
    }
  }, [purchaseOrders, loading, initialData]);

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
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>(initialData?.items || []);
  
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);

  // Payment State
  const [payments, setPayments] = useState<POPayment[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const isAdminOrManager = profile?.role === 'admin' || profile?.role === 'manager';

  useEffect(() => {
    if (initialData?.id && isAdminOrManager) {
      return subscribeToPOPayments(initialData.id, setPayments);
    }
  }, [initialData?.id, isAdminOrManager]);

  const totalAmount = useMemo(() => {
    return poItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [poItems]);

  const totalPaid = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

  const suppliers = useMemo(() => {
    return locations.filter(l => l.type === 'supplier' && l.isActive);
  }, [locations]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!supplierId) return alert('Please select a supplier');
    if (poItems.length === 0) return alert('Please add at least one item');

    // Check for required variants
    for (const poItem of poItems) {
      const item = items.find(i => i.id === poItem.itemId);
      if (item?.requireVariant && item.variantAttributes) {
        for (const attr of item.variantAttributes) {
          if (!poItem.variant?.[attr.name]) {
            return alert(`Please select ${attr.name} for ${item.name}`);
          }
        }
      }
    }

    setIsSubmitting(true);
    try {
      const data = {
        poNumber,
        supplierId,
        status,
        notes,
        items: poItems,
        totalAmount,
        date: Timestamp.fromDate(new Date(date))
      };

      if (initialData) {
        await updatePurchaseOrder(initialData.id, data);
      } else {
        await addPurchaseOrder(data, profile?.displayName);
      }
      onComplete();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addItemToPO = (item: Item) => {
    const newItem: PurchaseOrderItem = {
      itemId: item.id,
      quantity: 1,
      uomId: item.uomId,
      unitPrice: item.averageCost || 0,
      totalPrice: item.averageCost || 0,
      receivedQuantity: 0,
      note: ''
    };
    setPoItems([...poItems, newItem]);
    setItemSearch('');
    setShowItemSearch(false);
  };

  const updatePOItem = (idx: number, updates: Partial<PurchaseOrderItem>) => {
    const next = [...poItems];
    next[idx] = { ...next[idx], ...updates };
    next[idx].totalPrice = next[idx].quantity * next[idx].unitPrice;
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
              required
              placeholder="PO 26-001"
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
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
                onChange={e => setStatus(e.target.value as any)}
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

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Supplier</label>
          <select 
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            required
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
          >
            <option value="">Select Supplier...</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Items</label>
          <div className="space-y-3">
            {poItems.map((poItem, idx) => {
              const item = items.find(i => i.id === poItem.itemId);
              return (
                <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-blue-600 shadow-sm">
                        {item?.isTool ? <Wrench size={16} /> : <Box size={16} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{item?.name || 'Unknown Item'}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.symbol || item?.uomId}
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))} className="text-red-500 p-1">
                      <X size={16} />
                    </button>
                  </div>

                  {item?.variantAttributes && item.variantAttributes.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {item.variantAttributes.map(attr => (
                        <div key={attr.name} className="space-y-1">
                          <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">{attr.name}</label>
                          <select 
                            required={item.requireVariant}
                            value={poItem.variant?.[attr.name] || ''}
                            onChange={e => {
                              const nextVariant = { ...(poItem.variant || {}), [attr.name]: e.target.value };
                              updatePOItem(idx, { variant: nextVariant });
                            }}
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none"
                          >
                            <option value="">{item.requireVariant ? 'Select...' : 'Optional...'}</option>
                            {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Quantity</label>
                      <input 
                        type="number"
                        value={poItem.quantity}
                        onChange={e => updatePOItem(idx, { quantity: Number(e.target.value) })}
                        className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Unit Price</label>
                      <input 
                        type="number"
                        step="0.01"
                        value={poItem.unitPrice}
                        onChange={e => updatePOItem(idx, { unitPrice: Number(e.target.value) })}
                        className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-1 flex flex-col justify-end">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Total</label>
                      <div className="w-full p-2 bg-gray-100 rounded-xl text-xs font-bold text-gray-600 h-[34px] flex items-center">
                        {poItem.totalPrice.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest pl-1">Item Note (Size, Color, etc.)</label>
                    <input 
                      type="text"
                      value={poItem.note || ''}
                      onChange={e => updatePOItem(idx, { note: e.target.value })}
                      placeholder="e.g. 12 inch, Blue, Heavy Duty"
                      className="w-full p-2 bg-white border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    />
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

        <div className="p-4 bg-blue-600 rounded-2xl text-white flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest">Total Amount</span>
          <span className="text-xl font-black">{totalAmount.toLocaleString()}</span>
        </div>

        {initialData && isAdminOrManager && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-black text-gray-900">Payments</h4>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Paid: ₱ {totalPaid.toLocaleString()} / ₱ {totalAmount.toLocaleString()}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setShowPaymentForm(true)}
                className="px-3 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center space-x-1"
              >
                <Plus size={14} />
                <span>Add Payment</span>
              </button>
            </div>

            {showPaymentForm && (
              <div className="p-6 bg-white border-2 border-blue-100 rounded-[2rem] shadow-xl">
                <div className="flex items-center space-x-2 mb-4">
                  <CreditCard className="text-blue-600" size={20} />
                  <h5 className="font-black text-gray-900">New Payment Record</h5>
                </div>
                <POPaymentForm 
                  po={initialData} 
                  onComplete={() => setShowPaymentForm(false)}
                  onCancel={() => setShowPaymentForm(false)}
                />
              </div>
            )}

            <div className="space-y-3">
              {payments.map(payment => (
                <div key={payment.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-gray-400 shadow-sm">
                        <Receipt size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-gray-900">CV: {payment.cvNumber}</p>
                        <p className="text-[10px] font-bold text-gray-400">
                          {format(payment.date.toDate(), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest",
                      payment.status === 'collected' ? "bg-green-100 text-green-600" : 
                      payment.status === 'prepared' ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                    )}>
                      {payment.status}
                    </div>
                  </div>
                  
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200/50">
                      <div className="flex items-center space-x-4">
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Net Amount</p>
                          <p className="text-xs font-black text-gray-900">₱ {payment.amount.toLocaleString()}</p>
                        </div>
                        {payment.deductions.length > 0 && (
                          <div>
                            <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Deductions</p>
                            <p className="text-xs font-black text-red-500">
                              -₱ {(payment.grossAmount - payment.amount).toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {deletingPaymentId === payment.id ? (
                        <div className="flex items-center space-x-1">
                          <button 
                            type="button"
                            onClick={async () => {
                              await deletePOPayment(initialData.id, payment.id);
                              setDeletingPaymentId(null);
                            }}
                            className="px-2 py-1 bg-red-600 text-white text-[8px] font-black rounded-lg uppercase tracking-widest"
                          >
                            Confirm
                          </button>
                          <button 
                            type="button"
                            onClick={() => setDeletingPaymentId(null)}
                            className="px-2 py-1 bg-gray-200 text-gray-600 text-[8px] font-black rounded-lg uppercase tracking-widest"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button 
                          type="button"
                          onClick={() => setDeletingPaymentId(payment.id)}
                          className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                </div>
              ))}
              {payments.length === 0 && (
                <div className="p-8 text-center bg-gray-50/50 rounded-2xl border-2 border-dashed border-gray-100">
                  <CreditCard className="mx-auto text-gray-200 mb-2" size={32} />
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">No payments recorded yet</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-16 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-100 lg:bottom-0 lg:left-72 z-40">
        <div className="max-w-5xl mx-auto flex space-x-3">
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
  );
};
