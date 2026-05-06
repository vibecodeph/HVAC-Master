import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ChevronRight, Plus, Check, Box, Wrench, ArrowLeftRight, Download, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../../App';
import { addLocation, deleteLocation } from '../../services/inventoryService';
import { exportLocationsToCSV, importLocationsFromCSV } from '../../services/csvService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Swipeable } from '../common/Swipeable';
import { Modal } from '../common/Modal';
import { Location } from '../../types';

export const LocationsView = () => {
  const { profile } = useAuth();
  const { locations, inventory, items, transactions, assets, uoms } = useData();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile && profile.role !== 'admin') {
      navigate('/');
    }
  }, [profile, navigate]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Location | null>(null);
  const [siteTab, setSiteTab] = useState<'Details' | 'Inventory' | 'History'>('Details');
  const [showInactive, setShowInactive] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTypes, setExportTypes] = useState<Set<string>>(new Set(['warehouse', 'jobsite', 'supplier']));
  const [exportIncludeInactive, setExportIncludeInactive] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const toggleExportType = (type: string) => {
    setExportTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleExport = () => {
    exportLocationsToCSV(locations, Array.from(exportTypes), exportIncludeInactive);
    setIsExportModalOpen(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportResult(null);
    setImportProgress(null);
    try {
      const result = await importLocationsFromCSV(file, locations, (current, total) => {
        setImportProgress({ current, total });
      });
      setImportResult(result);
    } catch (err: any) {
      setImportResult({ success: 0, errors: [err.message || 'Import failed'] });
    } finally {
      setIsImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // Group and sort locations
  const filteredLocations = locations.filter(l => {
    const matchesActivity = (profile?.role === 'admin' && showInactive) ? true : l.isActive;
    const matchesType = filterType === 'all' || l.type === filterType;
    return matchesActivity && matchesType;
  });
  const groupedLocations = filteredLocations.reduce((acc, site) => {
    const type = site.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(site);
    return acc;
  }, {} as Record<string, Location[]>);

  // Sort groups (e.g., warehouse first) and items within groups
  const sortedGroups = Object.keys(groupedLocations).sort((a, b) => {
    // Custom order: warehouse, jobsite, supplier, truck, others
    const order = { warehouse: 1, jobsite: 2, supplier: 3, truck: 4 };
    const valA = order[a as keyof typeof order] || 99;
    const valB = order[b as keyof typeof order] || 99;
    return valA - valB;
  });

  sortedGroups.forEach(group => {
    groupedLocations[group].sort((a, b) => a.name.localeCompare(b.name));
  });

  if (!profile || profile.role !== 'admin') return null;

  return (
    <div className="pb-20">
      <Header
        title="Locations"
        rightAction={
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { setImportResult(null); setIsImportModalOpen(true); }}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full text-xs font-bold transition-colors"
            >
              <Upload size={14} />
              <span>Import</span>
            </button>
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-700 text-white rounded-full text-xs font-bold transition-colors"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          </div>
        }
      />
      <div className="p-4 space-y-8">
        <div className="flex items-start justify-between space-x-4">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1 block pl-1">
              Filter Type
            </label>
            <div className="relative">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-2.5 text-xs font-bold text-gray-700 outline-none appearance-none focus:border-gray-200 transition-colors shadow-sm"
              >
                <option value="all">ALL LOCATIONS</option>
                <option value="warehouse">WAREHOUSE</option>
                <option value="jobsite">JOBSITE</option>
                <option value="supplier">SUPPLIER</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronRight size={14} className="rotate-90" />
              </div>
            </div>
          </div>

          {profile?.role === 'admin' && (
            <div className="pt-5 shrink-0">
              <button
                onClick={() => setShowInactive(!showInactive)}
                className={cn(
                  "text-[10px] font-black uppercase tracking-[0.2em] px-3 py-2.5 rounded-xl transition-all border",
                  showInactive
                    ? "bg-orange-100 text-orange-600 border-orange-200 shadow-sm"
                    : "bg-gray-50 text-gray-400 border-gray-100"
                )}
              >
                {showInactive ? "Showing Inactive" : "Show Inactive"}
              </button>
            </div>
          )}
        </div>

      {sortedGroups.map((group) => (
          <div key={group} className="space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] pl-1">
              {group}s
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <AnimatePresence mode="popLayout">
                {groupedLocations[group].map((site) => {
                  const siteInventory = inventory.filter(inv => inv.locationId === site.id && inv.quantity > 0);
                  const itemCount = siteInventory.length;
                  const hasLinkedInventory = inventory.some(inv => inv.locationId === site.id && inv.quantity > 0);
                  const hasLinkedTransactions = transactions.some(t => t.fromLocationId === site.id || t.toLocationId === site.id);
                  const hasLinkedAssets = assets.some(a => a.locationId === site.id);
                  const isSystem = site.type === 'system';
                  const canDelete = !isSystem && !hasLinkedInventory && !hasLinkedTransactions && !hasLinkedAssets;
                  
                  return (
                    <motion.div
                      key={site.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Swipeable
                        canDelete={canDelete && profile?.role === 'admin'}
                        canEdit={profile?.role === 'admin'}
                        onDelete={() => deleteLocation(site.id)}
                        onEdit={() => navigate(`/settings/manage/locations`)}
                        confirmMessage={`Delete ${site.name}?`}
                      >
                        <Card 
                          className={cn(
                            "p-4 flex items-center justify-between active:bg-gray-50 transition-colors cursor-pointer relative bg-white",
                            !site.isActive && "bg-gray-50 border-dashed"
                          )}
                          onClick={() => setSelectedSite(site)}
                        >
                          <div className={cn("flex items-center space-x-4", !site.isActive && "opacity-60")}>
                            <div className={cn(
                              "w-12 h-12 rounded-2xl flex items-center justify-center",
                              !site.isActive ? "bg-gray-100 text-gray-400" : (
                                site.type === 'warehouse' ? "bg-blue-50 text-blue-600" : 
                                site.type === 'supplier' ? "bg-purple-50 text-purple-600" : 
                                "bg-green-50 text-green-600"
                              )
                            )}>
                              <MapPin size={24} />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h4 className="text-sm font-bold text-gray-900">{site.name}</h4>
                                {!site.isActive && (
                                  <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-black uppercase tracking-widest">Inactive</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">{itemCount} items currently on site</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-1">
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase",
                              site.type === 'jobsite' ? "bg-green-100 text-green-700" : 
                              site.type === 'supplier' ? "bg-purple-100 text-purple-700" : 
                              site.type === 'warehouse' ? "bg-blue-100 text-blue-700" :
                              "bg-gray-100 text-gray-700"
                            )}>
                              {site.type}
                            </span>
                            <ChevronRight size={16} className="text-gray-300" />
                          </div>
                        </Card>
                      </Swipeable>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        ))}
        
        {locations.length === 0 && (
          <p className="text-center py-12 text-gray-400 font-bold italic uppercase tracking-widest">No locations defined</p>
        )}
      </div>

      <Modal isOpen={!!selectedSite} onClose={() => setSelectedSite(null)} title={selectedSite?.name || 'Site Details'}>
        <div className="space-y-6">
          <div className="flex p-1 bg-gray-100 rounded-2xl">
            {['Details', 'Inventory', 'History'].map((tab) => (
              <button 
                key={tab}
                onClick={() => setSiteTab(tab as 'Details' | 'Inventory' | 'History')}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-xl transition-colors",
                  siteTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {siteTab === 'Details' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Legal Name</p>
                  <p className="text-sm font-bold text-gray-900">{selectedSite?.longName || selectedSite?.name || 'N/A'}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Type</p>
                  <p className="text-sm font-bold text-gray-900 uppercase tracking-tight">{selectedSite?.type}</p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Address</p>
                <p className="text-sm font-bold text-gray-900 leading-relaxed">{selectedSite?.address || 'No address provided'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Contact Person</p>
                  <p className="text-sm font-bold text-gray-900">{selectedSite?.contactPerson || 'N/A'}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Contact Number</p>
                  <p className="text-sm font-bold text-gray-900">{selectedSite?.contactNumber || 'N/A'}</p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Terms</p>
                <p className="text-sm font-bold text-gray-900">{selectedSite?.terms || 'N/A'}</p>
              </div>
            </div>
          ) : siteTab === 'Inventory' ? (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Current Stock</h4>
              <div className="space-y-2">
                {inventory.filter(inv => inv.locationId === selectedSite?.id && inv.quantity > 0).map((inv, idx) => {
                  const item = items.find(i => i.id === inv.itemId);
                  const variantStr = inv.variant ? Object.entries(inv.variant).map(([k, v]) => `${v}`).join(', ') : '';
                  return (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center space-x-3">
                        {item?.isTool ? <Wrench size={14} className="text-orange-600" /> : <Box size={14} className="text-blue-600" />}
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-700">
                            {item?.name || 'Unknown Item'}
                          </span>
                          <div className="flex items-center space-x-2">
                            {variantStr && <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tight">{variantStr}</span>}
                            {inv.serialNumber && <span className="text-[10px] font-black text-orange-600 uppercase tracking-tight">SN: {inv.serialNumber}</span>}
                            {inv.propertyNumber && <span className="text-[10px] font-black text-purple-600 uppercase tracking-tight ml-1">PN: {inv.propertyNumber}</span>}
                          </div>
                        </div>
                      </div>
                      <span className="text-sm font-black text-gray-900">{inv.quantity} <span className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.symbol || item?.uomId}</span></span>
                    </div>
                  );
                })}
                {inventory.filter(inv => inv.locationId === selectedSite?.id && inv.quantity > 0).length === 0 && (
                  <p className="text-center py-8 text-gray-400 font-bold italic uppercase tracking-widest">No stock on site</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Recent Movements</h4>
              <div className="space-y-3">
                {transactions?.filter(t => t.toLocationId === selectedSite?.id || t.fromLocationId === selectedSite?.id).map(t => {
                  const item = items.find(i => i.id === t.itemId);
                  const isIncoming = t.toLocationId === selectedSite?.id;
                  return (
                    <div key={t.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-white",
                        isIncoming ? "bg-green-600" : "bg-orange-600"
                      )}>
                        {isIncoming ? <Plus size={14} /> : <ArrowLeftRight size={14} className="rotate-90" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">
                          {item?.name}
                          {t.variant && (
                            <span className="ml-1 text-[10px] text-blue-500">({Object.values(t.variant).join(', ')})</span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-500 font-medium">
                          {isIncoming ? 'Received' : 'Moved Out'} • {typeof t.timestamp?.toDate === 'function' ? t.timestamp.toDate().toLocaleDateString() : 'Recent'}
                          {t.serialNumber && <span className="ml-1 text-orange-600 font-black uppercase">SN: {t.serialNumber}</span>}
                          {t.propertyNumber && <span className="ml-1 text-purple-600 font-black uppercase">PN: {t.propertyNumber}</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-sm font-black", isIncoming ? "text-green-600" : "text-orange-600")}>
                          {isIncoming ? '+' : '-'}{t.quantity} <span className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.symbol || item?.uomId}</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Export Modal */}
      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title="Export Locations">
        <div className="space-y-5">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Location Types</p>
            <div className="space-y-2">
              {(['warehouse', 'jobsite', 'supplier'] as const).map(type => (
                <label key={type} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportTypes.has(type)}
                    onChange={() => toggleExportType(type)}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                  <span className="text-sm font-bold text-gray-700 capitalize">{type}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={exportIncludeInactive}
              onChange={() => setExportIncludeInactive(v => !v)}
              className="w-4 h-4 rounded accent-orange-500"
            />
            <span className="text-sm font-bold text-gray-700">Include inactive locations</span>
          </label>
          <button
            onClick={handleExport}
            disabled={exportTypes.size === 0}
            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-40"
          >
            <Download size={18} />
            <span>Download CSV</span>
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal isOpen={isImportModalOpen} onClose={() => { setIsImportModalOpen(false); setImportResult(null); }} title="Import Locations">
        <div className="space-y-5">
          <div className="p-4 bg-blue-50 rounded-2xl space-y-1">
            <p className="text-xs font-bold text-blue-700">CSV columns: ID (optional), Name, Long Name, Type, Address, Contact Person, Contact Number, Terms, Is Active</p>
            <p className="text-[10px] text-blue-500 font-medium">If ID matches an existing location it will be updated; otherwise a new location is created. Type must be: warehouse, jobsite, or supplier.</p>
          </div>

          {!isImporting && !importResult && (
            <>
              <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:border-gray-300 transition-colors bg-gray-50">
                <Upload size={24} className="text-gray-400 mb-2" />
                <span className="text-xs font-bold text-gray-500">Choose CSV file</span>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </label>
            </>
          )}

          {isImporting && (
            <div className="flex flex-col items-center py-6 space-y-3">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              {importProgress && (
                <p className="text-xs font-bold text-gray-500">
                  {importProgress.current} / {importProgress.total} rows
                </p>
              )}
            </div>
          )}

          {importResult && (
            <div className="space-y-3">
              <div className={cn(
                "p-4 rounded-2xl",
                importResult.errors.length === 0 ? "bg-green-50" : "bg-yellow-50"
              )}>
                <p className={cn(
                  "text-sm font-bold",
                  importResult.errors.length === 0 ? "text-green-700" : "text-yellow-700"
                )}>
                  {importResult.success} location{importResult.success !== 1 ? 's' : ''} imported successfully
                  {importResult.errors.length > 0 && `, ${importResult.errors.length} error${importResult.errors.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResult.errors.map((err, i) => (
                    <p key={i} className="text-xs text-red-600 font-medium bg-red-50 px-3 py-2 rounded-xl">{err}</p>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setIsImportModalOpen(false); setImportResult(null); }}
                className="w-full py-3 bg-gray-900 text-white rounded-2xl font-bold text-sm"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </Modal>

      <button
        onClick={() => setIsAddModalOpen(true)}
        className="fixed bottom-20 right-4 w-14 h-14 bg-gray-900 text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform z-50"
      >
        <Plus size={28} />
      </button>

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="New Location">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const name = formData.get('name') as string;
          const longName = formData.get('longName') as string;
          await addLocation({
            name,
            longName: longName || name,
            type: formData.get('type') as 'warehouse' | 'jobsite' | 'supplier',
            address: formData.get('address') as string,
            contactPerson: formData.get('contactPerson') as string,
            contactNumber: formData.get('contactNumber') as string,
            terms: formData.get('terms') as string,
          });
          setIsAddModalOpen(false);
        }}>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Location Name</label>
            <input name="name" required className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Site C: North Towers" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Long Name (Legal)</label>
              <input name="longName" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="Legal Entity Name..." />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Type</label>
              <select name="type" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
                <option value="jobsite">Jobsite</option>
                <option value="warehouse">Warehouse</option>
                <option value="supplier">Supplier</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Address</label>
            <textarea name="address" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" placeholder="Complete address..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Person</label>
              <input name="contactPerson" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Number</label>
              <input name="contactNumber" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Terms</label>
            <input name="terms" className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. COD, 30 Days" />
          </div>
          <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2">
            <Check size={20} />
            <span>Save Location</span>
          </button>
        </form>
      </Modal>
    </div>
  );
};
