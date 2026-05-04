import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getMillis(timestamp: any): number {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === 'number') return timestamp;
  if (timestamp.seconds !== undefined) {
    return timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000;
  }
  return 0;
}

export function normalizeVariant(variant?: Record<string, any>): string {
  if (!variant || Object.keys(variant).length === 0) return '{}';
  const sortedKeys = Object.keys(variant).sort();
  const normalized: Record<string, any> = {};
  sortedKeys.forEach(key => {
    normalized[key] = variant[key];
  });
  return JSON.stringify(normalized);
}
