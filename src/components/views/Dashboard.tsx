import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Package, ArrowDown, MapPin, Layers, Truck, Wrench, ArrowLeftRight, History, Plus } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { useIsMobile, useSidebar } from '../../hooks/useApp';
import { cn } from '../../lib/utils';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';
import { ItemForm, TransactionForm } from '../Forms';

export const Dashboard = () => {
  const { profile } = useAuth();
  const { items, inventory, transactions, uoms, categories, locations, assets, purchaseOrders } = useData();
  const { openSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isLocationSelectOpen, setIsLocationSelectOpen] = useState(false);
  
  // Default location for value card
  const initialLocationId = (() => {
    if (profile && profile.role !== 'admin' && profile.assignedLocationIds?.length) {
      // Find first active location in assigned locations
      const assignedLocs = locations.filter(l => 
        l.isActive && 
        profile.assignedLocationIds?.includes(l.id)
      );
      return assignedLocs[0]?.id || profile.assignedLocationIds[0] || 'all';
    }
    return 'all';
  })();

  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId);

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
            const filteredLocs = locations.filter(l => {
              if (!l.isActive) return false;
              if (l.type !== type) return false;
              if (profile && profile.role !== 'admin') {
                return profile.assignedLocationIds?.includes(l.id);
              }
              return true;
            });

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

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Quick Actions</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {profile?.role === 'admin' && (
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center space-x-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="text-blue-600" size={20} />
              <span className="text-sm font-bold text-gray-700">Add Item</span>
            </button>
          )}
          <button 
            onClick={() => setIsTransferModalOpen(true)}
            className={cn(
              "flex items-center space-x-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-95 transition-transform",
              profile?.role !== 'admin' && "col-span-2"
            )}
          >
            <ArrowLeftRight className="text-orange-600" size={20} />
            <span className="text-sm font-bold text-gray-700">Transfer</span>
          </button>
        </div>
      </section>

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
