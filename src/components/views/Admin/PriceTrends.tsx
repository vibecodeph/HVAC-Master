import { useState, useMemo } from 'react';
import { TrendingUp, ChevronDown, ChevronUp, Search, Package } from 'lucide-react';
import { useData } from '../../../App';
import { normalizeVariant } from '../../../lib/utils';
import { Item, VariantConfig, PriceHistoryEntry } from '../../../types';
import { Timestamp } from 'firebase/firestore';
import { Card } from '../../common/Card';
import { cn } from '../../../lib/utils';

const formatDate = (ts: Timestamp | undefined): string => {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatPrice = (price: number) =>
  `₱${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PriceRow {
  date: Timestamp;
  price: number;
  source: string;
}

export const PriceTrends = () => {
  const { items } = useData();
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedVariantKey, setSelectedVariantKey] = useState('_base');
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const filteredItems = useMemo(() => {
    const base = items.filter(i => i.isActive);
    if (!itemSearch.trim()) return [...base].sort((a, b) => a.name.localeCompare(b.name));
    const s = itemSearch.toLowerCase();
    return base
      .filter(i => i.name.toLowerCase().includes(s) || i.tags?.some(t => t.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, itemSearch]);

  const selectedItem = items.find(i => i.id === selectedItemId) as Item | undefined;

  const variantOptions = useMemo(() => {
    if (!selectedItem) return [];
    if (!selectedItem.variantAttributes || selectedItem.variantAttributes.length === 0) return [];
    return (selectedItem.variantConfigs || [])
      .filter(vc => vc.latestPrice !== undefined || (vc.priceHistory && vc.priceHistory.length > 0))
      .map(vc => ({
        key: normalizeVariant(vc.variant),
        label: Object.values(vc.variant).join(' / '),
        config: vc,
      }));
  }, [selectedItem]);

  const priceHistory: PriceRow[] = useMemo(() => {
    if (!selectedItem) return [];
    if (selectedItem.variantAttributes && selectedItem.variantAttributes.length > 0) {
      if (selectedVariantKey === '_base') return [];
      const config = selectedItem.variantConfigs?.find(
        vc => normalizeVariant(vc.variant) === selectedVariantKey
      ) as VariantConfig | undefined;
      return (config?.priceHistory || []).slice().reverse();
    }
    return (selectedItem.priceHistory || []).slice().reverse();
  }, [selectedItem, selectedVariantKey]);

  const latestPrice = useMemo(() => {
    if (!selectedItem) return undefined;
    if (selectedItem.variantAttributes && selectedItem.variantAttributes.length > 0) {
      const config = selectedItem.variantConfigs?.find(
        vc => normalizeVariant(vc.variant) === selectedVariantKey
      ) as VariantConfig | undefined;
      return config?.latestPrice;
    }
    return selectedItem.latestPrice;
  }, [selectedItem, selectedVariantKey]);

  const latestPriceDate = useMemo(() => {
    if (!selectedItem) return undefined;
    if (selectedItem.variantAttributes && selectedItem.variantAttributes.length > 0) {
      const config = selectedItem.variantConfigs?.find(
        vc => normalizeVariant(vc.variant) === selectedVariantKey
      ) as VariantConfig | undefined;
      return config?.latestPriceDate;
    }
    return selectedItem.latestPriceDate;
  }, [selectedItem, selectedVariantKey]);

  const sourceLabel = (source: string) => {
    if (source === 'po_receive') return 'PO Receive';
    if (source === 'invoice') return 'Invoice';
    if (source === 'manual') return 'Manual';
    return source;
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-black text-gray-900 tracking-tight">Price Trends</h2>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Item price history analysis</p>
      </div>

      <Card className="p-4 space-y-4 overflow-visible">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Select Item</label>
          {isDropdownOpen && (
            <div className="fixed inset-0 z-[90]" onClick={() => setIsDropdownOpen(false)} />
          )}
          <div className="relative group z-[95]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors z-10" size={18} />
            <input
              type="text"
              placeholder="Search items..."
              value={selectedItemId ? (selectedItem?.name || '') : itemSearch}
              onFocus={() => {
                setIsDropdownOpen(true);
                if (selectedItemId) {
                  setItemSearch('');
                  setSelectedItemId('');
                  setSelectedVariantKey('_base');
                }
              }}
              onChange={e => {
                setItemSearch(e.target.value);
                setSelectedItemId('');
                setSelectedVariantKey('_base');
                setIsDropdownOpen(true);
              }}
              className="w-full pl-12 pr-4 py-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400"
            />
            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[100] max-h-[250px] overflow-y-auto no-scrollbar">
                {filteredItems.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {filteredItems.map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setSelectedItemId(i.id);
                          setSelectedVariantKey('_base');
                          setItemSearch('');
                          setIsDropdownOpen(false);
                        }}
                        className="w-full p-3 text-left text-sm font-bold text-gray-900 hover:bg-blue-50 hover:text-blue-700 rounded-xl transition-colors"
                      >
                        {i.name}
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
          </div>
        </div>

        {selectedItem && variantOptions.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Variant</label>
            <select
              value={selectedVariantKey}
              onChange={e => setSelectedVariantKey(e.target.value)}
              className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="_base">— Select variant —</option>
              {variantOptions.map(v => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {selectedItem && (
        <>
          {latestPrice !== undefined ? (
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Latest Price</p>
                <p className="text-2xl font-black text-blue-600">{formatPrice(latestPrice)}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{formatDate(latestPriceDate)}</p>
              </div>
              <TrendingUp size={32} className="text-blue-200" />
            </Card>
          ) : (
            <Card className="p-4">
              <p className="text-sm text-gray-400 font-medium">No price recorded yet.</p>
            </Card>
          )}

          {priceHistory.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-gray-50">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Price History ({priceHistory.length} entries)
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {priceHistory.map((entry, idx) => (
                  <div key={idx} className={cn('flex items-center justify-between px-4 py-3', idx === 0 && 'bg-blue-50/50')}>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{formatPrice(entry.price)}</p>
                      <p className="text-[10px] font-medium text-gray-400">{formatDate(entry.date)}</p>
                    </div>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest',
                      entry.source === 'po_receive' ? 'bg-green-100 text-green-700' :
                      entry.source === 'invoice' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-600'
                    )}>
                      {sourceLabel(entry.source)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ) : selectedItem && (selectedVariantKey !== '_base' || !selectedItem.variantAttributes?.length) ? (
            <Card className="p-4">
              <p className="text-sm text-gray-400 font-medium">No price history available.</p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
};
