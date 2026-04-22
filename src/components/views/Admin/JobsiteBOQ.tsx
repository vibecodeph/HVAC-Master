import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, Check, Loader2, AlertTriangle, ChevronDown, Package, Box, ArrowLeft, X, Download, Upload } from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { BOQItem, Item } from '../../../types';
import { addBOQItem, updateBOQItem, deleteBOQItem, replaceJobsiteBOQ } from '../../../services/inventoryService';
import { cn } from '../../../lib/utils';
import { useDebounce } from '../../../hooks/useDebounce';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { exportJobsiteBOQToCSV, importJobsiteBOQFromCSV } from '../../../services/csvService';

export const JobsiteBOQView = () => {
  const { jobsiteId } = useParams<{ jobsiteId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { items, boqs, uoms, inventory, locations, categories } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [pendingImportData, setPendingImportData] = useState<Omit<BOQItem, 'id' | 'timestamp'>[] | null>(null);
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
      items: typeof jobsiteBOQ 
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
          items: []
        };
      }
      groups[groupId].items.push(boq);
    });

    // Sort items within groups alphabetically
    Object.values(groups).forEach(group => {
      group.items.sort((a, b) => {
        const nameA = items.find(i => i.id === a.itemId)?.name || '';
        const nameB = items.find(i => i.id === b.itemId)?.name || '';
        return nameA.localeCompare(nameB);
      });
    });

    // Sort groups alphabetically by parent name then category name
    return Object.entries(groups).sort(([, a], [, b]) => {
      const nameA = `${a.parentName || ''} ${a.categoryName}`;
      const nameB = `${b.parentName || ''} ${b.categoryName}`;
      return nameA.localeCompare(nameB);
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
    exportJobsiteBOQToCSV(jobsiteBOQ, items, jobsite.name);
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
        profile?.displayName || 'Admin',
        (current, total) => setImportProgress({ current, total })
      );

      if (result.errors.length > 0) {
        setError(`Import completed with errors: ${result.errors.slice(0, 3).join(', ')}${result.errors.length > 3 ? '...' : ''}`);
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

  if (!jobsite || profile?.role !== 'admin') {
    return <div className="p-8 text-center">Access Denied or Jobsite not found.</div>;
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
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center space-x-2 text-red-600 text-[10px] font-bold uppercase">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}
            
            {searchTerm && filteredItems.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden mt-2 max-h-80 overflow-y-auto z-10 relative">
                {filteredItems.map(item => {
                  const hasVariants = item.variantAttributes && item.variantAttributes.length > 0;
                  const needsCustomSpec = item.requireCustomSpec;
                  const needsSelection = hasVariants || needsCustomSpec;
                  const isSelecting = selectedItemForVariant === item.id;
                  const isInBOQ = !needsSelection && jobsiteBOQ.some(b => b.itemId === item.id);

                  return (
                    <div key={item.id} className="border-b border-gray-50 last:border-0">
                      <div className={cn(
                        "p-4 flex items-center justify-between hover:bg-gray-50 transition-colors",
                        isInBOQ && "opacity-50 pointer-events-none"
                      )}>
                        <div className="flex-1" onClick={() => needsSelection ? setSelectedItemForVariant(isSelecting ? null : item.id) : handleAdd(item.id)}>
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-bold text-gray-900">{item.name}</p>
                            {isInBOQ && <span className="text-[8px] font-black bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-widest">In BOQ</span>}
                          </div>
                          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId}
                          </p>
                        </div>
                        <button
                          onClick={() => needsSelection ? setSelectedItemForVariant(isSelecting ? null : item.id) : handleAdd(item.id)}
                          disabled={isSubmitting || isInBOQ}
                          className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                        >
                          {needsSelection ? <ChevronDown size={18} className={cn("transition-transform", isSelecting && "rotate-180")} /> : <Plus size={18} />}
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
                              JSON.stringify(b.variant) === JSON.stringify(selectedVariant) &&
                              b.customSpec === (selectedCustomSpec || undefined)
                            );

                            const canAdd = !isSubmitting && !isVariantInBOQ && 
                              (!item.requireVariant || Object.keys(selectedVariant).length === (item.variantAttributes?.length || 0)) &&
                              (!item.requireCustomSpec || selectedCustomSpec.trim().length > 0);

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
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                  {jobsiteBOQ.length} Items
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button 
                onClick={handleExport}
                className="p-2.5 bg-white border border-gray-100 text-gray-600 rounded-xl hover:bg-gray-50 transition-all shadow-sm flex items-center space-x-2"
                title="Export BOQ"
              >
                <Download size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Export</span>
              </button>
              <label className="p-2.5 bg-white border border-gray-100 text-gray-600 rounded-xl hover:bg-gray-50 transition-all shadow-sm flex items-center space-x-2 cursor-pointer">
                <Upload size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Import</span>
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
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 space-y-4">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                  <AlertTriangle size={20} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-amber-900 uppercase tracking-widest">Confirm Replacement</p>
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-tight">
                    This will REPLACE the current BOQ with {pendingImportData.length} items from the CSV. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={confirmImport}
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-amber-200 disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing...' : 'Confirm & Replace'}
                </button>
                <button
                  onClick={() => setPendingImportData(null)}
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-white border border-amber-200 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-50"
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
                    <div className="h-4 w-1 bg-blue-600 rounded-full" />
                    <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">
                      {group.parentName ? `${group.parentName} / ` : ''}{group.categoryName}
                    </h3>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    {group.items.map(boq => {
                      const item = items.find(i => i.id === boq.itemId);
                      const uom = uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId);
                      const currentStock = inventory
                        .filter(inv => {
                          const matchesLocation = inv.locationId === jobsiteId;
                          const matchesItem = inv.itemId === boq.itemId;
                          const matchesVariant = !boq.variant || JSON.stringify(inv.variant) === JSON.stringify(boq.variant);
                          return matchesLocation && matchesItem && matchesVariant;
                        })
                        .reduce((sum, inv) => sum + inv.quantity, 0);
                      const isOverTarget = (boq.targetQuantity || 0) > 0 && currentStock > (boq.targetQuantity || 0);

                      return (
                        <Card key={boq.id} className={cn(
                          "p-4 space-y-4 transition-all relative overflow-hidden",
                          isOverTarget ? "border-red-200 bg-red-50/10" : "border-gray-100"
                        )}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <h4 className="font-bold text-gray-900">{item?.name}</h4>
                                {isOverTarget && (
                                  <div className="flex items-center space-x-1 text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                    <AlertTriangle size={10} />
                                    <span className="text-[8px] font-black uppercase tracking-tight">Over Target</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2 mt-1">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{uom?.symbol || item?.uomId}</p>
                                {boq.variant && Object.entries(boq.variant).map(([k, v]) => (
                                  <span key={k} className="text-[8px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-bold uppercase">
                                    {v}
                                  </span>
                                ))}
                                {boq.customSpec && (
                                  <span key="spec" className="text-[8px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-bold uppercase">
                                    {boq.customSpec}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button 
                              onClick={() => deleteBOQItem(boq.id)}
                              className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">Target Qty</label>
                              <div className="relative">
                                <input 
                                  type="number"
                                  placeholder="Unlimited"
                                  defaultValue={boq.targetQuantity || ''}
                                  onBlur={async (e) => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    if (val !== boq.targetQuantity) {
                                      await updateBOQItem(boq.id, { targetQuantity: val as any });
                                    }
                                  }}
                                  className={cn(
                                    "w-full p-3 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors",
                                    isOverTarget ? "bg-red-50 border-red-100 text-red-900" : "bg-gray-50 border-transparent"
                                  )}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">Budget Price</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">₱</span>
                                <input 
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  defaultValue={boq.unitPrice || ''}
                                  onBlur={async (e) => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    if (val !== boq.unitPrice) {
                                      await updateBOQItem(boq.id, { unitPrice: val as any });
                                    }
                                  }}
                                  className="w-full pl-6 pr-3 py-3 bg-gray-50 border-transparent rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 rounded-full bg-blue-600" />
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Delivered: {currentStock}</span>
                            </div>
                            {boq.targetQuantity && (
                              <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 rounded-full bg-gray-300" />
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Remaining: {Math.max(0, boq.targetQuantity - currentStock)}</span>
                              </div>
                            )}
                          </div>

                          {isOverTarget && (
                            <div className="mt-2 p-2 bg-red-50 rounded-lg flex items-center space-x-2">
                              <AlertTriangle size={12} className="text-red-600" />
                              <p className="text-[9px] font-bold text-red-600 uppercase tracking-tight">
                                Delivered ({currentStock}) exceeds target ({boq.targetQuantity})
                              </p>
                            </div>
                          )}
                        </Card>
                      );
                    })}
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
