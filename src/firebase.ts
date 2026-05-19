import { initializeApp, FirebaseError } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// Set persistence to local
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Auth persistence error:', error);
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function getReadableFirestoreError(error: unknown): string {
  if (error instanceof FirebaseError) {
    const codeKey = error.code.includes('/') ? error.code.split('/')[1] : error.code;
    switch (codeKey) {
      case 'unavailable': return 'You appear to be offline. Please check your connection and try again.';
      case 'permission-denied': return "You don't have permission to perform this action.";
      case 'not-found': return 'The requested data was not found.';
      case 'already-exists': return 'This record already exists.';
      case 'deadline-exceeded': return 'The request timed out. Please try again.';
      case 'resource-exhausted': return 'Too many requests. Please wait a moment and try again.';
      case 'cancelled': return 'The operation was cancelled.';
      case 'unauthenticated': return 'Your session has expired. Please sign in again.';
    }
  }
  if (error instanceof Error && error.message.includes('the client is offline')) {
    return 'You appear to be offline. Please check your connection and try again.';
  }
  return 'An unexpected error occurred. Please try again.';
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, shouldThrow: boolean = true) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (shouldThrow) {
    throw new Error(getReadableFirestoreError(error));
  }
}

// Validate Connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
    // Skip logging for other errors, as this is simply a connection test.
  }
}
testConnection();
