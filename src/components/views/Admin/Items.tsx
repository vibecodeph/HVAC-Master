import React, { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, Plus, Box, Wrench, AlertTriangle, Trash2, X, Settings2, Download, Upload, Loader2 } from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { deleteItem } from '../../../services/inventoryService';
import { exportItemsToCSV, importItemsFromCSV } from '../../../services/csvService';
import { cn, getMillis, normalizeVariant } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Swipeable } from '../../common/Swipeable';
import { Modal } from '../../common/Modal';
import { ItemForm } from '../../Forms';
import { Item } from '../../../types';
import { Pagination } from '../../common/Pagination';
import { useDebounce } from '../../../hooks/useDebounce';

const ITEMS_PER_PAGE = 10;

const VariantDetailsModal = ({ item, uoms, onClose }: { item: Item, uoms: any[], onClose: () => void }) => {
  const variantBreakdown = useMemo(() => {
    if (!item.variantAttributes || item.variantAttributes.length === 0) return [];

    const generateCombinations = (attrs: { name: string; values: string[] }[]) => {
      let results: Record<string, string>[] = [{}];
      attrs.forEach(attr => {
        const nextResults: Record<string, string>[] = [];
        results.forEach(res => {
          attr.values.forEach(val => {
            nextResults.push({ ...res, [attr.name]: val });
          });
        });
        results = nextResults;
      });
      return results;
    };

    const allCombinations = generateCombinations(item.variantAttributes);

    return allCombinations.map(variant => {
      const config = item.variantConfigs?.find(vc => 
        normalizeVariant(vc.variant) === normalizeVariant(variant)
      );
      
      return {
        variant,
        averageCost: config?.averageCost ?? item.averageCost,
        reorderLevel: config?.reorderLevel ?? item.reorderLevel
      };
    });
  }, [item]);

  const uomSymbol = uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId;

  return (
    <div className="space-y-4">
      <div className="p-4 bg-blue-50 rounded-2xl">
        <h4 className="font-bold text-blue-900">{item.name}</h4>
        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Variant Breakdown</p>
      </div>
      
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
        {variantBreakdown.map((v, i) => (
          <Card key={i} className="p-4 flex items-center space-x-4 bg-white">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
              item.isTool ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
            )}>
              {item.isTool ? <Wrench size={20} /> : <Box size={20} />}
            </div>
            
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-gray-900 leading-tight">
                {Object.entries(v.variant).map(([_, val]) => val).join(' / ')}
              </h4>
            </div>

            <div className="flex items-center space-x-4 pr-1 flex-shrink-0">
              <div className="flex flex-col items-end">
                <span className="text-xs font-black text-blue-600">₱{(v.averageCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-black text-gray-900">{v.reorderLevel || 0}</span>
                <span className="text-[8px] font-black text-gray-400 uppercase tracking-[0.1em]">{uomSymbol}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
      
      <button 
        onClick={onClose}
        className="w-full py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
      >
        Close
      </button>
    </div>
  );
};

export const ItemManagementView = () => {
  const { profile } = useAuth();
  const { items, categories, uoms, locations, inventory, transactions, boqs, tags } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [filter, setFilter] = useState<'Materials' | 'Tools'>('Materials');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVariantItem, setSelectedVariantItem] = useState<Item | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: number; errors: string[] } | null>(null);

  if (profile?.role !== 'admin') {
    return <Navigate to="/settings" />;
  }

  const filteredItems = useMemo(() => {
    return items
      .filter(item => {
        if (showInactive) {
          if (item.isActive) return false;
        } else {
          if (!item.isActive) return false;
        }
        if (filter === 'Materials' && item.isTool) return false;
        if (filter === 'Tools' && !item.isTool) return false;
        if (selectedCategoryId !== 'all' && item.categoryId !== selectedCategoryId) return false;
        if (debouncedSearchTerm) {
          const search = debouncedSearchTerm.toLowerCase();
          const mainCat = categories.find(c => c.id === item.categoryId);
          const subCat = categories.find(c => c.id === item.subcategoryId);
          return item.name.toLowerCase().includes(search) || 
                 item.tags?.some(t => t.toLowerCase().includes(search)) ||
                 mainCat?.name.toLowerCase().includes(search) ||
                 subCat?.name.toLowerCase().includes(search);
        }
        return true;
      })
      .sort((a, b) => {
        const getSortName = (item: Item) => {
          const sub = categories.find(c => c.id === item.subcategoryId);
          if (sub) return sub.name;
          const main = categories.find(c => c.id === item.categoryId);
          return main?.name || 'Uncategorized';
        };
        const catA = getSortName(a);
        const catB = getSortName(b);
        const catCompare = catA.localeCompare(catB);
        if (catCompare !== 0) return catCompare;
        return a.name.localeCompare(b.name);
      });
  }, [items, showInactive, filter, debouncedSearchTerm, categories, selectedCategoryId]);

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleDelete = async (id: string) => {
    try {
      await deleteItem(id);
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleExport = () => {
    exportItemsToCSV(items, categories, uoms);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus(null);
    try {
      const result = await importItemsFromCSV(file, categories, uoms, tags);
      setImportStatus(result);
    } catch (error: any) {
      setImportStatus({ success: 0, errors: [error.message || 'Import failed'] });
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="pb-20">
      <Header title="Manage Items" showBack />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={handleExport}
            className="flex items-center justify-center space-x-2 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
          <label className="flex items-center justify-center space-x-2 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
            {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            <span>{isImporting ? 'Importing...' : 'Import CSV'}</span>
            <input type="file" accept=".csv" onChange={handleImport} className="hidden" disabled={isImporting} />
          </label>
        </div>

        {importStatus && (
          <div className={cn(
            "p-4 rounded-2xl border text-xs font-bold",
            importStatus.errors.length > 0 ? "bg-orange-50 border-orange-100 text-orange-700" : "bg-green-50 border-green-100 text-green-700"
          )}>
            <div className="flex justify-between items-start mb-2">
              <span className="uppercase tracking-widest text-[10px]">Import Result</span>
              <button onClick={() => setImportStatus(null)}><X size={14} /></button>
            </div>
            <p>Successfully processed {importStatus.success} items.</p>
            {importStatus.errors.length > 0 && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                <p className="text-orange-900">Errors ({importStatus.errors.length}):</p>
                {importStatus.errors.map((err, i) => (
                  <p key={i} className="font-medium opacity-80">• {err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search items, categories, tags..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
        </div>

        <div className="flex space-x-2">
          {['Materials', 'Tools'].map((cat) => (
            <button 
              key={cat} 
              onClick={() => setFilter(cat as any)}
              className={cn(
                "flex-1 py-4 rounded-2xl text-[10px] font-black transition-all uppercase tracking-[0.2em] border",
                filter === cat 
                  ? "bg-gray-900 text-white border-gray-900 shadow-[0_8px_20px_rgba(0,0,0,0.2)]" 
                  : "bg-white text-gray-400 border-gray-100"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center px-1">
          <div className="flex items-center space-x-2">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Category:</span>
            <select 
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="text-[10px] font-black uppercase tracking-widest bg-transparent outline-none text-blue-600 border-b border-blue-100 pb-0.5"
            >
              <option value="all">All Categories</option>
              {categories.filter(c => !c.parentId && c.isActive).map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={() => setShowInactive(!showInactive)}
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-xl transition-all border",
              showInactive 
                ? "bg-orange-100 text-orange-600 border-orange-200 shadow-sm" 
                : "bg-gray-50 text-gray-400 border-gray-100"
            )}
          >
            {showInactive ? "Showing Inactive Only" : "Show Inactive Only"}
          </button>
        </div>

        <div className="space-y-3">
          {paginatedItems.map((item, index) => {
            const getDisplayCategory = (it: Item) => {
              const sub = categories.find(c => c.id === it.subcategoryId);
              if (sub) return sub.name;
              const main = categories.find(c => c.id === it.categoryId);
              return main?.name || 'Uncategorized';
            };

            const categoryName = getDisplayCategory(item);
            const prevItem = paginatedItems[index - 1];
            const prevCategoryName = prevItem ? getDisplayCategory(prevItem) : null;
            const showHeader = categoryName !== prevCategoryName;

            const hasInventory = inventory.some(inv => inv.itemId === item.id && inv.quantity > 0);
            const hasTransactions = transactions.some(t => t.itemId === item.id);
            const hasBOQ = boqs.some(b => b.itemId === item.id);
            const canDelete = !hasInventory && !hasTransactions && !hasBOQ;

            return (
              <React.Fragment key={item.id}>
                {showHeader && (
                  <div className="pt-4 pb-1 px-1">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{categoryName}</h3>
                  </div>
                )}
                <Swipeable
                  canDelete={canDelete}
                  canEdit={true}
                  canDuplicate={true}
                  onDelete={() => handleDelete(item.id)}
                  onEdit={() => setEditingItem(item)}
                  onDuplicate={() => {
                    setEditingItem(item);
                    setIsDuplicating(true);
                  }}
                  confirmMessage={`Delete ${item.name}?`}
                >
                  <Card 
                    onClick={() => setEditingItem(item)}
                    className={cn(
                      "p-4 flex items-center space-x-4 bg-white",
                      !item.isActive && "bg-gray-50 border-dashed opacity-60"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                      item.isTool ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
                    )}>
                      {item.isTool ? <Wrench size={20} /> : <Box size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <h4 className="text-sm font-bold text-gray-900 leading-tight">{item.name}</h4>
                        {item.requireVariant && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full font-black uppercase tracking-widest">Required</span>
                        )}
                        {!item.isActive && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-black uppercase tracking-widest">Inactive</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 pr-1 flex-shrink-0">
                      {item.variantAttributes && item.variantAttributes.length > 0 ? (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVariantItem(item);
                          }}
                          className="flex flex-col items-end group"
                        >
                          <span className="text-xs font-black text-blue-600 group-hover:text-blue-700 transition-colors">VARIANTS</span>
                          <div className="flex items-center space-x-1 mt-0.5">
                            <Settings2 size={10} className="text-blue-400" />
                            <span className="text-[7px] font-black text-blue-400 uppercase tracking-tighter">View Details</span>
                          </div>
                        </button>
                      ) : (
                        <>
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-black text-blue-600">₱{(item.averageCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-black text-gray-900">{item.reorderLevel || 0}</span>
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-[0.1em]">
                              {uoms.find(u => u.id === item.uomId || u.symbol === item.uomId)?.symbol || item.uomId}
                            </span>
                          </div>
                        </>
                      )}
                      {!canDelete && (
                        <div className="flex flex-col items-center space-y-0.5 opacity-80" title="Item has linked data and cannot be deleted">
                          <AlertTriangle size={14} className="text-gray-400" />
                          <span className="text-[7px] font-black text-gray-400 uppercase tracking-tighter">Linked</span>
                        </div>
                      )}
                    </div>
                  </Card>
                </Swipeable>
              </React.Fragment>
            );
          })}
          {paginatedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                <Box size={32} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">No items found</h3>
                <p className="text-xs text-gray-500 mt-1">Try adjusting your filters or search.</p>
              </div>
            </div>
          )}
        </div>

        <Pagination 
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          className="mt-6"
        />
      </div>

      <button 
        onClick={() => setIsAddModalOpen(true)}
        className="fixed bottom-20 right-4 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform z-50"
      >
        <Plus size={28} />
      </button>

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="New Item">
        <ItemForm 
          uoms={uoms} 
          categories={categories} 
          locations={locations}
          items={items}
          onComplete={() => {
            setIsAddModalOpen(false);
            setCurrentPage(1);
          }} 
        />
      </Modal>

      <Modal 
        isOpen={!!editingItem} 
        onClose={() => {
          setEditingItem(null);
          setIsDuplicating(false);
        }} 
        title={isDuplicating ? "Duplicate Item" : "Edit Item"}
      >
        {editingItem && (
          <ItemForm 
            uoms={uoms} 
            categories={categories} 
            locations={locations}
            items={items}
            initialData={editingItem}
            isDuplicate={isDuplicating}
            onComplete={() => {
              setEditingItem(null);
              setIsDuplicating(false);
            }} 
          />
        )}
      </Modal>
      <Modal 
        isOpen={!!selectedVariantItem} 
        onClose={() => setSelectedVariantItem(null)} 
        title="Variant Details"
      >
        {selectedVariantItem && (
          <VariantDetailsModal 
            item={selectedVariantItem} 
            uoms={uoms} 
            onClose={() => setSelectedVariantItem(null)} 
          />
        )}
      </Modal>
    </div>
  );
};
