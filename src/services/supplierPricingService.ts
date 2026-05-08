import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SupplierPricingRecord } from '../types';

export const subscribeToSupplierPricing = (
  callback: (records: SupplierPricingRecord[]) => void
): () => void => {
  const q = query(collection(db, 'supplier_pricing'), orderBy('receivedDate', 'desc'));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(d => ({ ...d.data(), id: d.id } as SupplierPricingRecord))),
    (error) => console.error('supplier_pricing subscription error:', error)
  );
};
