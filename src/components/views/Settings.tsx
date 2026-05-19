import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Package, Filter, MapPin, Box, Users, Shield, Trash2, AlertCircle, Loader2, Check, LogOut, Hammer, UserCheck, Tag, Archive, Database, RotateCcw, Download, Upload } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { useAuth, useData } from '../../App';
import { functions } from '../../firebase';
import { clearInventoryData, updateSystemConfig, migratePriceHistoryToCollection } from '../../services/inventoryService';
import { getActiveOperations, ActiveOperationDoc, ActiveOperationType } from '../../services/activeOperationService';
import { downloadBackup, restoreFromBackup, validateBackup, backupUndeliveredRequests, restoreUndeliveredRequests, validateUndeliveredRequestsBackup, UndeliveredRequestsBackup } from '../../services/backupService';
import { exportMetadata, importMetadata, validateMetadataExport, analyzeImport, METADATA_COLLECTIONS, COLLECTION_LABELS, MetadataCollection, MetadataExport, CollectionAnalysis } from '../../services/metadataService';
import { cn } from '../../lib/utils';
import { Modal } from '../common/Modal';

export const SettingsView = () => {
  const { profile, logout, isOnline } = useAuth();
  const { locations, systemConfig } = useData();
  const navigate = useNavigate();
  const [isClearingData, setIsClearingData] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [includeBOQ, setIncludeBOQ] = useState(false);
  const [includePOs, setIncludePOs] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Price history migration state
  const [isMigratingPH, setIsMigratingPH] = useState(false);
  const [phMigrateMsg, setPhMigrateMsg] = useState<{ type: 'success' | 'error' | 'progress'; text: string } | null>(null);
  const [phCopied, setPhCopied] = useState(false);

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

  // Force sign out state
  const [isCheckingOps, setIsCheckingOps] = useState(false);
  const [isForceSigningOut, setIsForceSigningOut] = useState(false);
  const [activeOpsWarning, setActiveOpsWarning] = useState<ActiveOperationDoc[] | null>(null);
  const [forceSignOutMsg, setForceSignOutMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Metadata management state
  const [metaExportSelected, setMetaExportSelected] = useState<Set<MetadataCollection>>(new Set(METADATA_COLLECTIONS));
  const [isExportingMeta, setIsExportingMeta] = useState(false);
  const [isImportingMeta, setIsImportingMeta] = useState(false);
  const [metaMsg, setMetaMsg] = useState<{ type: 'success' | 'error' | 'progress'; text: string } | null>(null);
  const [metaImportParsed, setMetaImportParsed] = useState<MetadataExport | null>(null);
  const [metaImportFile, setMetaImportFile] = useState<File | null>(null);
  const [metaImportSelected, setMetaImportSelected] = useState<Set<MetadataCollection>>(new Set());
  const [metaImportAnalysis, setMetaImportAnalysis] = useState<Record<string, CollectionAnalysis>>({});
  const [metaMergeMode, setMetaMergeMode] = useState(true);
  const [showMetaImportConfirm, setShowMetaImportConfirm] = useState(false);
  const metaImportInputRef = useRef<HTMLInputElement>(null);

  const assignedLocations = locations.filter(l => profile?.assignedLocationIds?.includes(l.id));

  const opTypeLabel = (op: ActiveOperationType): string => {
    if (op === 'bulk_receive') return 'Bulk Receive';
    if (op === 'bulk_pick') return 'Bulk Pick';
    if (op === 'approve_requests') return 'Approve Requests';
    return op;
  };

  const handleForceSignOut = async () => {
    setIsForceSigningOut(true);
    setActiveOpsWarning(null);
    setForceSignOutMsg(null);
    try {
      const fn = httpsCallable<object, { revokedCount: number }>(functions, 'forceSignOutAllUsers');
      const result = await fn({});
      setForceSignOutMsg({ type: 'success', text: `Signed out ${result.data.revokedCount} user(s). Active sessions will expire shortly.` });
    } catch (err) {
      console.error('Force sign out failed:', err);
      setForceSignOutMsg({ type: 'error', text: 'Failed to force sign out users.' });
    } finally {
      setIsForceSigningOut(false);
    }
  };

  const handleForceSignOutCheck = async () => {
    setIsCheckingOps(true);
    setActiveOpsWarning(null);
    setForceSignOutMsg(null);
    try {
      const ops = await getActiveOperations();
      if (ops.length === 0) {
        await handleForceSignOut();
      } else {
        setActiveOpsWarning(ops);
        setIsCheckingOps(false);
      }
    } catch (err) {
      console.error('Failed to check active operations:', err);
      setForceSignOutMsg({ type: 'error', text: 'Failed to check active operations.' });
      setIsCheckingOps(false);
    }
  };

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

  const handleMigratePriceHistory = async (phase: 'copy' | 'cleanup') => {
    setIsMigratingPH(true);
    setPhMigrateMsg({ type: 'progress', text: phase === 'copy' ? 'Copying price history to collection…' : 'Removing old arrays from item docs…' });
    try {
      const result = await migratePriceHistoryToCollection(phase);
      if (phase === 'copy') {
        setPhMigrateMsg({ type: 'success', text: `Done — ${result.written} price history entries copied to price_history collection.` });
        setPhCopied(true);
      } else {
        setPhMigrateMsg({ type: 'success', text: `Done — ${result.updated} item docs cleaned up.` });
      }
    } catch (e: any) {
      setPhMigrateMsg({ type: 'error', text: e.message || 'Migration failed.' });
    } finally {
      setIsMigratingPH(false);
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

  const handleMetaExport = async () => {
    const selected = [...metaExportSelected] as MetadataCollection[];
    if (selected.length === 0) {
      setMetaMsg({ type: 'error', text: 'Select at least one collection to export.' });
      return;
    }
    setIsExportingMeta(true);
    setMetaMsg({ type: 'progress', text: 'Starting export…' });
    try {
      await exportMetadata(selected, msg => setMetaMsg({ type: 'progress', text: msg }));
      setMetaMsg({ type: 'success', text: 'Export complete — file downloaded.' });
    } catch (err) {
      console.error('Metadata export failed:', err);
      setMetaMsg({ type: 'error', text: 'Export failed. Please try again.' });
    } finally {
      setIsExportingMeta(false);
    }
  };

  const handleMetaImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMetaMsg({ type: 'error', text: 'File is not valid JSON.' });
      return;
    }
    if (!validateMetadataExport(parsed)) {
      setMetaMsg({ type: 'error', text: 'Invalid format — not a metadata export file.' });
      return;
    }
    const incomingCols = Object.keys(parsed.metadata) as MetadataCollection[];
    setMetaMsg({ type: 'progress', text: 'Analyzing existing records…' });
    try {
      const analysis = await analyzeImport(parsed, incomingCols);
      setMetaImportAnalysis(analysis);
      setMetaImportParsed(parsed);
      setMetaImportFile(file);
      setMetaImportSelected(new Set(incomingCols));
      setShowMetaImportConfirm(true);
      setMetaMsg(null);
    } catch (err) {
      console.error('Failed to analyze import:', err);
      setMetaMsg({ type: 'error', text: 'Could not read existing record counts. Please try again.' });
    }
  };

  const handleMetaImportConfirm = async () => {
    if (!metaImportParsed) return;
    setShowMetaImportConfirm(false);
    setIsImportingMeta(true);
    setMetaMsg({ type: 'progress', text: 'Importing…' });
    try {
      const { totalImported } = await importMetadata(
        metaImportParsed,
        [...metaImportSelected] as MetadataCollection[],
        metaMergeMode,
        msg => setMetaMsg({ type: 'progress', text: msg })
      );
      const modeLabel = metaMergeMode ? 'merged' : 'imported';
      setMetaMsg({ type: 'success', text: `${totalImported} records ${modeLabel} successfully.` });
    } catch (err) {
      console.error('Metadata import failed:', err);
      setMetaMsg({ type: 'error', text: 'Import failed. Some data may be in an inconsistent state — restore from backup if needed.' });
    } finally {
      setIsImportingMeta(false);
      setMetaImportParsed(null);
      setMetaImportFile(null);
    }
  };

  const resetMetaImportConfirm = () => {
    setShowMetaImportConfirm(false);
    setMetaImportParsed(null);
    setMetaImportFile(null);
    setMetaImportSelected(new Set());
    setMetaImportAnalysis({});
    setMetaMergeMode(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-900 pb-20">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-slate-500">Manage your HVAC field operations and system data.</p>
        </div>
        {systemConfig?.maintenanceMode && (
          <div className="flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 border border-blue-100">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Maintenance Mode Active</span>
          </div>
        )}
      </header>
      <div className="space-y-6">
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
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Management</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Item Management', desc: 'Add, edit, and organize inventory items', icon: Package, path: '/settings/manage/items' },
                { label: 'Categories', desc: 'Manage item categories and subcategories', icon: Filter, path: '/settings/manage/metadata/categories' },
                { label: 'Locations', desc: 'Warehouses, jobsites, and sublocations', icon: MapPin, path: '/settings/manage/metadata/locations' },
                { label: 'Units of Measure', desc: 'Configure measurement units and conversions', icon: Box, path: '/settings/manage/metadata/uoms' },
                { label: 'Tags', desc: 'Create and manage item classification tags', icon: Tag, path: '/settings/manage/metadata/tags' },
                { label: 'User Management', desc: 'Manage user accounts and access', icon: Users, path: '/settings/manage/users' },
                { label: 'Access Control', desc: 'Configure permissions by role', icon: Shield, path: '/settings/manage/rbac' },
                { label: 'Supplier Pricing', desc: 'Track and compare supplier prices', icon: Tag, path: '/settings/manage/supplier-pricing' },
                { label: 'Price Trends', desc: 'View item price history and trends', icon: Tag, path: '/settings/manage/price-trends' },
                { label: 'Archived Requests', desc: 'Browse completed and archived requests', icon: Archive, path: '/settings/manage/archived-requests' },
                { label: 'Requests Manager', desc: 'Debug and manage all field requests', icon: Database, path: '/settings/manage/requests' },
                { label: 'Transactions Manager', desc: 'Review and audit all transactions', icon: Database, path: '/settings/manage/transactions' },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => navigate(item.path)}
                  className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-500 hover:shadow-md text-left"
                >
                  <div className="rounded-lg bg-slate-100 p-2 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                    <item.icon size={18} />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {profile?.role === 'admin' && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
            {/* System Configuration */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="text-lg font-semibold mb-6">System Configuration</h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700">Maintenance Mode</p>
                    <p className="text-sm text-slate-500">Restrict access for non-admin users</p>
                  </div>
                  <button
                    disabled={isUpdatingConfig || !isOnline}
                    title={!isOnline ? 'You are offline' : undefined}
                    onClick={handleToggleMaintenance}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors relative shrink-0",
                      systemConfig?.maintenanceMode ? "bg-blue-600" : "bg-gray-200",
                      (isUpdatingConfig || !isOnline) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      systemConfig?.maintenanceMode ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700">Auto-Approve New Users</p>
                    <p className="text-sm text-slate-500">Skip approval for new sign-ups</p>
                  </div>
                  <button
                    disabled={isUpdatingConfig || !isOnline}
                    title={!isOnline ? 'You are offline' : undefined}
                    onClick={handleToggleAutoApprove}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors relative shrink-0",
                      systemConfig?.autoApproveNewUsers ? "bg-green-500" : "bg-gray-200",
                      (isUpdatingConfig || !isOnline) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      systemConfig?.autoApproveNewUsers ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
            </div>

          </section>
        )}

        {profile?.role === 'admin' && (
          <section className="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-800">Data Operations</h3>
            </div>

            <div className="p-6">
              {(backupMsg || requestsBackupMsg) && (
                <div className="mb-4 space-y-2">
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
                </div>
              )}

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                {/* System-Wide Backup */}
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">System-Wide Backup</h4>
                  <p className="text-sm text-slate-500 mb-4 font-light leading-relaxed">Complete Firestore backup and restoration. Ideal for full migrations.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadBackup}
                      disabled={isBackingUp || isRestoring}
                      className={cn(
                        'flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm flex items-center justify-center gap-1.5',
                        (isBackingUp || isRestoring) && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      {isBackingUp ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {isBackingUp ? 'Backing up…' : 'Download Full'}
                    </button>

                    <input ref={restoreInputRef} type="file" accept=".json" className="hidden" onChange={handleRestoreFileSelect} />
                    <button
                      onClick={() => restoreInputRef.current?.click()}
                      disabled={isBackingUp || isRestoring || !isOnline}
                      title={!isOnline ? 'You are offline' : undefined}
                      className={cn(
                        'flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5',
                        (isBackingUp || isRestoring || !isOnline) && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      {isRestoring ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {isRestoring ? 'Restoring…' : 'Restore Full'}
                    </button>
                  </div>
                </div>

                {/* Requests Only */}
                <div className="md:border-l md:border-slate-100 md:pl-8">
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Requests Only</h4>
                  <p className="text-sm text-slate-500 mb-4 font-light leading-relaxed">Preserve undelivered work orders before clearing locations.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadRequestsBackup}
                      disabled={isBackingUpRequests || isRestoringRequests}
                      className={cn(
                        'flex-1 rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5',
                        (isBackingUpRequests || isRestoringRequests) && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      {isBackingUpRequests ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {isBackingUpRequests ? 'Backing up…' : 'Download Requests'}
                    </button>

                    <input ref={requestsRestoreInputRef} type="file" accept=".json" className="hidden" onChange={handleRequestsRestoreFileSelect} />
                    <button
                      onClick={() => requestsRestoreInputRef.current?.click()}
                      disabled={isBackingUpRequests || isRestoringRequests || !isOnline}
                      title={!isOnline ? 'You are offline' : undefined}
                      className={cn(
                        'flex-1 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 transition-colors flex items-center justify-center gap-1.5',
                        (isBackingUpRequests || isRestoringRequests || !isOnline) && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      {isRestoringRequests ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {isRestoringRequests ? 'Restoring…' : 'Restore Requests'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {profile?.role === 'admin' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm mb-8">
            <div className="flex items-center justify-between border-b border-slate-50 bg-slate-50/50 px-6 py-4">
              <h3 className="font-bold text-slate-800">Metadata Management</h3>
              <div className="flex gap-3">
                <button
                  onClick={() => setMetaExportSelected(new Set(METADATA_COLLECTIONS))}
                  className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-md hover:bg-blue-100"
                >Select All</button>
                <button
                  onClick={() => setMetaExportSelected(new Set())}
                  className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-md hover:bg-slate-200"
                >Clear</button>
              </div>
            </div>

            <div className="p-6">
              <p className="mb-6 text-sm text-slate-500">
                <span className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 mr-2">Warning</span>
                Imports will overwrite existing records.
              </p>

              {metaMsg && (
                <div className={cn(
                  'mb-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2',
                  metaMsg.type === 'success' && 'bg-green-100 text-green-700',
                  metaMsg.type === 'error'   && 'bg-red-100 text-red-700',
                  metaMsg.type === 'progress' && 'bg-blue-50 text-blue-700',
                )}>
                  {metaMsg.type === 'progress' && <Loader2 size={14} className="animate-spin shrink-0" />}
                  {metaMsg.type === 'success'  && <Check size={14} className="shrink-0" />}
                  {metaMsg.type === 'error'    && <AlertCircle size={14} className="shrink-0" />}
                  <span>{metaMsg.text}</span>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                {METADATA_COLLECTIONS.map(col => (
                  <label
                    key={col}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 p-4 transition-all hover:bg-slate-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/30"
                  >
                    <input
                      type="checkbox"
                      checked={metaExportSelected.has(col)}
                      onChange={e => {
                        const next = new Set(metaExportSelected);
                        e.target.checked ? next.add(col) : next.delete(col);
                        setMetaExportSelected(next);
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 shrink-0"
                    />
                    <span className="text-sm font-medium text-slate-700">{COLLECTION_LABELS[col]}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-slate-50">
                <button
                  onClick={handleMetaExport}
                  disabled={isExportingMeta || isImportingMeta || metaExportSelected.size === 0}
                  className={cn(
                    'flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition-colors',
                    (isExportingMeta || isImportingMeta || metaExportSelected.size === 0) && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  {isExportingMeta ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {isExportingMeta ? 'Exporting…' : 'Export Selected'}
                </button>

                <input
                  ref={metaImportInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleMetaImportFileSelect}
                />
                <button
                  onClick={() => metaImportInputRef.current?.click()}
                  disabled={isExportingMeta || isImportingMeta}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors',
                    (isExportingMeta || isImportingMeta) && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  {isImportingMeta ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {isImportingMeta ? 'Importing…' : 'Import File'}
                </button>
              </div>
            </div>
          </section>
        )}

        {profile?.role === 'admin' && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm mb-8">
            <div className="border-b border-slate-50 bg-slate-50/50 px-6 py-4">
              <h3 className="font-bold text-slate-800">One-Time Migrations</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-1">Price History Collection</h4>
                <p className="text-sm text-slate-500 mb-4 font-light leading-relaxed">
                  Copy embedded <code className="text-xs bg-slate-100 px-1 rounded">priceHistory</code> arrays from item docs into the new
                  separate <code className="text-xs bg-slate-100 px-1 rounded">price_history</code> collection.
                  Run <strong>Step 1</strong> first, verify it looks correct in Firestore, then run <strong>Step 2</strong> to clean up the old arrays.
                </p>

                {phMigrateMsg && (
                  <div className={cn(
                    'mb-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2',
                    phMigrateMsg.type === 'success' && 'bg-green-100 text-green-700',
                    phMigrateMsg.type === 'error'   && 'bg-red-100 text-red-700',
                    phMigrateMsg.type === 'progress' && 'bg-blue-50 text-blue-700',
                  )}>
                    {phMigrateMsg.type === 'progress' && <Loader2 size={14} className="animate-spin shrink-0" />}
                    {phMigrateMsg.type === 'success'  && <Check size={14} className="shrink-0" />}
                    {phMigrateMsg.type === 'error'    && <AlertCircle size={14} className="shrink-0" />}
                    <span>{phMigrateMsg.text}</span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => handleMigratePriceHistory('copy')}
                    disabled={isMigratingPH || !isOnline}
                    title={!isOnline ? 'You are offline' : undefined}
                    className={cn(
                      'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5',
                      (isMigratingPH || !isOnline) && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    {isMigratingPH && !phCopied ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                    Step 1 — Copy to Collection
                  </button>
                  <button
                    onClick={() => handleMigratePriceHistory('cleanup')}
                    disabled={isMigratingPH || !phCopied || !isOnline}
                    title={!isOnline ? 'You are offline' : undefined}
                    className={cn(
                      'rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition-colors flex items-center gap-1.5',
                      (isMigratingPH || !phCopied || !isOnline) && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {isMigratingPH && phCopied ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Step 2 — Remove Old Arrays
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {profile?.role === 'admin' && (
          <section className="rounded-2xl border-2 border-dashed border-red-100 bg-red-50/30 p-8">
            {statusMessage && (
              <div className={cn(
                "mb-4 p-3 rounded-xl text-xs font-bold flex items-center space-x-2",
                statusMessage.type === 'success' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {statusMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                <span>{statusMessage.text}</span>
              </div>
            )}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>
                <p className="text-sm text-red-600/80">These actions are permanent and cannot be undone.</p>
              </div>
              <div className="flex flex-wrap gap-4">
                <button
                  onClick={() => navigate('/settings/manage/clear-location')}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-600 hover:text-white flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  Clear Location Inventory
                </button>
                <button
                  disabled={isClearingData || !isOnline}
                  title={!isOnline ? 'You are offline' : undefined}
                  onClick={() => setIsConfirmModalOpen(true)}
                  className={cn(
                    "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 shadow-lg shadow-red-200 flex items-center gap-2",
                    (isClearingData || !isOnline) && "opacity-70 cursor-not-allowed"
                  )}
                >
                  {isClearingData
                    ? <><Loader2 size={15} className="animate-spin" />Clearing Data…</>
                    : <><Trash2 size={15} />Purge All Data</>
                  }
                </button>
                <button
                  disabled={isCheckingOps || isForceSigningOut || !isOnline}
                  title={!isOnline ? 'You are offline' : undefined}
                  onClick={handleForceSignOutCheck}
                  className={cn(
                    "rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 flex items-center gap-2",
                    (isCheckingOps || isForceSigningOut || !isOnline) && "opacity-60 cursor-not-allowed"
                  )}
                >
                  {isCheckingOps
                    ? <><Loader2 size={15} className="animate-spin" />Checking…</>
                    : isForceSigningOut
                    ? <><Loader2 size={15} className="animate-spin" />Signing Out…</>
                    : <><LogOut size={15} />Force Sign Out All Users</>
                  }
                </button>
              </div>
            </div>

            {activeOpsWarning && (
              <div className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-sm font-bold text-amber-800">
                      {activeOpsWarning.length} active operation{activeOpsWarning.length !== 1 ? 's' : ''} in progress
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Please wait for all active operations to complete before forcing sign out.
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  {activeOpsWarning.map(op => (
                    <div key={op.id} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-100 px-3 py-1.5 rounded-lg">
                      <span className="font-black uppercase tracking-wider">{op.role}</span>
                      <span className="text-amber-400">·</span>
                      <span className="font-medium">{opTypeLabel(op.operationType)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleForceSignOutCheck}
                    disabled={isCheckingOps}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors",
                      isCheckingOps && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <RotateCcw size={12} />
                    Check Again
                  </button>
                  <button
                    onClick={handleForceSignOut}
                    disabled={isForceSigningOut}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-sm shadow-red-200",
                      isForceSigningOut && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {isForceSigningOut ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                    Force Anyway
                  </button>
                </div>
              </div>
            )}

            {forceSignOutMsg && (
              <div className={cn(
                "mt-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2",
                forceSignOutMsg.type === 'success' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {forceSignOutMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                <span>{forceSignOutMsg.text}</span>
              </div>
            )}
          </section>
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
          isOpen={showMetaImportConfirm}
          onClose={resetMetaImportConfirm}
          title="Import Metadata"
        >
          <div className="space-y-4">
            {metaImportFile && metaImportParsed && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                <p className="text-xs font-bold text-gray-700">{metaImportFile.name}</p>
                <p className="text-[10px] text-gray-400">
                  {(metaImportFile.size / 1024).toFixed(1)} KB &middot; Exported {new Date(metaImportParsed.timestamp).toLocaleString()}
                </p>
              </div>
            )}

            {/* Merge / Replace toggle */}
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <label className={cn(
                'flex items-start gap-3 p-4 cursor-pointer transition-colors',
                metaMergeMode ? 'bg-blue-50' : 'bg-white'
              )}>
                <input
                  type="checkbox"
                  checked={metaMergeMode}
                  onChange={e => setMetaMergeMode(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                />
                <div>
                  <p className={cn('text-xs font-black', metaMergeMode ? 'text-blue-700' : 'text-gray-700')}>
                    {metaMergeMode ? 'Merge — keep existing data' : 'Replace — delete all, import new'}
                  </p>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5">
                    {metaMergeMode
                      ? 'Existing records are kept. Only new records (by ID) are added.'
                      : 'All existing records are deleted. Imported records replace them entirely.'}
                  </p>
                </div>
              </label>
            </div>

            {!metaMergeMode && (
              <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-start gap-2">
                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={14} />
                <p className="text-[10px] font-bold text-red-700">
                  Replace mode will permanently delete all existing records in the selected collections before importing. This cannot be undone.
                </p>
              </div>
            )}

            {metaImportParsed && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Collections</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setMetaImportSelected(new Set(Object.keys(metaImportParsed.metadata) as MetadataCollection[]))}
                      className="text-[10px] font-bold text-blue-600 active:opacity-60"
                    >All</button>
                    <button
                      onClick={() => setMetaImportSelected(new Set())}
                      className="text-[10px] font-bold text-gray-400 active:opacity-60"
                    >None</button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden">
                  {(Object.keys(metaImportParsed.metadata) as MetadataCollection[]).map(col => {
                    const checked = metaImportSelected.has(col);
                    const a = metaImportAnalysis[col];
                    return (
                      <label key={col} className="flex items-center gap-3 px-3 py-2.5 bg-white cursor-pointer active:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = new Set(metaImportSelected);
                            e.target.checked ? next.add(col) : next.delete(col);
                            setMetaImportSelected(next);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                        />
                        <span className={cn('flex-1 text-xs font-bold', checked ? 'text-gray-800' : 'text-gray-400')}>
                          {COLLECTION_LABELS[col] || col}
                        </span>
                        {a && checked ? (
                          metaMergeMode ? (
                            <span className="text-[10px] font-bold text-right leading-tight">
                              <span className="text-green-600">{a.newCount} new</span>
                              {a.duplicates > 0 && (
                                <span className="text-gray-400 ml-1">{a.duplicates} skip</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-gray-400">
                              {a.existing}
                              <span className="text-gray-300 mx-1">→</span>
                              <span className={a.newCount + a.duplicates !== a.existing ? 'text-amber-600' : 'text-gray-500'}>
                                {a.newCount + a.duplicates}
                              </span>
                            </span>
                          )
                        ) : (
                          <span className="text-[10px] text-gray-300 font-bold">—</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {metaImportSelected.size === 0 && (
                  <p className="text-[10px] text-gray-400 px-1">Select at least one collection to import.</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleMetaImportConfirm}
                disabled={metaImportSelected.size === 0}
                className={cn(
                  'w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-transform shadow-lg text-white',
                  metaMergeMode
                    ? 'bg-blue-600 shadow-blue-200'
                    : 'bg-red-600 shadow-red-200',
                  metaImportSelected.size === 0 && 'opacity-40 cursor-not-allowed',
                )}
              >
                {metaMergeMode ? 'Merge Records' : 'Replace & Import'}
              </button>
              <button
                onClick={resetMetaImportConfirm}
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
