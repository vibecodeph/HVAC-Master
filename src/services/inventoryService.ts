import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
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
  if (data === null || typeof data !== 'object') return data;
  
  // If it's a Date, return as is
  if (data instanceof Date) return data;

  // If it's a Firestore special object (Timestamp, FieldValue, etc.), return as is
  // We check for toDate (Timestamp) or if it's not a plain object (FieldValue and others)
  if (typeof data.toDate === 'function' || data instanceof Timestamp) {
    return data;
  }

  if (Array.isArray(data)) return data.map(cleanData);
  
  // Check if it's a plain object. If not, it's likely a Firestore internal class instance
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) {
    return data;
  }

  const clean: any = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      clean[key] = cleanData(data[key]);
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
    itemId, variant, serialNumber, propertyNumber, 
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
    if (id.length > 1000) {
      id = id.substring(0, 1000);
    }
    return doc(db, 'inventory', id);
  };

  try {
    await runTransaction(db, async (dbTransaction) => {
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

      // Fetch location docs to check types
      let fromLocDoc = null;
      let toLocDoc = null;
      if (fromLocationId) fromLocDoc = await dbTransaction.get(doc(db, 'locations', fromLocationId));
      if (toLocationId) toLocDoc = await dbTransaction.get(doc(db, 'locations', toLocationId));
      
      const fromIsWarehouse = fromLocDoc?.exists() && fromLocDoc.data()?.type === 'warehouse';
      const toIsWarehouse = toLocDoc?.exists() && toLocDoc.data()?.type === 'warehouse';

      if (toLocationId) {
        toInvRef = getInventoryRef(itemId, toLocationId, variant, serialNumber, propertyNumber);
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
          serialNumber: serialNumber || null,
          propertyNumber: propertyNumber || null,
          quantity: currentQty + baseQuantity
        }, { merge: true });
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

  const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string) => {
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
    if (id.length > 1000) id = id.substring(0, 1000);
    return doc(db, 'inventory', id);
  };

  try {
    await runTransaction(db, async (dbTransaction) => {
      // 1. GATHER DATA (READS)
      // Old refs
      const oldFromRef = oldTransaction.fromLocationId ? getInventoryRef(oldTransaction.itemId, oldTransaction.fromLocationId, oldTransaction.variant, oldTransaction.serialNumber) : null;
      const oldToRef = oldTransaction.toLocationId ? getInventoryRef(oldTransaction.itemId, oldTransaction.toLocationId, oldTransaction.variant, oldTransaction.serialNumber) : null;
      
      // New refs
      const newFromRef = newTransactionData.fromLocationId ? getInventoryRef(newTransactionData.itemId, newTransactionData.fromLocationId, newTransactionData.variant, newTransactionData.serialNumber) : null;
      const newToRef = newTransactionData.toLocationId ? getInventoryRef(newTransactionData.itemId, newTransactionData.toLocationId, newTransactionData.variant, newTransactionData.serialNumber) : null;

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
      createdAt: serverTimestamp()
    }));
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'items');
  }
};

export const updateItem = async (id: string, item: Partial<Item>) => {
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
        createdAt: serverTimestamp()
      }), { merge: true });
    } else {
      await updateDoc(itemRef, cleanData(item));
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

export const createRequest = async (request: Omit<Request, 'id' | 'timestamp' | 'status' | 'requestorId'>, requestorName?: string) => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('User not authenticated');

  try {
    const docRef = await addDoc(collection(db, 'requests'), {
      ...cleanData(request),
      requestorId: userId,
      requestorName: requestorName || '',
      status: 'pending',
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
    await updateDoc(doc(db, 'requests', id), {
      approvedQty,
      engineerNote: engineerNote || '',
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

export const recordBulkPick = async (selections: { requestId: string; deliveredQty: number; sourceLocationId: string; variant?: Record<string, string>; backorder?: boolean; serialNumbers?: string[] }[], warehousemanId: string, warehousemanName?: string) => {
  try {
    await runTransaction(db, async (dbTransaction) => {
      // 0. GENERATE DR NUMBER (DR#YY-XXXX)
      const now = new Date();
      const yearYY = now.getFullYear().toString().slice(-2);
      const counterRef = doc(db, 'counters', 'dr_number');
      const counterDoc = await dbTransaction.get(counterRef);
      
      let nextSeries = 1;
      if (counterDoc.exists()) {
        const data = counterDoc.data();
        if (data.year === yearYY) {
          nextSeries = (data.lastSeries || 0) + 1;
        }
      }
      
      const seriesStr = nextSeries.toString().padStart(4, '0');
      const batchId = `DR#${yearYY}-${seriesStr}`;
      
      const requestData: any[] = [];
      const itemCache: Record<string, Item> = {};
      const invCache: Record<string, { ref: any, quantity: number, serialNumber?: string }> = {};

      const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string) => {
        let id = `${itemId}_${locationId}`;
        if (variant && Object.keys(variant).length > 0) {
          const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => { acc[key] = variant[key]; return acc; }, {} as any);
          const variantHash = encodeURIComponent(JSON.stringify(sortedVariant)).replace(/%/g, '_').replace(/\./g, '-');
          id += `_${variantHash}`;
        }
        if (serialNumber) {
          id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
        }
        return doc(db, 'inventory', id.substring(0, 1000));
      };

      // 1. READS
      for (const selection of selections) {
        const { requestId, deliveredQty, sourceLocationId, variant, serialNumbers } = selection;
        const requestRef = doc(db, 'requests', requestId);
        const requestDoc = await dbTransaction.get(requestRef);
        if (!requestDoc.exists()) continue;
        const request = requestDoc.data() as Request;

        const { itemId, uomId } = request;
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
            const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, sn);
            const invKey = invRef.path;
            if (!invCache[invKey]) {
              const invDoc = await dbTransaction.get(invRef);
              invCache[invKey] = {
                ref: invRef,
                quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
                serialNumber: sn
              };
            }
          }
        } else {
          const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant);
          const invKey = invRef.path;
          if (!invCache[invKey]) {
            const invDoc = await dbTransaction.get(invRef);
            invCache[invKey] = {
              ref: invRef,
              quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0
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
        const { itemId, uomId, approvedQty } = request;

        // Update inventory cache and record transactions
        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant, sn);
            const invKey = invRef.path;
            invCache[invKey].quantity -= 1; // Serialized items are always quantity 1

            // Record individual transaction per serial number
            const transactionRef = doc(collection(db, 'transactions'));
            dbTransaction.set(transactionRef, cleanData({
              itemId,
              variant: effectiveVariant || null,
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
              timestamp: serverTimestamp(),
              batchId,
              requestIds: [requestId]
            }));

            // Update Asset location
            const assetRef = doc(db, 'assets', sn);
            dbTransaction.set(assetRef, {
              locationId: 'in-transit',
              updatedAt: serverTimestamp()
            }, { merge: true });
          }
        } else {
          const invRef = getInventoryRef(itemId, sourceLocationId, effectiveVariant);
          const invKey = invRef.path;
          invCache[invKey].quantity -= baseQuantity;

          // Record individual transaction (Pick)
          const transactionRef = doc(collection(db, 'transactions'));
          dbTransaction.set(transactionRef, cleanData({
            itemId,
            variant: effectiveVariant || null,
            fromLocationId: sourceLocationId,
            toLocationId: 'in-transit',
            quantity: deliveredQty,
            uomId,
            conversionFactor,
            baseQuantity,
            type: 'pick',
            userId: warehousemanId,
            userName: warehousemanName || '',
            timestamp: serverTimestamp(),
            batchId,
            requestIds: [requestId]
          }));
        }

        // Update Request Status to 'for delivery'
        dbTransaction.update(requestRef, cleanData({
          status: 'for delivery',
          deliveredQty,
          pickedAt: serverTimestamp(),
          batchId,
          variant: effectiveVariant || null,
          sourceLocationId,
          warehousemanId,
          warehousemanName: warehousemanName || '',
          serialNumbers: serialNumbers || null
        }));

        // Handle Backorder
        if (backorder && approvedQty && deliveredQty < approvedQty) {
          const backorderRef = doc(collection(db, 'requests'));
          dbTransaction.set(backorderRef, cleanData({
            itemId,
            variant: effectiveVariant || null,
            requestedQty: approvedQty - deliveredQty,
            uomId,
            jobsiteId: request.jobsiteId,
            status: 'approved',
            requestorId: request.requestorId,
            requestorName: request.requestorName || '',
            approverId: request.approverId || '',
            approverName: request.approverName || '',
            workerNote: `Backorder of ${requestId}`,
            timestamp: serverTimestamp(),
            approvedAt: serverTimestamp(),
            backorderOf: requestId
          }));
        }

        // Record individual transaction (Pick)
        const transactionRef = doc(collection(db, 'transactions'));
        dbTransaction.set(transactionRef, cleanData({
          itemId,
          variant: effectiveVariant || null,
          fromLocationId: sourceLocationId,
          toLocationId: 'in-transit',
          quantity: deliveredQty,
          uomId,
          conversionFactor,
          baseQuantity,
          type: 'pick',
          userId: warehousemanId,
          userName: warehousemanName || '',
          timestamp: serverTimestamp(),
          batchId,
          requestIds: [requestId]
        }));
      }

      // Update counter for next time
      dbTransaction.set(counterRef, {
        year: yearYY,
        lastSeries: nextSeries,
        updatedAt: serverTimestamp()
      });

      // Final inventory writes
      for (const invKey in invCache) {
        const { ref, quantity, serialNumber } = invCache[invKey];
        const data = requestData.find(d => {
          if (serialNumber) {
            return d.selection.serialNumbers?.includes(serialNumber);
          }
          return d.invKey === invKey;
        });
        if (data) {
          dbTransaction.set(ref, cleanData({
            itemId: data.request.itemId,
            locationId: data.selection.sourceLocationId,
            variant: data.effectiveVariant || null,
            serialNumber: serialNumber || null,
            quantity: quantity
          }), { merge: true });
        }
      }
    });
  } catch (error) {
    console.error("Bulk pick failed:", error);
    handleFirestoreError(error, OperationType.WRITE, 'bulk_pick');
  }
};

export const recordBulkReceive = async (requestIds: string[], receiverId: string, receiverName?: string) => {
  try {
    await runTransaction(db, async (dbTransaction) => {
      const requestData: any[] = [];
      const itemCache: Record<string, Item> = {};
      const invCache: Record<string, { ref: any, quantity: number, serialNumber?: string }> = {};

      const getInventoryRef = (itemId: string, locationId: string, variant?: Record<string, string>, serialNumber?: string) => {
        let id = `${itemId}_${locationId}`;
        if (variant && Object.keys(variant).length > 0) {
          const sortedVariant = Object.keys(variant).sort().reduce((acc, key) => { acc[key] = variant[key]; return acc; }, {} as any);
          const variantHash = encodeURIComponent(JSON.stringify(sortedVariant)).replace(/%/g, '_').replace(/\./g, '-');
          id += `_${variantHash}`;
        }
        if (serialNumber) {
          id += `_SN-${encodeURIComponent(serialNumber).replace(/%/g, '_')}`;
        }
        return doc(db, 'inventory', id.substring(0, 1000));
      };

      // 1. READS
      for (const requestId of requestIds) {
        const requestRef = doc(db, 'requests', requestId);
        const requestDoc = await dbTransaction.get(requestRef);
        if (!requestDoc.exists()) continue;
        const request = requestDoc.data() as Request;

        if (request.status !== 'for delivery') continue;

        const { itemId, uomId, jobsiteId, deliveredQty, variant, serialNumbers } = request;

        if (!itemCache[itemId]) {
          const itemRef = doc(db, 'items', itemId);
          const itemDoc = await dbTransaction.get(itemRef);
          if (itemDoc.exists()) {
            itemCache[itemId] = itemDoc.data() as Item;
          }
        }
        const itemData = itemCache[itemId];
        if (!itemData) continue;

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn);
            const invKey = invRef.path;
            if (!invCache[invKey]) {
              const invDoc = await dbTransaction.get(invRef);
              invCache[invKey] = {
                ref: invRef,
                quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0,
                serialNumber: sn
              };
            }
          }
        } else {
          const invRef = getInventoryRef(itemId, jobsiteId, variant);
          const invKey = invRef.path;
          if (!invCache[invKey]) {
            const invDoc = await dbTransaction.get(invRef);
            invCache[invKey] = {
              ref: invRef,
              quantity: (invDoc.exists() ? invDoc.data()?.quantity : 0) || 0
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

      // 2. WRITES
      for (const data of requestData) {
        const { requestId, requestRef, request, conversionFactor, baseQuantity } = data;
        const { itemId, uomId, jobsiteId, deliveredQty, variant, serialNumbers } = request;

        if (serialNumbers && serialNumbers.length > 0) {
          for (const sn of serialNumbers) {
            const invRef = getInventoryRef(itemId, jobsiteId, variant, sn);
            const invKey = invRef.path;
            invCache[invKey].quantity += 1;

            // Record individual transaction per serial number
            const transactionRef = doc(collection(db, 'transactions'));
            dbTransaction.set(transactionRef, cleanData({
              itemId,
              variant: variant || null,
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
              locationId: jobsiteId,
              updatedAt: serverTimestamp()
            }, { merge: true });
          }
        } else {
          const invRef = getInventoryRef(itemId, jobsiteId, variant);
          const invKey = invRef.path;
          invCache[invKey].quantity += baseQuantity;

          // Record individual transaction (Receive)
          const transactionRef = doc(collection(db, 'transactions'));
          dbTransaction.set(transactionRef, cleanData({
            itemId,
            variant: variant || null,
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
      }

      // Final inventory writes
      for (const invKey in invCache) {
        const { ref, quantity, serialNumber } = invCache[invKey];
        const data = requestData.find(d => {
          if (serialNumber) {
            return d.request.serialNumbers?.includes(serialNumber);
          }
          // For non-serialized, match by itemId, jobsiteId, and variant
          return d.request.itemId === invCache[invKey].ref.id.split('_')[0]; // Simplified check
        });
        
        // More robust matching for final writes
        const matchingData = requestData.find(d => {
          const { itemId, jobsiteId, variant, serialNumbers } = d.request;
          if (serialNumber) {
            return serialNumbers?.includes(serialNumber);
          }
          // This is a bit tricky because invKey is the path. 
          // Let's just use the ref we stored.
          return true; // We already have the ref and quantity in invCache
        });

        if (matchingData) {
          dbTransaction.set(ref, cleanData({
            itemId: matchingData.request.itemId,
            locationId: matchingData.request.jobsiteId,
            variant: matchingData.request.variant || null,
            serialNumber: serialNumber || null,
            quantity: quantity
          }), { merge: true });
        }
      }
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

// --- User Operations ---

export const subscribeToUsers = (callback: (data: UserProfile[]) => void) => {
  return onSnapshot(collection(db, 'users'), (snapshot) => {
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
