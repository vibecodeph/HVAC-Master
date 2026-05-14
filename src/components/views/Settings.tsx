import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Package, Filter, MapPin, Box, Users, Shield, Trash2, AlertCircle, Loader2, Check, LogOut, Hammer, UserCheck, Tag, Archive, Database, RotateCcw, Download, Upload } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { clearInventoryData, updateSystemConfig } from '../../services/inventoryService';
import { downloadBackup, restoreFromBackup, validateBackup, backupUndeliveredRequests, restoreUndeliveredRequests, validateUndeliveredRequestsBackup, UndeliveredRequestsBackup } from '../../services/backupService';
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

  // Backup & restore state
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: 'success' | 'error' | 'progress'; text: string } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Requests backup & restore state
  const [isBackingUpRequests, setIsBackingUpRequests] = useState(false);
  const [isRestoringRequests, setIsRestoringRequests] = useState(false);
  const [requestsBackupMsg, setRequestsBackupMsg] = useState<{ type: 'success' | 'error' | 'progress'; text: string } | null>(null);
  const [requestsRestoreFile, setRequestsRestoreFile] = useState<File | null>(null);
  const [requestsRestoreParsed, setRequestsRestoreParsed] = useState<UndeliveredRequestsBackup | null>(null);
  const [showRequestsRestoreConfirm, setShowRequestsRestoreConfirm] = useState(false);
  const [requestsRestoreLocOptions, setRequestsRestoreLocOptions] = useState<{ id: string; name: string; count: number }[]>([]);
  const [requestsRestoreSelectedLocs, setRequestsRestoreSelectedLocs] = useState<Set<string>>(new Set());
  const requestsRestoreInputRef = useRef<HTMLInputElement>(null);

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

  const handleToggleAutoApprove = async () => {
    try {
      setIsUpdatingConfig(true);
      await updateSystemConfig({ autoApproveNewUsers: !systemConfig?.autoApproveNewUsers });
      setStatusMessage({ type: 'success', text: `Auto-approve new users ${!systemConfig?.autoApproveNewUsers ? 'enabled' : 'disabled'}.` });
    } catch (error) {
      console.error('Failed to update config:', error);
      setStatusMessage({ type: 'error', text: 'Failed to update auto-approve setting.' });
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleDownloadBackup = async () => {
    setIsBackingUp(true);
    setBackupMsg({ type: 'progress', text: 'Starting backup…' });
    try {
      await downloadBackup((msg, current, total) => {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        setBackupMsg({ type: 'progress', text: `${msg} (${pct}%)` });
      });
      setBackupMsg({ type: 'success', text: 'Backup downloaded successfully.' });
    } catch (err) {
      console.error('Backup failed:', err);
      setBackupMsg({ type: 'error', text: 'Backup failed. Please try again.' });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);
    setShowRestoreConfirm(true);
    e.target.value = ''; // allow re-selecting same file
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile) return;
    setShowRestoreConfirm(false);
    setIsRestoring(true);
    setBackupMsg({ type: 'progress', text: 'Reading backup file…' });
    try {
      const text = await restoreFile.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setBackupMsg({ type: 'error', text: 'File is not valid JSON.' });
        setIsRestoring(false);
        setRestoreFile(null);
        return;
      }
      if (!validateBackup(parsed)) {
        setBackupMsg({ type: 'error', text: 'Invalid backup format. Missing required fields.' });
        setIsRestoring(false);
        setRestoreFile(null);
        return;
      }
      await restoreFromBackup(
        parsed,
        (msg, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setBackupMsg({ type: 'progress', text: `${msg} (${pct}%)` });
        },
        profile?.uid,
      );
      setBackupMsg({ type: 'success', text: 'Restore completed successfully.' });
    } catch (err) {
      console.error('Restore failed:', err);
      setBackupMsg({ type: 'error', text: 'Restore failed. The database may be in an inconsistent state — restore again from backup.' });
    } finally {
      setIsRestoring(false);
      setRestoreFile(null);
    }
  };

  const handleDownloadRequestsBackup = async () => {
    setIsBackingUpRequests(true);
    setRequestsBackupMsg({ type: 'progress', text: 'Fetching pending/approved requests…' });
    try {
      await backupUndeliveredRequests();
      setRequestsBackupMsg({ type: 'success', text: 'Requests backup downloaded.' });
    } catch (err) {
      console.error('Requests backup failed:', err);
      setRequestsBackupMsg({ type: 'error', text: 'Backup failed. Please try again.' });
    } finally {
      setIsBackingUpRequests(false);
    }
  };

  const handleRequestsRestoreFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setRequestsBackupMsg({ type: 'error', text: 'File is not valid JSON.' });
      return;
    }
    if (!validateUndeliveredRequestsBackup(parsed)) {
      setRequestsBackupMsg({ type: 'error', text: 'Invalid format — not an undelivered requests backup.' });
      return;
    }
    // Build per-location counts from the parsed requests
    const locCountMap = new Map<string, number>();
    for (const req of parsed.requests) {
      const lid = (req as any).jobsiteId as string | undefined;
      if (lid) locCountMap.set(lid, (locCountMap.get(lid) ?? 0) + 1);
    }
    const locOptions = Array.from(locCountMap.entries()).map(([id, count]) => ({
      id,
      name: locations.find(l => l.id === id)?.name ?? id,
      count,
    }));
    setRequestsRestoreLocOptions(locOptions);
    setRequestsRestoreSelectedLocs(new Set(locCountMap.keys()));
    setRequestsRestoreFile(file);
    setRequestsRestoreParsed(parsed);
    setShowRequestsRestoreConfirm(true);
  };

  const handleRequestsRestoreConfirm = async () => {
    if (!requestsRestoreParsed) return;
    setShowRequestsRestoreConfirm(false);
    setIsRestoringRequests(true);
    setRequestsBackupMsg({ type: 'progress', text: 'Restoring requests…' });
    try {
      const filteredRequests = requestsRestoreParsed.requests.filter(
        (r: any) => requestsRestoreSelectedLocs.has(r.jobsiteId)
      );
      const filteredBackup = { ...requestsRestoreParsed, requests: filteredRequests, totalRequests: filteredRequests.length };
      await restoreUndeliveredRequests(filteredBackup, (msg) => {
        setRequestsBackupMsg({ type: 'progress', text: msg });
      });
      setRequestsBackupMsg({ type: 'success', text: `${filteredRequests.length} request(s) restored successfully.` });
    } catch (err) {
      console.error('Requests restore failed:', err);
      setRequestsBackupMsg({ type: 'error', text: 'Restore failed. Please try again.' });
    } finally {
      setIsRestoringRequests(false);
      setRequestsRestoreFile(null);
      setRequestsRestoreParsed(null);
      setRequestsRestoreLocOptions([]);
      setRequestsRestoreSelectedLocs(new Set());
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
                { label: 'Supplier Pricing', icon: Tag, path: '/settings/manage/supplier-pricing' },
                { label: 'Archived Requests', icon: Archive, path: '/settings/manage/archived-requests' },
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
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Debug & Troubleshooting</h3>
            <Card className="divide-y divide-gray-100">
              {[
                { label: 'Requests Manager', icon: Database, path: '/settings/manage/requests' },
                { label: 'Transactions Manager', icon: Database, path: '/settings/manage/transactions' },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => navigate(item.path)}
                  className="w-full p-4 flex items-center justify-between active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <item.icon size={18} className="text-amber-500" />
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

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    systemConfig?.autoApproveNewUsers ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                  )}>
                    <UserCheck size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Auto-Approve New Users</p>
                    <p className="text-[10px] text-gray-500 font-medium">Skip approval for new sign-ups</p>
                  </div>
                </div>
                <button
                  disabled={isUpdatingConfig}
                  onClick={handleToggleAutoApprove}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    systemConfig?.autoApproveNewUsers ? "bg-green-500" : "bg-gray-200",
                    isUpdatingConfig && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                    systemConfig?.autoApproveNewUsers ? "left-7" : "left-1"
                  )} />
                </button>
              </div>
            </Card>
          </div>
        )}

        {profile?.role === 'admin' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Backup & Restore</h3>
            <Card className="p-4 space-y-3">
              <p className="text-[10px] text-gray-500 font-medium leading-snug">
                Backup saves all Firestore collections to a JSON file. Restore overwrites all data — it is not atomic; if it fails partway, restore again from the same file.
              </p>

              {backupMsg && (
                <div className={cn(
                  'p-3 rounded-xl text-xs font-bold flex items-center gap-2',
                  backupMsg.type === 'success' && 'bg-green-100 text-green-700',
                  backupMsg.type === 'error'   && 'bg-red-100 text-red-700',
                  backupMsg.type === 'progress' && 'bg-blue-50 text-blue-700',
                )}>
                  {backupMsg.type === 'progress' && <Loader2 size={14} className="animate-spin shrink-0" />}
                  {backupMsg.type === 'success'  && <Check size={14} className="shrink-0" />}
                  {backupMsg.type === 'error'    && <AlertCircle size={14} className="shrink-0" />}
                  <span>{backupMsg.text}</span>
                </div>
              )}

              <button
                onClick={handleDownloadBackup}
                disabled={isBackingUp || isRestoring}
                className={cn(
                  'w-full py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform',
                  (isBackingUp || isRestoring) && 'opacity-60 cursor-not-allowed',
                )}
              >
                {isBackingUp ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                <span>{isBackingUp ? 'Creating Backup…' : 'Download Backup'}</span>
              </button>

              <input
                ref={restoreInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleRestoreFileSelect}
              />
              <button
                onClick={() => restoreInputRef.current?.click()}
                disabled={isBackingUp || isRestoring}
                className={cn(
                  'w-full py-3 bg-amber-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform',
                  (isBackingUp || isRestoring) && 'opacity-60 cursor-not-allowed',
                )}
              >
                {isRestoring ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                <span>{isRestoring ? 'Restoring…' : 'Restore from Backup'}</span>
              </button>
            </Card>
          </div>
        )}

        {profile?.role === 'admin' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Requests Backup</h3>
            <Card className="p-4 space-y-3">
              <p className="text-[10px] text-gray-500 font-medium leading-snug">
                Backup and restore only pending and approved requests. Use this before clearing a location to preserve undelivered work orders.
              </p>

              {requestsBackupMsg && (
                <div className={cn(
                  'p-3 rounded-xl text-xs font-bold flex items-center gap-2',
                  requestsBackupMsg.type === 'success' && 'bg-green-100 text-green-700',
                  requestsBackupMsg.type === 'error'   && 'bg-red-100 text-red-700',
                  requestsBackupMsg.type === 'progress' && 'bg-blue-50 text-blue-700',
                )}>
                  {requestsBackupMsg.type === 'progress' && <Loader2 size={14} className="animate-spin shrink-0" />}
                  {requestsBackupMsg.type === 'success'  && <Check size={14} className="shrink-0" />}
                  {requestsBackupMsg.type === 'error'    && <AlertCircle size={14} className="shrink-0" />}
                  <span>{requestsBackupMsg.text}</span>
                </div>
              )}

              <button
                onClick={handleDownloadRequestsBackup}
                disabled={isBackingUpRequests || isRestoringRequests}
                className={cn(
                  'w-full py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform',
                  (isBackingUpRequests || isRestoringRequests) && 'opacity-60 cursor-not-allowed',
                )}
              >
                {isBackingUpRequests ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                <span>{isBackingUpRequests ? 'Backing Up…' : 'Download Requests Backup'}</span>
              </button>

              <input
                ref={requestsRestoreInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleRequestsRestoreFileSelect}
              />
              <button
                onClick={() => requestsRestoreInputRef.current?.click()}
                disabled={isBackingUpRequests || isRestoringRequests}
                className={cn(
                  'w-full py-3 bg-amber-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform',
                  (isBackingUpRequests || isRestoringRequests) && 'opacity-60 cursor-not-allowed',
                )}
              >
                {isRestoringRequests ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                <span>{isRestoringRequests ? 'Restoring…' : 'Restore Requests'}</span>
              </button>
            </Card>
          </div>
        )}

        {profile?.role === 'admin' && (
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
                onClick={() => navigate('/settings/manage/clear-location')}
                className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold flex items-center justify-center space-x-2 active:scale-95 transition-transform mb-2"
              >
                <RotateCcw size={18} />
                <span>Clear Location Inventory</span>
              </button>
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
          isOpen={showRestoreConfirm}
          onClose={() => { setShowRestoreConfirm(false); setRestoreFile(null); }}
          title="Restore Database"
        >
          <div className="space-y-4">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex items-start gap-3">
              <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-900">This will overwrite ALL data!</p>
                <p className="text-xs text-red-700 font-medium leading-relaxed">
                  Every document in every collection will be deleted and replaced with the backup contents.
                  This cannot be undone. The operation is not atomic — if it fails midway, restore again from the same file.
                </p>
              </div>
            </div>
            {restoreFile && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                <p className="text-xs font-bold text-gray-700">{restoreFile.name}</p>
                <p className="text-[10px] text-gray-500">{(restoreFile.size / 1024).toFixed(1)} KB</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleRestoreConfirm}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform shadow-lg shadow-red-200"
              >
                Yes, Overwrite All Data
              </button>
              <button
                onClick={() => { setShowRestoreConfirm(false); setRestoreFile(null); }}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={showRequestsRestoreConfirm}
          onClose={() => { setShowRequestsRestoreConfirm(false); setRequestsRestoreFile(null); setRequestsRestoreParsed(null); setRequestsRestoreLocOptions([]); setRequestsRestoreSelectedLocs(new Set()); }}
          title="Restore Requests"
        >
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
              <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <p className="text-sm font-bold text-amber-900">Existing requests with the same IDs will be overwritten.</p>
                <p className="text-xs text-amber-700 font-medium leading-relaxed">
                  Only requests for the selected locations will be restored. Other requests in the database are not affected.
                </p>
              </div>
            </div>

            {requestsRestoreFile && requestsRestoreParsed && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
                <p className="text-xs font-bold text-gray-700">{requestsRestoreFile.name}</p>
                <p className="text-[10px] text-gray-500">{(requestsRestoreFile.size / 1024).toFixed(1)} KB &middot; {requestsRestoreParsed.totalRequests} request(s)</p>
                <p className="text-[10px] text-gray-400">Backed up: {new Date(requestsRestoreParsed.timestamp).toLocaleString()}</p>
              </div>
            )}

            {requestsRestoreLocOptions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-bold text-gray-600 uppercase tracking-widest">Locations</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setRequestsRestoreSelectedLocs(new Set(requestsRestoreLocOptions.map(l => l.id)))}
                      className="text-[10px] font-bold text-blue-600 active:opacity-60"
                    >All</button>
                    <button
                      onClick={() => setRequestsRestoreSelectedLocs(new Set())}
                      className="text-[10px] font-bold text-gray-400 active:opacity-60"
                    >None</button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden">
                  {requestsRestoreLocOptions.map(loc => (
                    <label key={loc.id} className="flex items-center gap-3 px-3 py-2.5 bg-white cursor-pointer active:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={requestsRestoreSelectedLocs.has(loc.id)}
                        onChange={(e) => {
                          const next = new Set(requestsRestoreSelectedLocs);
                          e.target.checked ? next.add(loc.id) : next.delete(loc.id);
                          setRequestsRestoreSelectedLocs(next);
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="flex-1 text-xs font-bold text-gray-800">{loc.name}</span>
                      <span className="text-[10px] font-bold text-gray-400">{loc.count} req</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 px-1">
                  {requestsRestoreSelectedLocs.size === 0
                    ? 'No locations selected — nothing will be restored.'
                    : `${requestsRestoreParsed?.requests.filter((r: any) => requestsRestoreSelectedLocs.has(r.jobsiteId)).length ?? 0} of ${requestsRestoreParsed?.totalRequests} request(s) will be restored.`
                  }
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleRequestsRestoreConfirm}
                disabled={requestsRestoreSelectedLocs.size === 0}
                className={cn(
                  'w-full py-4 bg-amber-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform shadow-lg shadow-amber-200',
                  requestsRestoreSelectedLocs.size === 0 && 'opacity-40 cursor-not-allowed',
                )}
              >
                Yes, Restore Requests
              </button>
              <button
                onClick={() => { setShowRequestsRestoreConfirm(false); setRequestsRestoreFile(null); setRequestsRestoreParsed(null); setRequestsRestoreLocOptions([]); setRequestsRestoreSelectedLocs(new Set()); }}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>

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
