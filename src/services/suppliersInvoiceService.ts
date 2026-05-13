import {
  collection, doc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, orderBy, runTransaction, serverTimestamp,
  where, writeBatch, DocumentReference,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { SuppliersInvoice, SuppliersInvoiceItem } from '../types';
import { getInventoryRef } from './inventoryService';

export type InvoiceFormData = Omit<SuppliersInvoice, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

const cleanItem = (item: SuppliersInvoiceItem): SuppliersInvoiceItem => ({
  itemId: item.itemId,
  itemName: item.itemName,
  ...(item.variant && Object.keys(item.variant).length > 0 ? { variant: item.variant } : {}),
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  uomId: item.uomId,
  uomSymbol: item.uomSymbol,
  totalPrice: item.totalPrice,
});

export const subscribeToSuppliersInvoices = (
  callback: (invoices: SuppliersInvoice[]) => void
): () => void => {
  const q = query(collection(db, 'suppliers_invoices'), orderBy('purchaseDate', 'desc'));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ ...d.data(), id: d.id } as SuppliersInvoice))),
    error => console.error('suppliers_invoices subscription error:', error)
  );
};

export const createSuppliersInvoice = async (data: InvoiceFormData): Promise<string> => {
  const userId = auth.currentUser?.uid;
  const userName = auth.currentUser?.displayName || '';
  if (!userId) throw new Error('User not authenticated');

  try {
    const invoiceRef = doc(collection(db, 'suppliers_invoices'));

    await runTransaction(db, async txn => {
      // Collect all unique refs
      const invRefMap = new Map<string, DocumentReference>();
      const itemDocRefMap = new Map<string, DocumentReference>();
      data.items.forEach(item => {
        const r = getInventoryRef(item.itemId, data.locationId, item.variant);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });

      // Read all
      const invSnaps = new Map<string, any>();
      const itemDocSnaps = new Map<string, any>();
      await Promise.all([
        ...[...invRefMap.entries()].map(async ([k, r]) => invSnaps.set(k, await txn.get(r))),
        ...[...itemDocRefMap.entries()].map(async ([k, r]) => itemDocSnaps.set(k, await txn.get(r))),
      ]);

      // Write invoice doc
      txn.set(invoiceRef, {
        ...data,
        items: data.items.map(cleanItem),
        id: invoiceRef.id,
        createdBy: userId,
        createdAt: serverTimestamp(),
      });

      // Process each item
      for (const item of data.items) {
        const invRef = getInventoryRef(item.itemId, data.locationId, item.variant);
        const invSnap = invSnaps.get(invRef.path);
        const itemDocSnap = itemDocSnaps.get(item.itemId);
        if (!itemDocSnap?.exists()) continue;

        // Update inventory
        const existingQty = invSnap?.exists() ? (invSnap.data()?.quantity || 0) : 0;
        const newQty = existingQty + item.quantity;
        if (invSnap?.exists()) {
          txn.update(invRef, { quantity: newQty });
        } else {
          txn.set(invRef, {
            itemId: item.itemId,
            locationId: data.locationId,
            variant: item.variant && Object.keys(item.variant).length > 0 ? item.variant : null,
            quantity: newQty,
          });
        }

        // Update item totalQuantity + averageCost (weighted average)
        const itemData = itemDocSnap.data();
        const currentAvg = itemData.averageCost || 0;
        const currentTotal = itemData.totalQuantity || 0;
        const newTotal = currentTotal + item.quantity;
        const newAvg = newTotal > 0
          ? ((currentTotal * currentAvg) + (item.quantity * item.unitPrice)) / newTotal
          : item.unitPrice;
        txn.update(doc(db, 'items', item.itemId), {
          totalQuantity: isNaN(newTotal) ? currentTotal : newTotal,
          averageCost: isNaN(newAvg) ? currentAvg : newAvg,
        });

        // Supplier pricing record
        const spRef = doc(collection(db, 'supplier_pricing'));
        txn.set(spRef, {
          id: spRef.id,
          supplierId: data.supplierName,
          supplierName: data.supplierName,
          itemId: item.itemId,
          variant: item.variant && Object.keys(item.variant).length > 0 ? item.variant : null,
          uomId: item.uomId,
          unitPrice: item.unitPrice,
          quantityReceived: item.quantity,
          baseQuantity: item.quantity,
          totalCost: item.totalPrice,
          receivedDate: data.purchaseDate,
          conversionFactor: 1,
          poId: invoiceRef.id,
          poNumber: data.billNumber,
        });

        // Transaction record
        const txnDocRef = doc(collection(db, 'transactions'));
        txn.set(txnDocRef, {
          itemId: item.itemId,
          variant: item.variant && Object.keys(item.variant).length > 0 ? item.variant : null,
          quantity: item.quantity,
          uomId: item.uomId,
          conversionFactor: 1,
          baseQuantity: item.quantity,
          type: 'supplier_invoice',
          toLocationId: data.locationId,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          supplierInvoice: data.billNumber,
          notes: `Supplier: ${data.supplierName} — Bill#: ${data.billNumber}`,
          timestamp: serverTimestamp(),
          userId,
          userName,
        });
      }
    });

    return invoiceRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'suppliers_invoices');
    throw error;
  }
};

export const updateSuppliersInvoice = async (
  invoice: SuppliersInvoice,
  newData: InvoiceFormData
): Promise<void> => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await runTransaction(db, async txn => {
      // Collect all unique refs from old and new items
      const invRefMap = new Map<string, DocumentReference>();
      const itemDocRefMap = new Map<string, DocumentReference>();

      invoice.items.forEach(item => {
        const r = getInventoryRef(item.itemId, invoice.locationId, item.variant);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });
      newData.items.forEach(item => {
        const r = getInventoryRef(item.itemId, newData.locationId, item.variant);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });

      // Read all
      const invSnaps = new Map<string, any>();
      const itemDocSnaps = new Map<string, any>();
      await Promise.all([
        ...[...invRefMap.entries()].map(async ([k, r]) => invSnaps.set(k, await txn.get(r))),
        ...[...itemDocRefMap.entries()].map(async ([k, r]) => itemDocSnaps.set(k, await txn.get(r))),
      ]);

      // Compute net inventory delta per ref (new - old)
      const invNetDelta = new Map<string, number>();
      invoice.items.forEach(item => {
        const path = getInventoryRef(item.itemId, invoice.locationId, item.variant).path;
        invNetDelta.set(path, (invNetDelta.get(path) || 0) - item.quantity);
      });
      newData.items.forEach(item => {
        const path = getInventoryRef(item.itemId, newData.locationId, item.variant).path;
        invNetDelta.set(path, (invNetDelta.get(path) || 0) + item.quantity);
      });

      // Apply inventory changes
      for (const [path, delta] of invNetDelta) {
        if (delta === 0) continue;
        const ref = invRefMap.get(path)!;
        const snap = invSnaps.get(path);
        const current = snap?.exists() ? (snap.data()?.quantity || 0) : 0;
        const newQty = current + delta;
        if (snap?.exists()) {
          txn.update(ref, { quantity: newQty });
        } else if (newQty > 0) {
          const newItem = newData.items.find(i =>
            getInventoryRef(i.itemId, newData.locationId, i.variant).path === path
          );
          if (newItem) {
            txn.set(ref, {
              itemId: newItem.itemId,
              locationId: newData.locationId,
              variant: newItem.variant && Object.keys(newItem.variant).length > 0 ? newItem.variant : null,
              quantity: newQty,
            });
          }
        }
      }

      // Compute net totalQuantity delta per itemId + averageCost
      const itemQtyDelta = new Map<string, number>();
      invoice.items.forEach(i => itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) - i.quantity));
      newData.items.forEach(i => itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) + i.quantity));

      for (const [itemId, delta] of itemQtyDelta) {
        if (delta === 0) continue;
        const snap = itemDocSnaps.get(itemId);
        if (!snap?.exists()) continue;
        const itemData = snap.data();
        const currentTotal = itemData.totalQuantity || 0;
        const currentAvg = itemData.averageCost || 0;
        const newTotal = Math.max(0, currentTotal + delta);
        const update: Record<string, any> = { totalQuantity: newTotal };

        if (delta > 0) {
          const addedItems = newData.items.filter(i => i.itemId === itemId);
          const removedQty = invoice.items.filter(i => i.itemId === itemId).reduce((s, i) => s + i.quantity, 0);
          const baseQty = Math.max(0, currentTotal - removedQty);
          const addedQty = addedItems.reduce((s, i) => s + i.quantity, 0);
          const addedCost = addedItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
          const totalForAvg = baseQty + addedQty;
          if (totalForAvg > 0) {
            const newAvg = ((baseQty * currentAvg) + addedCost) / totalForAvg;
            update.averageCost = isNaN(newAvg) ? currentAvg : newAvg;
          }
        }

        txn.update(doc(db, 'items', itemId), update);
      }

      // Update invoice doc
      txn.update(doc(db, 'suppliers_invoices', invoice.id), {
        supplierName: newData.supplierName,
        billNumber: newData.billNumber,
        purchaseDate: newData.purchaseDate,
        items: newData.items.map(cleanItem),
        locationId: newData.locationId,
        locationName: newData.locationName,
        totalAmount: newData.totalAmount,
        notes: newData.notes || null,
        updatedBy: userId,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `suppliers_invoices/${invoice.id}`);
    throw error;
  }
};

export const deleteSuppliersInvoice = async (invoice: SuppliersInvoice): Promise<void> => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await runTransaction(db, async txn => {
      // Collect unique refs
      const invRefMap = new Map<string, DocumentReference>();
      const itemDocRefMap = new Map<string, DocumentReference>();
      invoice.items.forEach(item => {
        const r = getInventoryRef(item.itemId, invoice.locationId, item.variant);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });

      // Read all
      const invSnaps = new Map<string, any>();
      const itemDocSnaps = new Map<string, any>();
      await Promise.all([
        ...[...invRefMap.entries()].map(async ([k, r]) => invSnaps.set(k, await txn.get(r))),
        ...[...itemDocRefMap.entries()].map(async ([k, r]) => itemDocSnaps.set(k, await txn.get(r))),
      ]);

      // Accumulate inventory qty to remove per ref
      const invQtyToRemove = new Map<string, number>();
      invoice.items.forEach(item => {
        const path = getInventoryRef(item.itemId, invoice.locationId, item.variant).path;
        invQtyToRemove.set(path, (invQtyToRemove.get(path) || 0) + item.quantity);
      });

      for (const [path, qty] of invQtyToRemove) {
        const ref = invRefMap.get(path)!;
        const snap = invSnaps.get(path);
        if (snap?.exists()) {
          txn.update(ref, { quantity: (snap.data()?.quantity || 0) - qty });
        }
      }

      // Accumulate totalQuantity to remove per itemId
      const itemQtyToRemove = new Map<string, number>();
      invoice.items.forEach(i => itemQtyToRemove.set(i.itemId, (itemQtyToRemove.get(i.itemId) || 0) + i.quantity));

      for (const [itemId, qty] of itemQtyToRemove) {
        const snap = itemDocSnaps.get(itemId);
        if (snap?.exists()) {
          const currentTotal = snap.data()?.totalQuantity || 0;
          txn.update(doc(db, 'items', itemId), { totalQuantity: Math.max(0, currentTotal - qty) });
        }
      }

      txn.delete(doc(db, 'suppliers_invoices', invoice.id));
    });

    // Best-effort cleanup of supplier_pricing records
    try {
      const spSnap = await getDocs(query(collection(db, 'supplier_pricing'), where('poId', '==', invoice.id)));
      if (!spSnap.empty) {
        const batch = writeBatch(db);
        spSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {
      // Non-blocking — pricing records may be left as historical data
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `suppliers_invoices/${invoice.id}`);
    throw error;
  }
};
