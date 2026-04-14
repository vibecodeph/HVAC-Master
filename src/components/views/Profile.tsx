import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, X, Plus } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { updateUserProfile } from '../../services/inventoryService';
import { Location } from '../../types';
import { Header } from '../common/Header';
import { Card } from '../common/Card';

export const ProfileView = () => {
  const { profile } = useAuth();
  const { locations } = useData();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    firstName: profile?.firstName || '',
    lastName: profile?.lastName || '',
    position: profile?.position || '',
    photoURL: profile?.photoURL || '',
    skills: profile?.skills || []
  });
  const [newSkill, setNewSkill] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        position: profile.position || '',
        photoURL: profile.photoURL || '',
        skills: profile.skills || []
      });
    }
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const displayName = `${formData.firstName} ${formData.lastName}`.trim() || profile.email.split('@')[0];
      await updateUserProfile(profile.uid, {
        ...formData,
        displayName
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const addSkill = () => {
    if (newSkill.trim() && !formData.skills.includes(newSkill.trim())) {
      setFormData({ ...formData, skills: [...formData.skills, newSkill.trim()] });
      setNewSkill('');
    }
  };

  const removeSkill = (skill: string) => {
    setFormData({ ...formData, skills: formData.skills.filter(s => s !== skill) });
  };

  return (
    <div className="pb-20">
      <Header 
        title="My Profile" 
        leftAction={<button onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>}
        rightAction={
          isEditing ? (
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          ) : (
            <button 
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold"
            >
              Edit
            </button>
          )
        }
      />
      
      <div className="p-4 space-y-6">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-32 h-32 rounded-3xl bg-blue-600 flex items-center justify-center text-white text-4xl font-black shadow-xl overflow-hidden relative group">
            {formData.photoURL ? (
              <img src={formData.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              profile?.displayName?.[0] || profile?.email?.[0]?.toUpperCase() || '?'
            )}
            {isEditing && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil size={24} className="text-white" />
              </div>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-black text-gray-900">
              {formData.firstName || formData.lastName ? `${formData.firstName} ${formData.lastName}` : profile?.displayName}
            </h2>
            <p className="text-sm font-bold text-blue-600 uppercase tracking-widest">{formData.position || profile?.role?.replace('_', ' ')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Personal Information</label>
            <Card className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">First Name</span>
                  {isEditing ? (
                    <input 
                      type="text" 
                      value={formData.firstName}
                      onChange={e => setFormData({...formData, firstName: e.target.value})}
                      className="w-full p-2 bg-gray-50 rounded-xl text-sm font-bold border-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-sm font-bold text-gray-700">{formData.firstName || '-'}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Last Name</span>
                  {isEditing ? (
                    <input 
                      type="text" 
                      value={formData.lastName}
                      onChange={e => setFormData({...formData, lastName: e.target.value})}
                      className="w-full p-2 bg-gray-50 rounded-xl text-sm font-bold border-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-sm font-bold text-gray-700">{formData.lastName || '-'}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Position</span>
                {isEditing ? (
                  <input 
                    type="text" 
                    value={formData.position}
                    onChange={e => setFormData({...formData, position: e.target.value})}
                    className="w-full p-2 bg-gray-50 rounded-xl text-sm font-bold border-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Senior Engineer"
                  />
                ) : (
                  <p className="text-sm font-bold text-gray-700">{formData.position || '-'}</p>
                )}
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Email</span>
                <p className="text-sm font-bold text-gray-500">{profile?.email}</p>
              </div>
              {isEditing && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Photo URL</span>
                  <input 
                    type="text" 
                    value={formData.photoURL}
                    onChange={e => setFormData({...formData, photoURL: e.target.value})}
                    className="w-full p-2 bg-gray-50 rounded-xl text-sm font-bold border-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://example.com/photo.jpg"
                  />
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Skills & Expertise</label>
            <Card className="p-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {formData.skills.map(skill => (
                  <span key={skill} className="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-bold">
                    <span>{skill}</span>
                    {isEditing && (
                      <button onClick={() => removeSkill(skill)} className="p-0.5 hover:bg-blue-100 rounded-full">
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {formData.skills.length === 0 && !isEditing && (
                  <p className="text-sm text-gray-400 italic">No skills added yet</p>
                )}
              </div>
              {isEditing && (
                <div className="flex space-x-2">
                  <input 
                    type="text" 
                    value={newSkill}
                    onChange={e => setNewSkill(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && addSkill()}
                    className="flex-1 p-2 bg-gray-50 rounded-xl text-sm font-bold border-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Add a skill..."
                  />
                  <button 
                    onClick={addSkill}
                    className="p-2 bg-blue-600 text-white rounded-xl"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Assigned Jobsites</label>
            <Card className="p-4 space-y-2">
              {profile?.assignedLocationIds && profile.assignedLocationIds.length > 0 ? (
                <div className="space-y-2">
                  {profile.assignedLocationIds
                    .map(id => locations.find(l => l.id === id))
                    .filter((l): l is Location => !!l) // Only show locations that exist
                    .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically
                    .map(location => (
                      <div key={location.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{location.name}</p>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{location.type}</p>
                        </div>
                        {!location.isActive && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-black uppercase tracking-widest">Inactive</span>
                        )}
                      </div>
                    ))}
                  {profile.assignedLocationIds.filter(id => !locations.find(l => l.id === id)).length > 0 && (
                    <p className="text-[10px] text-gray-400 italic px-1 pt-2 border-t border-gray-100">
                      Some assigned locations are no longer available.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic px-1">No jobsites assigned yet</p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
