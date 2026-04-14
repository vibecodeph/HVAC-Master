import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, BottomNav } from './common/Navigation';
import { useIsMobile } from '../hooks/useApp';
import { useData } from '../App';
import { Hammer } from 'lucide-react';

export const Layout = ({ children }: { children?: React.ReactNode }) => {
  const isMobile = useIsMobile();
  const { systemConfig } = useData();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
      <Sidebar />
      <main className="flex-1 overflow-y-auto no-scrollbar lg:max-h-screen">
        {systemConfig?.maintenanceMode && (
          <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-center space-x-2 sticky top-0 z-50 shadow-lg">
            <Hammer size={16} className="animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Maintenance Mode Active</span>
          </div>
        )}
        <div className="max-w-5xl mx-auto min-h-screen relative">
          {children || <Outlet />}
        </div>
      </main>
      {isMobile && <BottomNav />}
    </div>
  );
};
