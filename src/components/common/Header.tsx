import React from 'react';
import { Menu, ChevronRight } from 'lucide-react';
import { useIsMobile, useSidebar } from '../../hooks/useApp';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}

export const Header = ({ title, showBack, leftAction, rightAction }: HeaderProps) => {
  const isMobile = useIsMobile();
  const { openSidebar } = useSidebar();
  
  return (
    <header className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 h-14 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        {leftAction ? (
          leftAction
        ) : (
          <>
            {isMobile && !showBack && (
              <button onClick={openSidebar} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <Menu size={20} />
              </button>
            )}
            {showBack && (
              <button onClick={() => window.history.back()} className="p-1 -ml-1 text-gray-600">
                <ChevronRight className="rotate-180" size={24} />
              </button>
            )}
          </>
        )}
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      </div>
      <div className="flex items-center space-x-2">
        {rightAction}
      </div>
    </header>
  );
};
