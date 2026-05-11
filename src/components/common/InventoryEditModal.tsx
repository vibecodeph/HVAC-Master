import React, { useState } from 'react';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { Inventory, Item, UserProfile } from '../../types';
import { manualEditInventory } from '../../services/inventoryService';
import { cn } from '../../lib/utils';

interface Props {
  inv: Inventory;
  item: Item;
  variant?: Record<string, string>;
  profile: UserProfile;
  locationName: string;
  onClose: () => void;
}

export const InventoryEditModal: React.FC<Props> = ({
  inv,
  item,
  variant,
  profile,
  locationName,
  onClose,
}) => {
  const [quantity, setQuantity] = useState(String(inv.quantity));
  const [unitPrice, setUnitPrice] = useState(inv.unitPrice !== undefined ? String(inv.unitPrice) : '');
  const [customSpec, setCustomSpec] = useState(inv.customSpec || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const parsedQty = parseFloat(quantity);
  const parsedPrice = unitPrice !== '' ? parseFloat(unitPrice) : undefined;

  const isQtyZero = !isNaN(parsedQty) && parsedQty === 0 && inv.quantity !== 0;
  const isPriceZero = parsedPrice !== undefined && parsedPrice === 0;

  const showCustomSpec = item.requireCustomSpec || !!inv.customSpec;

  const handleSave = async () => {
    if (isNaN(parsedQty) || parsedQty < 0) {
      setError('Quantity must be a non-negative number.');
      return;
    }
    if (parsedPrice !== undefined && isNaN(parsedPrice)) {
      setError('Unit price must be a valid number.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      await manualEditInventory(
        inv.id!,
        item.id,
        variant,
        {
          quantity: parsedQty,
          unitPrice: parsedPrice,
          customSpec: customSpec || undefined,
          notes: notes.trim(),
        },
        profile.uid
      );
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
        <div className="font-bold text-sm text-gray-900">{item.name}</div>
        <div className="text-xs text-gray-400 font-medium mt-0.5">{locationName}</div>
        {variant && Object.keys(variant).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(variant).map(([k, v]) => (
              <span
                key={k}
                className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-bold uppercase tracking-tight"
              >
                {String(v)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
          Quantity
        </label>
        <input
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-full px-3 py-2.5 bg-gray-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {isQtyZero && (
          <div className="mt-2 flex items-start space-x-2 p-2.5 bg-amber-50 rounded-xl border border-amber-200">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] font-semibold text-amber-700 leading-tight">
              You are setting quantity to 0. This removes all stock at this location.
            </p>
          </div>
        )}
      </div>

      <div>
        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
          Unit Price <span className="text-gray-400 font-medium normal-case tracking-normal">(optional)</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
          <input
            type="number"
            min="0"
            step="any"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="Leave blank to keep current"
            className="w-full pl-7 pr-3 py-2.5 bg-gray-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        {isPriceZero && (
          <div className="mt-2 flex items-start space-x-2 p-2.5 bg-amber-50 rounded-xl border border-amber-200">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] font-semibold text-amber-700 leading-tight">
              Setting price to ₱0.00. Average cost will be updated to zero.
            </p>
          </div>
        )}
      </div>

      {showCustomSpec && (
        <div>
          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
            {item.customSpecLabel || 'Custom Spec'}
          </label>
          <input
            type="text"
            value={customSpec}
            onChange={(e) => setCustomSpec(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
          Notes <span className="text-gray-400 font-medium normal-case tracking-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for manual correction (e.g. physical count discrepancy)..."
          rows={2}
          className="w-full px-3 py-2.5 bg-gray-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-xl border border-red-100">
          <p className="text-xs font-semibold text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center space-x-2 p-3 bg-green-50 rounded-xl border border-green-100">
          <CheckCircle size={14} className="text-green-600 shrink-0" />
          <p className="text-xs font-semibold text-green-700">Changes saved successfully.</p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || success}
        className={cn(
          "w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95",
          isQtyZero
            ? "bg-amber-600 hover:bg-amber-700 text-white"
            : "bg-gray-900 hover:bg-gray-800 text-white",
          (saving || success) && "opacity-50 cursor-not-allowed"
        )}
      >
        {saving ? (
          <span className="flex items-center justify-center space-x-2">
            <Loader2 size={14} className="animate-spin" />
            <span>Saving...</span>
          </span>
        ) : isQtyZero ? (
          'Confirm & Save'
        ) : (
          'Save Changes'
        )}
      </button>
    </div>
  );
};
