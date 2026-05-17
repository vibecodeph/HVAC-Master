import { collection, addDoc, deleteDoc, doc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type ActiveOperationType = 'bulk_receive' | 'bulk_pick' | 'approve_requests';

export interface ActiveOperationDoc {
  id: string;
  uid: string;
  role: string;
  operationType: ActiveOperationType;
  startedAt: any;
  locationId: string | null;
}

export async function startOperation(
  uid: string,
  role: string,
  operationType: ActiveOperationType,
  locationId?: string
): Promise<string> {
  const docRef = await addDoc(collection(db, 'activeOperations'), {
    uid,
    role,
    operationType,
    startedAt: serverTimestamp(),
    locationId: locationId || null,
  });
  return docRef.id;
}

export async function endOperation(docId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'activeOperations', docId));
  } catch {
    // never throw — must not interrupt the main flow
  }
}

export async function getActiveOperations(): Promise<ActiveOperationDoc[]> {
  const snap = await getDocs(collection(db, 'activeOperations'));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ActiveOperationDoc, 'id'>) }));
}

export async function clearStaleOperations(uid: string): Promise<void> {
  try {
    const snap = await getDocs(query(collection(db, 'activeOperations'), where('uid', '==', uid)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch {
    // never throw
  }
}
