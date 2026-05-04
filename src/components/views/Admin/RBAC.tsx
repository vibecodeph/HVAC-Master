import React from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Check, X } from 'lucide-react';
import { useAuth } from '../../../App';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { UserRole } from '../../../types';

export const RBACDashboard = () => {
  const { profile } = useAuth();
  if (profile?.role !== 'admin') return <Navigate to="/settings" />;

  const roles: UserRole[] = ['admin', 'manager', 'warehouseman', 'engineer', 'worker'];
  const permissions = [
    { id: 'view_inventory', label: 'View Inventory', description: 'Can see stock levels and item details' },
    { id: 'create_requests', label: 'Create Requests', description: 'Can create item requests for jobsites' },
    { id: 'approve_requests', label: 'Approve Requests', description: 'Can approve or reject pending requests' },
    { id: 'fulfill_requests', label: 'Fulfill Requests', description: 'Can pick items and mark as "for delivery"' },
    { id: 'receive_requests', label: 'Receive Requests', description: 'Can mark delivered items as "received"' },
    { id: 'manage_items', label: 'Manage Items', description: 'Can create, edit, and delete items' },
    { id: 'manage_metadata', label: 'Manage Metadata', description: 'Can manage Categories, UOMs, and Tags' },
    { id: 'manage_locations', label: 'Manage Locations', description: 'Can create and manage warehouses/jobsites' },
    { id: 'manage_users', label: 'Manage Users', description: 'Can manage user roles and assignments' },
    { id: 'manage_po', label: 'Manage POs', description: 'Can create and manage Purchase Orders' },
    { id: 'manage_payments', label: 'Manage Payments', description: 'Can process and track PO payments' },
    { id: 'bulk_receive', label: 'Bulk Receive', description: 'Can receive multiple items from POs at once' },
    { id: 'view_transactions', label: 'View Transactions', description: 'Can view transaction history and logs' },
    { id: 'view_costs', label: 'View Costs', description: 'Can view item average costs and values' },
    { id: 'view_inactive', label: 'View Inactive', description: 'Can view inactive items and locations' },
    { id: 'clear_data', label: 'Clear Data', description: 'Can perform bulk deletion of inventory data' },
  ];

  const rolePermissions: Record<string, string[]> = {
    admin: [
      'view_inventory', 'create_requests', 'approve_requests', 'fulfill_requests', 
      'receive_requests', 'manage_items', 'manage_metadata', 'manage_locations', 
      'manage_users', 'manage_po', 'manage_payments', 'bulk_receive',
      'view_transactions', 'view_costs', 'view_inactive', 'clear_data'
    ],
    manager: [
      'view_inventory', 'create_requests', 'approve_requests', 
      'receive_requests', 'manage_po', 'manage_payments',
      'bulk_receive', 'view_transactions', 'view_costs'
    ],
    engineer: [
      'view_inventory', 'create_requests', 'approve_requests', 'receive_requests', 
      'view_transactions'
    ],
    warehouseman: [
      'view_inventory', 'create_requests', 'fulfill_requests', 'receive_requests', 
      'bulk_receive', 'view_transactions', 'view_costs'
    ],
    worker: [
      'view_inventory', 'create_requests', 'receive_requests', 'view_transactions'
    ],
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
            This dashboard reflects the current Role-Based Access Control settings implemented in the application and Firestore security rules.
          </p>
        </div>

        <div className="space-y-4 overflow-x-auto no-scrollbar">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left py-3 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">Permission</th>
                {roles.map(role => (
                  <th key={role} className="text-center py-3 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                    {role.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {permissions.map(perm => (
                <tr key={perm.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-4 px-4">
                    <p className="text-sm font-bold text-gray-900">{perm.label}</p>
                    <p className="text-[10px] text-gray-500 font-medium">{perm.description}</p>
                  </td>
                  {roles.map(role => {
                    const hasPerm = rolePermissions[role]?.includes(perm.id);
                    return (
                      <td key={role} className="py-4 px-4 text-center">
                        <div className={cn(
                          "inline-flex items-center justify-center w-6 h-6 rounded-lg",
                          hasPerm ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-300"
                        )}>
                          {hasPerm ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                        </div>
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
            {[
              { role: 'Admin', desc: 'Full system access, user management, metadata management (Categories, UOM, Tags), and bulk data clearing capabilities.' },
              { role: 'Manager', desc: 'Full operational access including PO management, payments, and bulk receiving.' },
              { role: 'Engineer', desc: 'Can request items and approve requests for their assigned jobsites.' },
              { role: 'Warehouseman', desc: 'Can fulfill requests and perform bulk receiving from POs.' },
              { role: 'Worker', desc: 'Can request items from assigned jobsites. Requires admin approval after registration.' },
            ].map(r => (
              <Card key={r.role} className="p-4 bg-white">
                <h4 className="text-sm font-bold text-gray-900 mb-1">{r.role}</h4>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">{r.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
