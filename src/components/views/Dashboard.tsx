import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Package, ArrowDown, MapPin, Layers, Truck, Wrench, ArrowLeftRight, History, Plus, Target, Clock, Box } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { useIsMobile, useSidebar } from '../../hooks/useApp';
import { cn } from '../../lib/utils';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { ItemForm, TransactionForm, WorkerRequestForm } from '../Forms';

export const Dashboard = () => {
  const { profile } = useAuth();
  const { items, inventory, transactions, uoms, categories, locations, assets, purchaseOrders, requests } = useData();
  const { openSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [workerAction, setWorkerAction] = useState<{ mode: 'material' | 'pullout' } | null>(null);
  
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isLocationSelectOpen, setIsLocationSelectOpen] = useState(false);
  const [hasSetDefaultJobsite, setHasSetDefaultJobsite] = useState(false);
  const storageKey = profile?.uid ? `lastSite_${profile.uid}` : null;

  const [selectedLocationId, setSelectedLocationId] = useState(() => {
    if (profile?.uid) {
      const saved = localStorage.getItem(`lastSite_${profile.uid}`);
      return saved || 'all';
    }
    return 'all';
  });

  // Sync with localStorage changes from other views/tabs
  useEffect(() => {
    if (!storageKey) return;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        setSelectedLocationId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey]);

  // Set default jobsite once data is available
  useEffect(() => {
    if (profile && locations.length > 0 && !hasSetDefaultJobsite) {
      const saved = storageKey ? localStorage.getItem(storageKey) : null;
      
      const assignedLocs = locations.filter(l => 
        l.isActive && 
        profile.assignedLocationIds?.includes(l.id)
      );

      // 1. Try saved location if valid
      if (saved) {
        const isValid = locations.some(l => l.id === saved) || saved === 'all';
        const hasAccess = profile.role === 'admin' || profile.role === 'warehouseman' || profile.role === 'manager' || profile.assignedLocationIds?.includes(saved);
        if (isValid && hasAccess) {
          setSelectedLocationId(saved);
          setHasSetDefaultJobsite(true);
          return;
        }
      }

      // 2. Try first assigned location
      if (assignedLocs.length > 0) {
        setSelectedLocationId(assignedLocs[0].id);
      } else if (profile.role === 'admin' || profile.role === 'manager') {
        // 3. Last resort for admins
        setSelectedLocationId('all');
      } else if (profile.assignedLocationIds?.length) {
        // Even if not "active" in the filter, use it as a fallback ID
        setSelectedLocationId(profile.assignedLocationIds[0]);
      }
      
      setHasSetDefaultJobsite(true);
    }
  }, [profile, locations, hasSetDefaultJobsite, storageKey]);

  useEffect(() => {
    if (profile?.uid && selectedLocationId) {
      localStorage.setItem(`lastSite_${profile.uid}`, selectedLocationId);
    }
  }, [selectedLocationId, profile]);

  const totalItems = useMemo(() => {
    return inventory
      .filter(inv => {
        const loc = locations.find(l => l.id === inv.locationId);
        if (!loc) return false;
        
        // If a specific location is selected, only count that
        if (selectedLocationId !== 'all') {
          return inv.locationId === selectedLocationId;
        }
        
        // If 'all' is selected, only count warehouses (default behavior)
        const isWarehouse = loc.type === 'warehouse';
        return isWarehouse && (profile?.role === 'admin' || loc.isActive);
      })
      .reduce((acc, inv) => acc + inv.quantity, 0);
  }, [inventory, locations, selectedLocationId, profile]);

  const lowStockItems = useMemo(() => {
    return items.filter(item => {
      const totalQty = inventory
        .filter(inv => {
          const loc = locations.find(l => l.id === inv.locationId);
          if (!loc) return false;
          
          // Low stock is usually a warehouse concern
          const isWarehouse = loc.type === 'warehouse';
          const matchesLocation = selectedLocationId === 'all' 
            ? isWarehouse 
            : inv.locationId === selectedLocationId;
            
          return matchesLocation && inv.itemId === item.id && (profile?.role === 'admin' || loc.isActive);
        })
        .reduce((acc, inv) => acc + inv.quantity, 0);
      return item.reorderLevel !== undefined && item.reorderLevel !== null && totalQty <= item.reorderLevel;
    });
  }, [items, inventory, locations, selectedLocationId, profile]);

  const totalInventoryValue = useMemo(() => {
    return inventory.reduce((acc, inv) => {
      // Filter by location
      const loc = locations.find(l => l.id === inv.locationId);
      if (!loc) return acc;

      if (selectedLocationId !== 'all') {
        if (inv.locationId !== selectedLocationId) return acc;
      } else {
        // If 'all' is selected, only value warehouse stock by default
        if (loc.type !== 'warehouse') return acc;
      }
      
      const item = items.find(i => i.id === inv.itemId);
      if (!item) return acc;
      
      // Resolve cost (variant-specific or base)
      let cost = item.averageCost || 0;
      if (inv.variant && item.variantConfigs) {
        const config = item.variantConfigs.find(vc => {
          if (!vc.variant || !inv.variant) return false;
          const vcKeys = Object.keys(vc.variant);
          const invKeys = Object.keys(inv.variant);
          if (vcKeys.length !== invKeys.length) return false;
          return vcKeys.every(k => vc.variant[k] === inv.variant[k]);
        });
        if (config && config.averageCost !== undefined) {
          cost = config.averageCost;
        }
      }
      
      return acc + (inv.quantity * cost);
    }, 0);
  }, [items, inventory, locations, selectedLocationId]);

  const selectedLocation = locations.find(l => l.id === selectedLocationId);
  const showLowStock = profile?.role === 'admin' || profile?.role === 'warehouseman';

  const isWorkerDashboard = profile?.role === 'worker' || profile?.role === 'engineer';

  const workerMetrics = useMemo(() => {
    if (!isWorkerDashboard) return null;
    
    // Only count requests for the selected jobsite
    const siteRequests = requests.filter(r => r.jobsiteId === selectedLocationId);
    
    const readyForReceipt = siteRequests.filter(r => r.status === 'for delivery').length;
    const pendingApproval = siteRequests.filter(r => r.status === 'pending').length;
    
    return { readyForReceipt, pendingApproval };
  }, [requests, selectedLocationId, isWorkerDashboard]);

  if (isWorkerDashboard) {
    return (
      <div className="p-4 space-y-6 pb-20 text-blue-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isMobile && (
              <button onClick={openSidebar} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <Menu size={20} />
              </button>
            )}
            <div>
              <h2 className="text-2xl font-black tracking-tight text-gray-900">Dashboard</h2>
              <p className="text-sm text-gray-500 font-medium italic">Hello, {profile?.firstName || profile?.displayName?.split(' ')[0] || 'Member'}</p>
            </div>
          </div>
          <Link to="/profile" className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold overflow-hidden hover:ring-2 hover:ring-blue-400 transition-all">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              profile?.displayName?.[0] || '?'
            )}
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Main Jobsite Card - Streamlined */}
          <Card 
            onClick={() => setIsLocationSelectOpen(true)}
            className="col-span-2 p-5 bg-gray-900 text-white flex items-center justify-between relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer shadow-xl border-none group"
          >
            <div className="relative z-10 flex-1 min-w-0">
              <div className="flex items-center space-x-2 mb-1">
                <MapPin size={12} className="text-blue-400" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Current Jobsite</span>
              </div>
              <h3 className="text-xl font-black tracking-tight truncate group-hover:text-blue-400 transition-colors">
                {selectedLocation?.name || (selectedLocationId === 'all' ? 'All Locations' : 'No Jobsite Assigned')}
              </h3>
              <div className="mt-1 flex items-center space-x-2">
                <span className="flex items-center space-x-1 px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-[8px] font-black text-green-400 uppercase tracking-widest">
                  <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                  <span>ACTIVE</span>
                </span>
              </div>
            </div>
            
            <div className="relative z-10 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
              <ArrowLeftRight size={18} />
            </div>

            <div className="absolute -right-4 -bottom-4 opacity-5 pointer-events-none group-hover:rotate-12 transition-transform duration-700">
              <Layers size={100} />
            </div>
          </Card>

          {/* Metric: Ready for Receipt */}
          <Card className="p-4 bg-orange-50 border-orange-100 flex items-center space-x-4 group hover:bg-orange-100 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
              <Truck size={20} />
            </div>
            <div className="min-w-0">
              <span className="text-2xl font-black text-orange-950 leading-none tracking-tighter block">{workerMetrics?.readyForReceipt}</span>
              <p className="text-[10px] font-black text-orange-900 uppercase tracking-tight opacity-60 leading-tight">To Receive</p>
            </div>
          </Card>

          {/* Metric: Pending Approval */}
          <Card className="p-4 bg-blue-50 border-blue-100 flex items-center space-x-4 group hover:bg-blue-100 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
              <Clock size={20} />
            </div>
            <div className="min-w-0">
              <span className="text-2xl font-black text-blue-950 leading-none tracking-tighter block">{workerMetrics?.pendingApproval}</span>
              <p className="text-[10px] font-black text-blue-900 uppercase tracking-tight opacity-60 leading-tight">Pending</p>
            </div>
          </Card>
        </div>

        {/* Quick Actions - More Compact */}
        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={() => setWorkerAction({ mode: 'material' })}
            className="group p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md active:scale-95 transition-all text-left flex items-center space-x-3"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white group-hover:rotate-12 transition-transform shadow-lg shadow-blue-600/10 flex-shrink-0">
              <Plus size={20} />
            </div>
            <div>
              <h4 className="font-black text-gray-900 uppercase text-xs tracking-widest leading-none">Material</h4>
              <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase">Request New</p>
            </div>
          </button>
          
          <button 
            onClick={() => setWorkerAction({ mode: 'pullout' })}
            className="group p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md active:scale-95 transition-all text-left flex items-center space-x-3"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center text-white group-hover:-rotate-12 transition-transform shadow-lg shadow-purple-600/10 flex-shrink-0">
              <ArrowLeftRight size={20} />
            </div>
            <div>
              <h4 className="font-black text-gray-900 uppercase text-xs tracking-widest leading-none">Pullout</h4>
              <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase">Return items</p>
            </div>
          </button>
        </div>

        <Modal isOpen={isLocationSelectOpen} onClose={() => setIsLocationSelectOpen(false)} title="Assigned Jobsites">
          <div className="space-y-3">
            {locations
              .filter(l => l.type === 'jobsite' && l.isActive && profile?.assignedLocationIds?.includes(l.id))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(loc => (
                <button
                  key={loc.id}
                onClick={() => {
                  setSelectedLocationId(loc.id);
                  setIsLocationSelectOpen(false);
                }}
                className={cn(
                  "w-full p-5 rounded-2xl text-left font-black transition-all border-2",
                  selectedLocationId === loc.id 
                    ? "bg-gray-900 text-white border-gray-900" 
                    : "bg-gray-50 text-gray-600 border-gray-100"
                )}
              >
                {loc.name}
              </button>
            ))}
          </div>
        </Modal>

        <Modal 
          isOpen={!!workerAction} 
          onClose={() => setWorkerAction(null)} 
          title={workerAction?.mode === 'material' ? 'Request Materials' : 'Request Pullout'}
        >
          {workerAction && (
            <WorkerRequestForm 
              items={items}
              locations={locations}
              uoms={uoms}
              inventory={inventory}
              profile={profile}
              mode={workerAction.mode}
              defaultJobsiteId={selectedLocationId}
              onComplete={() => setWorkerAction(null)}
            />
          )}
        </Modal>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {isMobile && (
            <button onClick={openSidebar} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <Menu size={20} />
            </button>
          )}
          <div>
            <h2 className="text-2xl font-black tracking-tight text-gray-900">Dashboard</h2>
            <p className="text-sm text-gray-500 font-medium">Welcome back, {profile?.firstName || profile?.displayName?.split(' ')[0] || 'User'}</p>
          </div>
        </div>
        <Link to="/profile" className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold overflow-hidden hover:ring-2 hover:ring-blue-400 transition-all">
          {profile?.photoURL ? (
            <img 
              src={profile.photoURL} 
              alt="Profile" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            profile?.displayName?.[0] || profile?.email?.[0]?.toUpperCase() || '?'
          )}
        </Link>
      </div>

      <div className={cn(
        "grid gap-4",
        showLowStock ? "grid-cols-2" : "grid-cols-1"
      )}>
        <Card className="p-4 bg-blue-50 border-blue-100">
          <div className="flex flex-col space-y-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Package size={18} />
            </div>
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Total Stock</span>
            <span className="text-2xl font-black text-blue-900">{totalItems.toLocaleString()}</span>
          </div>
        </Card>
        {showLowStock && (
          <Card className={cn(
            "p-4 border",
            lowStockItems.length > 0 ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100"
          )}>
            <div className="flex flex-col space-y-2">
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-white",
                lowStockItems.length > 0 ? "bg-red-600" : "bg-green-600"
              )}>
                <ArrowDown size={18} />
              </div>
              <span className={cn(
                "text-xs font-bold uppercase tracking-wider",
                lowStockItems.length > 0 ? "text-red-800" : "text-green-800"
              )}>Low Stock</span>
              <span className={cn(
                "text-2xl font-black",
                lowStockItems.length > 0 ? "text-red-900" : "text-green-900"
              )}>{lowStockItems.length}</span>
            </div>
          </Card>
        )}
      </div>

      {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'warehouseman') && (
        <Card 
          onClick={() => setIsLocationSelectOpen(true)}
          className="p-6 bg-gray-900 text-white overflow-hidden relative active:scale-[0.98] transition-transform cursor-pointer"
        >
          <div className="relative z-10">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">
              {selectedLocationId === 'all' ? 'Total Inventory Value' : `Inventory Value: ${selectedLocation?.name || selectedLocationId}`}
            </p>
            <h3 className="text-3xl font-black tracking-tighter">P{totalInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
            {selectedLocationId !== 'all' && (
              <div className="mt-2 inline-flex items-center space-x-1 px-2 py-1 bg-white/10 rounded-lg border border-white/10">
                <MapPin size={10} className="text-blue-400" />
                <span className="text-[10px] font-bold text-gray-300">{selectedLocation?.name || selectedLocationId}</span>
              </div>
            )}
          </div>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Layers size={80} />
          </div>
        </Card>
      )}

      <Modal 
        isOpen={isLocationSelectOpen} 
        onClose={() => setIsLocationSelectOpen(false)}
        title="Select Location"
      >
        <div className="space-y-3">
          {profile?.role === 'admin' && (
            <button
              onClick={() => {
                setSelectedLocationId('all');
                setIsLocationSelectOpen(false);
              }}
              className={cn(
                "w-full p-4 rounded-2xl text-left font-bold transition-all border",
                selectedLocationId === 'all' 
                  ? "bg-gray-900 text-white border-gray-900" 
                  : "bg-gray-50 text-gray-600 border-gray-100"
              )}
            >
              All Locations
            </button>
          )}
          
          {['warehouse', 'jobsite'].map(type => {
            const filteredLocs = locations
              .filter(l => {
                if (!l.isActive) return false;
                if (l.type !== type) return false;
                if (profile && profile.role !== 'admin') {
                  return profile.assignedLocationIds?.includes(l.id);
                }
                return true;
              })
              .sort((a, b) => a.name.localeCompare(b.name));

            if (filteredLocs.length === 0) return null;

            return (
              <div key={type} className="space-y-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">{type}s</p>
                {filteredLocs.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => {
                      setSelectedLocationId(loc.id);
                      setIsLocationSelectOpen(false);
                    }}
                    className={cn(
                      "w-full p-4 rounded-2xl text-left font-bold transition-all border",
                      selectedLocationId === loc.id 
                        ? "bg-gray-900 text-white border-gray-900" 
                        : "bg-gray-50 text-gray-600 border-gray-100"
                    )}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </Modal>

      {profile?.role === 'admin' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Recent Activity</h3>
            <Link to="/transactions" className="text-xs font-bold text-blue-600">View All</Link>
          </div>
          <div className="space-y-3">
            {transactions.slice(0, 3).map((t) => {
              const item = items.find(i => i.id === t.itemId);
              return (
                <div key={t.id} className="flex items-center space-x-3 p-3 bg-white border border-gray-50 rounded-xl">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0",
                    t.type === 'delivery' ? "bg-blue-600" : 
                    t.type === 'usage' ? "bg-orange-600" : 
                    t.type === 'return' ? "bg-green-600" : "bg-gray-900"
                  )}>
                    {t.type === 'delivery' ? <Truck size={16} /> : 
                     t.type === 'usage' ? <Wrench size={16} /> : 
                     t.type === 'return' ? <ArrowLeftRight size={16} /> : <History size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">
                      {item?.name}
                    </p>
                    <div className="flex items-center space-x-1">
                      <p className="text-[10px] text-gray-500 font-medium uppercase">
                        {t.type}
                        {t.serialNumber && <span className="ml-1 text-blue-500 font-black">SN: {t.serialNumber}</span>}
                        {t.propertyNumber && <span className="ml-1 text-purple-600 font-black uppercase text-[8px]">PN: {t.propertyNumber}</span>}
                      </p>
                      {t.userName && (
                        <>
                          <span className="text-gray-300 text-[8px]">•</span>
                          <span className="text-[10px] font-bold text-gray-400">{t.userName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-gray-900">{t.quantity} <span className="text-[10px] font-bold text-gray-400 uppercase">{uoms.find(u => u.id === item?.uomId || u.symbol === item?.uomId)?.symbol || item?.uomId}</span></p>
                  </div>
                </div>
              );
            })}
            {transactions.length === 0 && (
              <p className="text-xs text-center py-8 text-gray-400 font-bold italic uppercase tracking-widest">No recent transfers</p>
            )}
          </div>
        </section>
      )}

      {profile?.role === 'admin' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Quick Actions</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center space-x-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="text-blue-600" size={20} />
              <span className="text-sm font-bold text-gray-700">Add Item</span>
            </button>
            <button 
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center space-x-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-95 transition-transform"
            >
              <ArrowLeftRight className="text-orange-600" size={20} />
              <span className="text-sm font-bold text-gray-700">Transfer</span>
            </button>
          </div>
        </section>
      )}

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="New Inventory Item">
        <ItemForm 
          uoms={uoms} 
          categories={categories} 
          locations={locations}
          items={items}
          onComplete={() => {
            console.log('ItemForm onComplete called in Dashboard');
            setIsAddModalOpen(false);
          }} 
        />
      </Modal>

      <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Quick Transfer">
        <TransactionForm 
          items={items} 
          locations={locations} 
          uoms={uoms}
          inventory={inventory}
          purchaseOrders={purchaseOrders}
          profile={profile}
          onComplete={() => setIsTransferModalOpen(false)} 
        />
      </Modal>
    </div>
  );
};
