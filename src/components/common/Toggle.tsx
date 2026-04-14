import React from 'react';
import { cn } from '../../lib/utils';

interface ToggleProps {
  enabled: boolean;
  onChange: (val: boolean) => void;
  label?: string;
}

export const Toggle = ({ enabled, onChange, label }: ToggleProps) => {
  return (
    <div className="flex items-center space-x-2">
      {label && <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</span>}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange(!enabled);
        }}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
          enabled ? "bg-blue-600" : "bg-gray-200"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
            enabled ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
};
