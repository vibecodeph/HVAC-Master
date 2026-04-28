import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { PurchaseOrder, PurchaseOrderItem, POTemplate } from '../types';

const TEMPLATE_ID = 'default';

export const getPOTemplate = async (): Promise<POTemplate | null> => {
  try {
    const docSnap = await getDoc(doc(db, 'po_templates', TEMPLATE_ID));
    if (docSnap.exists()) {
      return docSnap.data() as POTemplate;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'po_templates');
    return null;
  }
};

export const savePOTemplate = async (template: Omit<POTemplate, 'updatedAt' | 'updatedBy'>) => {
  try {
    await setDoc(doc(db, 'po_templates', TEMPLATE_ID), {
      ...template,
      id: TEMPLATE_ID,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'po_templates');
  }
};

export const createPurchaseOrder = async (po: Omit<PurchaseOrder, 'id' | 'createdAt' | 'createdBy'>, items: PurchaseOrderItem[]) => {
  try {
    const poRef = doc(collection(db, 'purchase_orders'));
    const id = poRef.id;
    
    await setDoc(poRef, {
      ...po,
      id,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid
    });

    // Add items
    const itemsPromises = items.map(item => {
      const itemRef = doc(collection(db, 'purchase_orders', id, 'items'));
      return setDoc(itemRef, { ...item, id: itemRef.id });
    });
    
    await Promise.all(itemsPromises);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'purchase_orders');
  }
};

export const updatePurchaseOrder = async (id: string, po: Partial<PurchaseOrder>, items?: PurchaseOrderItem[]) => {
  try {
    const poRef = doc(db, 'purchase_orders', id);
    await updateDoc(poRef, {
      ...po,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    });

    if (items) {
      // For simplicity, we'll replace all items
      // First, delete existing items
      const itemsSnap = await getDocs(collection(db, 'purchase_orders', id, 'items'));
      const deletePromises = itemsSnap.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      // Then add new items
      const itemsPromises = items.map(item => {
        const itemRef = doc(collection(db, 'purchase_orders', id, 'items'));
        return setDoc(itemRef, { ...item, id: itemRef.id });
      });
      await Promise.all(itemsPromises);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `purchase_orders/${id}`);
  }
};

export const getPurchaseOrders = async () => {
  try {
    const q = query(collection(db, 'purchase_orders'), orderBy('date', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as PurchaseOrder);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'purchase_orders');
    return [];
  }
};

export const getPurchaseOrder = async (id: string): Promise<{ po: PurchaseOrder; items: PurchaseOrderItem[] } | null> => {
  try {
    const poSnap = await getDoc(doc(db, 'purchase_orders', id));
    if (!poSnap.exists()) return null;
    
    const itemsSnap = await getDocs(collection(db, 'purchase_orders', id, 'items'));
    const items = itemsSnap.docs.map(doc => doc.data() as PurchaseOrderItem);
    
    return {
      po: poSnap.data() as PurchaseOrder,
      items
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'purchase_orders');
    return null;
  }
};
