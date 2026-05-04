import React, { useEffect } from 'react';
import { Shield, LogOut } from 'lucide-react';
import { useAuth } from '../../App';
import { useNavigate } from 'react-router-dom';

export const PendingApproval = () => {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-3xl flex items-center justify-center mb-6">
        <Shield size={40} />
      </div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">Approval Pending</h2>
      <p className="text-gray-500 font-medium mb-8 max-w-xs">
        Hi {profile?.displayName || 'there'}! Your account is waiting for administrator approval. 
        Please contact your supervisor to gain access to the system.
      </p>
      <button 
        onClick={logout}
        className="px-8 py-4 bg-white text-gray-900 rounded-2xl font-bold shadow-sm border border-gray-100 flex items-center space-x-2 active:scale-95 transition-transform"
      >
        <LogOut size={18} />
        <span>Sign Out</span>
      </button>
    </div>
  );
};
