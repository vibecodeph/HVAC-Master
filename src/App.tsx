import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, User, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut, getRedirectResult } from 'firebase/auth';
import { onSnapshot, collection, query, where, getDocs, doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { ArrowLeftRight } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  Item, Category, UOM, Location, Inventory, Transaction, Request, UserProfile, Asset, BOQItem, UnplannedStock, Tag, SystemConfig, PurchaseOrder 
} from './types';
import { 
  subscribeToItems, subscribeToCategories, subscribeToUOMs, 
  subscribeToLocations, subscribeToInventory, subscribeToTransactions, 
  subscribeToRequests, subscribeToUsers, subscribeToAssets, 
  subscribeToBOQs, subscribeToUnplannedStock, subscribeToTags,
  subscribeToPurchaseOrders
} from './services/inventoryService';
import { Layout } from './components/Layout';
import { Dashboard } from './components/views/Dashboard';
import { InventoryList } from './components/views/InventoryList';
import { Transactions } from './components/views/Transactions';
import { RequestsView } from './components/views/Requests';
import { ProfileView } from './components/views/Profile';
import { SettingsView } from './components/views/Settings';
import { Login } from './components/views/Login';
import { PendingApproval } from './components/views/PendingApproval';
import { MaintenanceMode } from './components/views/MaintenanceMode';
import { MetadataAdminView } from './components/views/Admin/Metadata';
import { RBACDashboard } from './components/views/Admin/RBAC';
import { ItemManagementView } from './components/views/Admin/Items';
import { UsersManagementView } from './components/views/Admin/Users';
import { JobsiteBOQView } from './components/views/Admin/JobsiteBOQ';
import { PurchaseOrderList } from './components/views/PurchaseOrderList';
import { PurchaseOrderForm } from './components/Forms';
import { LocationsView } from './components/views/Locations';

const PurchaseOrderView = () => {
  const { purchaseOrders, locations, items, uoms } = useData();
  const { profile } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);

  if (isAdding || editingPO) {
    return (
      <div className="p-6">
        <div className="flex items-center space-x-4 mb-8">
          <button 
            onClick={() => {
              setIsAdding(false);
              setEditingPO(null);
            }}
            className="p-3 bg-white rounded-2xl shadow-sm text-gray-400 hover:text-gray-900 transition-colors"
          >
            <ArrowLeftRight size={20} className="rotate-180" />
          </button>
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">
              {editingPO ? 'Edit Purchase Order' : 'New Purchase Order'}
            </h2>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              {editingPO ? `Editing ${editingPO.poNumber}` : 'Create a new order for a supplier'}
            </p>
          </div>
        </div>
        <PurchaseOrderForm 
          items={items}
          locations={locations}
          uoms={uoms}
          profile={profile}
          initialData={editingPO || undefined}
          onComplete={() => {
            setIsAdding(false);
            setEditingPO(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PurchaseOrderList 
        purchaseOrders={purchaseOrders}
        locations={locations}
        items={items}
        uoms={uoms}
        profile={profile}
        onAdd={() => setIsAdding(true)}
        onEdit={setEditingPO}
      />
    </div>
  );
};
import { SidebarProvider } from './hooks/useApp';

// Contexts
interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  signIn: (method?: 'popup' | 'redirect') => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  profile: null, 
  loading: true,
  isSigningIn: false,
  authError: null,
  signIn: async (method?: 'popup' | 'redirect') => {},
  logout: async () => {}
});
export const useAuth = () => useContext(AuthContext);

interface DataContextType {
  items: Item[];
  categories: Category[];
  uoms: UOM[];
  locations: Location[];
  inventory: Inventory[];
  transactions: Transaction[];
  requests: Request[];
  users: UserProfile[];
  assets: Asset[];
  boqs: BOQItem[];
  unplanned: UnplannedStock[];
  purchaseOrders: PurchaseOrder[];
  tags: Tag[];
  systemConfig: SystemConfig | null | undefined;
  loading: boolean;
}

const DataContext = createContext<DataContextType>({
  items: [], categories: [], uoms: [], locations: [], inventory: [],
  transactions: [], requests: [], users: [], assets: [], boqs: [], unplanned: [],
  purchaseOrders: [],
  tags: [],
  systemConfig: undefined,
  loading: true
});
export const useData = () => useContext(DataContext);

// Providers
const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const signIn = async (method: 'popup' | 'redirect' = 'popup') => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      
      if (method === 'popup') {
        const result = await signInWithPopup(auth, provider);
        setUser(result.user);
      } else {
        await signInWithRedirect(auth, provider);
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      const isPopupClosed = error.code === 'auth/popup-closed-by-user' || error.message?.includes('popup-closed-by-user');
      const isPopupBlocked = error.code === 'auth/popup-blocked' || error.code === 'auth/blocked-at-interaction' || error.message?.includes('popup-blocked');
      
      if (isPopupClosed) {
        setAuthError('Sign-in was cancelled.');
      } else if (isPopupBlocked) {
        setAuthError('The sign-in popup was blocked. Please enable popups for this site or try the "Redirect" method below.');
      } else if (error.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        setAuthError(`Domain Unauthorized: "${domain}" is not in the authorized list in Firebase Console. Please add it in Authentication > Settings > Authorized domains.`);
      } else {
        setAuthError(error.message || 'An error occurred during sign-in. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.error('Redirect result error:', error);
      setAuthError(error.message);
    });
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), async (userDoc) => {
      const BOOTSTRAP_EMAILS = import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS?.split(',') || [];
      const isBootstrapAdmin = user.email && BOOTSTRAP_EMAILS.includes(user.email);
      
      if (userDoc.exists()) {
        const data = userDoc.data() as UserProfile;
        // Auto-activate admin if they are a bootstrap admin email but not active
        if (isBootstrapAdmin && !data.isActive) {
          const updatedProfile = { ...data, isActive: true, isApproved: true, role: 'admin' as const };
          await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
          setProfile(updatedProfile);
        } else {
          setProfile(data);
        }
      } else {
        // Create default profile for new users
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'New User',
          photoURL: user.photoURL || '',
          role: isBootstrapAdmin ? 'admin' : 'worker',
          isActive: !!isBootstrapAdmin, // Admins are active by default
          isApproved: !!isBootstrapAdmin, // Admins are approved by default
          createdAt: serverTimestamp() as any,
        };
        await setDoc(doc(db, 'users', user.uid), newProfile);
        setProfile(newProfile);
      }
      setLoading(false);
    }, (err) => {
      console.error('Profile listener error:', err);
      setLoading(false);
    });

    return () => unsubProfile();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isSigningIn, authError, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const DataProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, setData] = useState<Omit<DataContextType, 'loading'>>({
    items: [], categories: [], uoms: [], locations: [], inventory: [],
    transactions: [], requests: [], users: [], assets: [], boqs: [], unplanned: [],
    purchaseOrders: [],
    tags: [],
    systemConfig: undefined
  });
  const [loading, setLoading] = useState(true);
  const { user, profile } = useAuth();

  useEffect(() => {
    const loadedCollections = new Set<string>();
    const collectionsToLoad = ['system_config'];
    if (user && profile?.isApproved) {
      collectionsToLoad.push(
        'items', 'categories', 'uoms', 'locations', 'inventory', 
        'transactions', 'requests', 'assets', 'boq', 'unplanned', 
        'tags', 'purchase_orders'
      );
      if (profile.role === 'admin' || profile.role === 'engineer') {
        collectionsToLoad.push('users');
      }
    }

    const totalCollections = collectionsToLoad.length;

    const checkLoading = (collectionName: string) => {
      loadedCollections.add(collectionName);
      if (loadedCollections.size >= totalCollections) {
        setLoading(false);
      }
    };

    // 1. Always listen to system config
    const unsubConfig = onSnapshot(doc(db, 'system', 'config'), (s) => {
      setData(prev => ({ ...prev, systemConfig: s.exists() ? s.data() as SystemConfig : null }));
      checkLoading('system_config');
    }, (e) => {
      console.error('System config load error:', e);
      checkLoading('system_config');
    });

    if (!user || !profile?.isApproved) {
      // If no user or not approved, we only wait for system_config
      if (!user) return () => unsubConfig();
      return () => unsubConfig();
    }

    // 2. Listen to other collections when user is logged in
    setLoading(true);
    const isInternalRole = profile?.role === 'admin' || profile?.role === 'warehouseman' || profile?.role === 'manager' || profile?.role === 'engineer' || profile?.role === 'worker';
    const assigned = isInternalRole ? undefined : (profile?.assignedLocationIds || []);
    const broadAssigned = isInternalRole ? undefined : assigned;
    const includeSuppliers = isInternalRole;

    const safeSubscribe = (name: string, subscribeFn: (cb: (data: any) => void, ...args: any[]) => () => void, ...args: any[]) => {
      try {
        return subscribeFn(data => {
          const key = name === 'boq' ? 'boqs' : (name === 'purchase_orders' ? 'purchaseOrders' : name);
          setData(prev => ({ ...prev, [key]: data }));
          checkLoading(name);
        }, ...args);
      } catch (error) {
        console.error(`Subscription error for ${name}:`, error);
        checkLoading(name);
        return () => {};
      }
    };

    const unsubscribes = [
      safeSubscribe('items', subscribeToItems),
      safeSubscribe('categories', subscribeToCategories),
      safeSubscribe('uoms', subscribeToUOMs),
      safeSubscribe('locations', subscribeToLocations, broadAssigned, includeSuppliers),
      safeSubscribe('inventory', subscribeToInventory, assigned),
      safeSubscribe('transactions', subscribeToTransactions, assigned),
      safeSubscribe('requests', subscribeToRequests, assigned),
      (profile?.role === 'admin' || profile?.role === 'engineer') ? safeSubscribe('users', subscribeToUsers, profile.role) : () => {},
      safeSubscribe('assets', subscribeToAssets, assigned),
      safeSubscribe('boq', subscribeToBOQs, assigned),
      safeSubscribe('unplanned', subscribeToUnplannedStock, assigned),
      safeSubscribe('tags', subscribeToTags),
      safeSubscribe('purchase_orders', subscribeToPurchaseOrders)
    ];

    return () => {
      unsubConfig();
      unsubscribes.forEach(u => u());
    };
  }, [user, profile]);

  return (
    <DataContext.Provider value={{ ...data, loading }}>
      {children}
    </DataContext.Provider>
  );
};

// Protected Route Component
const ProtectedRoute = ({ children, requireAdmin }: { children: React.ReactNode, requireAdmin?: boolean }) => {
  const { user, profile, loading: authLoading } = useAuth();
  const { systemConfig, loading: dataLoading } = useData();
  const location = useLocation();

  if (authLoading || dataLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  
  // Maintenance Mode Check
  const BOOTSTRAP_EMAILS = import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS?.split(',') || [];
  const isBootstrapAdminFromEnv = user.email && BOOTSTRAP_EMAILS.includes(user.email);
  
  if (systemConfig?.maintenanceMode && profile?.role !== 'admin' && !isBootstrapAdminFromEnv) {
    return <Navigate to="/maintenance" replace />;
  }

  if (profile && (!profile.isActive || !profile.isApproved)) return <Navigate to="/pending-approval" replace />;
  if (requireAdmin && profile?.role !== 'admin') return <Navigate to="/" replace />;

  return <>{children}</>;
};

// Error Boundary
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <span className="text-2xl font-black">!</span>
            </div>
            <h1 className="text-xl font-black text-gray-900 uppercase tracking-widest">Something went wrong</h1>
            <p className="text-sm text-gray-500 font-medium">The application encountered an unexpected error. Please try refreshing the page.</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold uppercase tracking-widest active:scale-95 transition-transform"
            >
              Refresh App
            </button>
            {process.env.NODE_ENV === 'development' && (
              <pre className="text-[10px] text-left bg-gray-100 p-4 rounded-xl overflow-auto max-h-40">
                {this.state.error?.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataProvider>
          <SidebarProvider>
            <Router>
              <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/pending-approval" element={<PendingApproval />} />
                  <Route path="/maintenance" element={<MaintenanceMode />} />
                  
                  <Route path="/" element={
                    <ProtectedRoute>
                      <Layout>
                        <Dashboard />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/inventory" element={
                    <ProtectedRoute>
                      <Layout>
                        <InventoryList />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/transactions" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <Transactions />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/purchase-orders" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <PurchaseOrderView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/requests" element={
                    <ProtectedRoute>
                      <Layout>
                        <RequestsView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/locations" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <LocationsView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/profile" element={
                    <ProtectedRoute>
                      <Layout>
                        <ProfileView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings" element={
                    <ProtectedRoute>
                      <Layout>
                        <SettingsView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings/manage/metadata/:type" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <MetadataAdminView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings/manage/rbac" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <RBACDashboard />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings/manage/items" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <ItemManagementView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings/manage/boq/:jobsiteId" element={
                    <ProtectedRoute requireAdmin>
                      <Layout>
                        <JobsiteBOQView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="/settings/manage/users" element={
                    <ProtectedRoute requireAdmin={false}>
                      <Layout>
                        <UsersManagementView />
                      </Layout>
                    </ProtectedRoute>
                  } />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Router>
            </SidebarProvider>
          </DataProvider>
        </AuthProvider>
      </ErrorBoundary>
    );
  };

export default App;
