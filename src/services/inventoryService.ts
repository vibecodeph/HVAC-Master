import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  and,
  onSnapshot,
  Timestamp,
  runTransaction,
  serverTimestamp,
  deleteDoc,
  deleteField,
  setDoc,
  limit,
  or,
  orderBy,
  documentId,
  arrayRemove,
  writeBatch,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Item, Category, Location, Inventory, Transaction, UOM, Tag, UserProfile, Asset, Request, BOQItem, UnplannedStock, SystemConfig, PurchaseOrder, POPayment } from '../types';
import { normalizeVariant } from '../lib/utils';
import { startOperation, endOperation } from './activeOperationService';

// --- Generic Helpers ---
const getCollection = (name: string) => collection(db, name);

const cleanData = (data: any): any => {
  if (data === undefined) return null;
  if (data === null || typeof data !== 'object') return data;
  
  // If it's a Date, return as is
  if (data instanceof Date) return data;

  // If it's a Firestore special object (Timestamp, FieldValue, etc.), return as is
  if (typeof data.toDate === 'function' || data instanceof Timestamp) {
    return data;
  }

  if (Array.isArray(data)) return data.map(cleanData).filter(v => v !== undefined && v !== null);
  
  // Check if it's a plain object. If not, it's likely a Firestore internal class instance
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) {
    return data;
  }

  const clean: any = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const val = cleanData(data[key]);
      if (val !== undefined && val !== null) {
        clean[key] = val;
      }
    }
  }
  return clean;
};

export const getInventoryRef = (
  itemId: string,
  locationId: string,
  variant?: Record<string, string>,
  serialNumber?: string,
  propertyNumber?: string,
  customSpec?: string
) => {
  let id = `${itemId}_${locationId}`;
  if (variant && Object.keys(variant).length > 0) {
    const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => {
      acc[key] = variant[key]; return acc;
    }, {} as any);
    id += `_${encodeURIComponent(JSON.stringify(sortedVariant)).replace(/%/g, '_').replace(/\./g, '-')}`;
  }
  if (customSpec) id += `_SPEC-${encodeURIComponent(customSpec).replace(/%/g, '_')}`;
  if (serialNumber) id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
  if (propertyNumber) id += `_PN-${encodeURIComponent(propertyNumber).replace(/%/g, '_')}`;
  if (id.length > 1000) id = id.substring(0, 1000);
  return doc(db, 'inventory', id);
};

const sortVariant = (v: any): string => {
  if (!v) return "{}";
  const sorted = Object.keys(v).sort().reduce((acc, key) => {
    acc[key] = v[key];
    return acc;
  }, {} as any);
  return JSON.stringify(sorted);
};

// --- System Config ---
export const subscribeToSystemConfig = (callback: (config: SystemConfig | null) => void) => {
  return onSnapshot(doc(db, 'system', 'config'), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data() as SystemConfig);
    } else {
      callback(null);
    }
  }, (error) => handleFirestoreError(error, OperationType.GET, 'system_config'));
};

export const updateSystemConfig = async (config: Partial<SystemConfig>) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await setDoc(doc(db, 'system', 'config'), {
      ...cleanData(config),
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'system_config');
  }
};

// --- Inventory Operations ---

export const recordTransaction = async (transaction: Omit<Transaction, 'id' | 'userId'>, userName?: string) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  const { 
    itemId, variant, customSpec, serialNumber, propertyNumber, 
    fromLocationId, toLocationId, quantity, uomId, 
    conversionFactor, baseQuantity, type, notes, 
    totalPrice, unitPrice, poNumber, poId, supplierInvoice, supplierDR,
    timestamp
  } = transaction;

  const transactionData: any = {
    itemId,
    quantity,
    uomId,
    conversionFactor,
    baseQuantity,
    type,
    userId,
    userName: userName || '',
    timestamp: timestamp || Timestamp.now()
  };

  if (variant) transactionData.variant = variant;
  if (customSpec) transactionData.customSpec = customSpec;
  if (serialNumber) transactionData.serialNumber = serialNumber;
  if (propertyNumber) transactionData.propertyNumber = propertyNumber;
  if (fromLocationId) transactionData.fromLocationId = fromLocationId;
  if (toLocationId) transactionData.toLocationId = toLocationId;
  if (notes) transactionData.notes = notes;
  if (totalPrice !== undefined) transactionData.totalPrice = totalPrice;
  if (unitPrice !== undefined) transactionData.unitPrice = unitPrice;
  if (poNumber) transactionData.poNumber = poNumber;
  if (poId) transactionData.poId = poId;
  if (supplierInvoice) transactionData.supplierInvoice = supplierInvoice;
  if (supplierDR) transactionData.supplierDR = supplierDR;

  try {
    // PRE-FETCH BOQ IDs (Queries not allowed in transactions)
    let boqToId: string | null = null;
    let boqFromId: string | null = null;

    const findBoq = async (locId: string) => {
      const q = query(collection(db, 'boq'), where('jobsiteId', '==', locId), where('itemId', '==', itemId));
      const snap = await getDocs(q);
      const match = snap.docs.find(d => normalizeVariant(d.data().variant) === normalizeVariant(variant));
      return match?.id || null;
    };

    if (toLocationId) boqToId = await findBoq(toLocationId);
    if (fromLocationId) boqFromId = await findBoq(fromLocationId);

    const boqToRef = boqToId ? doc(db, 'boq', boqToId) : null;
    const boqFromRef = boqFromId ? doc(db, 'boq', boqFromId) : null;

    // Resolve UOM ID
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>();
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      const boqToDoc = boqToRef ? await dbTransaction.get(boqToRef) : null;
      const boqFromDoc = boqFromRef ? await dbTransaction.get(boqFromRef) : null;
      let fromInvDoc = null;
      let toInvDoc = null;
      let fromInvRef = null;
      let toInvRef = null;
      let poDoc = null;
      let poRef = null;

      if (fromLocationId) {
        fromInvRef = getInventoryRef(itemId, fromLocationId, variant, serialNumber, propertyNumber, customSpec);
        fromInvDoc = await dbTransaction.get(fromInvRef);
      }

      // Fetch location docs to check types
      let fromLocDoc = null;
      let toLocDoc = null;
      if (fromLocationId) fromLocDoc = await dbTransaction.get(doc(db, 'locations', fromLocationId));
      if (toLocationId) toLocDoc = await dbTransaction.get(doc(db, 'locations', toLocationId));
      
      if (toLocationId) {
        toInvRef = getInventoryRef(itemId, toLocationId, variant, serialNumber, propertyNumber, customSpec);
        toInvDoc = await dbTransaction.get(toInvRef);
      }

      // Fetch Item for average cost calculation
      const itemRef = doc(db, 'items', itemId);
      const itemDoc = await dbTransaction.get(itemRef);
      if (!itemDoc.exists()) throw new Error('Item not found');
      const itemData = itemDoc.data() as Item;

      // Fetch Purchase Order if linked
      if (poId && type === 'delivery') {
        poRef = doc(db, 'purchase_orders', poId);
        poDoc = await dbTransaction.get(poRef);
      }

      // 1.5. ASSET UPDATE (If tool with serial number or property number)
      // (Moved to writes section)

      // 2. PERFORM ALL UPDATES (WRITES LAST)
      
      // Calculate new average cost if totalPrice is provided
      // Recompute if items were added from a non-internal location (e.g. supplier) to an internal location (warehouse or jobsite)
      const isInternal = (loc: any) => loc?.exists() && (loc.data()?.type === 'warehouse' || loc.data()?.type === 'jobsite');
      const toIsInternal = isInternal(toLocDoc);
      const fromIsInternal = isInternal(fromLocDoc);

      // Update Item document with total quantity (All internal stock)
      const changeInTotalQty = (toIsInternal ? baseQuantity : 0) - (fromIsInternal ? baseQuantity : 0);
      const newTotalQty = (itemData.totalQuantity || 0) + changeInTotalQty;

      dbTransaction.update(itemRef, {
        totalQuantity: isNaN(newTotalQty) ? (itemData.totalQuantity || 0) : newTotalQty
      });

      // Record the transaction
      const transactionRef = doc(collection(db, 'transactions'));
      dbTransaction.set(transactionRef, transactionData);

      // 1.5. ASSET UPDATE (If tool with serial number or property number)
      if (serialNumber || propertyNumber) {
        const assetId = serialNumber || propertyNumber;
        if (assetId) {
          const assetRef = doc(db, 'assets', assetId);
          if (toLocationId) {
            dbTransaction.set(assetRef, {
              id: assetId,
              serialNumber: serialNumber || null,
              propertyNumber: propertyNumber || null,
              itemId,
              variant: variant || null,
              locationId: toLocationId,
              updatedAt: serverTimestamp()
            }, { merge: true });
          }
        }
      }

      // 3. PURCHASE ORDER UPDATE
      if (poDoc?.exists() && poRef) {
        const poData = poDoc.data() as PurchaseOrder;
        const targetVariantStr = sortVariant(variant);

        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === itemId && sortVariant(item.variant) === targetVariantStr;
          
          if (isMatch) {
            // Calculate quantity in PO item's UOM
            let quantityInPoUom = baseQuantity; // Default to base quantity
            
            // Determine if PO item UOM matches Item base UOM
            const poItemUomId = uomMap.get((item.uomId || '').toLowerCase()) || item.uomId;
            const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;
            
            // If PO item is NOT in base UOM, convert back
            if (poItemUomId !== itemBaseUomId) {
              const conversion = itemData.uomConversions?.find(c => {
                const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
                return cUomId === poItemUomId;
              });
              if (conversion && conversion.factor > 0) {
                quantityInPoUom = baseQuantity / conversion.factor;
              }
            }

            return {
              ...item,
              receivedQuantity: (item.receivedQuantity || 0) + quantityInPoUom
            };
          }
          return item;
        });

        // Determine new status
        const allReceived = updatedItems.every(item => (item.receivedQuantity || 0) >= item.quantity);
        const anyReceived = updatedItems.some(item => (item.receivedQuantity || 0) > 0);
        
        let newStatus: PurchaseOrder['status'] = poData.status;
        if (allReceived) {
          newStatus = 'received';
        } else if (anyReceived) {
          newStatus = 'partially_received';
        } else if (poData.status !== 'draft' && poData.status !== 'cancelled') {
          newStatus = 'sent';
        }

        dbTransaction.update(poRef, {
          items: updatedItems as any,
          status: newStatus,
          updatedAt: serverTimestamp(),
          updatedBy: userId
        });
      }

      // Update source location inventory
      if (fromLocationId && fromInvRef && fromIsInternal) {
        const currentQty = (fromInvDoc?.exists() ? fromInvDoc.data()?.quantity : 0) || 0;
        if (currentQty < baseQuantity) {
          throw new Error(`Insufficient stock at source: ${currentQty} available, ${baseQuantity} requested.`);
        }
        dbTransaction.set(fromInvRef, {
          itemId: itemId,
          locationId: fromLocationId,
          variant: variant && Object.keys(variant).length > 0 ? variant : null,
          customSpec: customSpec || null,
          serialNumber: serialNumber || null,
          propertyNumber: propertyNumber || null,
          quantity: currentQty - baseQuantity
        }, { merge: true });
      }

      // Update destination location inventory
      if (toLocationId && toInvRef && toIsInternal) {
        const currentQty = (toInvDoc?.exists() ? toInvDoc.data()?.quantity : 0) || 0;

        // Determine source cost for destination cost tracking
        let toSourceCost: number;
        if (fromIsInternal) {
          toSourceCost = (fromInvDoc?.exists() ? fromInvDoc.data()?.averageCost : undefined) ?? itemData.latestPrice ?? 0;
        } else if (totalPrice !== undefined && !isNaN(totalPrice) && baseQuantity > 0) {
          toSourceCost = totalPrice / baseQuantity;
        } else if (unitPrice !== undefined && !isNaN(unitPrice)) {
          toSourceCost = unitPrice;
        } else {
          toSourceCost = itemData.latestPrice || 0;
        }
        const currentToCost = (toInvDoc?.exists() ? toInvDoc.data()?.averageCost : undefined) ?? 0;
        const toNewAvgCost = currentQty > 0
          ? (currentQty * currentToCost + baseQuantity * toSourceCost) / (currentQty + baseQuantity)
          : toSourceCost;

        dbTransaction.set(toInvRef, {
          itemId: itemId,
          locationId: toLocationId,
          variant: variant && Object.keys(variant).length > 0 ? variant : null,
          customSpec: customSpec || null,
          serialNumber: serialNumber || null,
          propertyNumber: propertyNumber || null,
          quantity: currentQty + baseQuantity,
          averageCost: toNewAvgCost
        }, { merge: true });
      }

      // 4. BOQ QUANTITY UPDATE
      const toIsJobsite = toLocDoc?.exists() && toLocDoc.data()?.type === 'jobsite';
      const fromIsJobsite = fromLocDoc?.exists() && fromLocDoc.data()?.type === 'jobsite';

      if (toIsJobsite && boqToRef && boqToDoc?.exists()) {
        const current = boqToDoc.data()?.currentQuantity || 0;
        dbTransaction.update(boqToRef, { currentQuantity: current + baseQuantity });
      }
      if (fromIsJobsite && boqFromRef && boqFromDoc?.exists()) {
        const current = boqFromDoc.data()?.currentQuantity || 0;
        dbTransaction.update(boqFromRef, { currentQuantity: Math.max(0, current - baseQuantity) });
      }
    });
  } catch (error) {
    console.error("Transaction failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'transactions/inventory');
  }
};

export const deleteTransaction = async (transaction: Transaction) => {
  const { itemId, variant, customSpec, serialNumber, propertyNumber, fromLocationId, toLocationId, baseQuantity } = transaction;

  try {
    // Resolve UOM ID
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>();
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      // 1. GATHER DATA (READS)
      let fromInvDoc = null;
      let toInvDoc = null;
      let fromInvRef = null;
      let toInvRef = null;
      let poDoc = null;
      let poRef = null;

      if (fromLocationId) {
        fromInvRef = getInventoryRef(itemId, fromLocationId, variant, serialNumber, propertyNumber, customSpec);
        fromInvDoc = await dbTransaction.get(fromInvRef);
      }

      if (toLocationId) {
        toInvRef = getInventoryRef(itemId, toLocationId, variant, serialNumber, propertyNumber, customSpec);
        toInvDoc = await dbTransaction.get(toInvRef);
      }

      // Fetch Item for total quantity update
      const itemRef = doc(db, 'items', itemId);
      const itemDoc = await dbTransaction.get(itemRef);

      // Fetch location docs to check types
      let fromLocDoc = null;
      let toLocDoc = null;
      if (fromLocationId) fromLocDoc = await dbTransaction.get(doc(db, 'locations', fromLocationId));
      if (toLocationId) toLocDoc = await dbTransaction.get(doc(db, 'locations', toLocationId));

      // Fetch Purchase Order if linked
      if (transaction.poId && transaction.type === 'delivery') {
        poRef = doc(db, 'purchase_orders', transaction.poId);
        poDoc = await dbTransaction.get(poRef);
      }

      // 2. PERFORM ALL UPDATES (WRITES LAST)

      // 0. REVERT PURCHASE ORDER (If linked)
      if (poDoc?.exists() && poRef) {
        const poData = poDoc.data() as PurchaseOrder;
        const itemData = itemDoc.data() as Item;

        const targetVariantStr = sortVariant(variant);

        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === itemId && sortVariant(item.variant) === targetVariantStr;
          
          if (isMatch) {
            // Calculate quantity in PO item's UOM
            let quantityInPoUom = baseQuantity;
            
            // Determine if PO item UOM matches Item base UOM
            const poItemUomId = uomMap.get((item.uomId || '').toLowerCase()) || item.uomId;
            const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;

            if (poItemUomId !== itemBaseUomId) {
              const conversion = itemData.uomConversions?.find(c => {
                const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
                return cUomId === poItemUomId;
              });
              if (conversion && conversion.factor > 0) {
                quantityInPoUom = baseQuantity / conversion.factor;
              }
            }

            return {
              ...item,
              receivedQuantity: Math.max(0, (item.receivedQuantity || 0) - quantityInPoUom)
            };
          }
          return item;
        });

        // Determine new status
        const allReceived = updatedItems.every(item => (item.receivedQuantity || 0) >= item.quantity);
        const anyReceived = updatedItems.some(item => (item.receivedQuantity || 0) > 0);
        
        let newStatus: PurchaseOrder['status'] = 'sent'; 
        if (allReceived) {
          newStatus = 'received';
        } else if (anyReceived) {
          newStatus = 'partially_received';
        }

        dbTransaction.update(poRef, {
          items: updatedItems as any,
          status: newStatus,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid
        });
      }
      
      // 2. REVERT CHANGES (WRITES)
      const isInternal = (loc: any) => loc?.exists() && (loc.data()?.type === 'warehouse' || loc.data()?.type === 'jobsite');
      const fromIsInternal = isInternal(fromLocDoc);
      const toIsInternal = isInternal(toLocDoc);
      
      // Revert source (add back)
      if (fromLocationId && fromInvRef && fromIsInternal) {
        const currentQty = (fromInvDoc?.exists() ? fromInvDoc.data()?.quantity : 0) || 0;
        dbTransaction.set(fromInvRef, { quantity: currentQty + baseQuantity }, { merge: true });
      }

      // Revert destination (subtract)
      if (toLocationId && toInvRef && toIsInternal) {
        const currentQty = (toInvDoc?.exists() ? toInvDoc.data()?.quantity : 0) || 0;
        if (currentQty < baseQuantity) {
          throw new Error(`Cannot reverse transaction: destination only has ${currentQty} in stock, but transaction moved ${baseQuantity}.`);
        }
        dbTransaction.set(toInvRef, { quantity: currentQty - baseQuantity }, { merge: true });
      }

      // Revert total quantity (All internal stock)
      if (itemDoc.exists()) {
        const itemData = itemDoc.data() as Item;
        const changeInTotalQty = (toIsInternal ? baseQuantity : 0) - (fromIsInternal ? baseQuantity : 0);
        const newTotalQty = (itemData.totalQuantity || 0) - changeInTotalQty;
        dbTransaction.update(itemRef, {
          totalQuantity: isNaN(newTotalQty) ? (itemData.totalQuantity || 0) : newTotalQty
        });
      }

      // Delete the transaction record
      dbTransaction.delete(doc(db, 'transactions', transaction.id));
    });
  } catch (error) {
    console.error("Delete transaction failed:", error);
    handleFirestoreError(error, OperationType.DELETE, 'transactions');
  }
};

export const updateTransaction = async (id: string, oldTransaction: Transaction, newTransactionData: Omit<Transaction, 'id' | 'userId'>) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  const { timestamp } = newTransactionData;

  try {
    // Resolve UOM ID
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>();
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      // 1. GATHER DATA (READS)
      // Old refs
      const oldFromRef = oldTransaction.fromLocationId ? getInventoryRef(oldTransaction.itemId, oldTransaction.fromLocationId, oldTransaction.variant, oldTransaction.serialNumber, oldTransaction.propertyNumber, oldTransaction.customSpec) : null;
      const oldToRef = oldTransaction.toLocationId ? getInventoryRef(oldTransaction.itemId, oldTransaction.toLocationId, oldTransaction.variant, oldTransaction.serialNumber, oldTransaction.propertyNumber, oldTransaction.customSpec) : null;
      
      // New refs
      const newFromRef = newTransactionData.fromLocationId ? getInventoryRef(newTransactionData.itemId, newTransactionData.fromLocationId, newTransactionData.variant, newTransactionData.serialNumber, newTransactionData.propertyNumber, newTransactionData.customSpec) : null;
      const newToRef = newTransactionData.toLocationId ? getInventoryRef(newTransactionData.itemId, newTransactionData.toLocationId, newTransactionData.variant, newTransactionData.serialNumber, newTransactionData.propertyNumber, newTransactionData.customSpec) : null;

      // Fetch all involved inventory docs
      const refsToFetch = [oldFromRef, oldToRef, newFromRef, newToRef].filter((r, i, self) => r && self.findIndex(x => x?.path === r.path) === i);
      const docs = await Promise.all(refsToFetch.map(r => r ? dbTransaction.get(r) : null));
      const docMap = new Map();
      refsToFetch.forEach((r, i) => { if (r) docMap.set(r.path, docs[i]); });

      // Fetch location docs to check types
      const locIds = [oldTransaction.fromLocationId, oldTransaction.toLocationId, newTransactionData.fromLocationId, newTransactionData.toLocationId].filter(id => id);
      const locDocs = await Promise.all(locIds.map(id => id ? dbTransaction.get(doc(db, 'locations', id)) : null));
      const locMap = new Map();
      locIds.forEach((id, i) => { if (id) locMap.set(id, locDocs[i]); });

      const isInternal = (loc: any) => loc?.exists() && (loc.data()?.type === 'warehouse' || loc.data()?.type === 'jobsite');
      const oldFromIsInternal = oldTransaction.fromLocationId ? isInternal(locMap.get(oldTransaction.fromLocationId)) : false;
      const oldToIsInternal = oldTransaction.toLocationId ? isInternal(locMap.get(oldTransaction.toLocationId)) : false;
      const newFromIsInternal = newTransactionData.fromLocationId ? isInternal(locMap.get(newTransactionData.fromLocationId)) : false;
      const newToIsInternal = newTransactionData.toLocationId ? isInternal(locMap.get(newTransactionData.toLocationId)) : false;

      // Fetch Item(s)
      const itemRef = doc(db, 'items', oldTransaction.itemId);
      const itemDoc = await dbTransaction.get(itemRef);
      const itemData = itemDoc.data() as Item;
      
      let newItemData = itemData;
      if (newTransactionData.itemId !== oldTransaction.itemId) {
        const newItemRef = doc(db, 'items', newTransactionData.itemId);
        const newItemDoc = await dbTransaction.get(newItemRef);
        newItemData = newItemDoc.data() as Item;
      }

      // Fetch Purchase Orders if linked
      let oldPoDoc = null;
      let oldPoRef = null;
      if (oldTransaction.poId && oldTransaction.type === 'delivery') {
        oldPoRef = doc(db, 'purchase_orders', oldTransaction.poId);
        oldPoDoc = await dbTransaction.get(oldPoRef);
      }

      let newPoDoc = null;
      let newPoRef = null;
      if (newTransactionData.poId && newTransactionData.type === 'delivery') {
        if (newTransactionData.poId === oldTransaction.poId) {
          newPoRef = oldPoRef;
          newPoDoc = oldPoDoc;
        } else {
          newPoRef = doc(db, 'purchase_orders', newTransactionData.poId);
          newPoDoc = await dbTransaction.get(newPoRef);
        }
      }

      // 2. APPLY CHANGES (WRITES)
      
      // Step A: Revert old transaction
      if (oldFromRef) {
        const d = docMap.get(oldFromRef.path);
        const currentQty = (d?.exists() ? d.data()?.quantity : 0) || 0;
        // Update local map so subsequent steps see the change if they use the same ref
        docMap.set(oldFromRef.path, { exists: () => true, data: () => ({ ...d?.data(), quantity: currentQty + oldTransaction.baseQuantity }) });
      }
      if (oldToRef) {
        const d = docMap.get(oldToRef.path);
        const currentQty = (d?.exists() ? d.data()?.quantity : 0) || 0;
        docMap.set(oldToRef.path, { exists: () => true, data: () => ({ ...d?.data(), quantity: currentQty - oldTransaction.baseQuantity }) });
      }

      // Revert PO if needed
      if (oldPoDoc?.exists() && oldPoRef) {
        const poData = oldPoDoc.data() as PurchaseOrder;
        const targetVariantStr = sortVariant(oldTransaction.variant);
        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === oldTransaction.itemId && sortVariant(item.variant) === targetVariantStr;
          if (isMatch) {
            let qtyInPoUom = oldTransaction.baseQuantity;
            
            // Determine if PO item UOM matches Item base UOM
            const poItemUomId = uomMap.get((item.uomId || '').toLowerCase()) || item.uomId;
            const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;

            if (poItemUomId !== itemBaseUomId) {
              const conversion = itemData.uomConversions?.find(c => {
                const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
                return cUomId === poItemUomId;
              });
              if (conversion && conversion.factor > 0) qtyInPoUom = oldTransaction.baseQuantity / conversion.factor;
            }
            return { ...item, receivedQuantity: Math.max(0, (item.receivedQuantity || 0) - qtyInPoUom) };
          }
          return item;
        });

        const allReceived = updatedItems.every(item => (item.receivedQuantity || 0) >= item.quantity);
        const anyReceived = updatedItems.some(item => (item.receivedQuantity || 0) > 0);
        let newStatus: PurchaseOrder['status'] = 'sent';
        if (allReceived) newStatus = 'received';
        else if (anyReceived) newStatus = 'partially_received';

        dbTransaction.update(oldPoRef, {
          items: updatedItems as any,
          status: newStatus,
          updatedAt: serverTimestamp(),
          updatedBy: userId
        });
        
        // Update local doc if it's the same as newPoDoc
        if (newPoRef?.path === oldPoRef.path) {
          newPoDoc = { exists: () => true, data: () => ({ ...poData, items: updatedItems, status: newStatus }) } as any;
        }
      }

      // Step B: Apply new transaction
      if (newFromRef) {
        const d = docMap.get(newFromRef.path);
        const currentQty = (d?.exists() ? d.data()?.quantity : 0) || 0;
        docMap.set(newFromRef.path, { exists: () => true, data: () => ({ ...d?.data(), quantity: currentQty - newTransactionData.baseQuantity }) });
      }
      if (newToRef) {
        const d = docMap.get(newToRef.path);
        const currentQty = (d?.exists() ? d.data()?.quantity : 0) || 0;
        docMap.set(newToRef.path, { exists: () => true, data: () => ({ ...d?.data(), quantity: currentQty + newTransactionData.baseQuantity }) });
      }

      // Apply PO update if needed
      if (newPoDoc?.exists() && newPoRef) {
        const poData = newPoDoc.data() as PurchaseOrder;
        const targetVariantStr = sortVariant(newTransactionData.variant);
        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === newTransactionData.itemId && sortVariant(item.variant) === targetVariantStr;
          if (isMatch) {
            let qtyInPoUom = newTransactionData.baseQuantity;
            
            // Determine if PO item UOM matches Item base UOM
            const poItemUomId = uomMap.get((item.uomId || '').toLowerCase()) || item.uomId;
            const newItemBaseUomId = uomMap.get((newItemData.uomId || '').toLowerCase()) || newItemData.uomId;

            if (poItemUomId !== newItemBaseUomId) {
              const conversion = newItemData.uomConversions?.find(c => {
                const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
                return cUomId === poItemUomId;
              });
              if (conversion && conversion.factor > 0) qtyInPoUom = newTransactionData.baseQuantity / conversion.factor;
            }
            return { ...item, receivedQuantity: (item.receivedQuantity || 0) + qtyInPoUom };
          }
          return item;
        });

        const allReceived = updatedItems.every(item => (item.receivedQuantity || 0) >= item.quantity);
        const anyReceived = updatedItems.some(item => (item.receivedQuantity || 0) > 0);
        let newStatus: PurchaseOrder['status'] = poData.status;
        if (allReceived) newStatus = 'received';
        else if (anyReceived) newStatus = 'partially_received';

        dbTransaction.update(newPoRef, {
          items: updatedItems as any,
          status: newStatus,
          updatedAt: serverTimestamp(),
          updatedBy: userId
        });
      }

      // Step C: Commit inventory changes
      docMap.forEach((d, path) => {
        const data = d.data();
        const locId = data.locationId || (path.split('_')[1]);
        const locDoc = locMap.get(locId);
        
        // Only update if it's an internal location
        if (isInternal(locDoc)) {
          dbTransaction.set(doc(db, path), {
            itemId: data.itemId || (path.split('_')[0].split('/').pop()), 
            locationId: locId,
            variant: data.variant || null,
            customSpec: data.customSpec || null,
            serialNumber: data.serialNumber || null,
            propertyNumber: data.propertyNumber || null,
            quantity: data.quantity
          }, { merge: true });
        }
      });

      // Step D: Update Item total quantity (All internal stock)
      if (itemDoc.exists()) {
        const itemData = itemDoc.data() as Item;
        const oldChange = (oldToIsInternal ? oldTransaction.baseQuantity : 0) - (oldFromIsInternal ? oldTransaction.baseQuantity : 0);
        const newChange = (newToIsInternal ? newTransactionData.baseQuantity : 0) - (newFromIsInternal ? newTransactionData.baseQuantity : 0);
        const newTotalQty = (itemData.totalQuantity || 0) - oldChange + newChange;
        dbTransaction.update(itemRef, {
          totalQuantity: isNaN(newTotalQty) ? (itemData.totalQuantity || 0) : newTotalQty
        });
      }

      // Step E: Update transaction record
      dbTransaction.update(doc(db, 'transactions', id), {
        ...cleanData(newTransactionData),
        userId,
        timestamp: timestamp || oldTransaction.timestamp || Timestamp.now()
      });
    });
  } catch (error) {
    console.error("Update transaction failed:", error);
    handleFirestoreError(error, OperationType.UPDATE, 'transactions');
  }
};

// --- Management Operations ---

export const addItem = async (item: Omit<Item, 'id' | 'createdAt' | 'isActive'>) => {
  try {
    const itemRef = doc(collection(db, 'items'));
    const id = itemRef.id;
    await setDoc(itemRef, cleanData({
      id,
      totalQuantity: 0,
      ...item,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'items');
  }
};

export const updateItem = async (id: string, item: Partial<Item>) => {
  if (!id) throw new Error('Item ID is required for update');
  try {
    const itemRef = doc(db, 'items', id);
    const itemSnap = await getDoc(itemRef);
    
    if (!itemSnap.exists()) {
      // If it doesn't exist, treat it as a create with the provided ID
      await setDoc(itemRef, cleanData({
        ...item,
        isActive: item.isActive ?? true,
        totalQuantity: item.totalQuantity ?? 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }), { merge: true });
    } else {
      await updateDoc(itemRef, cleanData({
        ...item,
        updatedAt: serverTimestamp()
      }));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'items');
  }
};

export const deleteItem = async (id: string) => {
  try {
    // Check for inventory
    const inventorySnap = await getDocs(query(collection(db, 'inventory'), where('itemId', '==', id)));
    const totalQty = inventorySnap.docs.reduce((acc, doc) => acc + (doc.data().quantity || 0), 0);
    if (totalQty > 0) {
      throw new Error('Cannot delete item with existing stock in inventory.');
    }

    // Check for transactions
    const transactionsSnap = await getDocs(query(collection(db, 'transactions'), where('itemId', '==', id), limit(1)));
    if (!transactionsSnap.empty) {
      throw new Error('Cannot delete item with transaction history.');
    }

    // Check for assets
    const assetsSnap = await getDocs(query(collection(db, 'assets'), where('itemId', '==', id), limit(1)));
    if (!assetsSnap.empty) {
      throw new Error('Cannot delete item with linked assets/serial numbers.');
    }

    await deleteDoc(doc(db, 'items', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `items/${id}`);
  }
};

export const addCategory = async (category: Omit<Category, 'id' | 'isActive'>) => {
  try {
    // Clean up undefined fields
    const data: any = { name: category.name, isActive: true };
    if (category.parentId) data.parentId = category.parentId;
    
    const docRef = await addDoc(collection(db, 'categories'), data);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'categories');
  }
};

export const updateCategory = async (id: string, category: Partial<Category>) => {
  try {
    await updateDoc(doc(db, 'categories', id), cleanData(category));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'categories');
  }
};

export const deleteCategory = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'categories', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'categories');
  }
};

export const addLocation = async (location: Omit<Location, 'id' | 'isActive'>) => {
  try {
    const docRef = await addDoc(collection(db, 'locations'), { ...cleanData(location), isActive: true });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'locations');
  }
};

export const updateLocation = async (id: string, location: Partial<Location>) => {
  try {
    await updateDoc(doc(db, 'locations', id), cleanData(location));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'locations');
  }
};

export const deleteLocation = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'locations', id));

    const affectedUsers = await getDocs(
      query(collection(db, 'users'), where('assignedLocationIds', 'array-contains', id))
    );
    await Promise.all(
      affectedUsers.docs.map(d => updateDoc(d.ref, { assignedLocationIds: arrayRemove(id) }))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'locations');
  }
};

export const addUOM = async (uom: Omit<UOM, 'id' | 'isActive'>) => {
  try {
    const docRef = await addDoc(collection(db, 'uoms'), { ...cleanData(uom), isActive: true });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'uoms');
  }
};

export const updateUOM = async (id: string, uom: Partial<UOM>) => {
  try {
    await updateDoc(doc(db, 'uoms', id), cleanData(uom));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'uoms');
  }
};

export const deleteUOM = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'uoms', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'uoms');
  }
};

export const addPurchaseOrder = async (po: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>, userName?: string) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    const docRef = await addDoc(collection(db, 'purchase_orders'), cleanData({
      ...po,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: userId,
      createdByName: userName || '',
      updatedBy: userId
    }));
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'purchase_orders');
  }
};

export const updatePurchaseOrder = async (id: string, po: Partial<PurchaseOrder>) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await updateDoc(doc(db, 'purchase_orders', id), cleanData({
      ...po,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `purchase_orders/${id}`);
  }
};

export const deletePurchaseOrder = async (id: string) => {
  try {
    const poSnap = await getDoc(doc(db, 'purchase_orders', id));
    if (!poSnap.exists()) throw new Error('Purchase order not found.');
    const po = poSnap.data() as PurchaseOrder;
    if (po.status !== 'draft' && po.status !== 'cancelled') {
      throw new Error(`Cannot delete a PO with status "${po.status}". Only draft or cancelled POs can be deleted.`);
    }
    if (po.items?.some(item => (item.receivedQuantity || 0) > 0)) {
      throw new Error('Cannot delete a PO that has received items. Cancel it instead.');
    }
    await deleteDoc(doc(db, 'purchase_orders', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `purchase_orders/${id}`);
  }
};

// --- PO Payment Operations ---

export const getAllPOPayments = async (poId: string): Promise<POPayment[]> => {
  try {
    const snap = await getDocs(collection(db, 'purchase_orders', poId, 'payments'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as POPayment));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `purchase_orders/${poId}/payments`);
    return [];
  }
};

export const subscribeToPOPayments = (poId: string, callback: (payments: POPayment[]) => void) => {
  const q = query(collection(db, 'purchase_orders', poId, 'payments'), orderBy('date', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const payments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as POPayment));
    callback(payments);
  }, (error) => handleFirestoreError(error, OperationType.LIST, `purchase_orders/${poId}/payments`, false));
};

export const addPOPayment = async (poId: string, payment: Omit<POPayment, 'id' | 'createdAt' | 'createdBy'>) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    const docRef = await addDoc(collection(db, 'purchase_orders', poId, 'payments'), {
      ...cleanData(payment),
      poId,
      createdAt: serverTimestamp(),
      createdBy: userId
    });

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `purchase_orders/${poId}/payments`);
  }
};

export const updatePOPayment = async (poId: string, paymentId: string, data: Partial<POPayment>) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await updateDoc(doc(db, 'purchase_orders', poId, 'payments', paymentId), {
      ...cleanData(data),
      lastEditedBy: userId,
      lastEditedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `purchase_orders/${poId}/payments/${paymentId}`);
  }
};

export const deletePOPayment = async (poId: string, paymentId: string) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await deleteDoc(doc(db, 'purchase_orders', poId, 'payments', paymentId));

    // Re-derive PO paymentStatus from remaining payments so the card stays in sync
    const remainingSnap = await getDocs(collection(db, 'purchase_orders', poId, 'payments'));
    const remaining = remainingSnap.docs.map(d => d.data());

    let newPaymentStatus: PurchaseOrder['paymentStatus'];
    if (remaining.length === 0) {
      newPaymentStatus = 'unpaid';
    } else if (remaining.some(p => p.status === 'collected' || p.status === 'bank_deposit')) {
      newPaymentStatus = 'paid';
    } else if (remaining.some(p => p.status === 'prepared')) {
      newPaymentStatus = 'prepared';
    } else {
      newPaymentStatus = 'processing';
    }

    await updateDoc(doc(db, 'purchase_orders', poId), {
      paymentStatus: newPaymentStatus,
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `purchase_orders/${poId}/payments/${paymentId}`);
  }
};

export const addTag = async (tag: Omit<Tag, 'id' | 'isActive'>) => {
  try {
    const docRef = await addDoc(collection(db, 'tags'), { ...cleanData(tag), isActive: true });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'tags');
  }
};

export const updateTag = async (id: string, tag: Partial<Tag>) => {
  try {
    await updateDoc(doc(db, 'tags', id), cleanData(tag));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'tags');
  }
};

export const deleteTag = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'tags', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'tags');
  }
};

// --- BOQ Operations ---

export const subscribeToBOQ = (jobsiteId: string, callback: (boq: BOQItem[]) => void) => {
  const q = query(collection(db, 'boq'), where('jobsiteId', '==', jobsiteId));
  return onSnapshot(q, (snapshot) => {
    const boq = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem));
    callback(boq);
  }, (error) => handleFirestoreError(error, OperationType.GET, 'boq'));
};

export const subscribeToAllBOQ = (callback: (boq: BOQItem[]) => void, locationIds?: string[]) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'boq'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('jobsiteId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const boq = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem));
    callback(boq);
  }, (error) => handleFirestoreError(error, OperationType.GET, 'boq'));
};

export const addBOQItem = async (boqItem: Omit<BOQItem, 'id' | 'timestamp'>) => {
  try {
    // Check for duplicates
    const q = query(
      collection(db, 'boq'),
      where('jobsiteId', '==', boqItem.jobsiteId),
      where('itemId', '==', boqItem.itemId)
    );
    const snap = await getDocs(q);
    const existing = snap.docs.find(d => {
      const data = d.data();
      return normalizeVariant(data.variant) === normalizeVariant(boqItem.variant);
    });

    if (existing) {
      throw new Error('This item is already in the BOQ for this jobsite.');
    }

    const docRef = await addDoc(collection(db, 'boq'), {
      ...cleanData(boqItem),
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error("Add BOQ item failed:", error);
    handleFirestoreError(error, OperationType.CREATE, 'boq');
    throw error;
  }
};

export const updateBOQItem = async (id: string, data: Partial<BOQItem>) => {
  try {
    await updateDoc(doc(db, 'boq', id), cleanData(data));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'boq');
    throw error;
  }
};

export const deleteBOQItem = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'boq', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'boq');
    throw error;
  }
};

export const replaceJobsiteBOQ = async (jobsiteId: string, newItems: Omit<BOQItem, 'id' | 'timestamp'>[]) => {
  try {
    // 1. Get all existing BOQ items for this jobsite
    const q = query(collection(db, 'boq'), where('jobsiteId', '==', jobsiteId));
    const snap = await getDocs(q);
    
    // 2. Delete them
    const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    
    // 3. Add new items
    const addPromises = newItems.map(item => addDoc(collection(db, 'boq'), {
      ...cleanData(item),
      timestamp: serverTimestamp()
    }));
    await Promise.all(addPromises);
  } catch (error) {
    console.error("Replace BOQ failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'boq');
    throw error;
  }
};

// --- Unplanned Stock Operations ---

export const addUnplannedStock = async (stock: Omit<UnplannedStock, 'id' | 'timestamp'>) => {
  try {
    const docRef = await addDoc(collection(db, 'unplanned_stock'), {
      ...cleanData(stock),
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'unplanned_stock');
  }
};

export const deleteUnplannedStock = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'unplanned_stock', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'unplanned_stock');
  }
};

// --- Request Operations ---

export const createRequest = async (request: Omit<Request, 'id' | 'timestamp' | 'status' | 'requestorId'>, requestorName?: string) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    const userProfile = userDoc.exists() ? userDoc.data() as UserProfile : null;
    const isEngineer = userProfile?.role === 'engineer' || userProfile?.role === 'admin' || userProfile?.role === 'manager';

    const docRef = await addDoc(collection(db, 'requests'), {
      ...cleanData(request),
      requestorId: userId,
      requestorName: requestorName || '',
      status: isEngineer ? 'approved' : 'pending',
      approvedAt: isEngineer ? serverTimestamp() : null,
      approverId: isEngineer ? userId : null,
      approverName: isEngineer ? requestorName || 'Auto-approved' : null,
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'requests');
  }
};

export const addRequest = async (request: any) => {
  try {
    const docRef = await addDoc(collection(db, 'requests'), {
      ...cleanData(request),
      timestamp: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'requests');
  }
};

export const updateRequest = async (id: string, data: Partial<Request>) => {
  try {
    await updateDoc(doc(db, 'requests', id), cleanData(data));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  }
};

export const cancelRequest = async (id: string) => {
  try {
    await updateDoc(doc(db, 'requests', id), {
      status: 'cancelled',
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  }
};

export const cancelApproval = async (id: string) => {
  try {
    await updateDoc(doc(db, 'requests', id), {
      status: 'pending',
      approverId: deleteField(),
      approverName: deleteField(),
      approvedQty: deleteField(),
      approvedAt: deleteField(),
      engineerNote: deleteField(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  }
};

export const unpickRequest = async (id: string) => {
  try {
    await updateDoc(doc(db, 'requests', id), {
      status: 'approved',
      batchId: deleteField(),
      warehousemanId: deleteField(),
      warehousemanName: deleteField(),
      pickedAt: deleteField(),
      sourceLocationId: deleteField(),
      deliveredQty: deleteField(),
      serialNumbers: deleteField(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  }
};

export const deleteRequest = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'requests', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'requests');
  }
};

export const approveRequest = async (id: string, approvedQty: number, approverId: string, approverName?: string, engineerNote?: string) => {
  try {
    const requestRef = doc(db, 'requests', id);
    const requestDoc = await getDoc(requestRef);
    if (!requestDoc.exists()) throw new Error('Request not found');
    const requestData = requestDoc.data() as Request;

    let finalNote = engineerNote || '';
    if (approvedQty !== requestData.requestedQty) {
      const adjustmentNote = `adjusted from ${requestData.requestedQty} to ${approvedQty}`;
      finalNote = finalNote ? `${finalNote} (${adjustmentNote})` : adjustmentNote;
    }

    await updateDoc(requestRef, {
      approvedQty,
      engineerNote: finalNote,
      approverId,
      approverName: approverName || '',
      status: 'approved',
      approvedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  }
};

export const approveBulkRequests = async (requestIds: string[], approverId: string, approverName?: string, role?: string) => {
  const opId = await startOperation(approverId, role || '', 'approve_requests').catch(() => '');
  try {
    await runTransaction(db, async (dbTransaction) => {
      const requestDocs = [];
      for (const id of requestIds) {
        const requestRef = doc(db, 'requests', id);
        const requestDoc = await dbTransaction.get(requestRef);
        if (requestDoc.exists()) {
          requestDocs.push({ ref: requestRef, data: requestDoc.data() as Request });
        }
      }

      for (const { ref, data } of requestDocs) {
        dbTransaction.update(ref, {
          approvedQty: data.requestedQty, // Default to requested quantity for bulk approval
          approverId,
          approverName: approverName || '',
          status: 'approved',
          approvedAt: serverTimestamp()
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'requests');
  } finally {
    if (opId) await endOperation(opId);
  }
};

export const recordBulkReceivePO = async (
  poId: string,
  receivedItems: {
    itemId: string;
    variant?: Record<string, string>;
    quantity: number;
    uomId: string;
    unitPrice: number;
    totalPrice: number;
    customSpec?: string;
    serialNumber?: string;
    propertyNumber?: string;
    note?: string;
    assignedJobsiteId?: string;
    assignedJobsiteName?: string;
  }[],
  userId: string,
  userName: string,
  options: {
    toLocationId: string;
    date: Date;
    supplierInvoice?: string;
    supplierDR?: string;
    notes?: string;
    updateLatestPrice?: boolean;
  }
) => {
  try {
    // 1. Fetch UOMs first to resolve symbols if needed
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>(); // symbol/id -> id
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      // 1. READS (All reads must be first)
      const poRef = doc(db, 'purchase_orders', poId);
      const poDoc = await dbTransaction.get(poRef);
      if (!poDoc.exists()) throw new Error('Purchase Order not found');
      const poData = poDoc.data() as PurchaseOrder;
      
      const toLocRef = doc(db, 'locations', options.toLocationId);
      const toLocDoc = await dbTransaction.get(toLocRef);
      const toIsInternal = toLocDoc.exists() && (toLocDoc.data().type === 'warehouse' || toLocDoc.data().type === 'jobsite');

      const itemIds = Array.from(new Set(receivedItems.map(i => i.itemId)));
      const itemDataMap: Record<string, Item> = {};
      for (const id of itemIds) {
        const snap = await dbTransaction.get(doc(db, 'items', id));
        if (snap.exists()) itemDataMap[id] = snap.data() as Item;
      }

      const invDataMap: Record<string, { quantity: number; averageCost: number; ref: any }> = {};
      for (const receive of receivedItems) {
        if (receive.quantity <= 0) continue;
        const invRef = getInventoryRef(receive.itemId, options.toLocationId, receive.variant, receive.serialNumber, receive.customSpec);
        const invPath = invRef.path;
        if (!invDataMap[invPath]) {
          const snap = await dbTransaction.get(invRef);
          invDataMap[invPath] = {
            quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
            averageCost: snap.exists() ? (snap.data()?.averageCost ?? 0) : 0,
            ref: invRef
          };
        }
      }

      // 2. CALCULATIONS & WRITES
      const timestamp = Timestamp.fromDate(options.date);
      const updatedPoItems = [...poData.items];
      
      // Track item state changes for multiple lines of the same item
      const rollingItemState: Record<string, { totalQuantity: number; latestPricePerVariant: Record<string, { price: number; date: Timestamp }> }> = {};
      const receiveTimestamp = Timestamp.fromDate(options.date);
      for (const id in itemDataMap) {
        rollingItemState[id] = {
          totalQuantity: itemDataMap[id].totalQuantity || 0,
          latestPricePerVariant: {},
        };
      }

      for (const receive of receivedItems) {
        if (receive.quantity <= 0) continue;

        const poItemIndex = updatedPoItems.findIndex(poi => 
          poi.itemId === receive.itemId && 
          JSON.stringify(poi.variant || {}) === JSON.stringify(receive.variant || {})
        );

        if (poItemIndex === -1) continue;
        const poItem = updatedPoItems[poItemIndex];
        const currentReceived = poItem.receivedQuantity || 0;

        if (currentReceived + receive.quantity > poItem.quantity) {
          const itemName = itemDataMap[receive.itemId]?.name || receive.itemId;
          throw new Error(`Cannot receive ${receive.quantity} for ${itemName}. Ordered: ${poItem.quantity}, Already Received: ${currentReceived}.`);
        }

        updatedPoItems[poItemIndex] = {
          ...poItem,
          receivedQuantity: currentReceived + receive.quantity
        };

        const itemData = itemDataMap[receive.itemId];
        if (!itemData) continue;

        // Resolve UOM ID
        const targetUomId = uomMap.get(receive.uomId.toLowerCase()) || receive.uomId;
        const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;
        
        const conversionFactor = itemBaseUomId === targetUomId ? 1 : (itemData.uomConversions?.find(c => {
          const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
          return cUomId === targetUomId;
        })?.factor || 1);
        const baseQuantity = receive.quantity * conversionFactor;

        // Inventory update
        const invRef = getInventoryRef(receive.itemId, options.toLocationId, receive.variant, receive.serialNumber, receive.customSpec);
        const invInfo = invDataMap[invRef.path];
        const preReceiptQty = invInfo.quantity;
        invInfo.quantity += baseQuantity;

        // Compute location-level weighted average cost for this inventory doc
        const newUnitPricePerBase = receive.unitPrice / conversionFactor;
        if (toIsInternal) {
          invInfo.averageCost = preReceiptQty > 0
            ? (preReceiptQty * invInfo.averageCost + baseQuantity * newUnitPricePerBase) / invInfo.quantity
            : newUnitPricePerBase;
        }

        dbTransaction.set(invRef, {
          itemId: receive.itemId,
          locationId: options.toLocationId,
          variant: receive.variant ? cleanData(receive.variant) : null,
          customSpec: receive.customSpec || null,
          serialNumber: receive.serialNumber || null,
          propertyNumber: receive.propertyNumber || null,
          quantity: invInfo.quantity,
          ...(toIsInternal ? { averageCost: invInfo.averageCost } : {}),
          updatedAt: serverTimestamp(),
          ...(receive.assignedJobsiteId ? {
            assignedJobsiteId: receive.assignedJobsiteId,
            assignedJobsiteName: receive.assignedJobsiteName || null,
          } : {})
        }, { merge: true });

        // Update Asset if serialized
        if (receive.serialNumber) {
          const assetRef = doc(db, 'assets', receive.serialNumber);
          dbTransaction.set(assetRef, {
            id: receive.serialNumber,
            itemId: receive.itemId,
            locationId: options.toLocationId,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        // Rolling Total Quantity and optional latestPrice update
        if (toIsInternal) {
          const state = rollingItemState[receive.itemId];
          state.totalQuantity += baseQuantity;

          const itemUpdate: Record<string, any> = {
            totalQuantity: state.totalQuantity,
            updatedAt: serverTimestamp(),
            updatedBy: userId
          };

          if (options.updateLatestPrice) {
            const vKey = receive.variant && Object.keys(receive.variant).length > 0
              ? Object.keys(receive.variant).sort().map(k => `${k}:${receive.variant![k]}`).join('|')
              : '_base';

            const itemData = itemDataMap[receive.itemId];
            const isVariant = receive.variant && Object.keys(receive.variant).length > 0;

            if (isVariant) {
              const configs: any[] = itemData.variantConfigs ? itemData.variantConfigs.map(c => ({ ...c })) : [];
              const existingIdx = configs.findIndex(c => {
                const ck = Object.keys(c.variant).sort().map(k => `${k}:${c.variant[k]}`).join('|');
                return ck === vKey;
              });
              if (existingIdx >= 0) {
                configs[existingIdx] = { ...configs[existingIdx], latestPrice: newUnitPricePerBase, latestPriceDate: receiveTimestamp };
              } else {
                configs.push({ variant: receive.variant, latestPrice: newUnitPricePerBase, latestPriceDate: receiveTimestamp });
              }
              state.latestPricePerVariant[vKey] = { price: newUnitPricePerBase, date: receiveTimestamp };
              itemUpdate.variantConfigs = configs;
            } else {
              itemUpdate.latestPrice = newUnitPricePerBase;
              itemUpdate.latestPriceDate = receiveTimestamp;
              state.latestPricePerVariant['_base'] = { price: newUnitPricePerBase, date: receiveTimestamp };
            }

            const phRef = doc(collection(db, 'price_history'));
            dbTransaction.set(phRef, {
              id: phRef.id,
              itemId: receive.itemId,
              variantKey: isVariant ? normalizeVariant(receive.variant) : null,
              variant: isVariant ? (receive.variant || null) : null,
              date: receiveTimestamp,
              price: newUnitPricePerBase,
              source: 'po_receive',
              sourceId: poData.id,
              sourceRef: poData.poNumber,
            });
          }

          dbTransaction.update(doc(db, 'items', receive.itemId), itemUpdate);
        }

        // Supplier pricing record
        if (toIsInternal) {
          const spRef = doc(collection(db, 'supplier_pricing'));
          dbTransaction.set(spRef, cleanData({
            id: spRef.id,
            supplierId: poData.supplierId,
            supplierName: poData.supplierName || '',
            itemId: receive.itemId,
            variant: receive.variant || null,
            uomId: receive.uomId,
            unitPrice: receive.unitPrice,
            quantityReceived: receive.quantity,
            baseQuantity,
            totalCost: receive.totalPrice,
            receivedDate: timestamp,
            conversionFactor,
            poId: poData.id,
            poNumber: poData.poNumber,
          }));
        }

        // Record Transaction
        const transactionRef = doc(collection(db, 'transactions'));
        dbTransaction.set(transactionRef, cleanData({
          itemId: receive.itemId,
          variant: receive.variant || null,
          customSpec: receive.customSpec || null,
          serialNumber: receive.serialNumber || null,
          propertyNumber: receive.propertyNumber || null,
          fromLocationId: poData.supplierId,
          toLocationId: options.toLocationId,
          quantity: receive.quantity,
          uomId: receive.uomId,
          conversionFactor,
          baseQuantity,
          type: 'delivery',
          notes: receive.note || options.notes || '',
          unitPrice: receive.unitPrice,
          totalPrice: receive.totalPrice,
          poNumber: poData.poNumber,
          poId: poData.id,
          supplierInvoice: options.supplierInvoice || null,
          supplierDR: options.supplierDR || null,
          userId,
          userName,
          timestamp
        }));
      }

      // Final PO Status
      const isComplete = updatedPoItems.every(poi => (poi.receivedQuantity || 0) >= poi.quantity);
      const isAnyReceived = updatedPoItems.some(poi => (poi.receivedQuantity || 0) > 0);
      
      dbTransaction.update(poRef, {
        items: updatedPoItems,
        status: isComplete ? 'received' : (isAnyReceived ? 'partially_received' : poData.status),
        updatedAt: serverTimestamp(),
        updatedBy: userId
      });
    });
  } catch (error) {
    console.error("Bulk receive failed:", error);
    throw error;
  }
};

export const getExistingDRForJobsite = async (jobsiteId: string): Promise<string | null> => {
  try {
    const q = query(
      collection(db, 'requests'),
      where('jobsiteId', '==', jobsiteId),
      where('status', '==', 'for delivery'),
      limit(10)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const batchId = (d.data() as Request).batchId;
      if (batchId) return batchId;
    }
    return null;
  } catch {
    return null;
  }
};

export const recordBulkPick = async (
  selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[],
  warehousemanId: string,
  warehousemanName?: string,
  options?: { customBatchId?: string; customDate?: Date; role?: string }
) => {
  const opId = await startOperation(warehousemanId, options?.role || '', 'bulk_pick').catch(() => '');
  try {
    // If no custom DR is provided, check if we can reuse an existing active batchId
    let reusedBatchId = options?.customBatchId;
    
    // Note: we do not auto-reuse batchIds from other jobsites' deliveries.
    // A custom batch ID must be set explicitly via the PickingModal UI.
    // Without a customBatchId, a fresh DR number is always generated below.

    // Fetch UOMs first to resolve symbols if needed
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>(); // symbol/id -> id
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      // Maps each destination jobsiteId to its assigned DR number
      const jobsiteBatchIds = new Map<string, string>();
      let counterUpdate: any = null;
      let counterRef: any = null;

      const pickTime = options?.customDate ? Timestamp.fromDate(options.customDate) : serverTimestamp();
      const requestData: any[] = [];
      const itemCache: Record<string, Item> = {};
      const invCache: Record<string, { ref: any, quantity: number, serialNumber?: string, metadata: any }> = {};

      // 1. READS
      const locIds = Array.from(new Set(selections.map(s => s.sourceLocationId)));
      const locDocs = await Promise.all(locIds.map(id => dbTransaction.get(doc(db, 'locations', id))));
      const locMap = new Map();
      locIds.forEach((id, i) => locMap.set(id, locDocs[i]));
      const isInternal = (loc: any) => loc?.exists() && (loc.data()?.type === 'warehouse' || loc.data()?.type === 'jobsite');

      for (const selection of selections) {
        const { requestId, deliveredQty, sourceLocationId, variant, serialNumbers } = selection;
        const requestRef = doc(db, 'requests', requestId);
        const requestDoc = await dbTransaction.get(requestRef);
        if (!requestDoc.exists()) continue;
        const request = requestDoc.data() as Request;

        if (sourceLocationId === request.jobsiteId) {
          throw new Error(`Pick source and delivery destination cannot be the same location. Choose a different source warehouse.`);
        }

        const { itemId, uomId, customSpec } = request;
        const effectiveVariant = variant || request.variant;

        if (!itemCache[itemId]) {
          const itemRef = doc(db, 'items', itemId);
          const itemDoc = await dbTransaction.get(itemRef);
          if (itemDoc.exists()) {
            itemCache[itemId] = itemDoc.data() as Item;
          }
        }
        const itemData = itemCache[itemId];
        if (!itemData) continue;

        // If serial numbers are provided, we need to read each one's inventory
        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, sn, customSpec);
            const invKey = invRef.path;
            if (!invCache[invKey]) {
              const invDoc = await dbTransaction.get(invRef);
              invCache[invKey] = {
                ref: invRef,
                quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
                serialNumber: sn,
                metadata: { itemId, locationId: sourceLocationId, variant: effectiveVariant, customSpec }
              };
            }
          }
        } else {
          const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, undefined, customSpec);
          const invKey = invRef.path;
          if (!invCache[invKey]) {
            const invDoc = await dbTransaction.get(invRef);
            invCache[invKey] = {
              ref: invRef,
              quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
              metadata: { itemId, locationId: sourceLocationId, variant: effectiveVariant, customSpec }
            };
          }
        }

        // Resolve UOM ID
        const targetUomId = uomMap.get(uomId.toLowerCase()) || uomId;
        const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;

        const conversionFactor = itemBaseUomId === targetUomId ? 1 : (itemData.uomConversions?.find(c => {
          const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
          return cUomId === targetUomId;
        })?.factor || 1);
        const baseQuantity = deliveredQty * conversionFactor;

        requestData.push({
          requestId,
          requestRef,
          request,
          selection,
          effectiveVariant,
          conversionFactor,
          baseQuantity,
          itemData
        });
      }

      // Assign DR numbers: one per unique destination jobsite.
      // If a custom/reused batchId was provided, all destinations share it.
      if (reusedBatchId) {
        for (const d of requestData) {
          jobsiteBatchIds.set(d.request.jobsiteId || 'unknown', reusedBatchId);
        }
      } else {
        const uniqueJobsiteIds = [...new Set(requestData.map(d => d.request.jobsiteId || 'unknown'))];
        const now = new Date();
        const yearYY = now.getFullYear().toString().slice(-2);
        counterRef = doc(db, 'counters', 'dr_number');
        const counterDoc = await dbTransaction.get(counterRef);
        let nextSeries = 1;
        if (counterDoc.exists()) {
          const cData = counterDoc.data() as { year: string; lastSeries: number };
          if (cData.year === yearYY) {
            nextSeries = (cData.lastSeries || 0) + 1;
          }
        }
        for (const jid of uniqueJobsiteIds) {
          const seriesStr = nextSeries.toString().padStart(3, '0');
          jobsiteBatchIds.set(jid, `DR#${yearYY}-${seriesStr}`);
          nextSeries++;
        }
        counterUpdate = { year: yearYY, lastSeries: nextSeries - 1, updatedAt: serverTimestamp() };
      }

      // 2. WRITES
      for (const data of requestData) {
        const { requestId, requestRef, request, selection, effectiveVariant, conversionFactor, baseQuantity, itemData } = data;
        const { deliveredQty, sourceLocationId, backorder, serialNumbers } = selection;
        const { itemId, uomId, approvedQty, customSpec } = request;
        const batchId = jobsiteBatchIds.get(request.jobsiteId || 'unknown') || '';

        // Update inventory cache and record transactions
        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, sn, request.customSpec);
            const invKey = invRef.path;
            invCache[invKey].quantity -= 1; // Serialized items are always quantity 1

            // Record individual transaction per serial number
            const transactionRef = doc(collection(db, 'transactions'));
            dbTransaction.set(transactionRef, cleanData({
              itemId,
              variant: effectiveVariant || null,
              customSpec: request.customSpec || null,
              fromLocationId: sourceLocationId,
              toLocationId: 'in-transit',
              quantity: 1,
              serialNumber: sn,
              uomId,
              conversionFactor,
              baseQuantity: 1 * conversionFactor,
              type: 'pick',
              userId: warehousemanId,
              userName: warehousemanName || '',
              timestamp: pickTime,
              batchId,
              requestIds: [requestId]
            }));

            // Update Asset location
            const assetRef = doc(db, 'assets', sn);
            dbTransaction.set(assetRef, {
              id: sn,
              itemId,
              locationId: 'in-transit',
              updatedAt: pickTime
            }, { merge: true });
          }
        } else {
          const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, undefined, customSpec);
          const invKey = invRef.path;
          if (invCache[invKey].quantity < baseQuantity) {
            throw new Error(`Insufficient stock for ${itemData.name}: ${invCache[invKey].quantity} available, ${baseQuantity} requested.`);
          }
          invCache[invKey].quantity -= baseQuantity;

          // Record individual transaction (Pick)
          const transactionRef = doc(collection(db, 'transactions'));
          dbTransaction.set(transactionRef, cleanData({
            itemId,
            variant: effectiveVariant || null,
            customSpec: customSpec || null,
            fromLocationId: sourceLocationId,
            toLocationId: 'in-transit',
            quantity: deliveredQty,
            uomId,
            conversionFactor,
            baseQuantity,
            type: 'pick',
            userId: warehousemanId,
            userName: warehousemanName || '',
            timestamp: pickTime,
            batchId,
            requestIds: [requestId]
          }));
        }

        // Update Request Status to 'for delivery'
        // We set approvedQty to deliveredQty so it shows the actual picked amount in 'for delivery' section
        dbTransaction.update(requestRef, cleanData({
          status: 'for delivery',
          approvedQty: deliveredQty,
          deliveredQty,
          pickedAt: pickTime,
          batchId,
          variant: effectiveVariant || null,
          sourceLocationId,
          warehousemanId,
          warehousemanName: warehousemanName || '',
          serialNumbers: serialNumbers || null
        }));

        // Handle Backorder
        const originalApprovedQty = request.approvedQty || request.requestedQty;
        if (backorder && deliveredQty < originalApprovedQty) {
          const backorderRef = doc(collection(db, 'requests'));
          dbTransaction.set(backorderRef, cleanData({
            itemId,
            variant: effectiveVariant || null,
            customSpec: customSpec || null,
            requestedQty: originalApprovedQty - deliveredQty,
            approvedQty: originalApprovedQty - deliveredQty,
            uomId,
            jobsiteId: request.jobsiteId,
            status: 'approved',
            requestorId: request.requestorId,
            requestorName: request.requestorName || '',
            approverId: request.approverId || '',
            approverName: request.approverName || '',
            workerNote: `Backorder of ${itemData.name}`,
            timestamp: pickTime,
            approvedAt: pickTime,
            backorderOf: requestId
          }));
        }
      }

      // Final inventory writes
      for (const invKey in invCache) {
        const { ref, quantity, serialNumber, metadata } = invCache[invKey];
        dbTransaction.set(ref, cleanData({
          itemId: metadata.itemId,
          locationId: metadata.locationId,
          variant: metadata.variant || null,
          customSpec: metadata.customSpec || null,
          serialNumber: serialNumber || null,
          quantity: quantity,
          updatedAt: serverTimestamp()
        }), { merge: true });
      }

      // Update total quantities for items
      for (const itemId in itemCache) {
        const itemData = itemCache[itemId];
        const itemRef = doc(db, 'items', itemId);
        
        // Calculate net change in total quantity for this item in this batch
        // Picking moves from internal (warehouse/jobsite) to in-transit (external)
        let netChange = 0;
        requestData.filter(d => d.request.itemId === itemId).forEach(d => {
          const fromIsInternal = isInternal(locMap.get(d.selection.sourceLocationId));
          const toIsInternal = false; // in-transit is external
          netChange += (toIsInternal ? d.baseQuantity : 0) - (fromIsInternal ? d.baseQuantity : 0);
        });

        if (netChange !== 0) {
          dbTransaction.update(itemRef, {
            totalQuantity: (itemData.totalQuantity || 0) + netChange,
            updatedAt: serverTimestamp(),
            updatedBy: warehousemanId
          });
        }
      }

      // 3. FINAL COUNTER WRITE (Must be after all reads)
      if (counterUpdate && counterRef) {
        dbTransaction.set(counterRef, counterUpdate);
      }
    });
  } catch (error) {
    console.error("Bulk pick failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'bulk_pick');
  } finally {
    if (opId) await endOperation(opId);
  }
};

export const updateDeliveryQuantity = async (requestId: string, newQuantity: number, warehousemanId: string, warehousemanName: string, createBackorder: boolean) => {
  try {
    // Fetch UOMs first to resolve symbols if needed
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>(); // symbol/id -> id
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    await runTransaction(db, async (dbTransaction) => {
      const requestRef = doc(db, 'requests', requestId);
      const requestDoc = await dbTransaction.get(requestRef);
      if (!requestDoc.exists()) throw new Error('Request not found');
      
      const request = requestDoc.data() as Request;
      const oldQuantity = request.deliveredQty || 0;
      const difference = oldQuantity - newQuantity;
      
      if (difference === 0) return;
      if (newQuantity < 0) throw new Error('Quantity cannot be negative');

      const itemId = request.itemId;
      const itemRef = doc(db, 'items', itemId);
      const itemDoc = await dbTransaction.get(itemRef);
      if (!itemDoc.exists()) throw new Error('Item not found');
      const itemData = itemDoc.data() as Item;

      // Resolve UOM ID
      const targetUomId = uomMap.get((request.uomId || '').toLowerCase()) || request.uomId;
      const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;

      const conversionFactor = itemBaseUomId === targetUomId ? 1 : (itemData.uomConversions?.find(c => {
        const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
        return cUomId === targetUomId;
      })?.factor || 1);
      const baseDifference = difference * conversionFactor;

      // Update source location inventory if quantity decreased (stock returned to warehouse)
      // If quantity increased, we'd need to check availability, but the requirement specifically mentions "if it's now less than before"
      if (difference > 0) {
        if (request.sourceLocationId) {
          const invRef = getInventoryRef(itemId, request.sourceLocationId, request.variant, undefined, request.customSpec);
          const invDoc = await dbTransaction.get(invRef);
          const currentInvData = invDoc.data() as any;
          const currentInvQty = (invDoc.exists() ? currentInvData?.quantity : 0) || 0;
          
          dbTransaction.set(invRef, {
            quantity: currentInvQty + baseDifference,
            updatedAt: serverTimestamp()
          }, { merge: true });

          // Update total quantity (it was external 'in-transit', now returning internal)
          dbTransaction.update(itemRef, {
            totalQuantity: (itemData.totalQuantity || 0) + baseDifference,
            updatedAt: serverTimestamp(),
            updatedBy: warehousemanId
          });
        }

        // Record Adjustment Transaction (for the reduction)
        const transRef = doc(collection(db, 'transactions'));
        dbTransaction.set(transRef, cleanData({
          itemId,
          variant: request.variant || null,
          customSpec: request.customSpec || null,
          fromLocationId: 'in-transit',
          toLocationId: request.sourceLocationId || 'unknown',
          quantity: difference,
          uomId: request.uomId,
          conversionFactor,
          baseQuantity: baseDifference,
          type: 'adjustment',
          userId: warehousemanId,
          userName: warehousemanName,
          timestamp: serverTimestamp(),
          notes: `Quantity reduced for delivery #${request.batchId}. Stock returned to source.`
        }));

        // Backorder
        if (createBackorder) {
          const backorderRef = doc(collection(db, 'requests'));
          dbTransaction.set(backorderRef, cleanData({
            itemId,
            variant: request.variant || null,
            customSpec: request.customSpec || null,
            requestedQty: difference,
            approvedQty: difference,
            uomId: request.uomId,
            jobsiteId: request.jobsiteId,
            status: 'approved',
            requestorId: request.requestorId,
            requestorName: request.requestorName || '',
            approverId: request.approverId || '',
            approverName: request.approverName || '',
            workerNote: `Backorder of ${itemData.name} (Quantity Adjustment)`,
            timestamp: serverTimestamp(),
            approvedAt: serverTimestamp(),
            backorderOf: requestId
          }));
        }
      } else if (difference < 0) {
          // If warehouseman increases quantity... it's out of scope for "if it's less than before" but good to handle errors
          // For now let's just allow it if stock permits? Actually user said "if it's less than before".
          // Increasing quantity in-transit usually requires another pick. 
          // To keep it simple and safe, I'll error if increasing unless requested.
          throw new Error('Increasing delivery quantity after picking is not supported. Please create a new request or pick from warehouse again.');
      }

      // Update original request
      const updateData: any = {
        approvedQty: newQuantity,
        deliveredQty: newQuantity,
        updatedAt: serverTimestamp(),
        updatedBy: warehousemanId,
        adjustmentHistory: [
          ...(request.adjustmentHistory || []),
          {
            oldQty: oldQuantity,
            newQty: newQuantity,
            timestamp: new Date().toISOString(),
            userId: warehousemanId
          }
        ]
      };

      // If quantity is now 0, mark it as 'delivered' (quantity 0) so it leaves the active list
      if (newQuantity === 0) {
        updateData.status = 'delivered';
        updateData.deliveredAt = serverTimestamp();
      }

      dbTransaction.update(requestRef, cleanData(updateData));
    });
  } catch (error) {
    console.error("Update delivery quantity failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'requests');
    throw error;
  }
};

export const recordBulkReceive = async (requestIds: string[], receiverId: string, receiverName?: string, role?: string) => {
  const opId = await startOperation(receiverId, role || '', 'bulk_receive').catch(() => '');
  try {
    // Fetch UOMs first to resolve symbols if needed
    const uomsSnap = await getDocs(query(collection(db, 'uoms'), where('isActive', '==', true)));
    const uomMap = new Map<string, string>(); // symbol/id -> id
    uomsSnap.forEach(u => {
      const data = u.data() as UOM;
      uomMap.set(data.symbol.toLowerCase(), u.id);
      uomMap.set(u.id, u.id);
    });

    const requestDocs = await Promise.all(requestIds.map(id => getDoc(doc(db, 'requests', id))));
    const validRequests = requestDocs.filter(d => d.exists() && d.data()?.status === 'for delivery');
    const skippedCount = validRequests.filter(d => !(d.data() as Request).deliveredQty || (d.data() as Request).deliveredQty === 0).length;
    
    // Pre-fetch BOQ IDs for the items in these requests
    const boqMap = new Map<string, string>(); // key: itemId_jobsiteId_variantHash, value: boqId
    await Promise.all(validRequests.map(async (docSnap) => {
      const data = docSnap.data() as Request;
      const { itemId, jobsiteId, variant } = data;
      const q = query(collection(db, 'boq'), where('jobsiteId', '==', jobsiteId), where('itemId', '==', itemId));
      const snap = await getDocs(q);
      const variantStr = normalizeVariant(variant);
      const match = snap.docs.find(d => normalizeVariant(d.data().variant) === variantStr);
      if (match) {
        const key = `${itemId}_${jobsiteId}_${variantStr}`;
        boqMap.set(key, match.id);
      }
    }));

    await runTransaction(db, async (dbTransaction) => {
      // Determine shared batchId for grouping in transaction history
      let sharedBatchId: string | null = null;
      if (validRequests.length > 0) {
        const firstBatchId = (validRequests[0].data() as Request).batchId;
        const allSame = validRequests.every(d => (d.data() as Request).batchId === firstBatchId);
        
        if (allSame && firstBatchId) {
          sharedBatchId = firstBatchId;
        } else if (validRequests.length > 1) {
          // Generate new one if multiple items received together don't share one
          const now = new Date();
          const yearYY = now.getFullYear().toString().slice(-2);
          const counterRef = doc(db, 'counters', 'dr_number');
          const counterDoc = await dbTransaction.get(counterRef);
          let nextSeries = 1;
          if (counterDoc.exists()) {
            const data = counterDoc.data() as { year: string; lastSeries: number };
            if (data.year === yearYY) {
              nextSeries = (data.lastSeries || 0) + 1;
            }
          }
          const seriesStr = nextSeries.toString().padStart(3, '0');
          sharedBatchId = `DR#${yearYY}-${seriesStr}`;
          dbTransaction.set(counterRef, {
            year: yearYY,
            lastSeries: nextSeries,
            updatedAt: serverTimestamp()
          });
        } else {
          sharedBatchId = firstBatchId || null;
        }
      }

      const requestData: any[] = [];
      const itemCache: Record<string, Item> = {};
      const invCache: Record<string, { ref: any, quantity: number, averageCost: number, serialNumber?: string, metadata: any }> = {};
      const boqCache: Record<string, { ref: any, quantity: number }> = {};

      const locMap = new Map();
      const isInternal = (loc: any) => loc?.exists() && (loc.data()?.type === 'warehouse' || loc.data()?.type === 'jobsite');
      
      for (const requestDoc of validRequests) {
        const requestId = requestDoc.id;
        const requestRef = requestDoc.ref;
        const request = requestDoc.data() as Request;
        const { itemId, uomId, jobsiteId, deliveredQty, variant, serialNumbers, customSpec } = request;

        if (!locMap.has(jobsiteId)) {
          const locDoc = await dbTransaction.get(doc(db, 'locations', jobsiteId));
          locMap.set(jobsiteId, locDoc);
        }

        if (!itemCache[itemId]) {
          const itemRef = doc(db, 'items', itemId);
          const itemDoc = await dbTransaction.get(itemRef);
          if (itemDoc.exists()) {
            itemCache[itemId] = itemDoc.data() as Item;
          }
        }
        const itemData = itemCache[itemId];
        if (!itemData) {
          console.warn("[BulkReceive] Item not found:", itemId);
          continue;
        }

        // Pre-fetch BOQ data
        const variantStr = normalizeVariant(variant);
        const boqKey = `${itemId}_${jobsiteId}_${variantStr}`;
        const boqId = boqMap.get(boqKey);
        if (boqId && !boqCache[boqId]) {
          const boqRef = doc(db, 'boq', boqId);
          const boqDoc = await dbTransaction.get(boqRef);
          if (boqDoc.exists()) {
            boqCache[boqId] = {
              ref: boqRef,
              quantity: (boqDoc.data().currentQuantity || 0) as number
            };
          }
        }

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn, customSpec);
            const invKey = invRef.path;
            if (!invCache[invKey]) {
              const invDoc = await dbTransaction.get(invRef);
              invCache[invKey] = {
                ref: invRef,
                quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
                averageCost: invDoc.exists() ? (invDoc.data()?.averageCost ?? 0) : 0,
                serialNumber: sn,
                metadata: { itemId, jobsiteId, variant, customSpec }
              };
            }
          }
        } else {
          const invRef = getInventoryRef(itemId, jobsiteId, variant, undefined, customSpec);
          const invKey = invRef.path;
          if (!invCache[invKey]) {
            const invDoc = await dbTransaction.get(invRef);
            invCache[invKey] = {
              ref: invRef,
              quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
              averageCost: invDoc.exists() ? (invDoc.data()?.averageCost ?? 0) : 0,
              metadata: { itemId, jobsiteId, variant, customSpec }
            };
          }
        }

        // Resolve UOM ID
        const targetUomId = uomMap.get((uomId || '').toLowerCase()) || uomId;
        const itemBaseUomId = uomMap.get((itemData.uomId || '').toLowerCase()) || itemData.uomId;

        const conversionFactor = itemBaseUomId === targetUomId ? 1 : (itemData.uomConversions?.find(c => {
          const cUomId = uomMap.get((c.uomId || '').toLowerCase()) || c.uomId;
          return cUomId === targetUomId;
        })?.factor || 1);
        const baseQuantity = (deliveredQty || 0) * conversionFactor;
        if (baseQuantity === 0) continue;

        requestData.push({
          requestId,
          requestRef,
          request,
          conversionFactor,
          baseQuantity
        });
      }

      // 2. WRITES
      for (const data of requestData) {
        const { requestId, requestRef, request, conversionFactor, baseQuantity } = data;
        const { itemId, uomId, jobsiteId, deliveredQty, variant, serialNumbers } = request;

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn, request.customSpec);
            const invKey = invRef.path;

            // Serial items: cost = source item's latest price (no qty-weighting needed per serial doc)
            const snItemData = itemCache[itemId];
            const snVariantKey = normalizeVariant(variant);
            const snVariantConfig = snItemData?.variantConfigs?.find(c => normalizeVariant(c.variant) === snVariantKey);
            invCache[invKey].averageCost = (variant && Object.keys(variant || {}).length > 0 && snVariantConfig?.latestPrice !== undefined)
              ? snVariantConfig.latestPrice
              : (snItemData?.latestPrice || 0);
            invCache[invKey].quantity += 1;

            // Record individual transaction per serial number
            const transactionRef = doc(collection(db, 'transactions'));
            dbTransaction.set(transactionRef, cleanData({
              itemId,
              variant: variant || null,
              customSpec: request.customSpec || null,
              fromLocationId: 'in-transit',
              toLocationId: jobsiteId,
              quantity: 1,
              serialNumber: sn,
              uomId,
              conversionFactor,
              baseQuantity: 1 * conversionFactor,
              type: 'delivery',
              userId: receiverId,
              userName: receiverName || '',
              timestamp: serverTimestamp(),
              batchId: sharedBatchId,
              requestIds: [requestId]
            }));

            // Update Asset location
            const assetRef = doc(db, 'assets', sn);
            dbTransaction.set(assetRef, {
              id: sn,
              itemId,
              locationId: jobsiteId,
              updatedAt: serverTimestamp()
            }, { merge: true });
          }
        } else {
          const invRef = getInventoryRef(itemId, jobsiteId, variant, undefined, request.customSpec);
          const invKey = invRef.path;

          // Compute weighted average cost from source item's latest price before incrementing quantity
          const nsItemData = itemCache[itemId];
          const nsVariantKey = normalizeVariant(variant);
          const nsVariantConfig = nsItemData?.variantConfigs?.find(c => normalizeVariant(c.variant) === nsVariantKey);
          const nsSourceCost = (variant && Object.keys(variant || {}).length > 0 && nsVariantConfig?.latestPrice !== undefined)
            ? nsVariantConfig.latestPrice
            : (nsItemData?.latestPrice || 0);
          const nsCurrentQty = invCache[invKey].quantity;
          invCache[invKey].averageCost = nsCurrentQty > 0
            ? (nsCurrentQty * invCache[invKey].averageCost + baseQuantity * nsSourceCost) / (nsCurrentQty + baseQuantity)
            : nsSourceCost;
          invCache[invKey].quantity += baseQuantity;

          // Record individual transaction (Receive)
          const transactionRef = doc(collection(db, 'transactions'));
          dbTransaction.set(transactionRef, cleanData({
            itemId,
            variant: variant || null,
            customSpec: request.customSpec || null,
            fromLocationId: 'in-transit',
            toLocationId: jobsiteId,
            quantity: deliveredQty,
            uomId,
            conversionFactor,
            baseQuantity,
            type: 'delivery',
            userId: receiverId,
            userName: receiverName || '',
            timestamp: serverTimestamp(),
            batchId: sharedBatchId,
            requestIds: [requestId]
          }));
        }

        // Update Request Status to 'delivered'
        dbTransaction.update(requestRef, cleanData({
          status: 'delivered',
          batchId: sharedBatchId,
          deliveredAt: serverTimestamp(),
          receiverId,
          receiverName: receiverName || ''
        }));

        // Update Jobsite BOQ currentQuantity
        const variantStr = normalizeVariant(variant);
        const key = `${itemId}_${jobsiteId}_${variantStr}`;
        const boqId = boqMap.get(key);
        if (boqId && boqCache[boqId]) {
          const { ref, quantity } = boqCache[boqId];
          const newQty = quantity + baseQuantity;
          dbTransaction.update(ref, { currentQuantity: newQty });
          // Update cache for consecutive requests for the same BOQ item in this batch
          boqCache[boqId].quantity = newQty;
        }
      }

      // Final inventory writes
      for (const invKey in invCache) {
        const { ref, quantity, averageCost, serialNumber, metadata } = invCache[invKey];
        dbTransaction.set(ref, cleanData({
          itemId: metadata.itemId,
          locationId: metadata.jobsiteId,
          variant: metadata.variant || null,
          customSpec: metadata.customSpec || null,
          serialNumber: serialNumber || null,
          quantity: quantity,
          averageCost: averageCost
        }), { merge: true });
      }

      // Update total quantities for items
      for (const itemId in itemCache) {
        const itemData = itemCache[itemId];
        const itemRef = doc(db, 'items', itemId);
        
        // Receiving moves from in-transit (external) to jobsite (internal)
        let netChange = 0;
        requestData.filter(d => d.request.itemId === itemId).forEach(d => {
          const fromIsInternal = false; // in-transit is external
          const toIsInternal = isInternal(locMap.get(d.request.jobsiteId));
          netChange += (toIsInternal ? d.baseQuantity : 0) - (fromIsInternal ? d.baseQuantity : 0);
        });

        if (netChange !== 0) {
          dbTransaction.update(itemRef, {
            totalQuantity: (itemData.totalQuantity || 0) + netChange
          });
        }
      }
    });
    return { skippedCount };
  } catch (error) {
    console.error("Bulk receive failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'bulk_receive');
  } finally {
    if (opId) await endOperation(opId);
  }
};

export const reverseDeliveryBatch = async (
  batchId: string,
  adminId: string,
  adminName?: string
): Promise<void> => {
  try {
    const txSnap = await getDocs(query(collection(db, 'transactions'), where('batchId', '==', batchId)));
    const allTxs = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));

    const deliveryTxs = allTxs.filter(t => t.type === 'delivery');
    const pickTxs     = allTxs.filter(t => t.type === 'pick');

    if (deliveryTxs.length === 0) {
      const foundTypes = [...new Set(allTxs.map(t => t.type))].join(', ') || 'none';
      console.error(
        `[reverseDeliveryBatch] batchId="${batchId}": ` +
        `${allTxs.length} total txs (${pickTxs.length} picks, 0 deliveries). ` +
        `Types found: ${foundTypes}. ` +
        `Delivery may have been recorded under a different batch ID.`
      );
      throw new Error(
        `No delivery transactions found for batch ${batchId}. ` +
        `The delivery was likely recorded under a different DR number. ` +
        `Find the batch with type "delivery" in the Transactions Manager and reverse that one instead.`
      );
    }

    // Build source location maps from pick transactions
    const sourceByItemId = new Map<string, string>(); // itemId → warehouse locationId
    const sourceBySN     = new Map<string, string>(); // serialNumber → warehouse locationId
    for (const tx of pickTxs) {
      if (!tx.fromLocationId || tx.fromLocationId === 'in-transit') continue;
      if (tx.serialNumber) sourceBySN.set(tx.serialNumber, tx.fromLocationId);
      else                 sourceByItemId.set(tx.itemId, tx.fromLocationId);
    }

    const allRequestIds = [...new Set(allTxs.flatMap(t => t.requestIds ?? []))];

    // Pre-fetch requests to supplement source maps and BOQ data
    const reqPreFetch  = await Promise.all(allRequestIds.map(id => getDoc(doc(db, 'requests', id))));
    const validReqDocs = reqPreFetch.filter(d => d.exists());

    for (const d of validReqDocs) {
      const req = d.data() as Request;
      if (!req.sourceLocationId) continue;
      if (req.serialNumbers?.length) {
        for (const sn of req.serialNumbers) {
          if (!sourceBySN.has(sn)) sourceBySN.set(sn, req.sourceLocationId);
        }
      } else {
        if (!sourceByItemId.has(req.itemId)) sourceByItemId.set(req.itemId, req.sourceLocationId);
      }
    }

    const boqMap = new Map<string, string>(); // key → boqId
    await Promise.all(validReqDocs.map(async docSnap => {
      const req = docSnap.data() as Request;
      const { itemId, jobsiteId, variant } = req;
      const q = query(collection(db, 'boq'), where('jobsiteId', '==', jobsiteId), where('itemId', '==', itemId));
      const snap = await getDocs(q);
      const variantStr = normalizeVariant(variant);
      const match = snap.docs.find(d => normalizeVariant(d.data().variant) === variantStr);
      if (match) boqMap.set(`${itemId}_${jobsiteId}_${variantStr}`, match.id);
    }));

    await runTransaction(db, async (dbTransaction) => {
      const reverseTime = serverTimestamp();

      // --- READS ---
      const reqCache: Record<string, { ref: any; data: Request }> = {};
      for (const id of allRequestIds) {
        const ref  = doc(db, 'requests', id);
        const snap = await dbTransaction.get(ref);
        if (snap.exists()) reqCache[id] = { ref, data: snap.data() as Request };
      }

      const locIds = new Set<string>();
      for (const tx of deliveryTxs) {
        if (tx.toLocationId && tx.toLocationId !== 'in-transit') locIds.add(tx.toLocationId);
      }
      for (const locId of sourceByItemId.values()) locIds.add(locId);
      for (const locId of sourceBySN.values())     locIds.add(locId);

      const locDocMap = new Map<string, any>();
      for (const locId of locIds) {
        locDocMap.set(locId, await dbTransaction.get(doc(db, 'locations', locId)));
      }
      const isInternal = (locId: string | undefined) => {
        if (!locId) return false;
        const snap = locDocMap.get(locId);
        return snap?.exists() && (snap.data()?.type === 'warehouse' || snap.data()?.type === 'jobsite');
      };

      const invCache: Record<string, { ref: any; quantity: number; serialNumber?: string; metadata: any }> = {};
      const itemCache: Record<string, Item> = {};
      const boqCache:  Record<string, { ref: any; quantity: number }> = {};

      for (const tx of deliveryTxs) {
        const { itemId, toLocationId: jobsiteId, serialNumber, variant, customSpec } = tx;
        const srcId = serialNumber ? sourceBySN.get(serialNumber) : sourceByItemId.get(itemId);

        if (!itemCache[itemId]) {
          const snap = await dbTransaction.get(doc(db, 'items', itemId));
          if (snap.exists()) itemCache[itemId] = snap.data() as Item;
        }

        if (jobsiteId && jobsiteId !== 'in-transit') {
          const ref = getInventoryRef(itemId, jobsiteId, variant, serialNumber, customSpec);
          const k   = ref.path;
          if (!invCache[k]) {
            const snap = await dbTransaction.get(ref);
            invCache[k] = {
              ref,
              quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
              serialNumber,
              metadata: { itemId, locationId: jobsiteId, variant, customSpec },
            };
          }
        }

        if (srcId) {
          const ref = getInventoryRef(itemId, srcId, variant, serialNumber, customSpec);
          const k   = ref.path;
          if (!invCache[k]) {
            const snap = await dbTransaction.get(ref);
            invCache[k] = {
              ref,
              quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
              serialNumber,
              metadata: { itemId, locationId: srcId, variant, customSpec },
            };
          }
        }

        for (const reqId of (tx.requestIds ?? [])) {
          const rq = reqCache[reqId];
          if (!rq) continue;
          const variantStr = normalizeVariant(rq.data.variant);
          const boqId = boqMap.get(`${rq.data.itemId}_${rq.data.jobsiteId}_${variantStr}`);
          if (boqId && !boqCache[boqId]) {
            const ref  = doc(db, 'boq', boqId);
            const snap = await dbTransaction.get(ref);
            if (snap.exists()) boqCache[boqId] = { ref, quantity: snap.data().currentQuantity || 0 };
          }
        }
      }

      // --- WRITES ---
      const boqUpdatedReqIds = new Set<string>();

      for (const tx of deliveryTxs) {
        const { itemId, toLocationId: jobsiteId, serialNumber, variant, customSpec, quantity, baseQuantity, uomId, conversionFactor, requestIds: txReqIds = [] } = tx;
        const srcId = serialNumber ? sourceBySN.get(serialNumber) : sourceByItemId.get(itemId);

        if (jobsiteId && jobsiteId !== 'in-transit') {
          const k = getInventoryRef(itemId, jobsiteId, variant, serialNumber, customSpec).path;
          if (invCache[k]) invCache[k].quantity -= serialNumber ? 1 : baseQuantity;
        }

        if (srcId) {
          const k = getInventoryRef(itemId, srcId, variant, serialNumber, customSpec).path;
          if (invCache[k]) invCache[k].quantity += serialNumber ? 1 : baseQuantity;
        }

        const returnRef = doc(collection(db, 'transactions'));
        dbTransaction.set(returnRef, cleanData({
          itemId,
          variant:        variant     || null,
          customSpec:     customSpec  || null,
          fromLocationId: jobsiteId   || null,
          toLocationId:   srcId       || null,
          quantity,
          serialNumber:   serialNumber || null,
          uomId,
          conversionFactor,
          baseQuantity,
          type:      'return',
          userId:    adminId,
          userName:  adminName || '',
          timestamp: reverseTime,
          batchId,
          requestIds: txReqIds,
          notes: `Reversed by ${adminName || 'admin'}`,
        }));

        if (serialNumber && srcId) {
          const assetRef = doc(db, 'assets', serialNumber);
          dbTransaction.set(assetRef, { id: serialNumber, itemId, locationId: srcId, updatedAt: reverseTime }, { merge: true });
        }

        for (const reqId of txReqIds) {
          if (boqUpdatedReqIds.has(reqId)) continue;
          const rq = reqCache[reqId];
          if (!rq) continue;
          const variantStr = normalizeVariant(rq.data.variant);
          const boqId = boqMap.get(`${rq.data.itemId}_${rq.data.jobsiteId}_${variantStr}`);
          if (boqId && boqCache[boqId]) {
            const newQty = Math.max(0, boqCache[boqId].quantity - baseQuantity);
            dbTransaction.update(boqCache[boqId].ref, { currentQuantity: newQty });
            boqCache[boqId].quantity = newQty;
            boqUpdatedReqIds.add(reqId);
          }
        }
      }

      for (const k in invCache) {
        const { ref, quantity, serialNumber, metadata } = invCache[k];
        dbTransaction.set(ref, cleanData({
          itemId:       metadata.itemId,
          locationId:   metadata.locationId,
          variant:      metadata.variant    || null,
          customSpec:   metadata.customSpec || null,
          serialNumber: serialNumber        || null,
          quantity:     Math.max(0, quantity),
          updatedAt:    serverTimestamp(),
        }), { merge: true });
      }

      // Reversal: jobsite (internal) → warehouse (internal) → net = 0 in most cases
      for (const itemId in itemCache) {
        const itemData = itemCache[itemId];
        let netChange = 0;
        for (const tx of deliveryTxs.filter(t => t.itemId === itemId)) {
          const srcId     = tx.serialNumber ? sourceBySN.get(tx.serialNumber) : sourceByItemId.get(itemId);
          const fromIsInt = isInternal(tx.toLocationId);
          const toIsInt   = isInternal(srcId);
          netChange += (toIsInt ? tx.baseQuantity : 0) - (fromIsInt ? tx.baseQuantity : 0);
        }
        if (netChange !== 0) {
          dbTransaction.update(doc(db, 'items', itemId), {
            totalQuantity: (itemData.totalQuantity || 0) + netChange,
            updatedAt: serverTimestamp(),
            updatedBy: adminId,
          });
        }
      }

      for (const id of allRequestIds) {
        const rq = reqCache[id];
        if (!rq || rq.data.status !== 'delivered') continue;
        dbTransaction.update(rq.ref, {
          status:       'for delivery',
          deliveredAt:  deleteField(),
          receiverId:   deleteField(),
          receiverName: deleteField(),
        });
      }
    });
  } catch (error) {
    console.error('Reverse delivery failed:', error);
    handleFirestoreError(error, OperationType.WRITE, 'reverse_delivery');
  }
};

export const bulkUpdateRequests = async (
  requestIds: string[],
  field: string,
  value: string,
  nameField?: string,
  nameValue?: string,
): Promise<number> => {
  const batch = writeBatch(db);
  for (const id of requestIds) {
    const ref = doc(db, 'requests', id);
    const update: Record<string, any> = {
      [field]: value,
      updatedAt: serverTimestamp(),
    };
    if (nameField !== undefined) {
      update[nameField] = nameValue ?? '';
    }
    batch.update(ref, update);
  }
  await batch.commit();
  return requestIds.length;
};

export const clearInventoryData = async (includeBOQ: boolean = true, includePOs: boolean = false) => {
  try {
    const collectionsToClear = ['inventory', 'requests', 'transactions', 'unplanned_stock', 'supplier_pricing', 'suppliers_invoices', 'price_history'];
    if (includeBOQ) {
      collectionsToClear.push('boq');
    }
    
    for (const colName of collectionsToClear) {
      try {
        const snap = await getDocs(collection(db, colName));
        const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);
      } catch (err) {
        console.error(`Failed to clear collection ${colName}:`, err);
        handleFirestoreError(err, OperationType.DELETE, colName);
      }
    }
    
    // Handle Purchase Orders
    try {
      const poSnap = await getDocs(collection(db, 'purchase_orders'));
      if (includePOs) {
        // Delete all POs
        const poDeletes = poSnap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(poDeletes);
      } else {
        // Reset all POs: set receivedQuantity to 0 and status to 'sent'
        const poUpdates = poSnap.docs.map(d => {
          const poData = d.data() as PurchaseOrder;
          const resetItems = poData.items.map(item => ({
            ...item,
            receivedQuantity: 0
          }));
          return updateDoc(d.ref, {
            items: resetItems,
            status: 'sent',
            amountPaid: 0,
            paymentStatus: 'unpaid',
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.uid || 'system'
          });
        });
        await Promise.all(poUpdates);
      }
    } catch (err) {
      console.error("Failed to clear/reset purchase orders:", err);
      handleFirestoreError(err, OperationType.WRITE, 'purchase_orders');
    }
    
    // Also reset totalQuantity for all items to keep data consistent
    try {
      const itemsSnap = await getDocs(collection(db, 'items'));
      const itemUpdates = itemsSnap.docs.map(d => updateDoc(d.ref, {
        totalQuantity: 0
      }));
      await Promise.all(itemUpdates);
    } catch (err) {
      console.error("Failed to reset items:", err);
      handleFirestoreError(err, OperationType.WRITE, 'items');
    }

    // Also clear assets since they are linked to inventory
    try {
      const assetsSnap = await getDocs(collection(db, 'assets'));
      const assetDeletes = assetsSnap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(assetDeletes);
    } catch (err) {
      console.error("Failed to clear assets:", err);
      handleFirestoreError(err, OperationType.DELETE, 'assets');
    }

    // Reset DR number counter
    try {
      await deleteDoc(doc(db, 'counters', 'dr_number'));
    } catch (err) {
      console.error("Failed to reset DR counter:", err);
      handleFirestoreError(err, OperationType.DELETE, 'counters/dr_number');
    }

  } catch (error) {
    console.error("Clear inventory data failed:", error);
    handleFirestoreError(error, OperationType.DELETE, 'bulk_clear');
  }
};

export const recordBulkPullout = async (
  selections: { itemId: string; invId: string; quantity: number; variant?: Record<string, string> | null; customSpec?: string | null; uomId: string; }[],
  fromLocationId: string,
  toLocationId: string | null,
  userId: string,
  userName: string,
  notes: string
) => {
  try {
    await runTransaction(db, async (dbTransaction) => {
      // 1. READS
      const invCache: Record<string, { ref: any, quantity: number, exists: boolean, data?: any }> = {};
      
      for (const selection of selections) {
        if (selection.quantity <= 0) continue;
        
        // Source Inventory
        const fromInvRef = doc(db, 'inventory', selection.invId);
        if (!invCache[fromInvRef.path]) {
          const snap = await dbTransaction.get(fromInvRef);
          invCache[fromInvRef.path] = {
            ref: fromInvRef,
            quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
            exists: snap.exists(),
            data: snap.data()
          };
        }

        // Destination Inventory
        if (toLocationId) {
          const toInvRef = getInventoryRef(selection.itemId, toLocationId, selection.variant || undefined, selection.customSpec || undefined);
          if (!invCache[toInvRef.path]) {
            const snap = await dbTransaction.get(toInvRef);
            invCache[toInvRef.path] = {
              ref: toInvRef,
              quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
              exists: snap.exists(),
              data: snap.data()
            };
          }
        }
      }

      // 2. WRITES
      for (const selection of selections) {
        if (selection.quantity <= 0) continue;

        const fromInvPath = doc(db, 'inventory', selection.invId).path;
        const fromInvInfo = invCache[fromInvPath];
        
        if (!fromInvInfo || !fromInvInfo.exists) continue;

        if (fromInvInfo.quantity < selection.quantity) {
          throw new Error(`Insufficient stock for ${selection.itemId}`);
        }

        // Update Source Inventory
        fromInvInfo.quantity -= selection.quantity;
        dbTransaction.update(fromInvInfo.ref, {
          quantity: fromInvInfo.quantity,
          updatedAt: serverTimestamp()
        });

        // Update Destination Inventory
        if (toLocationId) {
          const toInvRef = getInventoryRef(selection.itemId, toLocationId, selection.variant || undefined, selection.customSpec || undefined);
          const toInvInfo = invCache[toInvRef.path];
          
          toInvInfo.quantity += selection.quantity;
          dbTransaction.set(toInvInfo.ref, {
            itemId: selection.itemId,
            locationId: toLocationId,
            variant: selection.variant || null,
            customSpec: selection.customSpec || null,
            quantity: toInvInfo.quantity,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        // Record Transaction
        const transactionRef = doc(collection(db, 'transactions'));
        dbTransaction.set(transactionRef, cleanData({
          itemId: selection.itemId,
          type: 'return',
          quantity: selection.quantity,
          fromLocationId,
          toLocationId,
          variant: selection.variant || null,
          customSpec: selection.customSpec || null,
          notes: `PULLOUT: ${notes}`,
          uomId: selection.uomId,
          conversionFactor: 1,
          baseQuantity: selection.quantity,
          timestamp: serverTimestamp(),
          userId,
          userName
        }));
      }
    });
  } catch (error) {
    console.error("Bulk pullout failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'bulk_pullout');
    throw error;
  }
};

// --- User Operations ---

export const subscribeToUsers = (callback: (data: UserProfile[]) => void, currentUserRole?: string) => {
  let q = query(collection(db, 'users'));
  const currentUserId = auth.currentUser?.uid;
  
  if (currentUserRole === 'engineer' && currentUserId) {
    // Engineers can see all active workers OR themselves
    q = query(q, or(
      and(where('role', '==', 'worker'), where('isActive', '==', true)),
      where(documentId(), '==', currentUserId)
    ));
  } else if (currentUserRole && currentUserRole !== 'admin' && currentUserId) {
    // Other roles (if ever enabled) see active users OR themselves
    q = query(q, or(
      where('isActive', '==', true),
      where(documentId(), '==', currentUserId)
    ));
  }

  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'users', false);
    callback([]);
  });
};

export const updateUserProfile = async (uid: string, profile: Partial<UserProfile>) => {
  try {
    await updateDoc(doc(db, 'users', uid), cleanData(profile));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'users');
  }
};

// --- Real-time Listeners ---

export const subscribeToTransactions = (callback: (data: Transaction[]) => void, locationIds?: string[], limitCount: number = 50) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(limitCount));
  if (locationIds && locationIds.length > 0) {
    q = query(q, or(
      where('fromLocationId', 'in', locationIds),
      where('toLocationId', 'in', locationIds)
    ));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'transactions', false);
    callback([]);
  });
};

export const getNoVariantInventoryExists = async (itemId: string): Promise<boolean> => {
  const snap = await getDocs(query(collection(db, 'inventory'), where('itemId', '==', itemId)));
  return snap.docs.some(d => {
    const data = d.data();
    return !data.variant && (data.quantity || 0) > 0;
  });
};

export const subscribeToInventory = (callback: (data: Inventory[]) => void, locationIds?: string[]) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'inventory'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('locationId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Inventory));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'inventory', false);
    callback([]);
  });
};

export const subscribeToItems = (callback: (data: Item[]) => void) => {
  return onSnapshot(query(collection(db, 'items'), where('isActive', '==', true)), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'items', false);
    callback([]);
  });
};

export const subscribeToAllItems = (callback: (data: Item[]) => void) => {
  // This is used for admin/management views to include inactive items
  return onSnapshot(collection(db, 'items'), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'items', false);
    callback([]);
  });
};

export const subscribeToLocations = (callback: (data: Location[]) => void, locationIds?: string[], includeSuppliers: boolean = false) => {
  let q = query(collection(db, 'locations'));
  if (locationIds) {
    const types = ['system'];
    if (includeSuppliers) types.push('supplier');
    
    if (locationIds.length === 0) {
      q = query(q, where('type', 'in', types));
    } else {
      // Use a safe limit for 'in' within 'or'
      const limitedIds = locationIds.slice(0, 25);
      q = query(q, or(
        where(documentId(), 'in', limitedIds), 
        where('type', 'in', types)
      ));
    }
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Location));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'locations', false);
    callback([]);
  });
};

export const subscribeToTags = (callback: (data: Tag[]) => void) => {
  return onSnapshot(query(collection(db, 'tags'), where('isActive', '==', true), orderBy('name', 'asc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tag));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'tags', false);
    callback([]);
  });
};

export const subscribeToAllTags = (callback: (data: Tag[]) => void) => {
  return onSnapshot(query(collection(db, 'tags'), orderBy('name', 'asc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tag));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'tags', false);
    callback([]);
  });
};

export const subscribeToAssets = (callback: (data: Asset[]) => void, locationIds?: string[]) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'assets'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('locationId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Asset));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'assets', false);
    callback([]);
  });
};

export const subscribeToBOQs = (callback: (data: BOQItem[]) => void, locationIds?: string[]) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'boq'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('jobsiteId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'boq', false);
    callback([]);
  });
};

export const subscribeToUnplannedStock = (callback: (data: UnplannedStock[]) => void, locationIds?: string[]) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'unplanned_stock'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('jobsiteId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UnplannedStock));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'unplanned_stock', false);
    callback([]);
  });
};

export const subscribeToCategories = (callback: (data: Category[]) => void) => {
  return onSnapshot(query(collection(db, 'categories'), where('isActive', '==', true), orderBy('name', 'asc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'categories', false);
    callback([]);
  });
};

export const subscribeToAllCategories = (callback: (data: Category[]) => void) => {
  return onSnapshot(query(collection(db, 'categories'), orderBy('name', 'asc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'categories', false);
    callback([]);
  });
};

export const subscribeToUOMs = (callback: (data: UOM[]) => void) => {
  return onSnapshot(query(collection(db, 'uoms'), where('isActive', '==', true)), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UOM));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'uoms', false);
    callback([]);
  });
};

export const subscribeToAllUOMs = (callback: (data: UOM[]) => void) => {
  // This is used for admin/management views to include inactive UOMs
  return onSnapshot(collection(db, 'uoms'), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UOM));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'uoms', false);
    callback([]);
  });
};

export const subscribeToRequests = (callback: (data: Request[]) => void, locationIds?: string[], limitCount?: number) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  // limitCount undefined = no limit (used for admin to load all requests)
  let q = limitCount != null
    ? query(collection(db, 'requests'), orderBy('timestamp', 'desc'), limit(limitCount))
    : query(collection(db, 'requests'), orderBy('timestamp', 'desc'));
  if (locationIds && locationIds.length > 0) {
    q = query(q, where('jobsiteId', 'in', locationIds));
  }
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Request));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'requests', false);
    callback([]);
  });
};

export const manualEditInventory = async (
  inventoryId: string,
  itemId: string,
  variant: Record<string, string> | undefined,
  updates: {
    quantity: number;
    unitPrice?: number;
    customSpec?: string;
    notes: string;
    assignedJobsiteId?: string | null;
    assignedJobsiteName?: string | null;
  },
  userId: string
): Promise<void> => {
  const invRef = doc(db, 'inventory', inventoryId);
  const itemRef = doc(db, 'items', itemId);

  await runTransaction(db, async (txn) => {
    const invSnap = await txn.get(invRef);
    const itemSnap = await txn.get(itemRef);

    if (!invSnap.exists()) throw new Error('Inventory record not found.');
    if (!itemSnap.exists()) throw new Error('Item not found.');

    const currentQty: number = invSnap.data()!.quantity || 0;
    const currentItem = itemSnap.data() as Item;
    const qtyDiff = updates.quantity - currentQty;

    const invUpdate: Record<string, any> = {
      quantity: updates.quantity,
      updatedBy: userId,
      updatedAt: serverTimestamp(),
      lastEditedBy: userId,
      lastEditedAt: serverTimestamp(),
      editNotes: updates.notes,
    };
    if (updates.unitPrice !== undefined) invUpdate.unitPrice = updates.unitPrice;
    if (updates.customSpec !== undefined) invUpdate.customSpec = updates.customSpec || null;
    if (updates.assignedJobsiteId !== undefined) invUpdate.assignedJobsiteId = updates.assignedJobsiteId;
    if (updates.assignedJobsiteName !== undefined) invUpdate.assignedJobsiteName = updates.assignedJobsiteName;
    txn.update(invRef, invUpdate);

    const itemUpdate: Record<string, any> = {
      totalQuantity: (currentItem.totalQuantity || 0) + qtyDiff,
      updatedBy: userId,
      updatedAt: serverTimestamp(),
    };

    if (updates.unitPrice !== undefined) {
      const hasVariant = variant && Object.keys(variant).length > 0;
      const manualTimestamp = Timestamp.now();
      if (hasVariant) {
        const varKey = normalizeVariant(variant!);
        const configs = [...(currentItem.variantConfigs || [])];
        const idx = configs.findIndex(vc => normalizeVariant(vc.variant) === varKey);
        if (idx >= 0) {
          configs[idx] = { ...configs[idx], latestPrice: updates.unitPrice, latestPriceDate: manualTimestamp };
        } else {
          configs.push({ variant: variant!, latestPrice: updates.unitPrice, latestPriceDate: manualTimestamp });
        }
        itemUpdate.variantConfigs = configs;
      } else {
        itemUpdate.latestPrice = updates.unitPrice;
        itemUpdate.latestPriceDate = manualTimestamp;
      }
      const phRef = doc(collection(db, 'price_history'));
      txn.set(phRef, {
        id: phRef.id,
        itemId,
        variantKey: hasVariant ? normalizeVariant(variant!) : null,
        variant: hasVariant ? variant! : null,
        date: manualTimestamp,
        price: updates.unitPrice,
        source: 'manual',
        sourceId: null,
        sourceRef: null,
      });
    }

    txn.update(itemRef, itemUpdate);
  });
};

export const consumeInventory = async (
  itemId: string,
  locationId: string,
  variant: Record<string, string> | undefined,
  customSpec: string | undefined,
  quantity: number,
  uomId: string,
  conversionFactor: number,
  floor: string,
  room: string,
  userName?: string
) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  const baseQuantity = quantity * conversionFactor;

  const transactionData: any = {
    itemId,
    quantity,
    uomId,
    conversionFactor,
    baseQuantity,
    type: 'consumption',
    userId,
    userName: userName || '',
    fromLocationId: locationId,
    floor,
    room,
    timestamp: Timestamp.now(),
  };
  if (variant && Object.keys(variant).length > 0) transactionData.variant = variant;
  if (customSpec) transactionData.customSpec = customSpec;

  try {
    await runTransaction(db, async (dbTransaction) => {
      const invRef = getInventoryRef(itemId, locationId, variant, undefined, undefined, customSpec);
      const invDoc = await dbTransaction.get(invRef);
      if (!invDoc.exists()) throw new Error('No inventory record found for this item at this location');

      const itemRef = doc(db, 'items', itemId);
      const itemDoc = await dbTransaction.get(itemRef);
      if (!itemDoc.exists()) throw new Error('Item not found');
      const itemData = itemDoc.data() as Item;

      // Read BOM component items to find tools
      const toolComponents: Array<{ itemId: string; uomId: string; pullQty: number }> = [];
      if (itemData.components && itemData.components.length > 0) {
        for (const component of itemData.components) {
          const compRef = doc(db, 'items', component.itemId);
          const compDoc = await dbTransaction.get(compRef);
          if (compDoc.exists() && (compDoc.data() as Item).isTool) {
            toolComponents.push({
              itemId: component.itemId,
              uomId: (compDoc.data() as Item).uomId,
              pullQty: component.quantity * baseQuantity,
            });
          }
        }
      }

      const currentQty = invDoc.data()?.quantity || 0;

      dbTransaction.set(invRef, {
        itemId,
        locationId,
        variant: variant && Object.keys(variant).length > 0 ? variant : null,
        customSpec: customSpec || null,
        quantity: currentQty - baseQuantity,
      }, { merge: true });

      const newTotalQty = (itemData.totalQuantity || 0) - baseQuantity;
      dbTransaction.update(itemRef, {
        totalQuantity: isNaN(newTotalQty) ? (itemData.totalQuantity || 0) : newTotalQty,
      });

      const transactionRef = doc(collection(db, 'transactions'));
      dbTransaction.set(transactionRef, transactionData);

      for (const tool of toolComponents) {
        const requestRef = doc(collection(db, 'requests'));
        dbTransaction.set(requestRef, {
          itemId: tool.itemId,
          requestedQty: tool.pullQty,
          uomId: tool.uomId,
          jobsiteId: locationId,
          status: 'for_pull_out',
          requestorId: userId,
          requestorName: userName || '',
          timestamp: Timestamp.now(),
          linkedConsumptionId: transactionRef.id,
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'transactions/inventory');
    throw error;
  }
};

export const addInventoryToJobsite = async (
  itemId: string,
  locationId: string,
  variant: Record<string, string> | undefined,
  quantity: number,
  unitPrice?: number,
  customSpec?: string
) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    await runTransaction(db, async (txn) => {
      const invRef = getInventoryRef(itemId, locationId, variant, undefined, undefined, customSpec);
      const itemRef = doc(db, 'items', itemId);

      const [invDoc, itemDoc] = await Promise.all([txn.get(invRef), txn.get(itemRef)]);
      if (!itemDoc.exists()) throw new Error('Item not found');
      const itemData = itemDoc.data() as Item;

      const existingQty = invDoc.exists() ? (invDoc.data()?.quantity || 0) : 0;
      const newQty = existingQty + quantity;
      if (newQty < 0) throw new Error(`Cannot reduce inventory below 0. Current quantity: ${existingQty}, you entered: ${quantity}`);

      // Compute location-level weighted average cost
      const ajVariantKey = normalizeVariant(variant);
      const ajVariantConfig = itemData.variantConfigs?.find(c => normalizeVariant(c.variant) === ajVariantKey);
      const ajSourceCost = (unitPrice !== undefined && unitPrice > 0)
        ? unitPrice
        : ((variant && Object.keys(variant || {}).length > 0 && ajVariantConfig?.latestPrice !== undefined)
          ? ajVariantConfig.latestPrice
          : (itemData.latestPrice || 0));
      const existingCost = invDoc.exists() ? (invDoc.data()?.averageCost ?? 0) : 0;
      const ajNewAvgCost = existingQty > 0 && newQty > 0
        ? (existingQty * existingCost + quantity * ajSourceCost) / newQty
        : ajSourceCost;

      if (invDoc.exists()) {
        txn.update(invRef, { quantity: newQty, averageCost: ajNewAvgCost });
      } else {
        txn.set(invRef, {
          itemId,
          locationId,
          variant: variant && Object.keys(variant).length > 0 ? variant : null,
          ...(customSpec ? { customSpec } : {}),
          quantity: newQty,
          averageCost: ajNewAvgCost,
        });
      }

      const newTotalQty = (itemData.totalQuantity || 0) + quantity;
      const itemUpdate: any = {
        totalQuantity: isNaN(newTotalQty) ? (itemData.totalQuantity || 0) : newTotalQty,
      };

      if (unitPrice !== undefined && unitPrice > 0) {
        const ajTimestamp = Timestamp.now();
        const ajHasVariant = !!(variant && Object.keys(variant || {}).length > 0);
        if (ajHasVariant) {
          const configs = [...(itemData.variantConfigs || [])];
          const idx = configs.findIndex(c => normalizeVariant(c.variant) === ajVariantKey);
          if (idx >= 0) {
            configs[idx] = { ...configs[idx], latestPrice: unitPrice, latestPriceDate: ajTimestamp };
          } else {
            configs.push({ variant: variant!, latestPrice: unitPrice, latestPriceDate: ajTimestamp });
          }
          itemUpdate.variantConfigs = configs;
        } else {
          itemUpdate.latestPrice = unitPrice;
          itemUpdate.latestPriceDate = ajTimestamp;
        }
        const phRef = doc(collection(db, 'price_history'));
        txn.set(phRef, {
          id: phRef.id,
          itemId,
          variantKey: ajHasVariant ? ajVariantKey : null,
          variant: ajHasVariant ? variant! : null,
          date: ajTimestamp,
          price: unitPrice,
          source: 'manual',
          sourceId: null,
          sourceRef: null,
        });
      }

      txn.update(itemRef, itemUpdate);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'inventory');
    throw error;
  }
};

export const clearLocationInventory = async (
  locationId: string,
  locationName: string,
  mainWarehouseId: string,
  userId: string,
  userName: string
): Promise<{ itemsCleared: number; boqCleared: number }> => {
  const BATCH = 400;

  // --- Phase 0: Fetch all affected data upfront ---
  const [invSnap, boqSnap, requestsSnap, txFromSnap, txToSnap, posSnap, invoicesSnap] = await Promise.all([
    getDocs(query(collection(db, 'inventory'), where('locationId', '==', locationId))),
    getDocs(query(collection(db, 'boq'), where('jobsiteId', '==', locationId))),
    getDocs(query(collection(db, 'requests'), where('jobsiteId', '==', locationId))),
    getDocs(query(collection(db, 'transactions'), where('fromLocationId', '==', locationId))),
    getDocs(query(collection(db, 'transactions'), where('toLocationId', '==', locationId))),
    getDocs(query(collection(db, 'purchase_orders'), where('toLocationId', '==', locationId))),
    getDocs(query(collection(db, 'suppliers_invoices'), where('toLocationId', '==', locationId))),
  ]);

  // Deduplicate transaction refs (a tx could appear in both from/to snaps)
  const txRefsToDelete = new Map<string, ReturnType<typeof doc>>();
  for (const d of [...txFromSnap.docs, ...txToSnap.docs]) txRefsToDelete.set(d.id, d.ref);

  // 'for delivery' requests have items already picked and in transit — leave them completely
  // untouched. Clearing the site must not break the pick→receive chain: their pick transactions
  // are still needed, and removing their batchId would cause recordBulkReceive to generate a
  // new batchId with no matching pick transaction, breaking the FROM display.
  const inTransitRequests = new Set(
    requestsSnap.docs.filter(d => d.data().status === 'for delivery').map(d => d.id)
  );

  // Delivered requests are terminal — delete them entirely
  const deliveredRequests = requestsSnap.docs.filter(d => d.data().status === 'delivered');

  // Pre-delivery requests (pending/approved) with a batchId — remove the DR assignment
  // so they can be reassigned. Do NOT include 'for delivery' here.
  const requestsWithBatch = requestsSnap.docs.filter(d => {
    const { status, batchId } = d.data();
    return !inTransitRequests.has(d.id) && status !== 'delivered' && !!batchId;
  });

  // Collect batchIds only from delivered + pre-delivery requests (not in-transit ones).
  // Pick transactions for in-transit items must be preserved so receive can resolve FROM.
  const batchIds = [...new Set(
    [...deliveredRequests, ...requestsWithBatch]
      .map(d => d.data().batchId as string | undefined)
      .filter(Boolean) as string[]
  )];
  // Query transactions by batchId in chunks of 30 (Firestore 'in' limit)
  for (let i = 0; i < batchIds.length; i += 30) {
    const snap = await getDocs(query(
      collection(db, 'transactions'),
      where('batchId', 'in', batchIds.slice(i, i + 30))
    ));
    for (const d of snap.docs) txRefsToDelete.set(d.id, d.ref);
  }

  // Only redirect POs that have already been (partially) delivered
  const deliveredPOs = posSnap.docs.filter(d =>
    ['partially_received', 'received'].includes(d.data().status)
  );

  let itemsCleared = 0;

  // --- Phase 1: Atomic inventory move (runTransaction for read-modify-write safety) ---
  await runTransaction(db, async (tx) => {
    // Re-read inventory docs inside transaction for fresh data
    const invDocs = await Promise.all(invSnap.docs.map(d => tx.get(d.ref)));

    type Entry = {
      jobsiteRef: ReturnType<typeof doc>;
      data: Inventory;
      qty: number;
      unitPrice: number;
      whRef: ReturnType<typeof doc>;
    };
    const entries: Entry[] = [];
    for (let i = 0; i < invSnap.docs.length; i++) {
      const invDoc = invDocs[i];
      if (!invDoc.exists()) continue;
      const data = invDoc.data() as Inventory;
      const qty = data.quantity ?? 0;
      if (qty <= 0) continue; // leave zero/negative at location unchanged
      entries.push({
        jobsiteRef: invSnap.docs[i].ref,
        data,
        qty,
        unitPrice: data.unitPrice ?? 0,
        whRef: getInventoryRef(data.itemId, mainWarehouseId, data.variant, data.serialNumber, data.propertyNumber, data.customSpec),
      });
    }

    // Re-read warehouse counterparts
    const whDocs = await Promise.all(entries.map(e => tx.get(e.whRef)));

    itemsCleared = 0;
    const now = serverTimestamp();

    for (let i = 0; i < entries.length; i++) {
      const { jobsiteRef, data, qty, unitPrice, whRef } = entries[i];
      const whDoc = whDocs[i];
      itemsCleared++;

      if (whDoc.exists()) {
        const whData = whDoc.data();
        const whQty: number = whData.quantity ?? 0;
        const whPrice: number = whData.unitPrice ?? 0;
        const update: Record<string, any> = { quantity: whQty + qty, updatedAt: now, updatedBy: userId };
        if (unitPrice > 0) {
          // Weighted average: blend existing warehouse cost with incoming cost
          update.unitPrice = (whQty * whPrice + qty * unitPrice) / (whQty + qty);
        }
        tx.update(whRef, update);
      } else {
        const newInv: Record<string, any> = {
          itemId: data.itemId,
          locationId: mainWarehouseId,
          quantity: qty,
          updatedAt: now,
          updatedBy: userId,
        };
        if (unitPrice > 0) newInv.unitPrice = unitPrice;
        if (data.variant && Object.keys(data.variant).length > 0) newInv.variant = data.variant;
        if (data.customSpec) newInv.customSpec = data.customSpec;
        if (data.serialNumber) newInv.serialNumber = data.serialNumber;
        if (data.propertyNumber) newInv.propertyNumber = data.propertyNumber;
        tx.set(whRef, newInv);
      }
      tx.delete(jobsiteRef);
    }

    for (const d of boqSnap.docs) tx.delete(d.ref);
  });

  // --- Phase 2: Cleanup in batched writes ---

  // 2a: Delete all transactions that involved this location
  const txRefs = [...txRefsToDelete.values()];
  for (let i = 0; i < txRefs.length; i += BATCH) {
    const batch = writeBatch(db);
    txRefs.slice(i, i + BATCH).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  // 2b: Delete delivered requests (terminal — no longer needed after location is cleared)
  for (let i = 0; i < deliveredRequests.length; i += BATCH) {
    const batch = writeBatch(db);
    deliveredRequests.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2c: Remove batchId from in-flight requests that had a DR assignment at this location
  for (let i = 0; i < requestsWithBatch.length; i += BATCH) {
    const batch = writeBatch(db);
    requestsWithBatch.slice(i, i + BATCH).forEach(d => batch.update(d.ref, { batchId: deleteField() }));
    await batch.commit();
  }

  // 2d: Redirect delivered POs from this location to Main Warehouse
  for (let i = 0; i < deliveredPOs.length; i += BATCH) {
    const batch = writeBatch(db);
    deliveredPOs.slice(i, i + BATCH).forEach(d => batch.update(d.ref, { toLocationId: mainWarehouseId }));
    await batch.commit();
  }

  // 2e: Redirect all supplier invoices from this location to Main Warehouse
  for (let i = 0; i < invoicesSnap.docs.length; i += BATCH) {
    const batch = writeBatch(db);
    invoicesSnap.docs.slice(i, i + BATCH).forEach(d => batch.update(d.ref, { toLocationId: mainWarehouseId }));
    await batch.commit();
  }

  // --- Phase 3: Audit log ---
  await addDoc(collection(db, 'audit_logs'), {
    action: 'clear_location_inventory',
    locationId,
    locationName,
    mainWarehouseId,
    itemsCleared,
    boqCleared: boqSnap.docs.length,
    transactionsDeleted: txRefs.length,
    deliveredRequestsDeleted: deliveredRequests.length,
    requestsUpdated: requestsWithBatch.length,
    posUpdated: deliveredPOs.length,
    invoicesUpdated: invoicesSnap.docs.length,
    performedBy: userId,
    performedByName: userName,
    timestamp: serverTimestamp(),
  });

  return { itemsCleared, boqCleared: boqSnap.docs.length };
};

export const subscribeToPurchaseOrders = (callback: (data: PurchaseOrder[]) => void) => {
  return onSnapshot(query(collection(db, 'purchase_orders'), orderBy('poNumber', 'desc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'purchase_orders', false);
    callback([]);
  });
};

// Migrate priceHistory arrays from item/variantConfig docs to price_history collection
export const migratePriceHistoryToCollection = async (
  phase: 'copy' | 'cleanup'
): Promise<{ written: number; updated: number }> => {
  const BATCH_SIZE = 400;
  const itemsSnap = await getDocs(collection(db, 'items'));
  let written = 0;
  let updated = 0;

  if (phase === 'copy') {
    let batch = writeBatch(db);
    let batchCount = 0;

    const flush = async () => {
      if (batchCount === 0) return;
      await batch.commit();
      written += batchCount;
      batch = writeBatch(db);
      batchCount = 0;
    };

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      const itemId = itemDoc.id;

      if (item.priceHistory && Array.isArray(item.priceHistory)) {
        for (const entry of item.priceHistory) {
          const phRef = doc(collection(db, 'price_history'));
          batch.set(phRef, {
            id: phRef.id, itemId, variantKey: null, variant: null,
            date: entry.date, price: entry.price, source: entry.source || 'manual',
            sourceId: null, sourceRef: null,
          });
          batchCount++;
          if (batchCount >= BATCH_SIZE) await flush();
        }
      }

      if (item.variantConfigs && Array.isArray(item.variantConfigs)) {
        for (const vc of item.variantConfigs) {
          if (!vc.priceHistory || !Array.isArray(vc.priceHistory) || vc.priceHistory.length === 0) continue;
          const vk = vc.variant && Object.keys(vc.variant).length > 0 ? normalizeVariant(vc.variant) : null;
          for (const entry of vc.priceHistory) {
            const phRef = doc(collection(db, 'price_history'));
            batch.set(phRef, {
              id: phRef.id, itemId, variantKey: vk, variant: vc.variant || null,
              date: entry.date, price: entry.price, source: entry.source || 'manual',
              sourceId: null, sourceRef: null,
            });
            batchCount++;
            if (batchCount >= BATCH_SIZE) await flush();
          }
        }
      }
    }

    await flush();
    return { written, updated: 0 };
  } else {
    let batch = writeBatch(db);
    let batchCount = 0;

    const flush = async () => {
      if (batchCount === 0) return;
      await batch.commit();
      updated += batchCount;
      batch = writeBatch(db);
      batchCount = 0;
    };

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      const hasBaseHistory = item.priceHistory && Array.isArray(item.priceHistory);
      const hasVariantHistory = Array.isArray(item.variantConfigs) &&
        item.variantConfigs.some((vc: any) => Array.isArray(vc.priceHistory) && vc.priceHistory.length > 0);

      if (!hasBaseHistory && !hasVariantHistory) continue;

      const update: Record<string, any> = {};
      if (hasBaseHistory) update.priceHistory = deleteField();
      if (hasVariantHistory) {
        update.variantConfigs = item.variantConfigs.map((vc: any) => {
          const { priceHistory: _ph, ...rest } = vc;
          return rest;
        });
      }

      batch.update(itemDoc.ref, update);
      batchCount++;
      if (batchCount >= BATCH_SIZE) await flush();
    }

    await flush();
    return { written: 0, updated };
  }
};

// Migrate averageCost → latestPrice for existing items (one-time admin utility)
export const migrateAverageCostToLatestPrice = async (): Promise<{ migrated: number; skipped: number }> => {
  const itemsSnap = await getDocs(collection(db, 'items'));
  let migrated = 0;
  let skipped = 0;
  const batch = writeBatch(db);

  for (const itemDoc of itemsSnap.docs) {
    const data = itemDoc.data();
    const updates: Record<string, any> = {};

    // Migrate item-level averageCost → latestPrice
    if (data.averageCost !== undefined && data.latestPrice === undefined) {
      updates.latestPrice = data.averageCost;
    }

    // Migrate variantConfigs[].averageCost → latestPrice
    if (data.variantConfigs && Array.isArray(data.variantConfigs)) {
      let variantMigrated = false;
      const updatedConfigs = data.variantConfigs.map((vc: any) => {
        if (vc.averageCost !== undefined && vc.latestPrice === undefined) {
          variantMigrated = true;
          const { averageCost, ...rest } = vc;
          return { ...rest, latestPrice: averageCost };
        }
        return vc;
      });
      if (variantMigrated) {
        updates.variantConfigs = updatedConfigs;
      }
    }

    if (Object.keys(updates).length > 0) {
      batch.update(itemDoc.ref, updates);
      migrated++;
    } else {
      skipped++;
    }
  }

  await batch.commit();
  return { migrated, skipped };
};
