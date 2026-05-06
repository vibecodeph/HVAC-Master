import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Shield, Check, X, Plus, Trash2, RotateCcw, History,
  ChevronDown, ChevronUp, Loader2, AlertTriangle,
} from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { cn, formatTimestamp } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Modal } from '../../common/Modal';
import { RBACauditEntry } from '../../../types';
import {
  subscribeToRBACaudit,
  callUpdateRolePermissions,
  callCreateRole,
  callDeleteRole,
} from '../../../services/rbacService';

const BUILT_IN_ORDER = ['admin', 'manager', 'warehouseman', 'engineer', 'worker'];

const ALL_PERMISSIONS = [
  { id: 'view_inventory',   label: 'View Inventory',    description: 'Can see stock levels and item details' },
  { id: 'create_requests',  label: 'Create Requests',   description: 'Can create item requests for jobsites' },
  { id: 'approve_requests', label: 'Approve Requests',  description: 'Can approve or reject pending requests' },
  { id: 'fulfill_requests', label: 'Fulfill Requests',  description: 'Can pick items and mark as "for delivery"' },
  { id: 'receive_requests', label: 'Receive Requests',  description: 'Can mark delivered items as "received"' },
  { id: 'manage_items',     label: 'Manage Items',      description: 'Can create, edit, and delete items' },
  { id: 'manage_metadata',  label: 'Manage Metadata',   description: 'Can manage Categories, UOMs, and Tags' },
  { id: 'manage_locations', label: 'Manage Locations',  description: 'Can create and manage warehouses/jobsites' },
  { id: 'manage_users',     label: 'Manage Users',      description: 'Can manage user roles and assignments' },
  { id: 'manage_po',        label: 'Manage POs',        description: 'Can create and manage Purchase Orders' },
  { id: 'manage_payments',  label: 'Manage Payments',   description: 'Can process and track PO payments' },
  { id: 'bulk_receive',     label: 'Bulk Receive',      description: 'Can receive multiple items from POs at once' },
  { id: 'view_transactions',label: 'View Transactions', description: 'Can view transaction history and logs' },
  { id: 'view_costs',       label: 'View Costs',        description: 'Can view item average costs and values' },
  { id: 'view_inactive',    label: 'View Inactive',     description: 'Can view inactive items and locations' },
  { id: 'clear_data',       label: 'Clear Data',        description: 'Can perform bulk deletion of inventory data' },
];

const DEFAULT_CONFIG: Record<string, { permissions: string[]; description: string }> = {
  admin: {
    permissions: ['view_inventory','create_requests','approve_requests','fulfill_requests','receive_requests','manage_items','manage_metadata','manage_locations','manage_users','manage_po','manage_payments','bulk_receive','view_transactions','view_costs','view_inactive','clear_data'],
    description: 'Full system access, user management, metadata management, and bulk data clearing capabilities.',
  },
  manager: {
    permissions: ['view_inventory','create_requests','approve_requests','receive_requests','manage_items','view_transactions','view_costs'],
    description: 'Can manage items, approve requests, and receive deliveries. Has read access to POs and payments.',
  },
  engineer: {
    permissions: ['view_inventory','create_requests','approve_requests','receive_requests','view_transactions'],
    description: 'Can create and approve requests for their assigned jobsites, and receive deliveries.',
  },
  warehouseman: {
    permissions: ['view_inventory','create_requests','approve_requests','fulfill_requests','view_transactions','view_costs'],
    description: 'Can approve requests and fulfill (pick) items for delivery. Cannot receive deliveries.',
  },
  worker: {
    permissions: ['view_inventory','create_requests','receive_requests','view_transactions'],
    description: 'Can request items from assigned jobsites. Requires admin approval after registration.',
  },
};

export const RBACDashboard = () => {
  const { profile } = useAuth();
  const { rbacConfig } = useData();

  if (profile?.role !== 'admin') return <Navigate to="/settings" />;

  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [confirmDeleteRole, setConfirmDeleteRole] = useState<string | null>(null);
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);
  const [addRoleId, setAddRoleId] = useState('');
  const [addRoleDesc, setAddRoleDesc] = useState('');
  const [addRolePerms, setAddRolePerms] = useState<string[]>([]);
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditEntries, setAuditEntries] = useState<RBACauditEntry[]>([]);

  useEffect(() => {
    if (!showAudit) return;
    return subscribeToRBACaudit(setAuditEntries);
  }, [showAudit]);

  const isInitialized = Object.keys(rbacConfig).length > 0;

  const roles = isInitialized
    ? [
        ...BUILT_IN_ORDER.filter(r => rbacConfig[r]),
        ...Object.keys(rbacConfig).filter(r => !BUILT_IN_ORDER.includes(r)).sort(),
      ]
    : [];

  const handleToggle = async (roleId: string, permId: string) => {
    if (pendingToggle) return;
    const currentPerms = rbacConfig[roleId]?.permissions || [];
    const hasIt = currentPerms.includes(permId);
    const newPerms = hasIt ? currentPerms.filter(p => p !== permId) : [...currentPerms, permId];
    if (roleId === 'admin' && newPerms.length === 0) {
      setError('Cannot remove all permissions from the admin role.');
      return;
    }
    setPendingToggle(`${roleId}-${permId}`);
    setError(null);
    try {
      await callUpdateRolePermissions({ roleId, permissions: newPerms });
    } catch (err: any) {
      setError(err.message || 'Failed to update permissions.');
    } finally {
      setPendingToggle(null);
    }
  };

  const handleInitialize = async () => {
    setIsInitializing(true);
    setError(null);
    try {
      for (const [roleId, cfg] of Object.entries(DEFAULT_CONFIG)) {
        await callUpdateRolePermissions({ roleId, permissions: cfg.permissions, description: cfg.description });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize RBAC config.');
    } finally {
      setIsInitializing(false);
    }
  };

  const handleResetToDefaults = async () => {
    setShowResetConfirm(false);
    setIsResetting(true);
    setError(null);
    try {
      for (const [roleId, cfg] of Object.entries(DEFAULT_CONFIG)) {
        if (rbacConfig[roleId]) {
          await callUpdateRolePermissions({ roleId, permissions: cfg.permissions, description: cfg.description });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset to defaults.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleAddRole = async () => {
    setIsAddingRole(true);
    setError(null);
    try {
      await callCreateRole({ roleId: addRoleId.trim(), permissions: addRolePerms, description: addRoleDesc.trim() });
      setShowAddRole(false);
      setAddRoleId('');
      setAddRoleDesc('');
      setAddRolePerms([]);
    } catch (err: any) {
      setError(err.message || 'Failed to create role.');
    } finally {
      setIsAddingRole(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!confirmDeleteRole) return;
    setIsDeletingRole(true);
    setError(null);
    try {
      await callDeleteRole({ roleId: confirmDeleteRole });
      setConfirmDeleteRole(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete role.');
      setConfirmDeleteRole(null);
    } finally {
      setIsDeletingRole(false);
    }
  };

  return (
    <div className="pb-20">
      <Header title="RBAC Dashboard" showBack />
      <div className="p-4 space-y-6">

        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
          <div className="flex items-center space-x-2 text-blue-600 mb-2">
            <Shield size={18} />
            <h3 className="text-sm font-bold uppercase tracking-widest">Active Configuration</h3>
          </div>
          <p className="text-xs text-blue-500 font-medium leading-relaxed">
            Manage role permissions. Changes apply immediately to UI access controls. Firestore security rules are enforced separately.
          </p>
        </div>

        {error && (
          <div className="flex items-start space-x-3 p-4 bg-red-50 border border-red-100 rounded-2xl">
            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs font-medium text-red-700 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        )}

        {!isInitialized && (
          <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 space-y-3">
            <div className="flex items-center space-x-2 text-amber-700">
              <AlertTriangle size={16} />
              <p className="text-sm font-bold">RBAC config not initialized</p>
            </div>
            <p className="text-xs text-amber-600 font-medium leading-relaxed">
              No role configuration found in Firestore. Click below to seed the default permissions for all built-in roles.
            </p>
            <button
              onClick={handleInitialize}
              disabled={isInitializing}
              className="flex items-center space-x-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {isInitializing ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              <span>{isInitializing ? 'Initializing…' : 'Set Up Defaults'}</span>
            </button>
          </div>
        )}

        {isInitialized && (
          <>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowAddRole(true)}
                className="flex items-center space-x-1.5 px-3 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold"
              >
                <Plus size={14} />
                <span>Add Role</span>
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex items-center space-x-1.5 px-3 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold disabled:opacity-50"
              >
                {isResetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                <span>{isResetting ? 'Resetting…' : 'Reset to Defaults'}</span>
              </button>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-3 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 min-w-[170px]">
                      Permission
                    </th>
                    {roles.map(role => (
                      <th key={role} className="py-3 px-2 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 min-w-[60px]">
                        <div className="flex flex-col items-center gap-1">
                          <span>{role.replace(/_/g, ' ')}</span>
                          {!BUILT_IN_ORDER.includes(role) && (
                            <button
                              onClick={() => setConfirmDeleteRole(role)}
                              title={`Delete "${role}" role`}
                              className="p-0.5 text-red-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ALL_PERMISSIONS.map(perm => (
                    <tr key={perm.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-3">
                        <p className="text-sm font-bold text-gray-900">{perm.label}</p>
                        <p className="text-[10px] text-gray-400 font-medium">{perm.description}</p>
                      </td>
                      {roles.map(role => {
                        const key = `${role}-${perm.id}`;
                        const hasPerm = rbacConfig[role]?.permissions.includes(perm.id) ?? false;
                        const isPending = pendingToggle === key;
                        const isDisabled = !!pendingToggle;
                        return (
                          <td key={role} className="py-3 px-2 text-center">
                            <button
                              onClick={() => handleToggle(role, perm.id)}
                              disabled={isDisabled}
                              className={cn(
                                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all',
                                isDisabled && !isPending ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                                hasPerm
                                  ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                  : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                              )}
                            >
                              {isPending
                                ? <Loader2 size={12} className="animate-spin text-blue-500" />
                                : hasPerm
                                ? <Check size={12} strokeWidth={3} />
                                : <X size={12} strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Role Definitions</h3>
              <div className="grid grid-cols-1 gap-3">
                {roles.map(role => (
                  <Card key={role} className="p-4 bg-white">
                    <h4 className="text-sm font-bold text-gray-900 mb-1 capitalize">{role.replace(/_/g, ' ')}</h4>
                    <p className="text-xs text-gray-500 font-medium leading-relaxed">
                      {rbacConfig[role]?.description || '—'}
                    </p>
                    <p className="text-[10px] text-gray-300 font-medium mt-2">
                      {rbacConfig[role]?.permissions.length ?? 0} permissions
                      {rbacConfig[role]?.lastUpdatedBy && <> · Last updated by {rbacConfig[role].lastUpdatedBy}</>}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Audit log */}
        <div className="space-y-3">
          <button
            onClick={() => setShowAudit(v => !v)}
            className="flex items-center justify-between w-full px-1 py-2"
          >
            <div className="flex items-center space-x-2">
              <History size={14} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Audit Log</span>
            </div>
            {showAudit
              ? <ChevronUp size={14} className="text-gray-300" />
              : <ChevronDown size={14} className="text-gray-300" />}
          </button>
          {showAudit && (
            <div className="space-y-2">
              {auditEntries.length === 0 ? (
                <p className="text-xs text-gray-400 font-medium text-center py-4">No audit records yet.</p>
              ) : (
                auditEntries.map(entry => (
                  <Card key={entry.id} className="p-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 capitalize">
                          {entry.changeType.replace(/_/g, ' ')}{' '}
                          <span className="text-blue-600">"{entry.roleId}"</span>
                        </p>
                        <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                          by {entry.changedByName || entry.changedBy}
                        </p>
                        {entry.changeType === 'updated_permissions' && (
                          <p className="text-[10px] text-gray-400 font-medium mt-1">
                            {entry.oldPermissions.length} → {entry.newPermissions.length} permissions
                          </p>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-300 font-medium shrink-0">
                        {entry.changedAt ? formatTimestamp(entry.changedAt) : '—'}
                      </p>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>

        {/* Add Role Modal */}
        <Modal
          isOpen={showAddRole}
          onClose={() => { setShowAddRole(false); setAddRoleId(''); setAddRoleDesc(''); setAddRolePerms([]); }}
          title="Add Custom Role"
        >
          <div className="space-y-5">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Role ID</label>
              <input
                value={addRoleId}
                onChange={e => setAddRoleId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="e.g. supervisor"
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-gray-400 pl-1">Lowercase letters, digits, underscores only.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Description</label>
              <textarea
                value={addRoleDesc}
                onChange={e => setAddRoleDesc(e.target.value)}
                placeholder="Brief description of this role's responsibilities"
                className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Permissions</label>
              <div className="space-y-1 max-h-[260px] overflow-y-auto">
                {ALL_PERMISSIONS.map(perm => (
                  <label key={perm.id} className="flex items-center space-x-3 p-3 rounded-xl bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addRolePerms.includes(perm.id)}
                      onChange={e =>
                        setAddRolePerms(prev =>
                          e.target.checked ? [...prev, perm.id] : prev.filter(p => p !== perm.id)
                        )
                      }
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-sm font-bold text-gray-900">{perm.label}</p>
                      <p className="text-[10px] text-gray-400 font-medium">{perm.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={handleAddRole}
              disabled={isAddingRole || addRoleId.trim().length < 2 || !addRoleDesc.trim()}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isAddingRole ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              <span>{isAddingRole ? 'Creating…' : 'Create Role'}</span>
            </button>
          </div>
        </Modal>

        {/* Delete role confirm */}
        <Modal isOpen={!!confirmDeleteRole} onClose={() => setConfirmDeleteRole(null)} title="Delete Role">
          <div className="space-y-5">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
              <p className="text-sm font-bold text-red-700 mb-1">Delete role "{confirmDeleteRole}"?</p>
              <p className="text-xs text-red-600 font-medium leading-relaxed">
                This permanently removes the role from RBAC config. Built-in roles and roles with active users cannot be deleted.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteRole(null)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-2xl font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRole}
                disabled={isDeletingRole}
                className="flex-1 py-3 bg-red-600 text-white rounded-2xl font-bold text-sm flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isDeletingRole ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                <span>{isDeletingRole ? 'Deleting…' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </Modal>

        {/* Reset to defaults confirm */}
        <Modal isOpen={showResetConfirm} onClose={() => setShowResetConfirm(false)} title="Reset to Defaults">
          <div className="space-y-5">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <p className="text-sm font-bold text-amber-700 mb-1">Reset built-in role permissions?</p>
              <p className="text-xs text-amber-600 font-medium leading-relaxed">
                Restores original permissions for admin, manager, engineer, warehouseman, and worker. Custom roles are not affected.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-2xl font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetToDefaults}
                className="flex-1 py-3 bg-amber-500 text-white rounded-2xl font-bold text-sm flex items-center justify-center space-x-2"
              >
                <RotateCcw size={16} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </Modal>

      </div>
    </div>
  );
};
