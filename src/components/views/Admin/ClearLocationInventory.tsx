import React, { useState, useMemo } from 'react';
import { AlertTriangle, Check, Loader2, MapPin, AlertCircle, ChevronDown } from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { clearLocationInventory } from '../../../services/inventoryService';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';

export const ClearLocationInventoryView = () => {
  const { profile } = useAuth();
  const { locations, inventory } = useData();

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ itemsCleared: number; boqCleared: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const jobsites = useMemo(
    () => locations.filter(l => l.type === 'jobsite' && l.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  const mainWarehouse = useMemo(
    () => locations.find(l => l.type === 'warehouse' && !l.parentId),
    [locations]
  );

  const selectedLocation = useMemo(
    () => locations.find(l => l.id === selectedLocationId),
    [locations, selectedLocationId]
  );

  const itemCountAtLocation = useMemo(
    () => inventory.filter(inv => inv.locationId === selectedLocationId && (inv.quantity || 0) > 0).length,
    [inventory, selectedLocationId]
  );

  const handleClear = async () => {
    if (!selectedLocation || !mainWarehouse || !profile) return;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const res = await clearLocationInventory(
        selectedLocation.id,
        selectedLocation.name,
        mainWarehouse.id,
        profile.uid,
        profile.displayName || profile.email || 'Admin'
      );
      setResult(res);
      setIsConfirming(false);
      setSelectedLocationId('');
    } catch (error) {
      console.error('Failed to clear location inventory:', error);
      setErrorMsg('Failed to clear inventory. Please check your connection and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pb-20">
      <Header title="Clear Location Inventory" showBack />
      <div className="p-4 space-y-5">

        {result && (
          <div className="p-4 bg-green-50 rounded-2xl border border-green-100 flex items-start space-x-3">
            <Check size={20} className="text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-green-900">Inventory cleared successfully</p>
              <p className="text-xs text-green-700 font-medium mt-1">
                {result.itemsCleared} item{result.itemsCleared !== 1 ? 's' : ''} returned to{' '}
                {mainWarehouse?.name || 'Main Warehouse'}.
                {result.boqCleared > 0 && ` ${result.boqCleared} BOQ record${result.boqCleared !== 1 ? 's' : ''} deleted.`}
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex items-start space-x-3">
            <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-900">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600">
              <AlertCircle size={16} />
            </button>
          </div>
        )}

        <Card className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
              Select Location
            </label>
            <div className="relative">
              <select
                value={selectedLocationId}
                onChange={e => {
                  setSelectedLocationId(e.target.value);
                  setIsConfirming(false);
                  setErrorMsg(null);
                  setResult(null);
                }}
                disabled={isProcessing}
                className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="">— Choose a jobsite —</option>
                {jobsites.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            {jobsites.length === 0 && (
              <p className="text-xs text-gray-400 font-medium mt-2">No active jobsites found.</p>
            )}
          </div>

          {selectedLocation && (
            <div className="p-4 bg-gray-50 rounded-xl space-y-2">
              <div className="flex items-center space-x-2">
                <MapPin size={16} className="text-gray-400" />
                <span className="text-sm font-bold text-gray-900">{selectedLocation.name}</span>
              </div>
              <p className="text-xs text-gray-500 font-medium">
                {itemCountAtLocation} active inventory line{itemCountAtLocation !== 1 ? 's' : ''} will be returned to{' '}
                <span className="font-bold text-gray-700">{mainWarehouse?.name || 'Main Warehouse'}</span>.
              </p>
            </div>
          )}
        </Card>

        {selectedLocation && !isConfirming && !result && (
          <button
            onClick={() => setIsConfirming(true)}
            disabled={isProcessing}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-bold flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-50"
          >
            <AlertTriangle size={18} />
            <span>Clear &amp; Return to Warehouse</span>
          </button>
        )}

        {isConfirming && !result && (
          <Card className="p-4 bg-red-50 border-red-100 space-y-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-900">This cannot be undone</p>
                <p className="text-xs text-red-700 font-medium leading-relaxed">
                  All <span className="font-black">{itemCountAtLocation}</span> item
                  {itemCountAtLocation !== 1 ? 's' : ''} at{' '}
                  <span className="font-black">{selectedLocation.name}</span> will be deleted
                  and returned to <span className="font-black">{mainWarehouse?.name || 'Main Warehouse'}</span>.
                  All BOQ records for this location will also be deleted.
                </p>
              </div>
            </div>

            <div className="flex flex-col space-y-2">
              <button
                onClick={handleClear}
                disabled={isProcessing}
                className={cn(
                  'w-full py-3 bg-red-600 text-white rounded-xl font-bold flex items-center justify-center space-x-2 active:scale-95 transition-transform',
                  isProcessing && 'opacity-70 cursor-not-allowed'
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Clearing...</span>
                  </>
                ) : (
                  <span>Yes, Clear Location</span>
                )}
              </button>
              <button
                onClick={() => setIsConfirming(false)}
                disabled={isProcessing}
                className="w-full py-3 bg-gray-100 text-gray-600 rounded-xl font-bold active:scale-95 transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
