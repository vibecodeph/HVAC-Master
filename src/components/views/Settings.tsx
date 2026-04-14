import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Package, Filter, MapPin, Box, Users, Shield, Trash2, AlertCircle, Loader2, Check, LogOut, Hammer } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { clearInventoryData, updateSystemConfig } from '../../services/inventoryService';
import { cn } from '../../lib/utils';
import { Header } from '../common/Header';
import { Card } from '../common/Card';
import { Modal } from '../common/Modal';

export const SettingsView = () => {
  const { profile, logout } = useAuth();
  const { locations, systemConfig } = useData();
  const navigate = useNavigate();
  const [isClearingData, setIsClearingData] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [includeBOQ, setIncludeBOQ] = useState(false);
  const [includePOs, setIncludePOs] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const assignedLocations = locations.filter(l => profile?.assignedLocationIds?.includes(l.id));

  const handleClearData = async () => {
    try {
      setIsClearingData(true);
      setIsConfirmModalOpen(false);
      await clearInventoryData(includeBOQ, includePOs);
      setStatusMessage({ type: 'success', text: 'Data cleared successfully.' });
    } catch (error) {
      console.error('Failed to clear data:', error);
      setStatusMessage({ type: 'error', text: 'Failed to clear data. Please check console for details.' });
    } finally {
      setIsClearingData(false);
    }
  };

  const handleToggleMaintenance = async () => {
    try {
      setIsUpdatingConfig(true);
      await updateSystemConfig({
        maintenanceMode: !systemConfig?.maintenanceMode,
        maintenanceMessage: "We're currently performing some scheduled maintenance to improve your experience. We'll be back online shortly."
      });
      setStatusMessage({ type: 'success', text: `Maintenance mode ${!systemConfig?.maintenanceMode ? 'enabled' : 'disabled'}.` });
    } catch (error) {
      console.error('Failed to update config:', error);
      setStatusMessage({ type: 'error', text: 'Failed to update maintenance mode.' });
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  return (
    <div className="pb-20">
      <Header title="Settings" />
      <div className="p-4 space-y-6">
        <button 
          onClick={() => navigate('/profile')}
          className="w-full flex items-center space-x-4 p-4 bg-gray-50 rounded-3xl active:bg-gray-100 transition-colors text-left"
        >
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-black shrink-0 overflow-hidden">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              profile?.displayName?.[0] || profile?.email?.[0]?.toUpperCase() || '?'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900">{profile?.displayName || 'User'}</h3>
            <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">{profile?.role?.replace('_', ' ')}</p>
            {assignedLocations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {assignedLocations.map(loc => (
                  <span key={loc.id} className="text-[8px] font-black bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded uppercase tracking-widest">
                    {loc.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <ChevronRight size={20} className="text-gray-300" />
        </button>

        {profile?.role === 'admin' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Management</h3>
            <Card className="divide-y divide-gray-100">
              {[
                { label: 'Item Management', icon: Package, path: '/settings/manage/items' },
                { label: 'Categories & Subcategories', icon: Filter, path: '/settings/manage/metadata/categories' },
                { label: 'Locations & Sublocations', icon: MapPin, path: '/settings/manage/metadata/locations' },
                { label: 'Units of Measure (UOM)', icon: Box, path: '/settings/manage/metadata/uoms' },
                { label: 'Tags Management', icon: Filter, path: '/settings/manage/metadata/tags' },
                { label: 'User Management', icon: Users, path: '/settings/manage/users' },
                { label: 'Role-Based Access Control', icon: Shield, path: '/settings/manage/rbac' },
              ].map((item) => (
                <button 
                  key={item.label} 
                  onClick={() => navigate(item.path)}
                  className="w-full p-4 flex items-center justify-between active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <item.icon size={18} className="text-gray-400" />
                    <span className="text-sm font-bold text-gray-700">{item.label}</span>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ))}
            </Card>
          </div>
        )}

        {profile?.role === 'admin' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">System Settings</h3>
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    systemConfig?.maintenanceMode ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                  )}>
                    <Hammer size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Maintenance Mode</p>
                    <p className="text-[10px] text-gray-500 font-medium">Restrict access for non-admins</p>
                  </div>
                </div>
                <button 
                  disabled={isUpdatingConfig}
                  onClick={handleToggleMaintenance}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    systemConfig?.maintenanceMode ? "bg-blue-600" : "bg-gray-200",
                    isUpdatingConfig && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                    systemConfig?.maintenanceMode ? "left-7" : "left-1"
                  )} />
                </button>
              </div>
            </Card>
          </div>
        )}

        {profile?.role === 'admin' && profile?.email === 'vibecodeph@gmail.com' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest px-2">Danger Zone</h3>
            <Card className="p-4 bg-red-50 border-red-100">
              {statusMessage && (
                <div className={cn(
                  "mb-4 p-3 rounded-xl text-xs font-bold flex items-center space-x-2",
                  statusMessage.type === 'success' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  {statusMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                  <span>{statusMessage.text}</span>
                </div>
              )}
              <button 
                disabled={isClearingData}
                onClick={() => setIsConfirmModalOpen(true)}
                className={cn(
                  "w-full py-3 bg-red-600 text-white rounded-xl font-bold flex items-center justify-center space-x-2 active:scale-95 transition-transform",
                  isClearingData && "opacity-70 cursor-not-allowed"
                )}
              >
                {isClearingData ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Clearing Data...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={18} />
                    <span>Clear All Inventory Data</span>
                  </>
                )}
              </button>
            </Card>
          </div>
        )}

        <Modal 
          isOpen={isConfirmModalOpen} 
          onClose={() => setIsConfirmModalOpen(false)} 
          title="Confirm Data Deletion"
        >
          <div className="space-y-4">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex items-start space-x-3">
              <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-900">This action is irreversible!</p>
                <p className="text-xs text-red-700 font-medium leading-relaxed">
                  You are about to delete all records in the inventory, requests, and transactions collections. 
                  All item stock levels will be reset to zero.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={includeBOQ}
                  onChange={(e) => setIncludeBOQ(e.target.checked)}
                  className="w-5 h-5 rounded-lg border-gray-300 text-red-600 focus:ring-red-500"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">Include BOQ Data</p>
                  <p className="text-[10px] text-gray-500 font-medium leading-tight">
                    Check this if you also want to delete the Bill of Quantities for all jobsites.
                  </p>
                </div>
              </label>

              <label className="flex items-center space-x-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={includePOs}
                  onChange={(e) => setIncludePOs(e.target.checked)}
                  className="w-5 h-5 rounded-lg border-gray-300 text-red-600 focus:ring-red-500"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">Delete Purchase Orders</p>
                  <p className="text-[10px] text-gray-500 font-medium leading-tight">
                    If unchecked, POs will be kept but reset to "undelivered" status.
                  </p>
                </div>
              </label>
            </div>
            
            <div className="flex flex-col space-y-2">
              <button 
                onClick={handleClearData}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform shadow-lg shadow-red-200"
              >
                Yes, Delete Everything
              </button>
              <button 
                onClick={() => setIsConfirmModalOpen(false)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};
