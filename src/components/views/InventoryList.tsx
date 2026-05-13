import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MapPin, Wrench, Box, Truck, Target, AlertTriangle, Plus, X, ChevronDown, History, ArrowLeftRight, Package, Loader2, Pencil, FileDown, Printer } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { useIsMobile } from '../../hooks/useApp';
import { cn, getMillis, normalizeVariant } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { InventoryEditModal } from '../common/InventoryEditModal';
import { ConsumeModal } from '../common/ConsumeModal';
import { RequestForm, ItemForm } from '../Forms';
import { Item, Location, Transaction, Inventory } from '../../types';
import { Pagination } from '../common/Pagination';
import { useDebounce } from '../../hooks/useDebounce';
import { subscribeToTransactions, addInventoryToJobsite } from '../../services/inventoryService';

const ITEMS_PER_PAGE = 10;

const ItemCard = ({
  item,
  entries,
  profile,
  categories,
  uoms,
  inventory,
  selectedJobsiteId,
  setRequestingItem,
  setViewingTransactions,
  setEditingInventory,
  setFilter,
  showRequestButton,
  setConsumingItem,
}: any) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const canConsume = !!selectedJobsiteId && selectedJobsiteId !== 'all' && !showRequestButton;

  return (
    <Card className="bg-white overflow-hidden border-gray-100 shadow-sm">
      {/* Item Header */}
      <div
        className={cn(
          "p-4 flex items-center justify-between bg-white transition-colors",
          canConsume ? "cursor-pointer active:bg-gray-50" : "cursor-default"
        )}
        onClick={() => {
          if (canConsume) setConsumingItem({ item, entries });
        }}
        title={showRequestButton ? "Disable request mode to consume items" : (!canConsume ? "Select a single jobsite to consume items" : undefined)}
      >
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
            item.isTool ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"
          )}>
            {item.isTool ? <Wrench size={20} /> : <Box size={20} />}
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-bold text-gray-900 truncate">{item.name}</h4>
              {item.components && item.components.length > 0 && (
                <span className="text-[8px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded-full font-black uppercase tracking-widest">Kit</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                className="text-gray-400 p-0.5 rounded hover:text-gray-600 transition-colors"
              >
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ChevronDown size={14} />
                </motion.div>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {!isExpanded && entries.length === 1 && (
            <div className="text-right mr-2">
              <span className="text-sm font-black text-gray-900">
                {entries[0].totalQty}
              </span>
              <span className="text-[8px] font-bold text-gray-400 uppercase ml-1">
                {uoms.find((u: any) => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId}
              </span>
            </div>
          )}
          {showRequestButton && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFilter(item.isTool ? 'Tools' : 'Materials');
                if (entries.length > 1 && !isExpanded) {
                  setIsExpanded(true);
                } else {
                  setRequestingItem({
                    item,
                    variant: entries[0]?.boq?.variant || entries[0]?.inv?.variant,
                    customSpec: entries[0]?.inv?.customSpec
                  });
                }
              }}
              className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-800 active:scale-95 transition-all shadow-sm"
            >
              Request
            </button>
          )}
        </div>
      </div>

      {/* Variants List (Collapsible) */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="divide-y divide-gray-50 border-t border-gray-50">
              {entries.map((entry: any, eIdx: number) => {
                const { type } = entry;
                const inv = entry.inv ? (Array.isArray(entry.inv) ? entry.inv : [entry.inv]) : [];
                const boq = entry.boq || null;
                
                const variantToMatch = boq?.variant || (type === 'unplanned' && !Array.isArray(entry.inv) ? entry.inv.variant : null);
                
                const filteredInv = boq && boq.variant 
                  ? inv.filter((i: any) => normalizeVariant(i.variant) === normalizeVariant(boq.variant))
                  : inv;

                const totalQty = filteredInv.reduce((sum: number, i: any) => sum + i.quantity, 0);
                const uom = uoms.find((u: any) => u.id === item.uomId || u.symbol === item.uomId);

                let reorderLevel = item.reorderLevel || 0;
                let averageCost = item.averageCost || 0;

                if (variantToMatch) {
                  const config = item.variantConfigs?.find((vc: any) => 
                    normalizeVariant(vc.variant) === normalizeVariant(variantToMatch)
                  );
                  if (config) {
                    if (config.reorderLevel !== undefined) reorderLevel = config.reorderLevel;
                    if (config.averageCost !== undefined) averageCost = config.averageCost;
                  }
                }

                const invList = filteredInv;

                return (
                  <div 
                    key={`${item.id}-${eIdx}`}
                    className="p-4 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                    onClick={() => {
                      if (profile?.role === 'admin') {
                        setFilter(item.isTool ? 'Tools' : 'Materials');
                        setViewingTransactions({ item, variant: variantToMatch || undefined });
                      }
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {variantToMatch && Object.keys(variantToMatch).length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {Object.entries(variantToMatch).map(([k, v]) => (
                              <span key={k} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg font-bold uppercase tracking-tight">
                                {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                        {invList[0]?.customSpec && (
                          <div className="mb-2">
                            <span className="text-[10px] px-2 py-1 bg-purple-50 text-purple-600 rounded-lg font-bold uppercase tracking-tight">
                              {invList[0].customSpec}
                            </span>
                          </div>
                        )}
                        {invList[0]?.assignedJobsiteId && (
                          <div className="mb-2">
                            <span className="text-[10px] px-2 py-1 bg-teal-50 text-teal-600 rounded-lg font-bold tracking-tight flex items-center gap-1 w-fit">
                              <MapPin size={9} />
                              {invList[0].assignedJobsiteName || invList[0].assignedJobsiteId}
                            </span>
                          </div>
                        )}

                        {boq && (
                          <div className="flex flex-col space-y-1.5 max-w-[200px]">
                            {boq.targetQuantity && (
                              <div className={cn(
                                "w-full h-1.5 bg-gray-100 rounded-full overflow-hidden",
                                totalQty > boq.targetQuantity && "bg-red-100"
                              )}>
                                <div 
                                  className={cn(
                                    "h-full transition-all duration-500",
                                    totalQty >= boq.targetQuantity ? "bg-green-500" : "bg-blue-500"
                                  )}
                                  style={{ width: `${Math.min(100, (totalQty / boq.targetQuantity) * 100)}%` }}
                                />
                              </div>
                            )}
                            <div className="flex items-center space-x-1 text-[10px] font-bold text-gray-400">
                              <Target size={12} className="text-gray-300" />
                              <span className="tracking-widest capitalize">Site Usage:</span>
                              <span className="text-gray-600 ml-1">{boq.currentQuantity || 0} / {boq.targetQuantity || '∞'}</span>
                            </div>
                            {boq.note && (
                              <div className="mt-1 flex items-start space-x-1.5 p-2 bg-amber-50/50 rounded-lg border border-amber-100/50">
                                <AlertTriangle size={10} className="text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-[9px] font-medium text-amber-800 leading-tight italic truncate">
                                  {boq.note}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {profile?.role === 'admin' && averageCost !== undefined && (
                          <div className="mt-2 text-[10px] font-bold text-blue-600">
                            ₱{averageCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>

                      <div className="text-right flex-shrink-0 ml-4 flex flex-col items-end">
                        <div className="flex items-center justify-end space-x-1.5">
                          {boq && boq.targetQuantity && totalQty > boq.targetQuantity && (
                            <AlertTriangle size={14} className="text-red-500" />
                          )}
                          <span className={cn(
                            "text-xl font-black",
                            totalQty < 0 ? "text-red-500" : (totalQty === 0 ? (type === 'boq' ? "text-blue-300" : "text-gray-300") : (boq && boq.targetQuantity && totalQty > boq.targetQuantity ? "text-red-600" : "text-gray-900"))
                          )}>
                            {item.components && item.components.length > 0 ? (
                              totalQty + Math.min(...item.components.map((comp: any) => {
                                const compInv = inventory.filter((inv: any) => inv.itemId === comp.itemId && inv.locationId === selectedJobsiteId);
                                const compTotal = compInv.reduce((sum: number, i: any) => sum + i.quantity, 0);
                                return Math.floor(compTotal / comp.quantity);
                              }))
                            ) : totalQty}
                          </span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{uom?.symbol || item.uomId}</span>
                        </div>
                        
                        {profile?.role === 'admin' && reorderLevel > 0 && (
                          <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mt-[-2px]">
                            Re-order: {reorderLevel}
                          </div>
                        )}

                        {showRequestButton && entries.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilter(item.isTool ? 'Tools' : 'Materials');
                              setRequestingItem({
                                item,
                                variant: variantToMatch || undefined,
                                customSpec: invList[0]?.customSpec
                              });
                            }}
                            className="mt-3 px-3 py-1.5 bg-gray-100 text-gray-900 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-gray-200 active:scale-95 transition-all opacity-0 group-hover:opacity-100"
                          >
                            Request
                          </button>
                        )}
                        {profile?.role === 'admin' && invList[0]?.id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingInventory({
                                inv: invList[0],
                                item,
                                variant: variantToMatch || undefined,
                              });
                            }}
                            className="mt-2 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 active:scale-95"
                            title="Edit inventory record"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
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

export const InventoryList = () => {
  const { profile } = useAuth();
  const { items, inventory, locations, uoms, categories, requests, boqs } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [filter, setFilter] = useState('Materials');
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>(() => {
    if (profile?.uid) {
      const saved = localStorage.getItem(`lastSite_${profile.uid}`);
      return saved || '';
    }
    return '';
  });
  const [hasSetDefaultJobsite, setHasSetDefaultJobsite] = useState(false);
  const storageKey = profile?.uid ? `lastSite_${profile.uid}` : null;

  // Sync with localStorage changes
  useEffect(() => {
    if (!storageKey) return;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        setSelectedJobsiteId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey]);
  const [isAddInventoryOpen, setIsAddInventoryOpen] = useState(false);
  const [addInvItemId, setAddInvItemId] = useState('');
  const [addInvItemSearch, setAddInvItemSearch] = useState('');
  const [addInvShowSearch, setAddInvShowSearch] = useState(false);
  const [addInvVariant, setAddInvVariant] = useState<Record<string, string>>({});
  const [addInvQty, setAddInvQty] = useState('1');
  const [addInvPrice, setAddInvPrice] = useState('');
  const [addInvSubmitting, setAddInvSubmitting] = useState(false);
  const [addInvError, setAddInvError] = useState<string | null>(null);
  const [addInvSuccess, setAddInvSuccess] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [requestingItem, setRequestingItem] = useState<{ 
    item: Item; 
    variant?: Record<string, string>; 
    customSpec?: string; 
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showRequestButton, setShowRequestButton] = useState(false);
  const [consumingItem, setConsumingItem] = useState<{ item: Item; entries: any[] } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportCategoryId, setExportCategoryId] = useState<string>('all');

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, filter, selectedJobsiteId, showRequestButton]);

  const [viewingTransactions, setViewingTransactions] = useState<{ item: Item, variant?: Record<string, string> } | null>(null);
  const [editingInventory, setEditingInventory] = useState<{ inv: Inventory, item: Item, variant?: Record<string, string> } | null>(null);
  const [itemTransactions, setItemTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);

  // Subscribe to transactions when viewing an item's history
  useEffect(() => {
    if (!viewingTransactions || !selectedJobsiteId) {
      setItemTransactions([]);
      return;
    }

    setIsLoadingTransactions(true);
    const unsub = subscribeToTransactions((data) => {
      // Filter transactions for this item and this location (either from or to)
      const filtered = data.filter(t => {
        const matchesItem = t.itemId === viewingTransactions.item.id;
        const matchesVariant = !viewingTransactions.variant || normalizeVariant(t.variant) === normalizeVariant(viewingTransactions.variant);
        const matchesLocation = t.fromLocationId === selectedJobsiteId || t.toLocationId === selectedJobsiteId;
        return matchesItem && matchesVariant && matchesLocation;
      });
      setItemTransactions(filtered);
      setIsLoadingTransactions(false);
    }, undefined, 100); // Limit to last 100 transactions for this item

    return () => unsub();
  }, [viewingTransactions, selectedJobsiteId]);

  // Filter locations to only show active jobsites/warehouses for the filter
  const groupedJobsites = useMemo(() => {
    const filtered = locations.filter(l => {
      const isJobsiteOrWarehouse = l.type === 'jobsite' || l.type === 'warehouse';
      if (!isJobsiteOrWarehouse) return false;
      
      if (profile?.role === 'admin') return true;
      
      return l.isActive && profile?.assignedLocationIds?.includes(l.id);
    });

    const groups: Record<string, Location[]> = {};
    filtered.forEach(l => {
      const t = l.type || 'other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(l);
    });

    const order = { warehouse: 1, jobsite: 2 };
    return Object.keys(groups)
      .sort((a, b) => (order[a as keyof typeof order] || 99) - (order[b as keyof typeof order] || 99))
      .map(type => ({
        type,
        locations: groups[type].sort((a, b) => a.name.localeCompare(b.name))
      }));
  }, [locations, profile]);

  // Persist selected jobsite
  useEffect(() => {
    if (selectedJobsiteId && profile?.uid) {
      localStorage.setItem(`lastSite_${profile.uid}`, selectedJobsiteId);
    }
  }, [selectedJobsiteId, profile]);

  // Set initial jobsite if none selected or selection is invalid
  useEffect(() => {
    const allSites = groupedJobsites.flatMap(g => g.locations);
    if (allSites.length > 0 && profile && !hasSetDefaultJobsite) {
      const saved = storageKey ? localStorage.getItem(storageKey) : null;
      const isValid = allSites.some(j => j.id === saved) || saved === 'all';
      
      if (saved && isValid) {
        setSelectedJobsiteId(saved);
      } else {
        setSelectedJobsiteId(allSites[0].id);
      }
      setHasSetDefaultJobsite(true);
    }
  }, [groupedJobsites, profile, hasSetDefaultJobsite, storageKey]);

  const allDisplayItems = useMemo(() => {
    if (!selectedJobsiteId) return [];

    const jobsiteBOQ = boqs.filter(b => b.jobsiteId === selectedJobsiteId);
    const jobsiteInv = inventory.filter(inv => inv.locationId === selectedJobsiteId);
    const search = debouncedSearchTerm.toLowerCase().trim();

    // 1. Get all unique item IDs involved in this jobsite (BOQ or Stock)
    const itemIds = new Set([
      ...jobsiteBOQ.map(b => b.itemId),
      ...jobsiteInv.map(inv => inv.itemId)
    ]);

    const groupedResult: Record<string, { item: Item, entries: any[] }> = {};

    itemIds.forEach(itemId => {
      const item = items.find(i => i.id === itemId);
      if (!item || !item.isActive) return;
      
      // Filter by Tool/Material
      if (!debouncedSearchTerm) {
        if (filter === 'Tools' ? !item.isTool : item.isTool) return;
      }
      
      // Search filter
      if (search && !item.name.toLowerCase().includes(search) && !item.tags?.some(t => t.toLowerCase().includes(search))) return;

      const itemBOQs = jobsiteBOQ.filter(b => b.itemId === itemId);
      const itemInv = jobsiteInv.filter(inv => inv.itemId === itemId);

      // Rule check: Does this item have ANY transaction/stock in this jobsite?
      const itemHasStock = itemInv.some(inv => inv.quantity !== 0);

      const variantEntries: Record<string, any> = {};

      // Process BOQ entries
      itemBOQs.forEach(boq => {
        const vKey = normalizeVariant(boq.variant);
        const matchingInv = itemInv.filter(inv => normalizeVariant(inv.variant) === vKey);
        const delivered = matchingInv.reduce((sum, inv) => sum + inv.quantity, 0);

        const hasValues = (boq.targetQuantity || 0) > 0 || (boq.unitPrice || 0) > 0 || delivered !== 0;

        // Rule: Show if it has values OR if the item has NO transactions at all
        if (hasValues || !itemHasStock) {
          variantEntries[vKey] = {
            type: 'boq',
            item,
            boq,
            inv: matchingInv,
            totalQty: delivered
          };
        }
      });

      // Process Inventory entries (unplanned variants)
      const invByVariant: Record<string, Inventory[]> = {};
      itemInv.forEach(inv => {
        const vKey = normalizeVariant(inv.variant);
        if (!invByVariant[vKey]) invByVariant[vKey] = [];
        invByVariant[vKey].push(inv);
      });

      Object.entries(invByVariant).forEach(([vKey, invs]) => {
        // If handled by BOQ, skip
        if (variantEntries[vKey]) return;

        const totalQty = invs.reduce((sum, inv) => sum + inv.quantity, 0);
        // Show unplanned variant only if it has stock
        if (totalQty !== 0) {
          variantEntries[vKey] = {
            type: 'unplanned',
            item,
            inv: invs[0], // for metadata
            totalQty
          };
        }
      });

      const entriesList = Object.values(variantEntries);
      if (entriesList.length > 0) {
        const totalStockValue = entriesList.reduce((sum: number, e: any) => sum + (e.totalQty || 0), 0);
        if (showRequestButton ? true : totalStockValue > 0) {
          groupedResult[itemId] = { item, entries: entriesList };
        }
      }
    });

    const result = Object.values(groupedResult);

    return result.sort((a, b) => {
      const catA = categories.find(c => c.id === a.item?.categoryId);
      const pA = catA?.parentId ? categories.find(c => c.id === catA.parentId) : null;
      const fullCatA = `${pA?.name || ''} ${catA?.name || 'General'}`;
      
      const catB = categories.find(c => c.id === b.item?.categoryId);
      const pB = catB?.parentId ? categories.find(c => c.id === catB.parentId) : null;
      const fullCatB = `${pB?.name || ''} ${catB?.name || 'General'}`;

      if (fullCatA !== fullCatB) return fullCatA.localeCompare(fullCatB);
      return (a.item?.name || '').localeCompare(b.item?.name || '');
    });
  }, [selectedJobsiteId, debouncedSearchTerm, filter, items, inventory, boqs, showRequestButton, categories]);

  const globalSearchItems = useMemo(() => {
    if (!selectedJobsiteId || !debouncedSearchTerm) return [];
    
    const jobsiteBOQ = boqs.filter(b => b.jobsiteId === selectedJobsiteId);
    const jobsiteInventory = inventory.filter(inv => inv.locationId === selectedJobsiteId);
    const search = debouncedSearchTerm.toLowerCase();

    return items
      .filter(item => 
        !jobsiteBOQ.some(b => b.itemId === item.id) && 
        !jobsiteInventory.some(inv => inv.itemId === item.id) &&
        (!debouncedSearchTerm ? (filter === 'Tools' ? item.isTool : !item.isTool) : true) &&
        (item.name.toLowerCase().includes(search) || 
         item.tags?.some(t => t.toLowerCase().includes(search)))
      )
      .slice(0, 5); // Limit to 5 global results
  }, [selectedJobsiteId, debouncedSearchTerm, filter, items, inventory, boqs]);

  const totalPages = Math.ceil(allDisplayItems.length / ITEMS_PER_PAGE);
  const paginatedItems = allDisplayItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Export data: all non-zero inventory at current jobsite
  const { exportRows, exportMainCategories } = useMemo(() => {
    if (!selectedJobsiteId || selectedJobsiteId === 'all') return { exportRows: [], exportMainCategories: [] };

    const jobsiteInv = inventory.filter(inv => inv.locationId === selectedJobsiteId && inv.quantity > 0);

    type ExportRow = { itemName: string; variant: string; avgCost: number; qty: number; uomSymbol: string; totalCost: number; mainCatId: string; mainCatName: string };
    const rows: ExportRow[] = [];
    const mainCatSet = new Map<string, string>();

    jobsiteInv.forEach(inv => {
      const item = items.find(i => i.id === inv.itemId && i.isActive);
      if (!item) return;
      const cat = categories.find(c => c.id === item.categoryId);
      const mainCat = cat?.parentId ? categories.find(c => c.id === cat.parentId) : cat;
      const mainCatId = mainCat?.id || 'uncategorized';
      const mainCatName = mainCat?.name || 'Uncategorized';
      mainCatSet.set(mainCatId, mainCatName);
      const variantLabel = inv.variant ? Object.values(inv.variant).join(', ') : '';
      const avgCost = item.averageCost || 0;
      const uomSymbol = uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId;
      rows.push({ itemName: item.name, variant: variantLabel, avgCost, qty: inv.quantity, uomSymbol, totalCost: inv.quantity * avgCost, mainCatId, mainCatName });
    });

    rows.sort((a, b) => a.mainCatName.localeCompare(b.mainCatName) || a.itemName.localeCompare(b.itemName));
    const exportMainCategories = [...mainCatSet.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { exportRows: rows, exportMainCategories };
  }, [selectedJobsiteId, inventory, items, categories, uoms]);

  const filteredExportRows = exportCategoryId === 'all'
    ? exportRows
    : exportRows.filter(r => r.mainCatId === exportCategoryId);

  const handleExportCSV = () => {
    const jobsite = locations.find(l => l.id === selectedJobsiteId);
    const catLabel = exportCategoryId === 'all' ? 'All' : (exportMainCategories.find(c => c.id === exportCategoryId)?.name || 'All');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `Inventory_${jobsite?.name || 'Site'}_${catLabel}_${date}.csv`.replace(/\s+/g, '_');
    const header = ['Item', 'Variant', 'Avg Cost (₱)', 'Qty', 'UOM', 'Total Cost (₱)'];
    const csvRows = [header, ...filteredExportRows.map(r => [
      `"${r.itemName.replace(/"/g, '""')}"`,
      `"${r.variant.replace(/"/g, '""')}"`,
      r.avgCost.toFixed(2),
      r.qty,
      r.uomSymbol,
      r.totalCost.toFixed(2),
    ])];
    const blob = new Blob([csvRows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const jobsite = locations.find(l => l.id === selectedJobsiteId);
    const catLabel = exportCategoryId === 'all' ? 'All Categories' : (exportMainCategories.find(c => c.id === exportCategoryId)?.name || 'All Categories');
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const totalQty = filteredExportRows.reduce((s, r) => s + r.qty, 0);
    const totalCost = filteredExportRows.reduce((s, r) => s + r.totalCost, 0);

    // Group rows by category for print
    const grouped: Record<string, typeof filteredExportRows> = {};
    filteredExportRows.forEach(r => {
      if (!grouped[r.mainCatName]) grouped[r.mainCatName] = [];
      grouped[r.mainCatName].push(r);
    });

    const tableRows = Object.entries(grouped).map(([catName, rows]) => `
      <tr class="cat-header"><td colspan="5">${catName}</td></tr>
      ${rows.map(r => `<tr>
        <td>${r.itemName}</td>
        <td>${r.variant || '—'}</td>
        <td style="text-align:right">₱${r.avgCost.toFixed(2)}</td>
        <td style="text-align:right">${r.qty} ${r.uomSymbol}</td>
        <td style="text-align:right">₱${r.totalCost.toFixed(2)}</td>
      </tr>`).join('')}
    `).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventory – ${jobsite?.name}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
      h2 { margin: 0 0 4px; font-size: 16px; }
      .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #111; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
      th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
      td { padding: 5px 8px; border-bottom: 1px solid #eee; }
      tr.cat-header td { background: #f3f4f6; font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; padding: 6px 8px; border-bottom: none; }
      .footer { margin-top: 16px; font-size: 11px; color: #444; }
      .footer strong { font-size: 13px; color: #111; }
    </style></head><body>
    <h2>${jobsite?.name || 'Inventory'}</h2>
    <div class="meta">${catLabel} · ${date}</div>
    <table>
      <thead><tr>
        <th>Item</th><th>Variant</th>
        <th style="text-align:right">Avg Cost</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Total Cost</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="footer">
      ${filteredExportRows.length} item${filteredExportRows.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
      Total value: <strong>₱${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
    </div>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="pb-20">
      <Header title="Inventory" />
      <div className="p-4 space-y-4">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search tools, materials, tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-gray-100 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {(['admin', 'manager', 'engineer'] as const).includes(profile?.role as any) && (() => {
            const canExport = !!selectedJobsiteId && selectedJobsiteId !== 'all';
            return (
              <button
                onClick={() => canExport && setIsExportModalOpen(true)}
                title={!canExport ? 'Select a single jobsite to export' : 'Export / Print'}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all",
                  canExport ? "bg-gray-900 text-white active:scale-90" : "bg-gray-100 text-gray-300 cursor-not-allowed"
                )}
              >
                <FileDown size={18} />
              </button>
            );
          })()}
        </div>
        
        <div className="flex space-x-2">
          {['Materials', 'Tools'].map((cat) => (
            <button 
              key={cat} 
              onClick={() => setFilter(cat)}
              className={cn(
                "flex-1 py-3 rounded-2xl text-[10px] font-black transition-all uppercase tracking-[0.2em] border",
                filter === cat 
                  ? "bg-gray-900 text-white border-gray-900 shadow-lg shadow-gray-200" 
                  : "bg-white text-gray-400 border-gray-100"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select
              value={selectedJobsiteId}
              onChange={(e) => setSelectedJobsiteId(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-gray-100 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
            >
              {groupedJobsites.length === 0 ? (
                <option value="">No locations assigned...</option>
              ) : (
                groupedJobsites.map(group => (
                  <optgroup key={group.type} label={group.type.charAt(0).toUpperCase() + group.type.slice(1) + 's'}>
                    {group.locations.map(site => (
                      <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <label className="flex items-center space-x-2 cursor-pointer">
            <div
              onClick={() => setShowRequestButton(!showRequestButton)}
              className={cn(
                "w-8 h-4 rounded-full transition-colors relative",
                showRequestButton ? "bg-blue-600" : "bg-gray-300"
              )}
            >
              <div className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                showRequestButton ? "translate-x-4" : "translate-x-0.5"
              )} />
            </div>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Show Request Button</span>
          </label>
        </div>

        <div className="space-y-6">
          <AnimatePresence mode="popLayout">
            <div className="space-y-8">
              {!selectedJobsiteId ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                    <MapPin size={32} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Select a Location</h3>
                    <p className="text-xs text-gray-500 mt-1">Pick a site to view its stock.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {paginatedItems.length === 0 && globalSearchItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                        <Box size={32} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">No items found</h3>
                        <p className="text-xs text-gray-500 mt-1">Try adjusting your search or filter.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-4">
                        {(() => {
                          let lastCategory = '';
                          return paginatedItems.map((group: any, idx) => {
                            const { item, entries } = group;
                            if (!item) return null;
                            
                            const category = categories.find(c => c.id === item.categoryId);
                            const pCat = category?.parentId ? categories.find(c => c.id === category.parentId) : null;
                            const catDisplay = category ? (pCat ? `${pCat.name} / ${category.name}` : category.name) : 'General';
                            const showHeader = catDisplay !== lastCategory;
                            lastCategory = catDisplay;

                            return (
                              <React.Fragment key={`group-wrapper-${item.id}-${idx}`}>
                                {showHeader && (
                                  <div className="flex items-center space-x-2 px-1 pt-4 first:pt-0 mb-4">
                                    <div className="h-4 w-1.5 bg-blue-600 rounded-full" />
                                    <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">
                                      {catDisplay}
                                    </h3>
                                  </div>
                                )}
                                <motion.div
                                  key={`group-${item.id}-${idx}`}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="space-y-4"
                                >
                                  <ItemCard
                                    item={item}
                                    entries={entries}
                                    profile={profile}
                                    categories={categories}
                                    uoms={uoms}
                                    inventory={inventory}
                                    selectedJobsiteId={selectedJobsiteId}
                                    setRequestingItem={setRequestingItem}
                                    setViewingTransactions={setViewingTransactions}
                                    setEditingInventory={setEditingInventory}
                                    setFilter={setFilter}
                                    showRequestButton={showRequestButton}
                                    setConsumingItem={setConsumingItem}
                                  />
                                </motion.div>
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>

                      {globalSearchItems.length > 0 && (
                        <div className="space-y-4 pt-8 border-t border-gray-100">
                          <div className="flex items-center justify-between px-1">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Global Catalog Results</h3>
                            <span className="text-[8px] font-bold text-gray-300 uppercase">Not in this jobsite</span>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                            {globalSearchItems.map((item: any) => (
                               <Card 
                                key={`global-${item.id}`}
                                className={cn(
                                  "p-4 bg-gray-50/50 border-dashed border-gray-200 transition-all group",
                                  profile?.role === 'admin' ? "hover:bg-white hover:border-solid hover:shadow-md cursor-pointer" : ""
                                )}
                                onClick={() => {
                                  if (profile?.role === 'admin') {
                                    setFilter(item.isTool ? 'Tools' : 'Materials');
                                    setViewingTransactions({ item });
                                  }
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <div className={cn(
                                      "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white shadow-sm",
                                      item.isTool ? "text-orange-400" : "text-blue-400"
                                    )}>
                                      {item.isTool ? <Wrench size={20} /> : <Box size={20} />}
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-bold text-gray-600 group-hover:text-gray-900 transition-colors">{item.name}</h4>
                                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                                        {categories.find(c => c.id === item.categoryId)?.name || 'General'}
                                      </p>
                                    </div>
                                  </div>
                                  {showRequestButton && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFilter(item.isTool ? 'Tools' : 'Materials');
                                        setRequestingItem({ item });
                                      }}
                                      className="px-4 h-10 bg-white text-blue-600 border border-blue-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                    >
                                      Request
                                    </button>
                                  )}
                                </div>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {paginatedItems.length > 0 && (
                        <Pagination 
                          currentPage={currentPage}
                          totalPages={totalPages}
                          onPageChange={setCurrentPage}
                          className="mt-6"
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </AnimatePresence>
        </div>
      </div>
      
      {profile?.role === 'admin' && (() => {
        const canAdd = !!selectedJobsiteId && selectedJobsiteId !== 'all';
        return (
          <button
            onClick={() => canAdd && setIsAddInventoryOpen(true)}
            title={!canAdd ? 'Select a single jobsite to add inventory' : 'Add to Inventory'}
            className={cn(
              "fixed bottom-20 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all z-50",
              canAdd ? "bg-blue-600 text-white active:scale-90 cursor-pointer" : "bg-gray-300 text-gray-100 cursor-not-allowed"
            )}
          >
            <Plus size={28} />
          </button>
        );
      })()}

      <Modal isOpen={!!requestingItem} onClose={() => setRequestingItem(null)} title="Request Item">
        {requestingItem && (
          <RequestForm 
            item={requestingItem.item}
            initialVariant={requestingItem.variant}
            initialCustomSpec={requestingItem.customSpec}
            locations={locations}
            uoms={uoms}
            profile={profile}
            defaultJobsiteId={selectedJobsiteId}
            onComplete={() => {
              setRequestingItem(null);
              setSearchTerm('');
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={isAddInventoryOpen}
        onClose={() => {
          setIsAddInventoryOpen(false);
          setAddInvItemId('');
          setAddInvItemSearch('');
          setAddInvVariant({});
          setAddInvQty('1');
          setAddInvPrice('');
          setAddInvError(null);
          setAddInvSuccess(null);
        }}
        title="Add to Inventory"
      >
        {(() => {
          const addInvItem = items.find(i => i.id === addInvItemId);
          const baseUom = uoms.find(u => u.id === addInvItem?.uomId || u.symbol === addInvItem?.uomId);
          const matchingItems = addInvItemSearch
            ? items.filter(i => i.isActive && i.name.toLowerCase().includes(addInvItemSearch.toLowerCase())).slice(0, 8)
            : [];
          const jobsite = locations.find(l => l.id === selectedJobsiteId);

          const handleSubmit = async () => {
            if (!addInvItemId) { setAddInvError('Please select an item'); return; }
            const qty = parseFloat(addInvQty);
            if (!addInvQty || isNaN(qty) || qty === 0) { setAddInvError('Quantity cannot be zero'); return; }
            if (addInvItem?.requireVariant && (!addInvItem.variantAttributes?.length || Object.keys(addInvVariant).length === 0)) {
              setAddInvError('Please select a variant'); return;
            }
            const price = addInvPrice !== '' ? parseFloat(addInvPrice) : undefined;
            if (addInvPrice !== '' && (isNaN(price!) || price! < 0)) { setAddInvError('Invalid price'); return; }

            setAddInvSubmitting(true);
            setAddInvError(null);
            try {
              await addInventoryToJobsite(
                addInvItemId,
                selectedJobsiteId,
                Object.keys(addInvVariant).length > 0 ? addInvVariant : undefined,
                qty,
                price
              );
              setAddInvSuccess(`Added ${qty} ${baseUom?.symbol || ''} of ${addInvItem?.name} to ${jobsite?.name}`);
              setAddInvItemId('');
              setAddInvItemSearch('');
              setAddInvVariant({});
              setAddInvQty('1');
              setAddInvPrice('');
            } catch (e: any) {
              setAddInvError(e.message || 'Failed to add inventory');
            } finally {
              setAddInvSubmitting(false);
            }
          };

          return (
            <div className="space-y-4">
              {addInvSuccess && (
                <div className="bg-green-50 border border-green-100 p-3 rounded-xl flex items-center justify-between">
                  <p className="text-xs font-bold text-green-700">{addInvSuccess}</p>
                  <button onClick={() => setAddInvSuccess(null)} className="text-green-400 hover:text-green-600 ml-2"><X size={14} /></button>
                </div>
              )}
              {addInvError && (
                <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-center justify-between">
                  <p className="text-xs font-bold text-red-700">{addInvError}</p>
                  <button onClick={() => setAddInvError(null)} className="text-red-400 hover:text-red-600 ml-2"><X size={14} /></button>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Item</label>
                {addInvItem && (
                  <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-900">{addInvItem.name}</p>
                    <button onClick={() => { setAddInvItemId(''); setAddInvVariant({}); }} className="text-gray-400 hover:text-red-500 ml-2"><X size={14} /></button>
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    value={addInvItemSearch}
                    onChange={e => { setAddInvItemSearch(e.target.value); setAddInvShowSearch(true); }}
                    onFocus={() => setAddInvShowSearch(true)}
                    onBlur={() => setTimeout(() => setAddInvShowSearch(false), 150)}
                    placeholder="Search item..."
                    className="w-full pl-8 pr-4 py-2 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {addInvShowSearch && matchingItems.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white shadow-xl rounded-xl border border-gray-100 z-10 max-h-48 overflow-y-auto mt-1">
                      {matchingItems.map(i => (
                        <button
                          key={i.id}
                          onMouseDown={() => {
                            setAddInvItemId(i.id);
                            setAddInvVariant({});
                            setAddInvItemSearch('');
                            setAddInvShowSearch(false);
                          }}
                          className="w-full p-3 text-left text-sm font-medium hover:bg-gray-50 transition-colors"
                        >
                          {i.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {addInvItem?.variantAttributes && addInvItem.variantAttributes.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Variant</label>
                  <div className="grid grid-cols-2 gap-2">
                    {addInvItem.variantAttributes.map(attr => (
                      <div key={attr.name} className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{attr.name}</label>
                        <select
                          value={addInvVariant[attr.name] || ''}
                          onChange={e => setAddInvVariant(prev => ({ ...prev, [attr.name]: e.target.value }))}
                          className="w-full p-2 bg-gray-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select...</option>
                          {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {addInvItem && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Base UOM</label>
                  <div className="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 font-medium">
                    {baseUom?.name || addInvItem.uomId}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Quantity{baseUom ? ` (${baseUom.symbol})` : ''} — negative to reduce
                </label>
                <input
                  type="number"
                  step="any"
                  value={addInvQty}
                  onChange={e => setAddInvQty(e.target.value)}
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Unit Price (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={addInvPrice}
                  onChange={e => setAddInvPrice(e.target.value)}
                  placeholder="Leave blank to keep existing"
                  className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex space-x-3 pt-1">
                <button
                  onClick={handleSubmit}
                  disabled={addInvSubmitting || !addInvItemId}
                  className="flex-1 py-3.5 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {addInvSubmitting ? <Loader2 className="animate-spin" size={16} /> : 'Add to Inventory'}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal
        isOpen={isExportModalOpen}
        onClose={() => { setIsExportModalOpen(false); setExportCategoryId('all'); }}
        title="Export / Print Inventory"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Category</label>
            <select
              value={exportCategoryId}
              onChange={e => setExportCategoryId(e.target.value)}
              className="w-full p-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Categories</option>
              {exportMainCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {filteredExportRows.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No items to export</p>
            </div>
          ) : (
            <div className="py-2 px-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 font-medium">{filteredExportRows.length} item{filteredExportRows.length !== 1 ? 's' : ''} · Total value: <span className="font-bold text-gray-900">₱{filteredExportRows.reduce((s, r) => s + r.totalCost, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
            </div>
          )}

          <div className="flex space-x-3 pt-1">
            <button
              onClick={handleExportCSV}
              disabled={filteredExportRows.length === 0}
              className="flex-1 py-3.5 bg-gray-900 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <FileDown size={14} />
              Export CSV
            </button>
            <button
              onClick={handlePrint}
              disabled={filteredExportRows.length === 0}
              className="flex-1 py-3.5 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <Printer size={14} />
              Print
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editingItem} onClose={() => setEditingItem(null)} title="Edit Item">
        {editingItem && (
          <ItemForm 
            uoms={uoms} 
            categories={categories} 
            locations={locations}
            items={items}
            initialData={editingItem}
            onComplete={() => {
              setEditingItem(null);
            }} 
          />
        )}
      </Modal>

      <Modal 
        isOpen={!!viewingTransactions} 
        onClose={() => setViewingTransactions(null)} 
        title="Transaction History"
      >
        {viewingTransactions && (
          <div className="space-y-6">
            <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                viewingTransactions.item.isTool ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"
              )}>
                {viewingTransactions.item.isTool ? <Wrench size={20} /> : <Box size={20} />}
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900">{viewingTransactions.item.name}</h4>
                <div className="flex flex-wrap gap-2 mt-0.5">
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                    {locations.find(l => l.id === selectedJobsiteId)?.name}
                  </p>
                  {viewingTransactions.variant && Object.keys(viewingTransactions.variant).length > 0 && Object.entries(viewingTransactions.variant).map(([k, v]) => (
                    <span key={k} className="text-[8px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-bold uppercase">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] pl-1">Recent Activity</h3>
              {isLoadingTransactions ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin text-blue-600" size={24} />
                </div>
              ) : itemTransactions.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No transactions found</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {itemTransactions.map(t => {
                    const from = locations.find(l => l.id === t.fromLocationId);
                    const to = locations.find(l => l.id === t.toLocationId);
                    const isIncoming = t.toLocationId === selectedJobsiteId;
                    
                    return (
                      <div key={t.id} className="flex items-center space-x-3 p-3 bg-white border border-gray-100 rounded-xl">
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0",
                          t.type === 'delivery' ? "bg-blue-600" : 
                          t.type === 'pick' ? "bg-purple-600" :
                          t.type === 'usage' ? "bg-orange-600" : 
                          t.type === 'return' ? "bg-green-600" : "bg-gray-900"
                        )}>
                          {t.type === 'delivery' ? <Truck size={14} /> : 
                           t.type === 'pick' ? <Package size={14} /> :
                           t.type === 'usage' ? <Wrench size={14} /> : 
                           t.type === 'return' ? <ArrowLeftRight size={14} /> : <History size={14} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-gray-900 uppercase tracking-tight">
                              {t.type}
                              {t.customSpec && (
                                <span className="ml-2 text-purple-600 lowercase font-bold">
                                  ({t.customSpec})
                                </span>
                              )}
                            </p>
                            <p className="text-[9px] font-bold text-gray-400">
                              {t.timestamp?.toDate ? t.timestamp.toDate().toLocaleDateString() : 'Just now'}
                            </p>
                          </div>
                          <p className="text-[10px] text-gray-500 truncate">
                            {isIncoming ? `From: ${from?.name || 'External'}` : `To: ${to?.name || 'External'}`}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.userName && <span className="text-[8px] font-bold text-gray-400 uppercase">{t.userName}</span>}
                            {t.poNumber && <span className="text-[8px] font-black text-blue-600 uppercase">PO: {t.poNumber}</span>}
                            {t.serialNumber && <span className="text-[8px] font-black text-purple-600 uppercase bg-purple-50 px-1 rounded">SN: {t.serialNumber}</span>}
                            {t.propertyNumber && <span className="text-[8px] font-black text-orange-600 uppercase bg-orange-50 px-1 rounded">PN: {t.propertyNumber}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "text-xs font-black",
                            isIncoming ? "text-green-600" : "text-red-600"
                          )}>
                            {isIncoming ? '+' : '-'}{t.quantity}
                          </p>
                          <p className="text-[8px] font-bold text-gray-400 uppercase">
                            {uoms.find(u => u.id === t.uomId || u.symbol === t.uomId)?.symbol || t.uomId}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editingInventory}
        onClose={() => setEditingInventory(null)}
        title="Edit Inventory Record"
      >
        {editingInventory && profile && (
          <InventoryEditModal
            inv={editingInventory.inv}
            item={editingInventory.item}
            variant={editingInventory.variant}
            profile={profile}
            locationName={locations.find(l => l.id === selectedJobsiteId)?.name || ''}
            onClose={() => setEditingInventory(null)}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!consumingItem}
        onClose={() => setConsumingItem(null)}
        title="Consume Item"
      >
        {consumingItem && (
          <ConsumeModal
            item={consumingItem.item}
            entries={consumingItem.entries}
            selectedJobsiteId={selectedJobsiteId}
            uoms={uoms}
            profile={profile}
            onClose={() => setConsumingItem(null)}
            onSuccess={() => setConsumingItem(null)}
          />
        )}
      </Modal>
    </div>
  );
};
