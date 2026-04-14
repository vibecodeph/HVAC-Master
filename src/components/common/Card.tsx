import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Card = ({ children, className, onClick }: CardProps) => (
  <div 
    onClick={onClick}
    className={cn("bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden", className, onClick && "cursor-pointer active:bg-gray-50")}
  >
    {children}
  </div>
);
