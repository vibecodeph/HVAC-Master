import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Package, ArrowLeftRight, History, 
  Settings, LogOut, X, Shield, Wrench, FileText 
} from 'lucide-react';
import { useAuth } from '../../App';
import { cn } from '../../lib/utils';
import { useSidebar } from '../../hooks/useApp';

export const Sidebar = () => {
  const navigate = useNavigate();
  const { profile, logout } = useAuth();
  const { isSidebarOpen, toggleSidebar } = useSidebar();
  const location = useLocation();

  const menuItems = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Inventory', icon: Package, path: '/inventory' },
    { label: 'Requests', icon: ArrowLeftRight, path: '/requests' },
    { label: 'Transactions', icon: History, path: '/transactions' },
    { label: 'Purchase Orders', icon: FileText, path: '/purchase-orders', adminOnly: true },
    { label: 'Settings', icon: Settings, path: '/settings', adminOnly: true },
  ].filter(item => !item.adminOnly || profile?.role === 'admin');

  return (
    <>
      {/* Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-72 bg-white z-[70] transform transition-transform duration-300 ease-out border-r border-gray-100 flex flex-col",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0 lg:static lg:z-0"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
              <Wrench size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 tracking-tight">HVAC Master</h1>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Field Operations</p>
            </div>
          </div>
          <button onClick={toggleSidebar} className="lg:hidden p-2 text-gray-400 hover:bg-gray-50 rounded-xl">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto no-scrollbar">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => window.innerWidth < 1024 && toggleSidebar()}
                className={cn(
                  "flex items-center space-x-3 px-4 py-3.5 rounded-2xl font-bold transition-all group",
                  isActive 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-100" 
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon size={20} className={cn(isActive ? "text-white" : "text-gray-400 group-hover:text-blue-600")} />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <div className="bg-gray-50 rounded-3xl p-4 space-y-4">
            <div 
              onClick={() => {
                navigate('/profile');
                if (window.innerWidth < 1024) toggleSidebar();
              }}
              className="flex items-center space-x-3 cursor-pointer hover:bg-white/50 p-2 -m-2 rounded-2xl transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-blue-600 font-bold shadow-sm overflow-hidden">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  profile?.displayName?.[0] || profile?.email?.[0]?.toUpperCase() || '?'
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{profile?.displayName || 'User'}</p>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{profile?.role?.replace('_', ' ')}</p>
              </div>
            </div>
            <button 
              onClick={logout}
              className="w-full py-3 bg-white text-red-600 rounded-2xl text-xs font-bold flex items-center justify-center space-x-2 shadow-sm hover:bg-red-50 transition-colors"
            >
              <LogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export const BottomNav = () => {
  const location = useLocation();
  const navItems = [
    { label: 'Home', icon: LayoutDashboard, path: '/' },
    { label: 'Stock', icon: Package, path: '/inventory' },
    { label: 'Requests', icon: ArrowLeftRight, path: '/requests' },
    { label: 'History', icon: History, path: '/transactions' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 px-4 py-2 flex items-center justify-around z-50 lg:hidden safe-bottom">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link 
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-col items-center p-2 rounded-2xl transition-all min-w-[64px]",
              isActive ? "text-blue-600" : "text-gray-400"
            )}
          >
            <div className={cn(
              "p-1.5 rounded-xl transition-all",
              isActive ? "bg-blue-50" : ""
            )}>
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
            </div>
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest mt-1 transition-all",
              isActive ? "opacity-100" : "opacity-60"
            )}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
};
