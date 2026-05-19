import {
  collection, doc, getDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, orderBy, runTransaction, serverTimestamp,
  where, writeBatch, DocumentReference, Timestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { SuppliersInvoice, SuppliersInvoiceItem } from '../types';
import { getInventoryRef } from './inventoryService';
import { normalizeVariant } from '../lib/utils';

export type InvoiceFormData = Omit<SuppliersInvoice, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

type UomEntry = { id: string; symbol: string };

// Resolves a uomId (which may be stored as a doc ID or as a symbol) to its canonical doc ID.
const normalizeUomId = (uomId: string, uomList: UomEntry[]): string =>
  uomList.find(u => u.id === uomId || u.symbol === uomId)?.id ?? uomId;

const getConvFactor = (
  itemSnap: any,
  uomId: string,
  uomList: UomEntry[]
): number => {
  if (!itemSnap?.exists()) return 1;
  const d = itemSnap.data();
  if (!d) return 1;
  const norm = (id: string) => normalizeUomId(id, uomList);
  const normalizedTarget = norm(uomId);
  if (norm(d.uomId) === normalizedTarget) return 1;
  const conv = (d.uomConversions || []).find((c: any) => norm(c.uomId) === normalizedTarget);
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

const fetchUomList = async (): Promise<UomEntry[]> => {
  const snap = await getDocs(collection(db, 'uoms'));
  return snap.docs.map(d => ({ id: d.id, symbol: d.data().symbol as string }));
};

export interface DeleteInconsistency {
  itemName: string;
  issue: 'not_found' | 'insufficient_qty';
  available: number;
  required: number;
}

export interface DeleteCheckResult {
  hasInconsistencies: boolean;
  inconsistencies: DeleteInconsistency[];
}

export const checkDeleteSuppliersInvoice = async (
  invoice: SuppliersInvoice
): Promise<DeleteCheckResult> => {
  if (invoice.addToInventory === false) {
    return { hasInconsistencies: false, inconsistencies: [] };
  }

  const uomList = await fetchUomList();

  // Fetch item docs for convFactor resolution
  const uniqueItemIds = [...new Set(invoice.items.map(i => i.itemId))];
  const itemSnaps = new Map<string, any>();
  await Promise.all(
    uniqueItemIds.map(async id => {
      itemSnaps.set(id, await getDoc(doc(db, 'items', id)));
    })
  );

  // Accumulate required reversal qty per inventory ref (same logic as deleteSuppliersInvoice)
  const pathMap = new Map<string, { ref: DocumentReference; qty: number; itemName: string }>();
  invoice.items.forEach(item => {
    const r = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec);
    const convFactor = getConvFactor(itemSnaps.get(item.itemId), item.uomId, uomList);
    const qty = item.quantity * convFactor;
    const existing = pathMap.get(r.path);
    pathMap.set(r.path, {
      ref: r,
      qty: (existing?.qty ?? 0) + qty,
      itemName: existing?.itemName ?? item.itemName,
    });
  });

  // Check each inventory doc for existence and sufficient quantity
  const inconsistencies: DeleteInconsistency[] = [];
  await Promise.all(
    [...pathMap.values()].map(async ({ ref, qty, itemName }) => {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        inconsistencies.push({ itemName, issue: 'not_found', available: 0, required: qty });
      } else {
        const available = snap.data()?.quantity ?? 0;
        if (available < qty) {
          inconsistencies.push({ itemName, issue: 'insufficient_qty', available, required: qty });
        }
      }
    })
  );

  return { hasInconsistencies: inconsistencies.length > 0, inconsistencies };
};

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
    const uomList = await fetchUomList();
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
          const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
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
            const itemRows = data.items.filter(i => i.itemId === itemId);
            const variantPriceMap = new Map<string, { price: number; item: SuppliersInvoiceItem }>();
            for (const row of itemRows) {
              variantPriceMap.set(normalizeVariant(row.variant), { price: row.unitPrice, item: row });
            }
            const isVariantItem = itemData.variantAttributes && itemData.variantAttributes.length > 0;
            if (isVariantItem) {
              const configs: any[] = itemData.variantConfigs ? itemData.variantConfigs.map((c: any) => ({ ...c })) : [];
              for (const [vk, { price, item }] of variantPriceMap) {
                if (!item.variant || Object.keys(item.variant).length === 0) continue;
                const convFactor = getConvFactor(snap, item.uomId, uomList);
                const unitCostPerBase = price / convFactor;
                const idx = configs.findIndex((c: any) => normalizeVariant(c.variant) === vk);
                if (idx >= 0) {
                  configs[idx] = { ...configs[idx], latestPrice: unitCostPerBase, latestPriceDate: invoiceTimestamp };
                } else {
                  configs.push({ variant: item.variant, latestPrice: unitCostPerBase, latestPriceDate: invoiceTimestamp });
                }
                const phRef = doc(collection(db, 'price_history'));
                txn.set(phRef, {
                  id: phRef.id,
                  itemId,
                  variantKey: vk === '{}' ? null : vk,
                  variant: item.variant,
                  date: invoiceTimestamp,
                  price: unitCostPerBase,
                  source: 'invoice',
                  sourceId: invoiceRef.id,
                  sourceRef: data.billNumber,
                });
              }
              itemUpdate.variantConfigs = configs;
            } else {
              const firstRow = data.items.find(i => i.itemId === itemId);
              if (firstRow) {
                const convFactor = getConvFactor(snap, firstRow.uomId, uomList);
                const unitCostPerBase = firstRow.unitPrice / convFactor;
                itemUpdate.latestPrice = unitCostPerBase;
                itemUpdate.latestPriceDate = invoiceTimestamp;
                const phRef = doc(collection(db, 'price_history'));
                txn.set(phRef, {
                  id: phRef.id,
                  itemId,
                  variantKey: null,
                  variant: null,
                  date: invoiceTimestamp,
                  price: unitCostPerBase,
                  source: 'invoice',
                  sourceId: invoiceRef.id,
                  sourceRef: data.billNumber,
                });
              }
            }
          }

          txn.update(doc(db, 'items', itemId), itemUpdate);
        }
      }

      // Per-item records (supplier_pricing + transaction) — these always use new doc refs, no conflict
      for (const item of data.items) {
        if (!itemDocSnaps.get(item.itemId)?.exists()) continue;
        const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
        const baseQty = item.quantity * convFactor;

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
          baseQuantity: baseQty,
          totalCost: item.totalPrice,
          receivedDate: data.purchaseDate,
          conversionFactor: convFactor,
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
          conversionFactor: convFactor,
          baseQuantity: baseQty,
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
    const uomList = await fetchUomList();

    // Delete stale supplier_pricing records before the transaction (best-effort)
    try {
      const spSnap = await getDocs(query(collection(db, 'supplier_pricing'), where('poId', '==', invoice.id)));
      if (!spSnap.empty) {
        const batch = writeBatch(db);
        spSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {
      // Non-blocking — stale records will be overwritten on next full sync
    }

    // Delete stale price_history records before the transaction (best-effort)
    try {
      const phSnap = await getDocs(query(collection(db, 'price_history'), where('sourceId', '==', invoice.id)));
      if (!phSnap.empty) {
        const batch = writeBatch(db);
        phSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {
      // Non-blocking
    }

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

      // Unit cost per inventory path from the NEW invoice items (for averageCost blending)
      const newInvUnitCostMap = new Map<string, number>();
      if (newAddsInventory) {
        newData.items.forEach(item => {
          const path = getInventoryRef(item.itemId, newData.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
          newInvUnitCostMap.set(path, item.unitPrice / cf);
        });
      }

      // Old unit cost per path — needed to un-blend the old price when quantity is unchanged
      const oldInvUnitCostMap = new Map<string, number>();
      if (oldAddsInventory) {
        invoice.items.forEach(item => {
          const path = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
          oldInvUnitCostMap.set(path, item.unitPrice / cf);
        });
      }

      // Absolute base qty per path for the new invoice (needed for price-correction formula)
      const newInvAbsQtyMap = new Map<string, number>();
      if (newAddsInventory) {
        newData.items.forEach(item => {
          const path = getInventoryRef(item.itemId, newData.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
          newInvAbsQtyMap.set(path, (newInvAbsQtyMap.get(path) || 0) + item.quantity * cf);
        });
      }

      // Net inventory quantity delta per path (new − old), in base UOM
      const invNetDelta = new Map<string, number>();
      if (oldAddsInventory) {
        invoice.items.forEach(item => {
          const path = getInventoryRef(item.itemId, invoice.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
          invNetDelta.set(path, (invNetDelta.get(path) || 0) - item.quantity * cf);
        });
      }
      if (newAddsInventory) {
        newData.items.forEach(item => {
          const path = getInventoryRef(item.itemId, newData.locationId, item.variant, undefined, undefined, item.customSpec).path;
          const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
          invNetDelta.set(path, (invNetDelta.get(path) || 0) + item.quantity * cf);
        });
      }

      // Apply inventory quantity + averageCost changes, and write audit transaction records
      for (const [path, delta] of invNetDelta) {
        const ref = invRefMap.get(path)!;
        const snap = invSnaps.get(path);
        const existingQty = snap?.exists() ? (snap.data()?.quantity || 0) : 0;
        const existingCost = snap?.exists() ? (snap.data()?.averageCost ?? 0) : 0;

        if (delta === 0) {
          // Price-only edit: quantity unchanged but cost may have changed.
          // Correct the weighted average: newAvg = oldAvg + (newUnit - oldUnit) * invoiceQty / existingQty
          const newUnitCostPerBase = newInvUnitCostMap.get(path);
          if (newUnitCostPerBase !== undefined && snap?.exists() && existingQty > 0) {
            const oldUnitCostPerBase = oldInvUnitCostMap.get(path) ?? existingCost;
            const invoiceBaseQty = newInvAbsQtyMap.get(path) ?? 0;
            const correctedAvgCost = existingCost + (newUnitCostPerBase - oldUnitCostPerBase) * invoiceBaseQty / existingQty;
            txn.update(ref, { averageCost: correctedAvgCost });
          }
          continue;
        }

        const newQty = existingQty + delta;
        const unitCostPerBase = newInvUnitCostMap.get(path) ?? existingCost;
        // Only blend averageCost when adding; removals keep the same per-unit cost
        const newAvgCost = delta > 0 && newQty > 0
          ? (existingQty * existingCost + delta * unitCostPerBase) / newQty
          : existingCost;

        if (snap?.exists()) {
          txn.update(ref, { quantity: newQty, averageCost: newAvgCost });
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
              averageCost: newAvgCost,
            });
          }
        }

        // Audit transaction record
        const isAddition = delta > 0;
        const sourceItem = isAddition
          ? newData.items.find(i => getInventoryRef(i.itemId, newData.locationId, i.variant, undefined, undefined, i.customSpec).path === path)
          : invoice.items.find(i => getInventoryRef(i.itemId, invoice.locationId, i.variant, undefined, undefined, i.customSpec).path === path);
        if (sourceItem) {
          const srcCf = getConvFactor(itemDocSnaps.get(sourceItem.itemId), sourceItem.uomId, uomList);
          const txnDocRef = doc(collection(db, 'transactions'));
          txn.set(txnDocRef, {
            itemId: sourceItem.itemId,
            variant: sourceItem.variant && Object.keys(sourceItem.variant).length > 0 ? sourceItem.variant : null,
            quantity: delta,
            uomId: sourceItem.uomId,
            conversionFactor: srcCf,
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

      // Net totalQuantity delta per itemId, in base UOM
      const itemQtyDelta = new Map<string, number>();
      if (oldAddsInventory) {
        invoice.items.forEach(i => {
          const cf = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId, uomList);
          itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) - i.quantity * cf);
        });
      }
      if (newAddsInventory) {
        newData.items.forEach(i => {
          const cf = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId, uomList);
          itemQtyDelta.set(i.itemId, (itemQtyDelta.get(i.itemId) || 0) + i.quantity * cf);
        });
      }

      // Invoice timestamp for new price_history docs
      const newInvoiceTimestamp = newData.purchaseDate instanceof Timestamp ? newData.purchaseDate : Timestamp.now();

      // All itemIds that need a write: quantity-delta items + price-update items
      const needsPriceUpdate = newData.updateLatestPrice && newAddsInventory;
      const allItemIds = new Set<string>([
        ...Array.from(itemQtyDelta.keys()),
        ...(needsPriceUpdate ? newData.items.map(i => i.itemId) : []),
      ]);

      for (const itemId of allItemIds) {
        const snap = itemDocSnaps.get(itemId);
        if (!snap?.exists()) continue;
        const itemData = snap.data();
        const itemUpdate: Record<string, any> = {};

        // totalQuantity update
        const qtyDelta = itemQtyDelta.get(itemId) || 0;
        if (qtyDelta !== 0) {
          itemUpdate.totalQuantity = Math.max(0, (itemData.totalQuantity || 0) + qtyDelta);
        }

        // Price update: write fresh price_history docs (old ones deleted pre-transaction)
        if (needsPriceUpdate && newData.items.some(i => i.itemId === itemId)) {
          const itemRows = newData.items.filter(i => i.itemId === itemId);
          const variantPriceMap = new Map<string, { price: number; item: SuppliersInvoiceItem }>();
          for (const row of itemRows) {
            variantPriceMap.set(normalizeVariant(row.variant), { price: row.unitPrice, item: row });
          }

          const isVariantItem = itemData.variantAttributes && itemData.variantAttributes.length > 0;
          if (isVariantItem) {
            const configs: any[] = itemData.variantConfigs ? itemData.variantConfigs.map((c: any) => ({ ...c })) : [];
            for (const [vk, { price, item }] of variantPriceMap) {
              if (!item.variant || Object.keys(item.variant).length === 0) continue;
              const cf = getConvFactor(snap, item.uomId, uomList);
              const unitCostPerBase = price / cf;
              const idx = configs.findIndex((c: any) => normalizeVariant(c.variant) === vk);
              if (idx >= 0) {
                configs[idx] = { ...configs[idx], latestPrice: unitCostPerBase, latestPriceDate: newInvoiceTimestamp };
              } else {
                configs.push({ variant: item.variant, latestPrice: unitCostPerBase, latestPriceDate: newInvoiceTimestamp });
              }
              const phRef = doc(collection(db, 'price_history'));
              txn.set(phRef, {
                id: phRef.id,
                itemId,
                variantKey: vk === '{}' ? null : vk,
                variant: item.variant,
                date: newInvoiceTimestamp,
                price: unitCostPerBase,
                source: 'invoice',
                sourceId: invoice.id,
                sourceRef: newData.billNumber,
              });
            }
            itemUpdate.variantConfigs = configs;
          } else {
            const firstRow = newData.items.find(i => i.itemId === itemId);
            if (firstRow) {
              const cf = getConvFactor(snap, firstRow.uomId, uomList);
              const unitCostPerBase = firstRow.unitPrice / cf;
              itemUpdate.latestPrice = unitCostPerBase;
              itemUpdate.latestPriceDate = newInvoiceTimestamp;
              const phRef = doc(collection(db, 'price_history'));
              txn.set(phRef, {
                id: phRef.id,
                itemId,
                variantKey: null,
                variant: null,
                date: newInvoiceTimestamp,
                price: unitCostPerBase,
                source: 'invoice',
                sourceId: invoice.id,
                sourceRef: newData.billNumber,
              });
            }
          }
        }

        if (Object.keys(itemUpdate).length > 0) {
          txn.update(doc(db, 'items', itemId), itemUpdate);
        }
      }

      // Write fresh supplier_pricing records with corrected conversionFactor
      for (const item of newData.items) {
        if (!itemDocSnaps.get(item.itemId)?.exists()) continue;
        const cf = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
        const baseQty = item.quantity * cf;
        const spRef = doc(collection(db, 'supplier_pricing'));
        txn.set(spRef, {
          id: spRef.id,
          supplierId: newData.supplierName,
          supplierName: newData.supplierName,
          itemId: item.itemId,
          variant: item.variant && Object.keys(item.variant).length > 0 ? item.variant : null,
          uomId: item.uomId,
          unitPrice: item.unitPrice,
          quantityReceived: item.quantity,
          baseQuantity: baseQty,
          totalCost: item.totalPrice,
          receivedDate: newData.purchaseDate,
          conversionFactor: cf,
          poId: invoice.id,
          poNumber: newData.billNumber,
        });
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

export const deleteSuppliersInvoice = async (invoice: SuppliersInvoice, options?: { force?: boolean }): Promise<void> => {
  const userId = auth.currentUser?.uid;
  const force = options?.force ?? false;
  if (!userId) throw new Error('User not authenticated');

  try {
    const uomList = await fetchUomList();

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
        const convFactor = getConvFactor(itemDocSnaps.get(item.itemId), item.uomId, uomList);
        invQtyToRemove.set(path, (invQtyToRemove.get(path) || 0) + item.quantity * convFactor);
      });

      if (invoice.addToInventory !== false) {
        for (const [path, qty] of invQtyToRemove) {
          const ref = invRefMap.get(path)!;
          const snap = invSnaps.get(path);
          if (snap?.exists()) {
            const current = snap.data()?.quantity || 0;
            txn.update(ref, { quantity: force ? Math.max(0, current - qty) : current - qty });
          }
        }

        // Accumulate totalQuantity to remove per itemId (in base UOM)
        const itemQtyToRemove = new Map<string, number>();
        invoice.items.forEach(i => {
          const convFactor = getConvFactor(itemDocSnaps.get(i.itemId), i.uomId, uomList);
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

    // Best-effort cleanup of price_history records linked to this invoice
    try {
      const phSnap = await getDocs(query(collection(db, 'price_history'), where('sourceId', '==', invoice.id)));
      if (!phSnap.empty) {
        const batch = writeBatch(db);
        phSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {
      // Non-blocking — price history records may be left as historical data
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `suppliers_invoices/${invoice.id}`);
    throw error;
  }
};
