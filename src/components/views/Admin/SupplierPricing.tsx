import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, Package, ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { subscribeToSupplierPricing } from '../../../services/supplierPricingService';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { SupplierPricingRecord } from '../../../types';

interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  latestPrice: number;
  latestPricePerBase: number;
  latestDateMs: number;
  uomSymbol: string;
  conversionFactor: number;
  totalReceived: number;
  history: SupplierPricingRecord[];
}

interface ItemVariantGroup {
  itemId: string;
  itemName: string;
  variantKey: string;
  variantLabel: string;
  suppliers: SupplierSummary[];
  baseUomSymbol: string;
}

const buildVariantKey = (variant?: Record<string, string> | null): string =>
  variant && Object.keys(variant).length > 0
    ? Object.keys(variant).sort().map(k => `${k}:${variant[k]}`).join('|')
    : '_base';

export const SupplierPricingView = () => {
  const { profile } = useAuth();
  const { items, locations, uoms } = useData();
  const [records, setRecords] = useState<SupplierPricingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = subscribeToSupplierPricing((data) => {
      setRecords(data);
      setLoading(false);
    });
    return () => unsub();
  }, [isAdmin]);

  const grouped = useMemo((): ItemVariantGroup[] => {
    const map = new Map<string, ItemVariantGroup>();

    for (const record of records) {
      const vKey = buildVariantKey(record.variant);
      const groupKey = `${record.itemId}|${vKey}`;
      const item = items.find(i => i.id === record.itemId);
      const baseUom = uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId);

      if (!map.has(groupKey)) {
        const variantLabel = record.variant && Object.keys(record.variant).length > 0
          ? Object.values(record.variant).join(', ')
          : '';
        map.set(groupKey, {
          itemId: record.itemId,
          itemName: item?.name || record.itemId,
          variantKey: vKey,
          variantLabel,
          suppliers: [],
          baseUomSymbol: baseUom?.symbol || item?.uomId || '',
        });
      }

      const group = map.get(groupKey)!;
      const uomSymbol = uoms.find(u => u.id === record.uomId || u.symbol === record.uomId)?.symbol || record.uomId;
      const cf = record.conversionFactor > 0 ? record.conversionFactor : 1;
      const pricePerBase = record.unitPrice / cf;
      const recordDateMs = record.receivedDate?.toDate?.().getTime() ?? 0;

      let supplier = group.suppliers.find(s => s.supplierId === record.supplierId);
      if (!supplier) {
        supplier = {
          supplierId: record.supplierId,
          supplierName: record.supplierName || locations.find(l => l.id === record.supplierId)?.name || 'Unknown',
          latestPrice: record.unitPrice,
          latestPricePerBase: pricePerBase,
          latestDateMs: recordDateMs,
          uomSymbol,
          conversionFactor: cf,
          totalReceived: 0,
          history: [],
        };
        group.suppliers.push(supplier);
      }

      supplier.history.push(record);
      supplier.totalReceived += record.quantityReceived;

      if (recordDateMs > supplier.latestDateMs) {
        supplier.latestPrice = record.unitPrice;
        supplier.latestPricePerBase = pricePerBase;
        supplier.latestDateMs = recordDateMs;
        supplier.uomSymbol = uomSymbol;
        supplier.conversionFactor = cf;
      }
    }

    map.forEach(group => {
      group.suppliers.sort((a, b) => a.latestPricePerBase - b.latestPricePerBase);
    });

    return Array.from(map.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [records, items, locations, uoms]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped.filter(g =>
      g.itemName.toLowerCase().includes(q) || g.variantLabel.toLowerCase().includes(q)
    );
  }, [grouped, search]);

  const formatDate = (ms: number) => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="pb-20">
      <Header title="Supplier Pricing" />
      <div className="p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full pl-9 pr-4 py-3 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
              <Package size={32} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">No pricing data yet</h3>
              <p className="text-xs text-gray-500 mt-1">Receive a PO to start tracking supplier prices.</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(group => {
            const groupKey = `${group.itemId}|${group.variantKey}`;
            const isExpanded = expandedGroups.has(groupKey);
            const cheapest = group.suppliers[0];
            const priciest = group.suppliers[group.suppliers.length - 1];
            const savingsPct = group.suppliers.length > 1 && priciest.latestPricePerBase > 0
              ? ((priciest.latestPricePerBase - cheapest.latestPricePerBase) / priciest.latestPricePerBase) * 100
              : 0;

            return (
              <Card key={groupKey} className="overflow-hidden">
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full p-4 flex items-center justify-between text-left active:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{group.itemName}</p>
                    {group.variantLabel && (
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{group.variantLabel}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs font-bold text-green-600">
                        Best: ₱{cheapest.latestPricePerBase.toFixed(2)}/{group.baseUomSymbol}
                      </span>
                      {savingsPct > 0.5 && (
                        <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-md">
                          Save {savingsPct.toFixed(1)}%
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 font-medium">
                        {group.suppliers.length} supplier{group.suppliers.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  {isExpanded
                    ? <ChevronUp size={16} className="text-gray-400 shrink-0 ml-2" />
                    : <ChevronDown size={16} className="text-gray-400 shrink-0 ml-2" />
                  }
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {group.suppliers.map((supplier, si) => {
                      const isCheapest = si === 0;
                      const priceDiffPct = group.suppliers.length > 1 && cheapest.latestPricePerBase > 0
                        ? ((supplier.latestPricePerBase - cheapest.latestPricePerBase) / cheapest.latestPricePerBase) * 100
                        : 0;

                      const sortedHistory = [...supplier.history].sort((a, b) => {
                        const da = a.receivedDate?.toDate?.().getTime() ?? 0;
                        const db2 = b.receivedDate?.toDate?.().getTime() ?? 0;
                        return db2 - da;
                      });
                      const prevPricePerBase = sortedHistory.length > 1
                        ? sortedHistory[1].unitPrice / (sortedHistory[1].conversionFactor > 0 ? sortedHistory[1].conversionFactor : 1)
                        : null;
                      const trending = prevPricePerBase !== null
                        ? supplier.latestPricePerBase > prevPricePerBase ? 'up'
                          : supplier.latestPricePerBase < prevPricePerBase ? 'down'
                          : 'flat'
                        : 'flat';

                      return (
                        <div
                          key={supplier.supplierId}
                          className={cn(
                            'p-4 flex items-center justify-between',
                            si < group.suppliers.length - 1 && 'border-b border-gray-50',
                            isCheapest && 'bg-green-50/50'
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-gray-900">{supplier.supplierName}</p>
                              {isCheapest && group.suppliers.length > 1 && (
                                <span className="text-[9px] font-black text-green-600 bg-green-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                  Cheapest
                                </span>
                              )}
                              {trending === 'up' && <TrendingUp size={12} className="text-red-400" />}
                              {trending === 'down' && <TrendingDown size={12} className="text-green-500" />}
                            </div>
                            <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                              Last received: {formatDate(supplier.latestDateMs)}
                              {' · '}{supplier.totalReceived.toLocaleString()} {supplier.uomSymbol} total
                            </p>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="text-base font-black text-gray-900">
                              ₱{supplier.latestPrice.toFixed(2)}
                              <span className="text-[10px] font-bold text-gray-400">/{supplier.uomSymbol}</span>
                            </p>
                            {supplier.conversionFactor > 1 && (
                              <p className="text-[10px] font-bold text-gray-500">
                                ₱{supplier.latestPricePerBase.toFixed(2)}/{group.baseUomSymbol} base
                              </p>
                            )}
                            {!isCheapest && priceDiffPct > 0 && (
                              <p className="text-[10px] font-bold text-red-500">+{priceDiffPct.toFixed(1)}% vs cheapest</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};
