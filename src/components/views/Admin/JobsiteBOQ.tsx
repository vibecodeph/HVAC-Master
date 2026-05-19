import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, Check, Loader2, AlertTriangle, ChevronDown, Package, Box, ArrowLeft, X, Download, Upload, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../../App';
import { BOQItem, Item } from '../../../types';
import { addBOQItem, updateBOQItem, deleteBOQItem, replaceJobsiteBOQ } from '../../../services/inventoryService';
import { cn, normalizeVariant } from '../../../lib/utils';
import { useDebounce } from '../../../hooks/useDebounce';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { exportJobsiteBOQToCSV, importJobsiteBOQFromCSV } from '../../../services/csvService';

const BOQItemGroup = ({ itemId, boqItems, items, uoms, inventory, jobsiteId }: { itemId: string; boqItems: BOQItem[]; items: Item[]; uoms: any[]; inventory: any[]; jobsiteId: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const item = items.find(i => i.id === itemId);
  const uom = uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId);

  // Pre-calculate delivered stock for each variant and filter out "empty" ones
  const activeEntries = boqItems.map(boq => {
    const delivered = inventory
      .filter(inv => {
        const matchesLocation = inv.locationId === jobsiteId;
        const matchesItem = inv.itemId === boq.itemId;
        const matchesVariant = !boq.variant || normalizeVariant(inv.variant) === normalizeVariant(boq.variant);
        return matchesLocation && matchesItem && matchesVariant;
      })
      .reduce((sum, inv) => sum + inv.quantity, 0);
    
    return { boq, delivered };
  });

  if (activeEntries.length === 0) return null;

  return (
    <Card className="bg-white border-gray-100 shadow-sm overflow-hidden rounded-2xl">
      <div 
        className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-4 flex-1">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <Box size={24} />
          </div>
          <div className="min-w-0">
            <h4 className="font-black text-gray-900 text-sm tracking-tight">
              {item?.name}
            </h4>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {confirmDelete === 'all' ? (
            <div className="flex items-center space-x-2 bg-red-50 p-1.5 rounded-xl border border-red-100 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
              <span className="text-[8px] font-black text-red-600 uppercase tracking-widest px-1">Delete All?</span>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await Promise.all(boqItems.map(boq => deleteBOQItem(boq.id)));
                  } catch (err: any) {
                    console.error('Delete BOQ error:', err);
                  }
                  setConfirmDelete(null);
                }}
                className="px-2 py-1 bg-red-600 text-white rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm hover:bg-red-700 transition-colors"
              >
                Yes
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(null);
                }}
                className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm hover:bg-gray-50 transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete('all');
              }}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
              title="Remove all from BOQ"
            >
              <Trash2 size={18} />
            </button>
          )}
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="text-gray-400"
          >
            <ChevronDown size={20} />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="divide-y divide-gray-50 border-t border-gray-50">
              {activeEntries.map(({ boq, delivered }) => {
                const isOverTarget = (boq.targetQuantity || 0) > 0 && delivered > (boq.targetQuantity || 0);
                
                return (
                  <div key={boq.id} className={cn("p-4 group", isOverTarget && "bg-red-50/10")}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex flex-wrap gap-2">
                        {boq.variant && Object.entries(boq.variant).map(([k, v]) => (
                          <span key={k} className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-lg font-black uppercase tracking-tight">
                            {String(v)}
                          </span>
                        ))}
                        {boq.customSpec && (
                          <span className="text-[10px] px-2 py-1 bg-purple-100 text-purple-700 rounded-lg font-black uppercase tracking-tight">
                            {boq.customSpec}
                          </span>
                        )}
                        {isOverTarget && (
                          <div className="flex items-center space-x-1 text-red-600 bg-red-100 px-2 py-1 rounded-lg">
                            <AlertTriangle size={10} />
                            <span className="text-[8px] font-black uppercase">Over Target</span>
                          </div>
                        )}
                      </div>
                      {confirmDelete === boq.id ? (
                        <div className="flex items-center space-x-2 bg-red-50 p-1.5 rounded-xl border border-red-100 animate-in fade-in zoom-in duration-200">
                          <span className="text-[8px] font-black text-red-600 uppercase tracking-widest px-1">Confirm?</span>
                          <button 
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await deleteBOQItem(boq.id);
                              } catch (err: any) {
                                console.error('Delete BOQ error:', err);
                              }
                              setConfirmDelete(null);
                            }}
                            className="px-2 py-1 bg-red-600 text-white rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm hover:bg-red-700 transition-colors"
                          >
                            Yes
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(null);
                            }}
                            className="px-2 py-1 bg-white border border-gray-200 text-gray-500 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm hover:bg-gray-50 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(boq.id);
                          }}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Target Qty</label>
                        <input 
                          type="number"
                          placeholder="Unlimited"
                          defaultValue={boq.targetQuantity || ''}
                          onBlur={async (e) => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            if (val !== boq.targetQuantity) await updateBOQItem(boq.id, { targetQuantity: val as any });
                          }}
                          className={cn(
                            "w-full px-3 py-2.5 rounded-xl text-xs font-bold ring-1 ring-inset ring-gray-100 outline-none focus:ring-2 focus:ring-blue-500",
                            isOverTarget ? "bg-red-50 ring-red-100 text-red-900" : "bg-gray-50"
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Unit of Measure</label>
                        <div className="relative">
                          <select 
                            value={boq.uomId || item?.uomId || ''}
                            onChange={async (e) => {
                              const val = e.target.value;
                              await updateBOQItem(boq.id, { uomId: val });
                            }}
                            className="w-full pl-3 pr-8 py-2.5 bg-gray-50 ring-1 ring-inset ring-gray-100 rounded-xl text-xs font-bold text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                          >
                            {(() => {
                              const baseUom = uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId);
                              const validUoms = new Set();
                              if (baseUom) validUoms.add(baseUom.id);
                              item?.uomConversions?.forEach(c => {
                                const convUom = uoms.find(u => u.id === c.uomId || u.symbol === c.uomId);
                                if (convUom) validUoms.add(convUom.id);
                              });

                              return uoms.filter(u => (validUoms.has(u.id) && u.isActive) || u.id === boq.uomId)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map(u => (
                                  <option key={u.id} value={u.id}>{u.symbol} - {u.name}</option>
                                ));
                            })()}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" size={14} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Budget Price</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400">₱</span>
                          <input 
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            defaultValue={boq.unitPrice || ''}
                            onBlur={async (e) => {
                              const val = e.target.value === '' ? null : Number(e.target.value);
                              if (val !== boq.unitPrice) await updateBOQItem(boq.id, { unitPrice: val as any });
                            }}
                            className="w-full pl-7 pr-3 py-2.5 bg-gray-50 ring-1 ring-inset ring-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Small Note</label>
                      <input 
                        type="text"
                        placeholder="Add a small note for this site item..."
                        defaultValue={boq.note || ''}
                        onBlur={async (e) => {
                          const val = e.target.value.trim();
                          if (val !== (boq.note || '')) await updateBOQItem(boq.id, { note: val || null as any });
                        }}
                        className="w-full px-3 py-2.5 bg-gray-50 ring-1 ring-inset ring-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="flex items-center justify-between mt-3 px-1">
                      <div className="flex items-center space-x-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <div className="flex items-center space-x-1">
                          <span className={cn(
                            "text-[9px] font-black uppercase tracking-widest",
                            delivered === 0 ? "text-gray-400" : "text-gray-500"
                          )}>
                            {delivered}
                          </span>
                          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest opacity-80">
                            {uoms.find(u => u.id === boq.uomId)?.symbol || uom?.symbol || item?.uomId} Delivered
                          </span>
                        </div>
                      </div>
                      {boq.targetQuantity && (
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          Remaining: {Math.max(0, boq.targetQuantity - delivered)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
};

export const JobsiteBOQView = () => {
  const { jobsiteId } = useParams<{ jobsiteId: string }>();
  const navigate = useNavigate();
  const { user, profile, isOnline } = useAuth();
  const { items, boqs, uoms, inventory, locations, categories } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [pendingImportData, setPendingImportData] = useState<Omit<BOQItem, 'id' | 'timestamp'>[] | null>(null);
  const [confirmClearBOQ, setConfirmClearBOQ] = useState(false);
  const [selectedItemForVariant, setSelectedItemForVariant] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [selectedCustomSpec, setSelectedCustomSpec] = useState('');

  const jobsite = locations.find(l => l.id === jobsiteId);
  const jobsiteBOQ = boqs.filter(b => b.jobsiteId === jobsiteId);

  // Grouping logic
  const groupedBOQ = useMemo(() => {
    const groups: Record<string, { 
      categoryName: string; 
      parentName?: string; 
      itemGroups: Record<string, BOQItem[]> 
    }> = {};

    jobsiteBOQ.forEach(boq => {
      const item = items.find(i => i.id === boq.itemId);
      const category = categories.find(c => c.id === item?.categoryId);
      const parentCategory = category?.parentId ? categories.find(c => c.id === category.parentId) : null;
      
      const groupId = category?.id || 'uncategorized';
      if (!groups[groupId]) {
        groups[groupId] = {
          categoryName: category?.name || 'Uncategorized',
          parentName: parentCategory?.name,
          itemGroups: {}
        };
      }
      
      if (!groups[groupId].itemGroups[boq.itemId]) {
        groups[groupId].itemGroups[boq.itemId] = [];
      }
      groups[groupId].itemGroups[boq.itemId].push(boq);
    });

    // Sort groups alphabetically by parent name then category name
    return Object.entries(groups).sort(([, a], [, b]) => {
      const nameA = `${a.parentName || ''} ${a.categoryName}`.trim();
      const nameB = `${b.parentName || ''} ${b.categoryName}`.trim();
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  }, [jobsiteBOQ, items, categories]);

  const filteredItems = useMemo(() => {
    if (!debouncedSearchTerm) return [];
    return items.filter(i => 
      !i.isTool && 
      i.isActive && 
      (i.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
       i.description?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
    ).slice(0, 10);
  }, [items, debouncedSearchTerm]);

  const handleAdd = async (itemId: string, variant?: Record<string, string>, customSpec?: string) => {
    if (!jobsiteId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await addBOQItem({
        jobsiteId,
        itemId,
        variant: variant || null,
        customSpec: customSpec || null,
        uomId: items.find(i => i.id === itemId)?.uomId || '',
        targetQuantity: 0,
        currentQuantity: 0,
        unitPrice: 0,
        isExtra: false,
        addedBy: user?.uid || ''
      });
      setSearchTerm('');
      setSelectedItemForVariant(null);
      setSelectedVariant({});
      setSelectedCustomSpec('');
    } catch (err: any) {
      setError(err.message || 'Failed to add item to BOQ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = () => {
    if (!jobsite) return;
    exportJobsiteBOQToCSV(jobsiteBOQ, items, uoms, jobsite.name);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !jobsiteId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await importJobsiteBOQFromCSV(
        file,
        jobsiteId,
        items,
        uoms,
        profile?.displayName || 'Admin',
        (current, total) => setImportProgress({ current, total })
      );

      if (result.errors.length > 0) {
        setError(`IMPORT COMPLETED WITH ERRORS: ${result.errors.join(', ')}`.toUpperCase());
      }

      if (result.data && result.data.length > 0) {
        setPendingImportData(result.data);
      } else {
        setError('No valid items found in the CSV to import.');
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setIsSubmitting(false);
      setImportProgress(null);
      e.target.value = '';
    }
  };

  const confirmImport = async () => {
    if (!pendingImportData || !jobsiteId) return;
    setIsSubmitting(true);
    try {
      await replaceJobsiteBOQ(jobsiteId, pendingImportData);
      setPendingImportData(null);
    } catch (err: any) {
      setError(err.message || 'Failed to replace BOQ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAdminUser = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'engineer';

  if (!jobsite || !isAdminUser) {
    return <div className="p-8 text-center text-gray-500 font-bold uppercase tracking-widest">Access Denied or Jobsite not found.</div>;
  }

  return (
    <div className="pb-20">
      <Header 
        title={`BOQ: ${jobsite.name}`} 
        showBack 
      />
      
      <div className="p-4 space-y-8">
        {/* Search & Add Section */}
        <section className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] pl-1">Add Materials to BOQ</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text"
                placeholder="Search materials to add..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setError(null);
                }}
                className="w-full pl-12 pr-10 py-4 bg-white border border-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
              {searchTerm && (
                <button 
                  onClick={() => {
                    setSearchTerm('');
                    setError(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start space-x-3 text-red-600 shadow-sm">
                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                <span className="text-[11px] font-black uppercase leading-relaxed tracking-wider">
                  {error}
                </span>
              </div>
            )}
            
            {searchTerm && filteredItems.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden mt-2 max-h-80 overflow-y-auto z-10 relative">
                {filteredItems.map(item => {
                  const hasVariants = item.variantAttributes && item.variantAttributes.length > 0;
                  const needsCustomSpec = item.requireCustomSpec;
                  const needsSelection = hasVariants || needsCustomSpec;
                  const isSelecting = selectedItemForVariant === item.id;
                  const hasGenericInBOQ = jobsiteBOQ.some(b => b.itemId === item.id && (!b.variant || Object.keys(b.variant).length === 0) && !b.customSpec);
                  const isInBOQ = !needsSelection && hasGenericInBOQ;

                  return (
                    <div key={item.id} className="border-b border-gray-50 last:border-0">
                      <div className={cn(
                        "p-4 flex items-center justify-between hover:bg-gray-50 transition-colors",
                        isInBOQ && "opacity-50 pointer-events-none"
                      )}>
                        <div 
                          className="flex-1" 
                          onClick={() => !hasGenericInBOQ && handleAdd(item.id)}
                        >
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-bold text-gray-900">{item.name}</p>
                            {hasGenericInBOQ && <span className="text-[8px] font-black bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-widest">In BOQ</span>}
                          </div>
                          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId}
                          </p>
                        </div>
                        {needsSelection && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemForVariant(isSelecting ? null : item.id);
                            }}
                            disabled={isSubmitting || !isOnline}
                            title={!isOnline ? 'You are offline' : undefined}
                            className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors mr-2"
                          >
                            <ChevronDown size={18} className={cn("transition-transform", isSelecting && "rotate-180")} />
                          </button>
                        )}
                        <button
                          onClick={() => handleAdd(item.id)}
                          disabled={isSubmitting || hasGenericInBOQ || !isOnline}
                          title={!isOnline ? 'You are offline' : undefined}
                          className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                        >
                          <Plus size={18} />
                        </button>
                      </div>

                      {isSelecting && (
                        <div className="p-4 bg-gray-50 space-y-4 border-t border-gray-100">
                          {item.variantAttributes && item.variantAttributes.map(attr => (
                            <div key={attr.name} className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">{attr.name}</label>
                              <div className="flex flex-wrap gap-2">
                                {attr.values.map(val => (
                                  <button
                                    key={val}
                                    onClick={() => setSelectedVariant(prev => ({ ...prev, [attr.name]: val }))}
                                    className={cn(
                                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                      selectedVariant[attr.name] === val
                                        ? "bg-blue-600 text-white shadow-md"
                                        : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300"
                                    )}
                                  >
                                    {val}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}

                          {item.requireCustomSpec && (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">
                                {item.customSpecLabel || 'Specification'}
                              </label>
                              <input
                                type="text"
                                value={selectedCustomSpec}
                                onChange={(e) => setSelectedCustomSpec(e.target.value)}
                                placeholder={`Enter ${item.customSpecLabel || 'specification'}...`}
                                className="w-full p-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}
                          
                          {(() => {
                            const isVariantInBOQ = jobsiteBOQ.some(b => 
                              b.itemId === item.id && 
                              normalizeVariant(b.variant) === normalizeVariant(selectedVariant) &&
                              b.customSpec === (selectedCustomSpec || undefined)
                            );

                            const canAdd = !isSubmitting && !isVariantInBOQ;

                            return (
                              <button
                                onClick={() => handleAdd(item.id, selectedVariant, selectedCustomSpec)}
                                disabled={!canAdd}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
                              >
                                {isVariantInBOQ ? (
                                  <>
                                    <Check size={16} />
                                    <span>Already in BOQ</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus size={16} />
                                    <span>Add to BOQ</span>
                                  </>
                                )}
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* BOQ List Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Current Bill of Quantities</label>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-black text-blue-600 bg-blue-100 px-3 py-1.5 rounded-full uppercase tracking-[0.15em] shadow-sm">
                  {jobsiteBOQ.length} Items
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {jobsiteBOQ.length > 0 && (
                <button 
                  onClick={() => setConfirmClearBOQ(true)}
                  className="px-3 py-2 bg-red-50/50 border border-red-200 text-red-500 rounded-xl hover:bg-red-50 transition-all flex items-center gap-2 shadow-sm"
                  title="Clear All BOQ"
                >
                  <Trash2 size={16} className="shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Clear All</span>
                </button>
              )}
              <button 
                onClick={handleExport}
                className="px-3 py-2 bg-gray-100 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-200 transition-all flex items-center gap-2 shadow-sm"
                title="Export BOQ"
              >
                <Download size={16} className="shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest">Export</span>
              </button>
              <label className="px-3 py-2 bg-gray-100 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-200 transition-all flex items-center gap-2 shadow-sm cursor-pointer">
                <Upload size={16} className="shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest">Import</span>
                <input 
                  type="file" 
                  accept=".csv" 
                  className="hidden" 
                  onChange={handleImport}
                  disabled={isSubmitting}
                />
              </label>
            </div>
          </div>

          {confirmClearBOQ && (
            <div className="p-6 bg-red-50 rounded-[2rem] border border-red-100 space-y-4 shadow-sm animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-start space-x-4">
                <div className="p-3 bg-red-100 text-red-600 rounded-2xl">
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-black text-red-900 uppercase tracking-widest">Clear Entire BOQ?</p>
                  <p className="text-[11px] font-bold text-red-700 uppercase tracking-tight leading-relaxed">
                    Are you sure you want to CLEAR the entire BOQ for {jobsite.name}? This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <button
                  onClick={async () => {
                    try {
                      await Promise.all(jobsiteBOQ.map(b => deleteBOQItem(b.id)));
                      setConfirmClearBOQ(false);
                    } catch (err: any) {
                      setError(err.message || "Failed to clear BOQ");
                    }
                  }}
                  disabled={!isOnline}
                  title={!isOnline ? 'You are offline' : undefined}
                  className="flex-[2] py-4 bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-red-200 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  Confirm Clear
                </button>
                <button
                  onClick={() => setConfirmClearBOQ(false)}
                  className="flex-1 py-4 bg-white border border-red-200 text-red-700 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] active:scale-[0.98] transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {importProgress && (
            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Importing BOQ...</span>
                <span className="text-[10px] font-black text-blue-600">{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-blue-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 transition-all duration-300" 
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {pendingImportData && (
            <div className="p-6 bg-amber-50 rounded-[2rem] border border-amber-100 space-y-6 shadow-sm">
              <div className="flex items-start space-x-4">
                <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl">
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-black text-amber-900 uppercase tracking-widest">Confirm Replacement</p>
                  <p className="text-[11px] font-bold text-amber-700 uppercase tracking-tight leading-relaxed">
                    This will REPLACE the current BOQ with {pendingImportData.length} items from the CSV. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <button
                  onClick={confirmImport}
                  disabled={isSubmitting || !isOnline}
                  title={!isOnline ? 'You are offline' : undefined}
                  className="flex-[2] py-4 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-orange-200 disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {isSubmitting ? 'Processing...' : 'Confirm & Replace'}
                </button>
                <button
                  onClick={() => setPendingImportData(null)}
                  disabled={isSubmitting}
                  className="flex-1 py-4 bg-white border border-amber-200 text-amber-700 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {jobsiteBOQ.length === 0 ? (
            <div className="p-12 text-center bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                <Package className="text-gray-300" size={32} />
              </div>
              <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No items in BOQ yet</p>
              <p className="text-xs text-gray-400 mt-1">Search and add materials above</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedBOQ.map(([groupId, group]) => (
                <div key={groupId} className="space-y-4">
                  <div className="flex items-center space-x-2 px-1">
                    <div className="h-4 w-1.5 bg-blue-600 rounded-full" />
                    <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">
                      {group.parentName ? `${group.parentName} / ` : ''}{group.categoryName}
                    </h3>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    {Object.entries(group.itemGroups)
                      .sort(([idA], [idB]) => {
                        const nameA = items.find(i => i.id === idA)?.name || '';
                        const nameB = items.find(i => i.id === idB)?.name || '';
                        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                      })
                      .map(([itemId, boqItems]) => (
                      <BOQItemGroup 
                        key={itemId} 
                        itemId={itemId}
                        boqItems={boqItems} 
                        items={items} 
                        uoms={uoms} 
                        inventory={inventory} 
                        jobsiteId={jobsiteId!} 
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
