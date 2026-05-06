import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { RBACRoleConfig, RBACauditEntry } from '../types';

export function subscribeToRBACConfig(
  callback: (config: Record<string, RBACRoleConfig>) => void
): () => void {
  return onSnapshot(
    collection(db, 'rbac_config'),
    (snapshot) => {
      const config: Record<string, RBACRoleConfig> = {};
      snapshot.forEach((doc) => {
        config[doc.id] = doc.data() as RBACRoleConfig;
      });
      callback(config);
    },
    (error) => {
      console.error('rbac_config subscription error:', error);
      callback({});
    }
  );
}

export function subscribeToRBACaudit(
  callback: (entries: RBACauditEntry[]) => void,
  limitCount = 50
): () => void {
  const q = query(
    collection(db, 'rbac_audit'),
    orderBy('changedAt', 'desc'),
    limit(limitCount)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const entries: RBACauditEntry[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as RBACauditEntry));
      callback(entries);
    },
    (error) => {
      console.error('rbac_audit subscription error:', error);
      callback([]);
    }
  );
}

export const callUpdateRolePermissions = httpsCallable<
  { roleId: string; permissions: string[]; description?: string },
  { success: boolean }
>(functions, 'updateRolePermissions');

export const callCreateRole = httpsCallable<
  { roleId: string; permissions: string[]; description: string },
  { success: boolean }
>(functions, 'createRole');

export const callDeleteRole = httpsCallable<
  { roleId: string },
  { success: boolean }
>(functions, 'deleteRole');
