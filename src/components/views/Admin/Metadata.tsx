import React, { useState } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Check, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../../App';
import { 
  updateCategory, addCategory, deleteCategory,
  updateLocation, addLocation, deleteLocation,
  updateUOM, addUOM, deleteUOM,
  updateTag, addTag, deleteTag
} from '../../../services/inventoryService';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Swipeable } from '../../common/Swipeable';
import { Modal } from '../../common/Modal';
import { deleteField } from 'firebase/firestore';

export const MetadataAdminView = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { categories, locations, uoms, tags, items, inventory, transactions, assets } = useData();
  const [showInactive, setShowInactive] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<any>(null);
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const getTitle = () => {
    switch (type) {
      case 'categories': return 'Categories';
      case 'locations': return 'Locations';
      case 'uoms': return 'Units of Measure';
      case 'tags': return 'Tags';
      default: return 'Metadata';
    }
  };

  const canEdit = () => {
    return profile?.role === 'admin';
  };

  const canDelete = (item: any) => {
    return profile?.role === 'admin' && item.canDelete;
  };

  const canOpenBOQ = () => {
    return profile?.role === 'admin';
  };

  const getData = () => {
    if (!canEdit() && !canOpenBOQ()) return [];
    switch (type) {
      case 'categories': 
        return categories
          .filter(c => !c.parentId && (showInactive || c.isActive))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(parent => {
            const subCats = categories
              .filter(c => c.parentId === parent.id && (showInactive || c.isActive))
              .sort((a, b) => a.name.localeCompare(b.name));
            
            return {
              id: parent.id,
              name: parent.name,
              isActive: parent.isActive,
              isParent: true,
              canDelete: !items.some(i => i.categoryId === parent.id) && subCats.length === 0,
              subCategories: subCats.map(sub => ({
                id: sub.id,
                name: sub.name,
                isActive: sub.isActive,
                parentId: sub.parentId,
                isParent: false,
                canDelete: !items.some(i => i.categoryId === sub.id)
              }))
            };
          });
      case 'locations': 
        const sortedLocations = [...locations]
          .filter(l => showInactive || l.isActive)
          .sort((a, b) => {
            const typeOrder = { warehouse: 1, jobsite: 2, supplier: 3, system: 4 };
            const orderA = typeOrder[a.type as keyof typeof typeOrder] || 99;
            const orderB = typeOrder[b.type as keyof typeof typeOrder] || 99;
            if (orderA !== orderB) return orderA - orderB;
            return a.name.localeCompare(b.name);
          });
        return sortedLocations.map(l => {
          const hasLinkedInventory = inventory.some(inv => inv.locationId === l.id && inv.quantity > 0);
          const hasLinkedTransactions = transactions.some(t => t.fromLocationId === l.id || t.toLocationId === l.id);
          const hasLinkedAssets = assets.some(a => a.locationId === l.id);
          const isSystem = l.type === 'system';
          return { 
            ...l,
            sub: l.type.toUpperCase(),
            canDelete: !isSystem && !hasLinkedInventory && !hasLinkedTransactions && !hasLinkedAssets
          };
        });
      case 'uoms': 
        return [...uoms]
          .filter(u => showInactive || u.isActive)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(u => {
            const hasLinkedItems = items.some(i => i.uomId === u.id);
            return { 
              id: u.id, 
              name: u.name, 
              sub: u.symbol,
              isActive: u.isActive,
              symbol: u.symbol,
              canDelete: !hasLinkedItems
            };
          });
      case 'tags':
        return [...tags]
          .filter(t => showInactive || t.isActive)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(t => {
            const hasLinkedItems = items.some(i => i.tags?.includes(t.name));
            return {
              id: t.id,
              name: t.name,
              sub: 'Tag',
              isActive: t.isActive,
              canDelete: !hasLinkedItems
            };
          });
      default: return [];
    }
  };

  const handleDelete = async (id: string, name: string) => {
    switch (type) {
      case 'categories': await deleteCategory(id); break;
      case 'locations': await deleteLocation(id); break;
      case 'uoms': await deleteUOM(id); break;
      case 'tags': await deleteTag(id); break;
    }
  };

  if (!canEdit() && !canOpenBOQ()) return <Navigate to="/settings" replace />;

  return (
    <div className="pb-20">
      <Header title={getTitle()} showBack />
      <div className="p-4 space-y-4">
        <div className="flex justify-end px-1">
          <button 
            onClick={() => setShowInactive(!showInactive)}
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-xl transition-all border",
              showInactive 
                ? "bg-orange-100 text-orange-600 border-orange-200 shadow-sm" 
                : "bg-gray-50 text-gray-400 border-gray-100"
            )}
          >
            {showInactive ? "Showing Inactive" : "Show Inactive"}
          </button>
        </div>

        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {getData().map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
              >
                {type === 'categories' ? (
                  <div className="space-y-2">
                    <Swipeable
                      canDelete={canDelete(item)}
                      canEdit={canEdit()}
                      onDelete={() => handleDelete(item.id, item.name)}
                      onEdit={() => setEditingEntity(item)}
                      confirmMessage={`Delete ${item.name}?`}
                    >
                      <Card 
                        onClick={() => canEdit() && setEditingEntity(item)}
                        className={cn(
                          "p-3 flex items-center justify-between bg-gray-100 border-none shadow-none",
                          !item.isActive && "opacity-50 border-dashed"
                        )}
                      >
                        <div className={cn("flex items-center space-x-3")}>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">{item.name}</h4>
                            {!item.isActive && (
                              <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-black uppercase tracking-widest">Inactive</span>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Swipeable>
                    
                    {item.subCategories && item.subCategories.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-2 pb-2">
                        {item.subCategories.map((sub: any) => (
                          <div key={sub.id} className="shrink-0">
                            <Swipeable
                              canDelete={canDelete(sub)}
                              canEdit={canEdit()}
                              onDelete={() => handleDelete(sub.id, sub.name)}
                              onEdit={() => setEditingEntity(sub)}
                              confirmMessage={`Delete ${sub.name}?`}
                            >
                              <div 
                                onClick={() => canEdit() && setEditingEntity(sub)}
                                className={cn(
                                  "px-4 py-2 bg-gray-200/70 rounded-full cursor-pointer active:scale-95 transition-transform",
                                  !sub.isActive && "opacity-50 grayscale"
                                )}
                              >
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs font-bold text-gray-700 whitespace-nowrap">{sub.name}</span>
                                  {!sub.isActive && (
                                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                                  )}
                                </div>
                              </div>
                            </Swipeable>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <Swipeable
                    canDelete={canDelete(item)}
                    canEdit={canEdit()}
                    onDelete={() => handleDelete(item.id, item.name)}
                    onEdit={() => setEditingEntity(item)}
                    confirmMessage={`Delete ${item.name}?`}
                  >
                    <Card 
                      onClick={() => {
                        if (type === 'locations' && item.type === 'jobsite') {
                          if (canOpenBOQ()) navigate(`/settings/manage/boq/${item.id}`);
                        } else {
                          if (canEdit()) setEditingEntity(item);
                        }
                      }}
                      className={cn(
                        "p-4 flex items-center justify-between bg-white",
                        !item.isActive && "bg-gray-50 border-dashed",
                        !canEdit() && !canOpenBOQ() && "cursor-default"
                      )}
                    >
                      <div className={cn("flex items-center space-x-3", !item.isActive && "opacity-60")}>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-bold text-gray-900">{item.displayName || item.name}</h4>
                            {!item.isActive && (
                              <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-black uppercase tracking-widest">Inactive</span>
                            )}
                          </div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {item.sub}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </Swipeable>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        
        {canEdit() && (
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="fixed bottom-20 right-4 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform z-50"
          >
            <Plus size={28} />
          </button>
        )}

        <Modal isOpen={isAddModalOpen || !!editingEntity} onClose={() => { setIsAddModalOpen(false); setEditingEntity(null); }} title={`${editingEntity ? 'Edit' : 'Add'} ${getTitle()}`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setIsSubmitting(true);
            try {
              const formData = new FormData(e.currentTarget);
              const name = formData.get('name') as string;
              const isActive = formData.get('isActive') === 'on';
              
              if (type === 'categories') {
                const parentId = formData.get('parentId') as string;
                const data: any = { name, isActive };
                if (parentId) data.parentId = parentId;
                else if (editingEntity) data.parentId = deleteField();
                
                if (editingEntity) await updateCategory(editingEntity.id, data);
                else await addCategory(data);
              }
              if (type === 'locations') {
                const locType = formData.get('type') as 'warehouse' | 'jobsite' | 'supplier';
                const longName = formData.get('longName') as string;
                const address = formData.get('address') as string;
                const contactPerson = formData.get('contactPerson') as string;
                const contactNumber = formData.get('contactNumber') as string;
                const terms = formData.get('terms') as string;
                
                const data = { 
                  name, 
                  longName: longName || name, // Default to short name if blank
                  type: locType, 
                  address,
                  contactPerson,
                  contactNumber,
                  terms,
                  isActive 
                };
                if (editingEntity) await updateLocation(editingEntity.id, data);
                else await addLocation(data);
              }
              if (type === 'uoms') {
                const symbol = formData.get('symbol') as string;
                const data = { name, symbol, isActive };
                if (editingEntity) await updateUOM(editingEntity.id, data);
                else await addUOM(data);
              }
              if (type === 'tags') {
                const data = { name, isActive };
                if (editingEntity) await updateTag(editingEntity.id, data);
                else await addTag(data);
              }
              
              setIsAddModalOpen(false);
              setEditingEntity(null);
            } catch (error) {
              console.error("Failed to save:", error);
            } finally {
              setIsSubmitting(false);
            }
          }}>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Name</label>
              <input 
                name="name" 
                required 
                defaultValue={editingEntity?.name}
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            {type === 'categories' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Parent Category (Optional)</label>
                <select 
                  name="parentId" 
                  defaultValue={editingEntity?.parentId || ''}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="">None (Main Category)</option>
                  {categories.filter(c => !c.parentId && c.id !== editingEntity?.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {type === 'locations' && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Long Name (Legal)</label>
                    <input 
                      name="longName" 
                      defaultValue={editingEntity?.longName}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                      placeholder="Legal Entity Name..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Type</label>
                    <select 
                      name="type" 
                      defaultValue={editingEntity?.type || 'jobsite'}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                    >
                      <option value="jobsite">Jobsite</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="supplier">Supplier</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Address</label>
                  <textarea 
                    name="address" 
                    defaultValue={editingEntity?.address}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" 
                    placeholder="Complete address..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Person</label>
                    <input 
                      name="contactPerson" 
                      defaultValue={editingEntity?.contactPerson}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Number</label>
                    <input 
                      name="contactNumber" 
                      defaultValue={editingEntity?.contactNumber}
                      className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Terms</label>
                  <input 
                    name="terms" 
                    defaultValue={editingEntity?.terms}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                    placeholder="e.g. COD, 30 Days"
                  />
                </div>
              </div>
            )}
            {type === 'uoms' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Symbol</label>
                <input 
                  name="symbol" 
                  required 
                  defaultValue={editingEntity?.symbol}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" 
                />
              </div>
            )}

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-gray-900">Active Status</p>
                <p className="text-[10px] text-gray-500 font-medium">Inactive items are archived</p>
              </div>
              <input 
                type="checkbox" 
                name="isActive" 
                defaultChecked={editingEntity ? editingEntity.isActive : true}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
              <span>{isSubmitting ? 'Saving...' : 'Save'}</span>
            </button>
          </form>
        </Modal>
      </div>
    </div>
  );
};
