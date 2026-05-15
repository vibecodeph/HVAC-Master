import {
  collection, doc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, orderBy, runTransaction, serverTimestamp,
  where, writeBatch, DocumentReference, Timestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { SuppliersInvoice, SuppliersInvoiceItem } from '../types';
import { getInventoryRef } from './inventoryService';
import { normalizeVariant } from '../lib/utils';

export type InvoiceFormData = Omit<SuppliersInvoice, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

const getConvFactor = (itemSnap: any, uomId: string): number => {
  if (!itemSnap?.exists()) return 1;
  const d = itemSnap.data();
  if (!d || d.uomId === uomId) return 1;
  const conv = (d.uomConversions || []).find((c: any) => c.uomId === uomId);
  return conv?.factor > 0 ? conv.factor : 1;
};

const cleanData = (data: any): any => {
  if (data === null || data === undefined || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(cleanData);
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return data;
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, cleanData(v)])
  );
};

const cleanItem = (item: SuppliersInvoiceItem): SuppliersInvoiceItem => ({
  itemId: item.itemId,
  itemName: item.itemName,
  ...(item.variant && Object.keys(item.variant).length > 0 ? { variant: item.variant } : {}),
  ...(item.customSpec ? { customSpec: item.customSpec } : {}),
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
    const linkedPOs = data.linkedPOs || [];

    await runTransaction(db, async txn => {
      // Collect all unique refs
      const invRefMap = new Map<string, DocumentReference>();
      const itemDocRefMap = new Map<string, DocumentReference>();
      data.items.forEach(item => {
        const r = getInventoryRef(item.itemId, data.locationId, item.variant, undefined, undefined, item.customSpec);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });
      const poRefMap = new Map<string, DocumentReference>();
      linkedPOs.forEach(lp => poRefMap.set(lp.poId, doc(db, 'purchase_orders', lp.poId)));

      // Read all
      const invSnaps = new Map<string, any>();
      const itemDocSnaps = new Map<string, any>();
      const poSnaps = new Map<string, any>();
      await Promise.all([
        ...[...invRefMap.entries()].map(async ([k, r]) => invSnaps.set(k, await txn.get(r))),
        ...[...itemDocRefMap.entries()].map(async ([k, r]) => itemDocSnaps.set(k, await txn.get(r))),
        ...[...poRefMap.entries()].map(async ([k, r]) => poSnaps.set(k, await txn.get(r))),
      ]);

      // Write invoice doc
      const firstPOSnap = linkedPOs.length > 0 ? poSnaps.get(linkedPOs[0].poId) : null;
      const previousPOStatus = firstPOSnap?.exists() ? (firstPOSnap.data()?.paymentStatus ?? null) : null;
      txn.set(invoiceRef, cleanData({
        ...data,
        items: data.items.map(cleanItem),
        id: invoiceRef.id,
        invoiceStatus: data.invoiceStatus || 'for_processing',
        ...(previousPOStatus ? { previousPOStatus } : {}),
        createdBy: userId,
        createdAt: serverTimestamp(),
      }));

      if (data.addToInventory !== false) {
        const invoiceTimestamp = data.purchaseDate instanceof Timestamp ? data.purchaseDate : Timestamp.now();

        // Pre-accumulate inventory deltas and item costs per unique path/itemId
        const invNetDelta = new Map<string, number>();
        const invUnitCostMap = new Map<string, number>(); // path -> unit price per base
        const itemQtyToAdd = new Map<string, number>();
        for (const item of data.items) {
          const path = getInventoryRef(item.itemId, data.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId);
          const baseQty = item.quantity * convFactor;
          invNetDelta.set(path, (invNetDelta.get(path) || 0) + baseQty);
          invUnitCostMap.set(path, item.unitPrice / convFactor);
          itemQtyToAdd.set(item.itemId, (itemQtyToAdd.get(item.itemId) || 0) + baseQty);
        }

        // Write inventory — once per unique path, including averageCost
        for (const [path, qty] of invNetDelta) {
          const ref = invRefMap.get(path)!;
          const snap = invSnaps.get(path);
          const existingQty = snap?.exists() ? (snap.data()?.quantity || 0) : 0;
          const existingCost = snap?.exists() ? (snap.data()?.averageCost ?? 0) : 0;
          const newQty = existingQty + qty;
          const unitCostPerBase = invUnitCostMap.get(path) || 0;
          const newAvgCost = existingQty > 0 && newQty > 0
            ? (existingQty * existingCost + qty * unitCostPerBase) / newQty
            : unitCostPerBase;
          if (snap?.exists()) {
            txn.update(ref, { quantity: newQty, averageCost: newAvgCost });
          } else {
            const srcItem = data.items.find(i =>
              getInventoryRef(i.itemId, data.locationId, i.variant, undefined, undefined, i.customSpec).path === path
            );
            if (srcItem) {
              txn.set(ref, {
                itemId: srcItem.itemId,
                locationId: data.locationId,
                variant: srcItem.variant && Object.keys(srcItem.variant).length > 0 ? srcItem.variant : null,
                ...(srcItem.customSpec ? { customSpec: srcItem.customSpec } : {}),
                quantity: newQty,
                averageCost: newAvgCost,
              });
            }
          }
        }

        // Write item totalQuantity + optional latestPrice — once per unique itemId
        for (const [itemId, addedQty] of itemQtyToAdd) {
          const snap = itemDocSnaps.get(itemId);
          if (!snap?.exists()) continue;
          const itemData = snap.data();
          const currentTotal = itemData.totalQuantity || 0;
          const newTotal = currentTotal + addedQty;
          const itemUpdate: Record<string, any> = {
            totalQuantity: isNaN(newTotal) ? currentTotal : newTotal,
          };

          if (data.updateLatestPrice) {
            // Group items by variant to determine latest price per variant
            const itemRows = data.items.filter(i => i.itemId === itemId);
            // Use the last row per variant as the latest price (invoice is treated as one event)
            const variantPriceMap = new Map<string, { price: number; item: SuppliersInvoiceItem }>();
            for (const row of itemRows) {
              const vk = normalizeVariant(row.variant);
              variantPriceMap.set(vk, { price: row.unitPrice, item: row });
            }
            const isVariantItem = itemData.variantAttributes && itemData.variantAttributes.length > 0;
            if (isVariantItem) {
              const configs: any[] = itemData.variantConfigs ? itemData.variantConfigs.map((c: any) => ({ ...c })) : [];
              for (const [vk, { price, item }] of variantPriceMap) {
                if (!item.variant || Object.keys(item.variant).length === 0) continue;
                const convFactor = getConvFactor(snap, item.uomId);
                const unitCostPerBase = price / convFactor;
                const idx = configs.findIndex((c: any) => normalizeVariant(c.variant) === vk);
                const prevHistory: any[] = idx >= 0 ? (configs[idx].priceHistory || []) : [];
                const newHistory = [...prevHistory, { date: invoiceTimestamp, price: unitCostPerBase, source: 'invoice' }].slice(-50);
                if (idx >= 0) {
                  configs[idx] = { ...configs[idx], latestPrice: unitCostPerBase, latestPriceDate: invoiceTimestamp, priceHistory: newHistory };
                } else {
                  configs.push({ variant: item.variant, latestPrice: unitCostPerBase, latestPriceDate: invoiceTimestamp, priceHistory: newHistory });
                }
              }
              itemUpdate.variantConfigs = configs;
            } else {
              // No-variant item: use first row's price
              const firstRow = data.items.find(i => i.itemId === itemId);
              if (firstRow) {
                const convFactor = getConvFactor(snap, firstRow.uomId);
                const unitCostPerBase = firstRow.unitPrice / convFactor;
                const prevHistory: any[] = itemData.priceHistory || [];
                itemUpdate.latestPrice = unitCostPerBase;
                itemUpdate.latestPriceDate = invoiceTimestamp;
                itemUpdate.priceHistory = [...prevHistory, { date: invoiceTimestamp, price: unitCostPerBase, source: 'invoice' }].slice(-50);
              }
            }
          }

          txn.update(doc(db, 'items', itemId), itemUpdate);
        }
      }

      // Per-item records (supplier_pricing + transaction) — these always use new doc refs, no conflict
      for (const item of data.items) {
        if (!itemDocSnaps.get(item.itemId)?.exists()) continue;

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
          invoiceId: invoiceRef.id,
          notes: `Supplier: ${data.supplierName} — Bill#: ${data.billNumber}`,
          timestamp: serverTimestamp(),
          userId,
          userName,
        });
      }

      // Update linked PO status
      if (linkedPOs.length > 0) {
        if (data.payment) {
          const totalLinkedAmt = linkedPOs.reduce((s, lp) => {
            const snap = poSnaps.get(lp.poId);
            return s + (snap?.exists() ? (snap.data()?.totalAmount || 0) : 0);
          }, 0);

          for (const linkedPO of linkedPOs) {
            const snap = poSnaps.get(linkedPO.poId);
            if (!snap?.exists()) continue;
            const poData = snap.data();
            const poTotal = poData.totalAmount || 0;
            const proportion = totalLinkedAmt > 0 ? poTotal / totalLinkedAmt : 1;
            const allocated = data.payment.amount * proportion;
            const newPaid = (poData.amountPaid || 0) + allocated;
            const newStatus = newPaid >= poTotal ? 'fully_paid' : newPaid > 0 ? 'partially_paid' : 'unpaid';
            txn.update(poRefMap.get(linkedPO.poId)!, {
              amountPaid: newPaid,
              paymentStatus: newStatus,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            });
          }
        } else {
          // No payment recorded — mark PO as with_invoice to prevent duplicate invoicing
          for (const linkedPO of linkedPOs) {
            const snap = poSnaps.get(linkedPO.poId);
            if (!snap?.exists()) continue;
            txn.update(poRefMap.get(linkedPO.poId)!, {
              paymentStatus: 'with_invoice',
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            });
          }
        }
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
  const userName = auth.currentUser?.displayName || '';
  if (!userId) throw new Error('User not authenticated');

  try {
    await runTransaction(db, async txn => {
      // Collect all unique refs from old and new items
      const invRefMap = new Map<string, DocumentReference>();
      const itemDocRefMap = new Map<string, DocumentReference>();

      invoice.items.forEach(item => {
        const r = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });
      newData.items.forEach(item => {
        const r = getInventoryRef(item.itemId, newData.locationId, item.variant, undefined, undefined, item.customSpec);
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

      const oldAddsInventory = invoice.addToInventory !== false;
      const newAddsInventory = newData.addToInventory !== false;

      // Compute net inventory delta per ref (new - old), quantities in base UOM
      const invNetDelta = new Map<string, number>();
      if (oldAddsInventory) {
        invoice.items.forEach(item => {
          const path = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId);
          invNetDelta.set(path, (invNetDelta.get(path) || 0) - item.quantity * convFactor);
        });
      }
      if (newAddsInventory) {
        newData.items.forEach(item => {
          const path = getInventoryRef(item.itemId, newData.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId);
          invNetDelta.set(path, (invNetDelta.get(path) || 0) + item.quantity * convFactor);
        });
      }

      // Apply inventory changes + create transaction records
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
            getInventoryRef(i.itemId, newData.locationId, i.variant, undefined, undefined, i.customSpec).path === path
          );
          if (newItem) {
            txn.set(ref, {
              itemId: newItem.itemId,
              locationId: newData.locationId,
              variant: newItem.variant && Object.keys(newItem.variant).length > 0 ? newItem.variant : null,
              ...(newItem.customSpec ? { customSpec: newItem.customSpec } : {}),
              quantity: newQty,
            });
          }
        }

        // Transaction record for audit trail
        const isAddition = delta > 0;
        const sourceItem = isAddition
          ? newData.items.find(i => getInventoryRef(i.itemId, newData.locationId, i.variant, undefined, undefined, i.customSpec).path === path)
          : invoice.items.find(i => getInventoryRef(i.itemId, invoice.locationId, i.variant, undefined, undefined, i.customSpec).path === path);
        if (sourceItem) {
          const txnDocRef = doc(collection(db, 'transactions'));
          txn.set(txnDocRef, {
            itemId: sourceItem.itemId,
            variant: sourceItem.variant && Object.keys(sourceItem.variant).length > 0 ? sourceItem.variant : null,
            quantity: delta,
            uomId: sourceItem.uomId,
            conversionFactor: 1,
            baseQuantity: delta,
            type: 'supplier_invoice',
            toLocationId: isAddition ? newData.locationId : null,
            fromLocationId: isAddition ? null : invoice.locationId,
            unitPrice: sourceItem.unitPrice,
            totalPrice: Math.abs(delta) * sourceItem.unitPrice,
            supplierInvoice: newData.billNumber,
            invoiceId: invoice.id,
            notes: `Edit — Supplier: ${newData.supplierName} — Bill#: ${newData.billNumber}`,
            timestamp: serverTimestamp(),
            userId,
            userName,
          });
        }
      }

      // Compute net totalQuantity delta per itemId (all quantities in base UOM)
      const itemQtyDelta = new Map<string, number>();
      if (oldAddsInventory) {
        invoice.items.forEach(i => {
          const convFactor = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId);
          itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) - i.quantity * convFactor);
        });
      }
      if (newAddsInventory) {
        newData.items.forEach(i => {
          const convFactor = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId);
          itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) + i.quantity * convFactor);
        });
      }

      for (const [itemId, delta] of itemQtyDelta) {
        if (delta === 0) continue;
        const snap = itemDocSnaps.get(itemId);
        if (!snap?.exists()) continue;
        const itemData = snap.data();
        const currentTotal = itemData.totalQuantity || 0;
        const newTotal = Math.max(0, currentTotal + delta);
        txn.update(doc(db, 'items', itemId), { totalQuantity: newTotal });
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
        addToInventory: newData.addToInventory !== false,
        payment: newData.payment || null,
        invoiceStatus: newData.invoiceStatus || 'for_processing',
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
        const r = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec);
        invRefMap.set(r.path, r);
        itemDocRefMap.set(item.itemId, doc(db, 'items', item.itemId));
      });
      const linkedPOs = invoice.linkedPOs || [];
      const poRefMap = new Map<string, DocumentReference>();
      if (linkedPOs.length > 0) {
        linkedPOs.forEach(lp => poRefMap.set(lp.poId, doc(db, 'purchase_orders', lp.poId)));
      }

      // Read all
      const invSnaps = new Map<string, any>();
      const itemDocSnaps = new Map<string, any>();
      const poSnaps = new Map<string, any>();
      await Promise.all([
        ...[...invRefMap.entries()].map(async ([k, r]) => invSnaps.set(k, await txn.get(r))),
        ...[...itemDocRefMap.entries()].map(async ([k, r]) => itemDocSnaps.set(k, await txn.get(r))),
        ...[...poRefMap.entries()].map(async ([k, r]) => poSnaps.set(k, await txn.get(r))),
      ]);

      // Accumulate inventory qty to remove per ref (in base UOM)
      const invQtyToRemove = new Map<string, number>();
      invoice.items.forEach(item => {
        const path = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec).path;
        const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId);
        invQtyToRemove.set(path, (invQtyToRemove.get(path) || 0) + item.quantity * convFactor);
      });

      if (invoice.addToInventory !== false) {
        for (const [path, qty] of invQtyToRemove) {
          const ref = invRefMap.get(path)!;
          const snap = invSnaps.get(path);
          if (snap?.exists()) {
            txn.update(ref, { quantity: (snap.data()?.quantity || 0) - qty });
          }
        }

        // Accumulate totalQuantity to remove per itemId (in base UOM)
        const itemQtyToRemove = new Map<string, number>();
        invoice.items.forEach(i => {
          const convFactor = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId);
          itemQtyToRemove.set(i.itemId, (itemQtyToRemove.get(i.itemId) || 0) + i.quantity * convFactor);
        });

        for (const [itemId, qty] of itemQtyToRemove) {
          const snap = itemDocSnaps.get(itemId);
          if (snap?.exists()) {
            const currentTotal = snap.data()?.totalQuantity || 0;
            txn.update(doc(db, 'items', itemId), { totalQuantity: Math.max(0, currentTotal - qty) });
          }
        }
      }

      txn.delete(doc(db, 'suppliers_invoices', invoice.id));

      // Revert linked PO status
      if (linkedPOs.length > 0) {
        const revertStatus = invoice.previousPOStatus || 'unpaid';
        if (invoice.payment) {
          const totalLinkedAmt = linkedPOs.reduce((s, lp) => s + lp.amount, 0);
          for (const lp of linkedPOs) {
            const snap = poSnaps.get(lp.poId);
            if (!snap?.exists()) continue;
            const poData = snap.data();
            const poTotal = poData.totalAmount || 0;
            const proportion = totalLinkedAmt > 0 ? lp.amount / totalLinkedAmt : 1;
            const allocated = invoice.payment.amount * proportion;
            const newPaid = Math.max(0, (poData.amountPaid || 0) - allocated);
            const newStatus = newPaid >= poTotal ? 'fully_paid'
              : newPaid > 0 ? 'partially_paid'
              : revertStatus;
            txn.update(poRefMap.get(lp.poId)!, {
              amountPaid: newPaid,
              paymentStatus: newStatus,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            });
          }
        } else {
          for (const lp of linkedPOs) {
            const snap = poSnaps.get(lp.poId);
            if (!snap?.exists()) continue;
            txn.update(poRefMap.get(lp.poId)!, {
              paymentStatus: revertStatus,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            });
          }
        }
      }
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

    // Best-effort cleanup of transaction records linked to this invoice
    try {
      const txSnap = await getDocs(query(collection(db, 'transactions'), where('invoiceId', '==', invoice.id)));
      if (!txSnap.empty) {
        const batch = writeBatch(db);
        txSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {
      // Non-blocking — transaction records may be left as historical data
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `suppliers_invoices/${invoice.id}`);
    throw error;
  }
};
