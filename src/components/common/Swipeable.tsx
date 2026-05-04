import React, { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useAnimation } from 'motion/react';
import { Pencil, Trash2, Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SwipeableProps {
  children: React.ReactNode;
  onDelete?: () => Promise<void> | void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  canDelete?: boolean;
  canEdit?: boolean;
  canDuplicate?: boolean;
  confirmMessage?: string;
}

export const Swipeable = ({ 
  children, 
  onDelete, 
  onEdit,
  onDuplicate,
  canDelete, 
  canEdit,
  canDuplicate,
  confirmMessage 
}: SwipeableProps) => {
  const x = useMotionValue(0);
  const controls = useAnimation();
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  if (!canDelete && !canEdit && !canDuplicate) return <>{children}</>;

  const handleDelete = async () => {
    if (confirmMessage && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    
    try {
      await onDelete?.();
    } catch (err) {
      console.error("Deletion failed:", err);
    }
    
    if (isMounted.current) {
      controls.start({ x: 0 });
      setIsOpen(false);
      setShowConfirm(false);
    }
  };

  const handleEdit = () => {
    onEdit?.();
    if (isMounted.current) {
      controls.start({ x: 0 });
      setIsOpen(false);
      setShowConfirm(false);
    }
  };

  const handleDuplicate = () => {
    onDuplicate?.();
    if (isMounted.current) {
      controls.start({ x: 0 });
      setIsOpen(false);
      setShowConfirm(false);
    }
  };

  const actionCount = (canDelete ? 1 : 0) + (canEdit ? 1 : 0) + (canDuplicate ? 1 : 0);
  const dragWidth = actionCount * 60;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gray-100 group">
      {/* Background Action Layer */}
      <div 
        className="absolute inset-y-0 right-0 flex items-center z-0"
        style={{ width: dragWidth }}
      >
        {canDuplicate && (
          <button 
            className="flex-1 h-full flex items-center justify-center bg-emerald-600 text-white active:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              handleDuplicate();
            }}
          >
            <Copy size={20} />
          </button>
        )}
        {canEdit && (
          <button 
            className="flex-1 h-full flex items-center justify-center bg-blue-600 text-white active:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              handleEdit();
            }}
          >
            <Pencil size={20} />
          </button>
        )}
        {canDelete && (
          <button 
            className={cn(
              "flex-1 h-full flex flex-col items-center justify-center text-white active:opacity-80 transition-all",
              showConfirm ? "bg-red-700 px-2" : "bg-red-600"
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            {showConfirm ? (
              <div className="flex flex-col items-center">
                <Check size={20} />
                <span className="text-[8px] font-black uppercase mt-1 text-center">Confirm</span>
              </div>
            ) : (
              <Trash2 size={20} />
            )}
          </button>
        )}
      </div>

      {/* Foreground Content Layer */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -dragWidth, right: 0 }}
        dragElastic={0.1}
        animate={controls}
        onDragEnd={(_, info) => {
          if (isMounted.current) {
            if (info.offset.x < -20) {
              controls.start({ x: -dragWidth });
              setIsOpen(true);
            } else {
              controls.start({ x: 0 });
              setIsOpen(false);
              setShowConfirm(false);
            }
          }
        }}
        style={{ x }}
        className="relative z-10"
      >
        <div 
          className={cn("bg-white transition-colors", isOpen && "cursor-pointer")}
          onClick={(e) => {
            if (isOpen && isMounted.current) {
              e.stopPropagation();
              controls.start({ x: 0 });
              setIsOpen(false);
              setShowConfirm(false);
            }
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
};
