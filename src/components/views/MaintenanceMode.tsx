import React from 'react';
import { Hammer, AlertCircle, LogOut } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { Navigate, useNavigate } from 'react-router-dom';

export const MaintenanceMode = () => {
  const { profile, logout } = useAuth();
  const { systemConfig } = useData();
  const navigate = useNavigate();

  if (!systemConfig?.maintenanceMode || profile?.role === 'admin') {
    return <Navigate to="/" replace />;
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-blue-50">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl text-center space-y-6">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto animate-pulse">
          <Hammer size={40} />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-widest">Under Maintenance</h1>
          <p className="text-sm text-gray-500 font-medium leading-relaxed">
            {systemConfig.maintenanceMessage || "We're currently performing some scheduled maintenance to improve your experience. We'll be back online shortly."}
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start space-x-3 text-left">
          <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={18} />
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-normal">
            If you believe this is an error or need urgent access, please contact your system administrator.
          </p>
        </div>

        <button 
          onClick={handleLogout}
          className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center space-x-2 active:scale-95 transition-transform"
        >
          <LogOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};
