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
  documentId
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Item, Category, Location, Inventory, Transaction, UOM, Tag, UserProfile, Asset, Request, BOQItem, UnplannedStock, SystemConfig, PurchaseOrder, POPayment } from '../types';

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

  const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string, propertyNumber?: string, customSpec?: string) => {
    let id = `${itemId}_${locationId}`;
    if (variant && Object.keys(variant).length > 0) {
      const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => {
        acc[key] = variant[key];
        return acc;
      }, {} as any);
      const variantStr = JSON.stringify(sortedVariant);
      const variantHash = encodeURIComponent(variantStr).replace(/%/g, '_').replace(/\./g, '-');
      id += `_${variantHash}`;
    }
    if (customSpec) {
      id += `_SPEC-${encodeURIComponent(customSpec).replace(/%/g, '_')}`;
    }
    if (serialNumber) {
      id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
    }
    if (propertyNumber) {
      id += `_PN-${encodeURIComponent(propertyNumber).replace(/%/g, '_')}`;
    }
    if (id.length > 1000) {
      id = id.substring(0, 1000);
    }
    return doc(db, 'inventory', id);
  };

  try {
    // PRE-FETCH BOQ IDs (Queries not allowed in transactions)
    let boqToId: string | null = null;
    let boqFromId: string | null = null;

    const findBoq = async (locId: string) => {
      const q = query(collection(db, 'boq'), where('jobsiteId', '==', locId), where('itemId', '==', itemId));
      const snap = await getDocs(q);
      const match = snap.docs.find(d => JSON.stringify(d.data().variant || {}) === JSON.stringify(variant || {}));
      return match?.id || null;
    };

    if (toLocationId) {
      const locSnap = await getDoc(doc(db, 'locations', toLocationId));
      if (locSnap.exists() && locSnap.data().type === 'jobsite') {
        boqToId = await findBoq(toLocationId);
      }
    }
    if (fromLocationId) {
      const locSnap = await getDoc(doc(db, 'locations', fromLocationId));
      if (locSnap.exists() && locSnap.data().type === 'jobsite') {
        boqFromId = await findBoq(fromLocationId);
      }
    }

    const boqToRef = boqToId ? doc(db, 'boq', boqToId) : null;
    const boqFromRef = boqFromId ? doc(db, 'boq', boqFromId) : null;

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
      
      const fromIsWarehouse = fromLocDoc?.exists() && fromLocDoc.data()?.type === 'warehouse';
      const toIsWarehouse = toLocDoc?.exists() && toLocDoc.data()?.type === 'warehouse';

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

      let newAvgCost = itemData.averageCost || 0;
      if (totalPrice !== undefined && !isNaN(totalPrice) && baseQuantity > 0 && toIsInternal && !fromIsInternal) {
        const currentTotalQty = itemData.totalQuantity || 0;
        const currentAvgCost = itemData.averageCost || 0;
        const newUnitPricePerBase = totalPrice / baseQuantity;
        
        // Weighted average: (Current Total Cost + New Cost) / (Current Total Qty + New Qty)
        const totalQty = currentTotalQty + baseQuantity;
        if (totalQty > 0) {
          newAvgCost = ((currentTotalQty * currentAvgCost) + (baseQuantity * newUnitPricePerBase)) / totalQty;
        }
      }

      // Ensure newAvgCost is a valid number
      if (isNaN(newAvgCost)) newAvgCost = itemData.averageCost || 0;

      // Update Item document with new average cost and total quantity (All internal stock)
      const changeInTotalQty = (toIsInternal ? baseQuantity : 0) - (fromIsInternal ? baseQuantity : 0);
      const newTotalQty = (itemData.totalQuantity || 0) + changeInTotalQty;

      dbTransaction.update(itemRef, {
        averageCost: newAvgCost,
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
        const sortVariant = (v: any) => {
          if (!v) return "{}";
          const sorted = Object.keys(v).sort().reduce((acc, key) => {
            acc[key] = v[key];
            return acc;
          }, {} as any);
          return JSON.stringify(sorted);
        };
        const targetVariantStr = sortVariant(variant);

        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === itemId && sortVariant(item.variant) === targetVariantStr;
          
          if (isMatch) {
            // Calculate quantity in PO item's UOM
            let quantityInPoUom = baseQuantity; // Default to base quantity
            
            // If PO item is NOT in base UOM, convert back
            if (item.uomId !== itemData.uomId) {
              const conversion = itemData.uomConversions?.find(c => c.uomId === item.uomId);
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
        dbTransaction.set(toInvRef, {
          itemId: itemId,
          locationId: toLocationId,
          variant: variant && Object.keys(variant).length > 0 ? variant : null,
          customSpec: customSpec || null,
          serialNumber: serialNumber || null,
          propertyNumber: propertyNumber || null,
          quantity: currentQty + baseQuantity
        }, { merge: true });
      }

      // 4. BOQ QUANTITY UPDATE
      if (boqToRef && boqToDoc?.exists()) {
        const current = boqToDoc.data()?.currentQuantity || 0;
        dbTransaction.update(boqToRef, { currentQuantity: current + baseQuantity });
      }
      if (boqFromRef && boqFromDoc?.exists()) {
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
  const { itemId, variant, serialNumber, propertyNumber, fromLocationId, toLocationId, baseQuantity } = transaction;

  const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string, propertyNumber?: string) => {
    let id = `${itemId}_${locationId}`;
    if (variant && Object.keys(variant).length > 0) {
      const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => {
        acc[key] = variant[key];
        return acc;
      }, {} as any);
      const variantStr = JSON.stringify(sortedVariant);
      const variantHash = encodeURIComponent(variantStr).replace(/%/g, '_').replace(/\./g, '-');
      id += `_${variantHash}`;
    }
    if (serialNumber) {
      id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
    }
    if (propertyNumber) {
      id += `_PN-${encodeURIComponent(propertyNumber).replace(/%/g, '_')}`;
    }
    if (id.length > 1000) id = id.substring(0, 1000);
    return doc(db, 'inventory', id);
  };

  try {
    await runTransaction(db, async (dbTransaction) => {
      // 1. GATHER DATA (READS)
      let fromInvDoc = null;
      let toInvDoc = null;
      let fromInvRef = null;
      let toInvRef = null;
      let poDoc = null;
      let poRef = null;

      if (fromLocationId) {
        fromInvRef = getInventoryRef(itemId, fromLocationId, variant, serialNumber, propertyNumber);
        fromInvDoc = await dbTransaction.get(fromInvRef);
      }

      if (toLocationId) {
        toInvRef = getInventoryRef(itemId, toLocationId, variant, serialNumber, propertyNumber);
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
        const itemRef = doc(db, 'items', itemId);
        const itemDoc = await dbTransaction.get(itemRef);
        const itemData = itemDoc.data() as Item;

        const sortVariant = (v: any) => {
          if (!v) return "{}";
          const sorted = Object.keys(v).sort().reduce((acc, key) => {
            acc[key] = v[key];
            return acc;
          }, {} as any);
          return JSON.stringify(sorted);
        };
        const targetVariantStr = sortVariant(variant);

        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === itemId && sortVariant(item.variant) === targetVariantStr;
          
          if (isMatch) {
            // Calculate quantity in PO item's UOM
            let quantityInPoUom = baseQuantity;
            if (item.uomId !== itemData.uomId) {
              const conversion = itemData.uomConversions?.find(c => c.uomId === item.uomId);
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
      
      const fromIsWarehouse = fromLocDoc?.exists() && fromLocDoc.data()?.type === 'warehouse';
      const toIsWarehouse = toLocDoc?.exists() && toLocDoc.data()?.type === 'warehouse';

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

  const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string, propertyNumber?: string, customSpec?: string) => {
    let id = `${itemId}_${locationId}`;
    if (variant && Object.keys(variant).length > 0) {
      const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => {
        acc[key] = variant[key];
        return acc;
      }, {} as any);
      const variantStr = JSON.stringify(sortedVariant);
      const variantHash = encodeURIComponent(variantStr).replace(/%/g, '_').replace(/\./g, '-');
      id += `_${variantHash}`;
    }
    if (customSpec) {
      id += `_SPEC-${encodeURIComponent(customSpec).replace(/%/g, '_')}`;
    }
    if (serialNumber) {
      id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
    }
    if (propertyNumber) {
      id += `_PN-${encodeURIComponent(propertyNumber).replace(/%/g, '_')}`;
    }
    if (id.length > 1000) id = id.substring(0, 1000);
    return doc(db, 'inventory', id);
  };

  try {
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

      const sortVariant = (v: any) => {
        if (!v) return "{}";
        const sorted = Object.keys(v).sort().reduce((acc, key) => {
          acc[key] = v[key];
          return acc;
        }, {} as any);
        return JSON.stringify(sorted);
      };

      // Revert PO if needed
      if (oldPoDoc?.exists() && oldPoRef) {
        const poData = oldPoDoc.data() as PurchaseOrder;
        const targetVariantStr = sortVariant(oldTransaction.variant);
        const updatedItems = poData.items.map(item => {
          const isMatch = item.itemId === oldTransaction.itemId && sortVariant(item.variant) === targetVariantStr;
          if (isMatch) {
            let qtyInPoUom = oldTransaction.baseQuantity;
            if (item.uomId !== itemData.uomId) {
              const conversion = itemData.uomConversions?.find(c => c.uomId === item.uomId);
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
            if (item.uomId !== newItemData.uomId) {
              const conversion = newItemData.uomConversions?.find(c => c.uomId === item.uomId);
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
    const docRef = await addDoc(collection(db, 'items'), cleanData({
      averageCost: 0,
      totalQuantity: 0,
      ...item,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    return docRef.id;
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
        averageCost: item.averageCost ?? 0,
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
    
    console.log('Adding category:', data);
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
    // 1. Delete the location document
    await deleteDoc(doc(db, 'locations', id));

    // 2. Remove this location from all user profiles
    const usersSnap = await getDocs(collection(db, 'users'));
    const updates = usersSnap.docs
      .filter(doc => {
        const data = doc.data() as UserProfile;
        return data.assignedLocationIds?.includes(id);
      })
      .map(doc => {
        const data = doc.data() as UserProfile;
        const newIds = data.assignedLocationIds?.filter(locId => locId !== id) || [];
        return updateDoc(doc.ref, { assignedLocationIds: newIds });
      });
    
    await Promise.all(updates);
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
    await deleteDoc(doc(db, 'purchase_orders', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `purchase_orders/${id}`);
  }
};

// --- PO Payment Operations ---

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

    // Update PO payment status if needed
    // This is a simple update, more complex logic could be added to derive status from all payments
    await updateDoc(doc(db, 'purchase_orders', poId), {
      paymentStatus: payment.status === 'collected' ? 'paid' : (payment.status === 'prepared' ? 'prepared' : 'processing'),
      updatedAt: serverTimestamp(),
      updatedBy: userId
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
    await updateDoc(doc(db, 'purchase_orders', poId, 'payments', paymentId), cleanData(data));
    
    if (data.status) {
      await updateDoc(doc(db, 'purchase_orders', poId), {
        paymentStatus: data.status === 'collected' ? 'paid' : (data.status === 'prepared' ? 'prepared' : 'processing'),
        updatedAt: serverTimestamp(),
        updatedBy: userId
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `purchase_orders/${poId}/payments/${paymentId}`);
  }
};

export const deletePOPayment = async (poId: string, paymentId: string) => {
  try {
    await deleteDoc(doc(db, 'purchase_orders', poId, 'payments', paymentId));
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
      return JSON.stringify(data.variant) === JSON.stringify(boqItem.variant);
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
  }
};

export const deleteBOQItem = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'boq', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'boq');
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

// --- Helper Functions ---

const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string, customSpec?: string) => {
  let id = `${itemId}_${locationId}`;
  if (variant && Object.keys(variant).length > 0) {
    const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => { acc[key] = variant[key]; return acc; }, {} as any);
    const variantHash = encodeURIComponent(JSON.stringify(sortedVariant)).replace(/%/g, '_').replace(/\./g, '-');
    id += `_${variantHash}`;
  }
  if (customSpec) {
    id += `_SPEC-${encodeURIComponent(customSpec).replace(/%/g, '_')}`;
  }
  if (serialNumber) {
    id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
  }
  return doc(db, 'inventory', id.substring(0, 1000));
};

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

export const approveBulkRequests = async (requestIds: string[], approverId: string, approverName?: string) => {
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
  }[],
  userId: string,
  userName: string,
  options: {
    toLocationId: string;
    date: Date;
    supplierInvoice?: string;
    supplierDR?: string;
    notes?: string;
  }
) => {
  try {
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

      const invDataMap: Record<string, { quantity: number; ref: any }> = {};
      for (const receive of receivedItems) {
        if (receive.quantity <= 0) continue;
        const invRef = getInventoryRef(receive.itemId, options.toLocationId, receive.variant, receive.serialNumber, receive.customSpec);
        const invPath = invRef.path;
        if (!invDataMap[invPath]) {
          const snap = await dbTransaction.get(invRef);
          invDataMap[invPath] = {
            quantity: (snap.exists() ? snap.data()?.quantity : 0) || 0,
            ref: invRef
          };
        }
      }

      // 2. CALCULATIONS & WRITES
      const timestamp = Timestamp.fromDate(options.date);
      const updatedPoItems = [...poData.items];
      
      // Track item state changes for multiple lines of the same item
      const rollingItemState: Record<string, { totalQuantity: number; averageCost: number }> = {};
      for (const id in itemDataMap) {
        rollingItemState[id] = {
          totalQuantity: itemDataMap[id].totalQuantity || 0,
          averageCost: itemDataMap[id].averageCost || 0
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

        const conversionFactor = itemData.uomId === receive.uomId ? 1 : (itemData.uomConversions?.find(c => c.uomId === receive.uomId)?.factor || 1);
        const baseQuantity = receive.quantity * conversionFactor;

        // Inventory update
        const invRef = getInventoryRef(receive.itemId, options.toLocationId, receive.variant, receive.serialNumber, receive.customSpec);
        const invInfo = invDataMap[invRef.path];
        invInfo.quantity += baseQuantity;

        dbTransaction.set(invRef, {
          itemId: receive.itemId,
          locationId: options.toLocationId,
          variant: receive.variant ? cleanData(receive.variant) : null,
          customSpec: receive.customSpec || null,
          serialNumber: receive.serialNumber || null,
          propertyNumber: receive.propertyNumber || null,
          quantity: invInfo.quantity,
          updatedAt: serverTimestamp()
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

        // Rolling Average Cost and Total Quantity
        if (toIsInternal) {
          const state = rollingItemState[receive.itemId];
          const newUnitPricePerBase = receive.unitPrice / conversionFactor;
          const totalQtyBefore = state.totalQuantity;
          const avgCostBefore = state.averageCost;
          
          state.totalQuantity += baseQuantity;
          if (state.totalQuantity > 0) {
            state.averageCost = ((totalQtyBefore * avgCostBefore) + (baseQuantity * newUnitPricePerBase)) / state.totalQuantity;
          }

          dbTransaction.update(doc(db, 'items', receive.itemId), {
            totalQuantity: state.totalQuantity,
            averageCost: state.averageCost,
            updatedAt: serverTimestamp(),
            updatedBy: userId
          });
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

export const recordBulkPick = async (
  selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[], 
  warehousemanId: string, 
  warehousemanName?: string,
  options?: { customBatchId?: string; customDate?: Date }
) => {
  try {
    await runTransaction(db, async (dbTransaction) => {
      let batchId = options?.customBatchId;
      let counterUpdate: any = null;
      let counterRef: any = null;
      
      // If no custom DR is provided, generate one
      if (!batchId) {
        const now = new Date();
        const yearYY = now.getFullYear().toString().slice(-2);
        counterRef = doc(db, 'counters', 'dr_number');
        const counterDoc = await dbTransaction.get(counterRef);
        
        let nextSeries = 1;
        if (counterDoc.exists()) {
          const data = counterDoc.data() as { year: string; lastSeries: number };
          if (data.year === yearYY) {
            nextSeries = (data.lastSeries || 0) + 1;
          }
        }
        
        const seriesStr = nextSeries.toString().padStart(4, '0');
        batchId = `DR#${yearYY}-${seriesStr}`;

        // Prepare counter update but DO NOT set it yet (must read all first)
        counterUpdate = {
          year: yearYY,
          lastSeries: nextSeries,
          updatedAt: serverTimestamp()
        };
      }

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

        const conversionFactor = itemData.uomId === uomId ? 1 : (itemData.uomConversions?.find(c => c.uomId === uomId)?.factor || 1);
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

      // 2. WRITES
      for (const data of requestData) {
        const { requestId, requestRef, request, selection, effectiveVariant, conversionFactor, baseQuantity, itemData } = data;
        const { deliveredQty, sourceLocationId, backorder, serialNumbers } = selection;
        const { itemId, uomId, approvedQty, customSpec } = request;

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
  }
};

export const updateDeliveryQuantity = async (requestId: string, newQuantity: number, warehousemanId: string, warehousemanName: string, createBackorder: boolean) => {
  try {
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

      const conversionFactor = itemData.uomId === request.uomId ? 1 : (itemData.uomConversions?.find(c => c.uomId === request.uomId)?.factor || 1);
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

export const recordBulkReceive = async (requestIds: string[], receiverId: string, receiverName?: string) => {
  try {
    const requestDocs = await Promise.all(requestIds.map(id => getDoc(doc(db, 'requests', id))));
    const validRequests = requestDocs.filter(d => d.exists() && d.data()?.status === 'for delivery');
    
    // Pre-fetch BOQ IDs for the items in these requests
    const boqMap = new Map<string, string>(); // key: itemId_jobsiteId_variantHash, value: boqId
    await Promise.all(validRequests.map(async (docSnap) => {
      const data = docSnap.data() as Request;
      const { itemId, jobsiteId, variant } = data;
      const q = query(collection(db, 'boq'), where('jobsiteId', '==', jobsiteId), where('itemId', '==', itemId));
      const snap = await getDocs(q);
      const variantStr = JSON.stringify(variant || {});
      const match = snap.docs.find(d => JSON.stringify(d.data().variant || {}) === variantStr);
      if (match) {
        const key = `${itemId}_${jobsiteId}_${variantStr}`;
        boqMap.set(key, match.id);
      }
    }));

    await runTransaction(db, async (dbTransaction) => {
      console.log("[BulkReceive] Starting transaction for:", validRequests.length, "valid requests");
      const requestData: any[] = [];
      const itemCache: Record<string, Item> = {};
      const invCache: Record<string, { ref: any, quantity: number, serialNumber?: string, metadata: any }> = {};

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

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn, customSpec);
            const invKey = invRef.path;
            if (!invCache[invKey]) {
              const invDoc = await dbTransaction.get(invRef);
              invCache[invKey] = {
                ref: invRef,
                quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
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
              metadata: { itemId, jobsiteId, variant, customSpec }
            };
          }
        }

        const conversionFactor = itemData.uomId === uomId ? 1 : (itemData.uomConversions?.find(c => c.uomId === uomId)?.factor || 1);
        const baseQuantity = (deliveredQty || 0) * conversionFactor;

        requestData.push({
          requestId,
          requestRef,
          request,
          conversionFactor,
          baseQuantity
        });
      }

      console.log("[BulkReceive] Reads complete. Processing writes for:", requestData.length, "items");

      // 2. WRITES
      for (const data of requestData) {
        const { requestId, requestRef, request, conversionFactor, baseQuantity } = data;
        const { itemId, uomId, jobsiteId, deliveredQty, variant, serialNumbers } = request;

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn, request.customSpec);
            const invKey = invRef.path;
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
            requestIds: [requestId]
          }));
        }

        // Update Request Status to 'delivered'
        dbTransaction.update(requestRef, cleanData({
          status: 'delivered',
          deliveredAt: serverTimestamp(),
          receiverId,
          receiverName: receiverName || ''
        }));

        // Update Jobsite BOQ currentQuantity
        const variantStr = JSON.stringify(variant || {});
        const key = `${itemId}_${jobsiteId}_${variantStr}`;
        const boqId = boqMap.get(key);
        if (boqId) {
          const boqRef = doc(db, 'boq', boqId);
          // We need current quantity from the BOQ doc
          // Since we already did a query outside, we might as well have fetched the quantities too,
          // but fetching inside transaction is safer if we have the Ref.
          const boqDoc = await dbTransaction.get(boqRef);
          if (boqDoc.exists()) {
            const current = (boqDoc.data().currentQuantity || 0) as number;
            dbTransaction.update(boqRef, { currentQuantity: current + baseQuantity });
          }
        }
      }

      // Final inventory writes
      for (const invKey in invCache) {
        const { ref, quantity, serialNumber, metadata } = invCache[invKey];
        dbTransaction.set(ref, cleanData({
          itemId: metadata.itemId,
          locationId: metadata.jobsiteId,
          variant: metadata.variant || null,
          customSpec: metadata.customSpec || null,
          serialNumber: serialNumber || null,
          quantity: quantity
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
      console.log("[BulkReceive] Transaction complete");
    });
  } catch (error) {
    console.error("Bulk receive failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'bulk_receive');
  }
};

export const clearInventoryData = async (includeBOQ: boolean = true, includePOs: boolean = false) => {
  try {
    const collectionsToClear = ['inventory', 'requests', 'transactions', 'unplanned_stock'];
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
    
    // Also reset totalQuantity and averageCost for all items to keep data consistent
    try {
      const itemsSnap = await getDocs(collection(db, 'items'));
      const itemUpdates = itemsSnap.docs.map(d => updateDoc(d.ref, {
        totalQuantity: 0,
        averageCost: 0
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
  const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, customSpec?: string) => {
    let id = `${itemId}_${locationId}`;
    if (variant && Object.keys(variant).length > 0) {
      const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => {
        acc[key] = variant[key];
        return acc;
      }, {} as any);
      const variantStr = JSON.stringify(sortedVariant);
      const variantHash = encodeURIComponent(variantStr).replace(/%/g, '_').replace(/\./g, '-');
      id += `_${variantHash}`;
    }
    if (customSpec) {
      id += `_SPEC-${encodeURIComponent(customSpec).replace(/%/g, '_')}`;
    }
    if (id.length > 1000) id = id.substring(0, 1000);
    return doc(db, 'inventory', id);
  };

  try {
    await runTransaction(db, async (dbTransaction) => {
      for (const selection of selections) {
        if (selection.quantity <= 0) continue;

        const fromInvRef = doc(db, 'inventory', selection.invId);
        const fromInvDoc = await dbTransaction.get(fromInvRef);
        
        if (!fromInvDoc.exists()) continue;
        const invData = fromInvDoc.data() as Inventory;

        if (invData.quantity < selection.quantity) {
          throw new Error(`Insufficient stock for ${selection.itemId}`);
        }

        // Update Source Inventory
        dbTransaction.update(fromInvRef, {
          quantity: invData.quantity - selection.quantity,
          updatedAt: serverTimestamp()
        });

        // Update Destination Inventory
        if (toLocationId) {
          const toInvRef = getInventoryRef(selection.itemId, toLocationId, selection.variant || undefined, selection.customSpec || undefined);
          const toInvDoc = await dbTransaction.get(toInvRef);
          const currentToQty = (toInvDoc.exists() ? toInvDoc.data()?.quantity : 0) || 0;
          
          dbTransaction.set(toInvRef, {
            itemId: selection.itemId,
            locationId: toLocationId,
            variant: selection.variant || null,
            customSpec: selection.customSpec || null,
            quantity: currentToQty + selection.quantity,
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
  return onSnapshot(collection(db, 'tags'), (snapshot) => {
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
  return onSnapshot(collection(db, 'categories'), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'categories', false);
    callback([]);
  });
};

export const subscribeToUOMs = (callback: (data: UOM[]) => void) => {
  return onSnapshot(collection(db, 'uoms'), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UOM));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'uoms', false);
    callback([]);
  });
};

export const subscribeToRequests = (callback: (data: Request[]) => void, locationIds?: string[], limitCount: number = 50) => {
  if (locationIds && locationIds.length === 0) {
    callback([]);
    return () => {};
  }
  let q = query(collection(db, 'requests'), orderBy('timestamp', 'desc'), limit(limitCount));
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

export const subscribeToPurchaseOrders = (callback: (data: PurchaseOrder[]) => void) => {
  return onSnapshot(query(collection(db, 'purchase_orders'), orderBy('poNumber', 'desc')), (snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder));
    callback(data);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, 'purchase_orders', false);
    callback([]);
  });
};
