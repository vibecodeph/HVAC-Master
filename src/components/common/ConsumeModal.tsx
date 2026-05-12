import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Flame, CheckCircle, Loader2 } from 'lucide-react';
import { Item, UOM, UserProfile } from '../../types';
import { consumeInventory } from '../../services/inventoryService';
import { cn } from '../../lib/utils';

interface ConsumeModalProps {
  item: Item;
  entries: any[];
  selectedJobsiteId: string;
  uoms: UOM[];
  profile: UserProfile | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const ConsumeModal = ({
  item,
  entries,
  selectedJobsiteId,
  uoms,
  profile,
  onClose,
  onSuccess,
}: ConsumeModalProps) => {
  const locationKey = `lastConsumeLocation_${selectedJobsiteId}`;
  const [floor, setFloor] = useState(() => localStorage.getItem(`${locationKey}_floor`) || '');
  const [room, setRoom] = useState(() => localStorage.getItem(`${locationKey}_room`) || '');
  const [selectedEntryIdx, setSelectedEntryIdx] = useState(0);
  const [quantity, setQuantity] = useState('1');
  const [selectedUomId, setSelectedUomId] = useState<string>(item.uomId);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Reset sticky location when jobsite changes
  useEffect(() => {
    setFloor(localStorage.getItem(`${locationKey}_floor`) || '');
    setRoom(localStorage.getItem(`${locationKey}_room`) || '');
  }, [locationKey]);

  const baseUom = uoms.find(u => u.id === item.uomId || u.symbol === item.uomId);

  const uomOptions = useMemo(() => {
    const options: Array<{ uom: UOM; factor: number }> = [];
    if (baseUom) options.push({ uom: baseUom, factor: 1 });
    (item.uomConversions || []).forEach(conv => {
      const u = uoms.find(u => u.id === conv.uomId || u.symbol === conv.uomId);
      if (u) options.push({ uom: u, factor: conv.factor });
    });
    return options;
  }, [item, uoms, baseUom]);

  const getEntryVariantAndSpec = (entry: any) => {
    const variant = entry.boq?.variant || (entry.type === 'unplanned' && !Array.isArray(entry.inv) ? entry.inv?.variant : null);
    const customSpec = Array.isArray(entry.inv) ? entry.inv[0]?.customSpec : entry.inv?.customSpec;
    return { variant: variant || undefined, customSpec: customSpec || undefined };
  };

  const getEntryLabel = (entry: any): string => {
    const { variant, customSpec } = getEntryVariantAndSpec(entry);
    const parts: string[] = [];
    if (variant && Object.keys(variant).length > 0) {
      parts.push(Object.values(variant).join(' - '));
    }
    if (customSpec) parts.push(customSpec);
    return parts.length > 0 ? parts.join(' · ') : 'Default';
  };

  const hasVariants = !!(item.variantAttributes && item.variantAttributes.length > 0);
  const selectedEntry = entries[selectedEntryIdx] || entries[0];
  const currentStock = selectedEntry?.totalQty ?? 0;

  const handleConsume = async () => {
    setError(null);
    if (!floor.trim()) { setError('Floor is required'); return; }
    if (!room.trim()) { setError('Room / Area is required'); return; }
    const qty = parseFloat(quantity);
    if (!quantity || isNaN(qty) || qty <= 0) { setError('Quantity must be greater than 0'); return; }
    if (!selectedUomId) { setError('Please select a UOM'); return; }

    const uomOption = uomOptions.find(o => o.uom.id === selectedUomId || o.uom.symbol === selectedUomId);
    const conversionFactor = uomOption?.factor ?? 1;
    const { variant, customSpec } = getEntryVariantAndSpec(selectedEntry);

    setIsSubmitting(true);
    try {
      await consumeInventory(
        item.id,
        selectedJobsiteId,
        variant,
        customSpec,
        qty,
        selectedUomId,
        conversionFactor,
        floor.trim(),
        room.trim(),
        profile?.displayName || profile?.firstName || profile?.email || ''
      );

      localStorage.setItem(`${locationKey}_floor`, floor.trim());
      localStorage.setItem(`${locationKey}_room`, room.trim());

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 900);
    } catch (e: any) {
      setError(e.message || 'Failed to record consumption');
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-14 space-y-3">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle className="text-green-600" size={32} />
        </div>
        <p className="text-sm font-black text-gray-900 uppercase tracking-widest">Consumed</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Row 1: Floor + Room */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Floor</label>
          <input
            type="text"
            value={floor}
            onChange={e => setFloor(e.target.value)}
            placeholder="e.g. 3F"
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Room / Area</label>
          <input
            type="text"
            value={room}
            onChange={e => setRoom(e.target.value)}
            placeholder="e.g. Server Room"
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Spacer */}
      <div className="h-1" />

      {/* Row 2: Item name */}
      <div className="text-center py-1">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Consuming</p>
        <h3 className="text-xl font-black text-gray-900">{item.name}</h3>
        <p className="text-xs text-gray-400 mt-1 font-medium">
          Current stock:{' '}
          <span className={cn('font-black', currentStock < 0 ? 'text-red-500' : currentStock === 0 ? 'text-amber-500' : 'text-gray-700')}>
            {currentStock}
          </span>
          {' '}<span className="text-gray-400">{baseUom?.symbol || item.uomId}</span>
        </p>
      </div>

      {/* Row 3: Variant selector */}
      {hasVariants && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Variant</label>
          <div className="relative">
            <select
              value={selectedEntryIdx}
              onChange={e => setSelectedEntryIdx(Number(e.target.value))}
              className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
            >
              {entries.map((entry, idx) => (
                <option key={idx} value={idx}>
                  {getEntryLabel(entry)} — {entry.totalQty} {baseUom?.symbol || item.uomId}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
          </div>
        </div>
      )}

      {/* Row 4: Quantity + UOM */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            min="0.001"
            step="1"
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">UOM</label>
          <div className="relative">
            <select
              value={selectedUomId}
              onChange={e => setSelectedUomId(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
            >
              {uomOptions.map(({ uom, factor }) => (
                <option key={uom.id} value={uom.id}>
                  {uom.name} ({factor})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={handleConsume}
          disabled={isSubmitting}
          className="flex-1 py-3.5 bg-gray-900 text-white rounded-xl text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <>
              <Flame size={14} />
              Consume
            </>
          )}
        </button>
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="px-6 py-3.5 bg-gray-100 text-gray-600 rounded-xl text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
