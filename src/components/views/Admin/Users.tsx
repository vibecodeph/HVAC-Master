import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronRight, Check, Loader2 } from 'lucide-react';
import { useAuth, useData } from '../../../App';
import { updateUserProfile } from '../../../services/inventoryService';
import { cn } from '../../../lib/utils';
import { Header } from '../../common/Header';
import { Card } from '../../common/Card';
import { Modal } from '../../common/Modal';
import { Toggle } from '../../common/Toggle';
import { UserProfile, UserRole, Location } from '../../../types';

export const UsersManagementView = () => {
  const { users, locations } = useData();
  const { profile } = useAuth();
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInactiveLocations, setShowInactiveLocations] = useState(false);

  if (profile?.role !== 'admin') {
    return <Navigate to="/settings" />;
  }

  const filteredLocations = locations.filter(l => showInactiveLocations || l.isActive);
  const sortedLocations = [...filteredLocations].sort((a, b) => a.name.localeCompare(b.name));
  
  const groupedLocations = sortedLocations.reduce((acc, loc) => {
    if (!acc[loc.type]) acc[loc.type] = [];
    acc[loc.type].push(loc);
    return acc;
  }, {} as Record<string, Location[]>);

  return (
    <div className="pb-20">
      <Header title="User Management" showBack />
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.uid}>
              <Card 
                onClick={() => setEditingUser(user)}
                className="p-4 flex items-center justify-between bg-white active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold overflow-hidden">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      user.displayName?.[0] || user.email?.[0]?.toUpperCase() || '?'
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-sm font-bold text-gray-900">{user.displayName || 'User'}</h4>
                      {!user.isActive && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full font-black uppercase tracking-widest">Pending</span>
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {user.email} • {user.role?.replace('_', ' ') || 'No Role'} • {user.assignedLocationIds?.length || 0} Locations
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </Card>
            </div>
          ))}
        </div>

        <Modal 
          isOpen={!!editingUser} 
          onClose={() => setEditingUser(null)} 
          title="Edit User Access"
        >
          {editingUser && (
            <form className="space-y-6" onSubmit={async (e) => {
              e.preventDefault();
              setIsSubmitting(true);
              try {
                const formData = new FormData(e.currentTarget);
                const role = formData.get('role') as UserRole;
                const assignedLocationIds = Array.from(formData.getAll('locations')) as string[];
                const firstName = formData.get('firstName') as string;
                const lastName = formData.get('lastName') as string;
                const position = formData.get('position') as string;
                const photoURL = formData.get('photoURL') as string;
                const skills = (formData.get('skills') as string).split(',').map(s => s.trim()).filter(Boolean);
                const displayName = `${firstName} ${lastName}`.trim() || editingUser.email.split('@')[0];
                
                const isActive = formData.get('isActive') === 'on';
                
                await updateUserProfile(editingUser.uid, { 
                  role, 
                  assignedLocationIds,
                  isActive,
                  isApproved: isActive, // Keep in sync for now
                  firstName,
                  lastName,
                  position,
                  photoURL,
                  skills,
                  displayName
                });
                setEditingUser(null);
              } catch (error) {
                console.error(error);
              } finally {
                setIsSubmitting(false);
              }
            }}>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Email Address</label>
                <div className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-medium text-gray-500">
                  {editingUser.email}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">First Name</label>
                  <input 
                    name="firstName" 
                    defaultValue={editingUser.firstName}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Last Name</label>
                  <input 
                    name="lastName" 
                    defaultValue={editingUser.lastName}
                    className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Position</label>
                <input 
                  name="position" 
                  defaultValue={editingUser.position}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Photo URL</label>
                <input 
                  name="photoURL" 
                  defaultValue={editingUser.photoURL}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Skills (comma separated)</label>
                <textarea 
                  name="skills" 
                  defaultValue={editingUser.skills?.join(', ')}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">Role</label>
                <select 
                  name="role" 
                  defaultValue={editingUser.role}
                  className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="worker">Worker</option>
                  <option value="engineer">Engineer</option>
                  <option value="warehouseman">Warehouseman</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div>
                  <p className="text-sm font-bold text-gray-900">Approved Access</p>
                  <p className="text-[10px] text-gray-500 font-medium">Allow user to access the application</p>
                </div>
                <input 
                  type="checkbox" 
                  name="isActive" 
                  defaultChecked={editingUser.isActive}
                  className="w-6 h-6 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Assigned Locations</label>
                  <Toggle 
                    enabled={showInactiveLocations} 
                    onChange={setShowInactiveLocations} 
                    label="Show Inactive" 
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 max-h-[300px] overflow-y-auto p-1">
                  {(Object.entries(groupedLocations) as [string, Location[]][]).sort(([a], [b]) => a.localeCompare(b)).map(([type, locs]) => (
                    <div key={type} className="space-y-2">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1 border-b border-gray-100 pb-1">
                        {type}s
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        {locs.map(loc => (
                          <label 
                            key={loc.id} 
                            className={cn(
                              "flex items-center space-x-3 p-3 rounded-xl cursor-pointer transition-colors",
                              loc.isActive ? "bg-gray-50 active:bg-gray-100" : "bg-red-50/50 opacity-75"
                            )}
                          >
                            <input 
                              type="checkbox" 
                              name="locations" 
                              value={loc.id}
                              defaultChecked={editingUser.assignedLocationIds?.includes(loc.id)}
                              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div className="flex-1">
                              <p className={cn("text-sm font-bold", loc.isActive ? "text-gray-900" : "text-gray-500 italic")}>
                                {loc.name} {!loc.isActive && "(Inactive)"}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                <span>{isSubmitting ? 'Updating Access...' : 'Update Access'}</span>
              </button>
            </form>
          )}
        </Modal>
      </div>
    </div>
  );
};
