# HVAC Master — Claude Code Skill File

> A complete onboarding reference for any Claude Code session working on this project.
> Read this before asking basic questions — everything you need to get started is here.

---

## 1. Project Overview

**What it does:** Firebase-backed inventory management app for HVAC field professionals.
Manages items, stock levels, locations, material requests, purchase orders, suppliers invoices,
BOQ (Bill of Quantities), and user access.

**Tech stack:**
- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS (`cn()` from `src/lib/utils.ts` for conditional classes)
- Animations: `motion/react`
- Icons: Lucide React
- Backend: Firebase (Firestore, Auth, Cloud Functions v2)
- State: React Context only — `AuthContext` + `DataContext` in `src/App.tsx`

**Live URL:** https://hvacmaster.web.app

**Local path:** `C:\Users\Edwin\Documents\PROJECTS\HVAC-Master`

**Firebase project ID:** `gen-lang-client-0430534848`

**Firestore database ID:** `ai-studio-bd36edda-8fe9-4e09-b9a3-dfe452f56d22`
(Named database — passed as second arg to `getFirestore()`. Never use the default database.)

**Environment variables (Vite):**
- `VITE_BOOTSTRAP_ADMIN_EMAILS` — comma-separated admin email list (used in App.tsx for first-user bootstrap)
- `VITE_APP_VERSION` — app version string shown in Login.tsx

---

## 2. Architecture & Key Files

### Services (`src/services/`)

| File | What it does |
|---|---|
| `inventoryService.ts` | All core Firestore ops: CRUD for items/locations/categories/UOMs/tags/BOQ/assets/requests/transactions. Contains `getInventoryRef`, `sortVariant`, `cleanData`, `recordTransaction`, `deleteTransaction`, `updateTransaction`, `recordBulkReceivePO`, all subscribe functions. The largest file in the project. |
| `suppliersInvoiceService.ts` | Create/update/delete suppliers invoices. Contains `getConvFactor`, its own `cleanData` copy, and all logic for writing price_history docs. |
| `purchaseOrderService.ts` | PO CRUD: `createPurchaseOrder`, `updatePurchaseOrder`, `deletePurchaseOrder`, `getPOTemplate`, `savePOTemplate`. |
| `csvService.ts` | CSV import/export for items and inventory. |
| `activeOperationService.ts` | `startOperation` / `endOperation` — tracks bulk operations to prevent conflicts. `endOperation` is always in a `finally` block. |
| `rbacService.ts` | `subscribeToRBACConfig` — reads `rbac_config` collection (admin only). |

### Maintenance scripts (`scripts/`)

| Script | What it does |
|---|---|
| `check-integrity.ts` | One-shot Firestore integrity checker. Dry-run by default; `--fix` applies auto-fixes. Requires `scripts/serviceAccountKey.json` (in `.gitignore`). Run: `cd scripts && npx tsx check-integrity.ts`. |
| `migrate-price-history.ts` | One-time migration: copies `averageCost → latestPrice` on item docs. Already run — do not re-run. |

### App entry points

| File | Role |
|---|---|
| `src/App.tsx` | Root: `AuthProvider`, `DataProvider`, `SidebarProvider`, **`createBrowserRouter` + `RouterProvider`** (data router — required for `useBlocker`), route definitions, `SuspenseShell`, `ProtectedRoute`, `ErrorBoundary`. |
| `src/firebase.ts` | Firebase init (`app`, `db`, `auth`, `functions`), `OperationType` enum, `handleFirestoreError()`, `getReadableFirestoreError()`. |
| `src/types.ts` | All shared TypeScript interfaces — single source of truth. |
| `src/lib/utils.ts` | `cn()`, `getMillis()`, `formatTimestamp()`, `normalizeVariant()`. |
| `src/hooks/useApp.tsx` | `useIsMobile`, `SidebarContext`, `SidebarProvider`, `useSidebar`. |
| `src/hooks/useDebounce.ts` | `useDebounce<T>` hook. |
| `src/hooks/useUnsavedGuard.ts` | `useUnsavedGuard(isDirty)` → `{ isBlocked, confirmLeave, cancelLeave }`. Combines `useBlocker` (route navigation) + `beforeunload` (browser close). Requires data router — App.tsx uses `createBrowserRouter`. |

### Key component files

| File | Role |
|---|---|
| `src/components/Layout.tsx` | App shell with nav, sidebar, offline banner. |
| `src/components/Forms.tsx` | All major modal forms: `RequestForm`, `WorkerRequestForm`, `ItemForm`, `TransactionForm`, `PurchaseOrderForm`, `POPaymentForm`, `PickingModal`, `RequestApprovalModal`. |
| `src/components/views/Dashboard.tsx` | Main dashboard with inventory overview. |
| `src/components/views/Requests.tsx` | Request workflow: approve, pick, receive, reject. |
| `src/components/views/InventoryList.tsx` | Browse & filter inventory. |
| `src/components/views/Transactions.tsx` | Transaction log. |
| `src/components/views/Settings.tsx` | System config, data migration, purge, force sign-out. |
| `src/components/views/Admin/Items.tsx` | Full item management (admin). |
| `src/components/views/Admin/Users.tsx` | User management (admin). |
| `src/components/views/Admin/RBAC.tsx` | Role permission editor (admin). |
| `src/components/views/Admin/JobsiteBOQ.tsx` | BOQ editor per jobsite (admin). |
| `src/components/views/Admin/SuppliersInvoice.tsx` | Supplier invoice management (admin). |
| `src/components/views/Admin/RequestsManager.tsx` | Admin bulk-edit requests. |
| `src/components/views/Admin/TransactionsManager.tsx` | Admin bulk-edit transactions. |
| `src/components/views/Admin/ArchivedRequests.tsx` | Archived request viewer + manual archive trigger. |
| `src/components/views/Admin/PriceTrends.tsx` | Price history chart by item (admin). |
| `src/components/views/Admin/Metadata.tsx` | UOM/category/tag/location CRUD (admin). |
| `src/components/views/Admin/POTemplateSettings.tsx` | PO document header/signatory config. |
| `src/components/common/UnsavedChangesModal.tsx` | Reusable modal for unsaved changes confirmation. `z-[80]` — renders above existing `Modal` at `z-[70]`. Props: `{ isOpen, onStay, onLeave }`. |

### Important utilities

**`getInventoryRef(itemId, locationId, variant?, serialNumber?, propertyNumber?, customSpec?)`**
— Module-level in `inventoryService.ts`. Builds a deterministic Firestore doc ref for an inventory record.
Never duplicate this function inside other functions.

**`sortVariant(v)`** — Module-level in `inventoryService.ts`. Returns sorted JSON string of variant keys.
Used for PO item matching. Never duplicate.

**`normalizeVariant(variant?)`** — In `src/lib/utils.ts`. Returns sorted JSON string.
Used for BOQ matching and variant comparisons across the codebase.

**`cleanData(data)`** — In `inventoryService.ts` and `suppliersInvoiceService.ts`. Strips `undefined`
values before writing to Firestore (Firestore rejects `undefined`). All writes must go through `cleanData`.

**`handleFirestoreError(error, operationType, path, shouldThrow?)`** — In `src/firebase.ts`.
Logs full error info to `console.error`, then throws a human-readable message. Call it in every catch block.

**`startOperation / endOperation`** — In `activeOperationService.ts`. Wrap bulk operations.
`endOperation` must always be in a `finally` block — it never throws.

### Data flow

```
Google Sign-in → Firebase Auth → onAuthStateChanged → AuthProvider
  → profile onSnapshot (users/{uid}) → custom claims auto-refreshed if role changed
  → DataProvider useEffect → Firestore onSnapshot subscriptions → DataContext
  → Components consume via useAuth() + useData()
```

**`DataProvider` dependency array** (critical — do not change this):
```ts
[user?.uid, profile?.isApproved, profile?.role, JSON.stringify(profile?.assignedLocationIds)]
```

**Requests subscription** has its own `useEffect` (separate from main data effect) to support
dynamic pagination via `requestsLimitCount`. Admin loads all requests (no limit).

---

## 3. Firestore Collections

| Collection | Contents | Notes |
|---|---|---|
| `items` | Item catalog | `isActive`, `uomId`, `variantAttributes`, `requireVariant`, `requireCustomSpec`, `uomConversions`, `variantConfigs`, `latestPrice`, `latestPriceDate`, `totalQuantity` |
| `inventory` | Stock per location | Doc IDs built by `getInventoryRef`. Contains `quantity`, `averageCost`, `assignedJobsiteId`. |
| `transactions` | All movement records | `type`: delivery/usage/return/adjustment/pick/consumption/supplier_invoice. `conversionFactor` + `baseQuantity` always stored. |
| `requests` | Material requests | Status flow: pending → approved → for delivery → delivered. Also: rejected, for_pull_out. |
| `requests_archive` | Archived requests | Cloud Functions only (write). Admin read. Requests >30 days old. |
| `locations` | Warehouses, jobsites, suppliers, system | `type`: warehouse/jobsite/supplier/system |
| `categories` | Item categories with optional parent | `parentId` for subcategory |
| `uoms` | Units of measure | `baseUomId` + `conversionFactor` for conversion UOMs |
| `tags` | Item tags | Simple name + isActive |
| `assets` | Serialized/tracked tools | Doc ID = serialNumber or propertyNumber |
| `boq` | Bill of Quantities per jobsite | `jobsiteId`, `itemId`, `targetQuantity`, `currentQuantity` |
| `unplanned_stock` | Ad-hoc stock at jobsite | Worker-reported material not in system |
| `users` | User profiles | Role, approval, assignedLocationIds |
| `purchase_orders` | Purchase orders | Has subcollection `items/{itemId}` and `payments/{paymentId}` |
| `suppliers_invoices` | Supplier billing invoices | `addToInventory`, `updateLatestPrice` flags |
| `price_history` | Price history per item/variant | `variantKey: null` for base items; `normalizeVariant(variant)` for variants |
| `supplier_pricing` | Per-supplier pricing records | Created on bulk-receive |
| `po_templates` | PO document layout/signatories | Single doc `default` |
| `system` | System config | Single doc `config`: maintenanceMode, autoApproveNewUsers |
| `counters` | Auto-increment counters | `dr_number`, `po_number`, etc. |
| `rbac_config` | Role permission configs | Cloud Functions write only. Admin read. |
| `rbac_audit` | RBAC change log | Cloud Functions write only. Admin read. |
| `audit_logs` | General audit log | Admin create + read. No update/delete. |
| `activeOperations` | In-flight bulk operation locks | Created by `startOperation`, deleted by `endOperation` |

**Transactional collections** (writes via `runTransaction`):
`inventory`, `items` (totalQuantity), `transactions`, `purchase_orders` (items/status),
`boq` (currentQuantity), `price_history`, `assets`

**Pre-transaction cleanup** (writeBatch outside transaction, before `runTransaction`):
`price_history` docs deleted in `updateSuppliersInvoice` before re-creating inside the transaction.

---

## 4. Code Standards — MUST FOLLOW

### No browser dialogs
```ts
// NEVER
confirm('Are you sure?')
alert('Error!')

// ALWAYS — inline React state
const [confirmId, setConfirmId] = useState<string | null>(null);
// Show Yes/No buttons when confirmId === item.id
```

### No hardcoded credentials
```ts
// NEVER
if (email === 'admin@company.com')

// ALWAYS
const admins = import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS?.split(',') || [];
```

### Always use cleanData before Firestore writes
```ts
await setDoc(ref, cleanData({ ...data, updatedAt: serverTimestamp() }));
await updateDoc(ref, cleanData({ field: value, updatedAt: serverTimestamp() }));
```

### getInventoryRef and sortVariant — module-level, never duplicated
Both live at the top of `inventoryService.ts`. Reference them directly; never write local copies.

### All Firestore writes inside runTransaction when atomicity is needed
Read-all-first, then write. Queries are not allowed inside `runTransaction`.
Pre-fetch query results (BOQ IDs, UOM maps) before calling `runTransaction`.

### endOperation always in finally
```ts
const opId = await startOperation(...);
try {
  // bulk work
} finally {
  await endOperation(opId);
}
```

### Error handling pattern
```ts
} catch (error) {
  console.error('Descriptive message:', error);
  handleFirestoreError(error, OperationType.WRITE, 'collection/path');
}
// handleFirestoreError throws a human-readable Error — let it propagate to the UI
```

### Loading state pattern
```ts
const [isSubmitting, setIsSubmitting] = useState(false);
// button: disabled={isSubmitting || !isOnline}
setIsSubmitting(true);
try { ... } finally { setIsSubmitting(false); }
```

### Offline guard on all write buttons
```tsx
const { isOnline } = useAuth();
<button
  disabled={isSubmitting || !isOnline}
  title={!isOnline ? 'You are offline' : undefined}
>
```

### Unsaved changes guard (full-page forms)

Use `useUnsavedGuard` + `UnsavedChangesModal` on any full-page form where losing data would be disruptive:

```tsx
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { UnsavedChangesModal } from '../common/UnsavedChangesModal';

const { isBlocked, confirmLeave, cancelLeave } = useUnsavedGuard(isDirty);

// Combined handler for back-button + route-blocker cases:
<UnsavedChangesModal
  isOpen={showBackConfirm || isBlocked}
  onStay={() => { setShowBackConfirm(false); if (isBlocked) cancelLeave(); }}
  onLeave={() => { setShowBackConfirm(false); if (isBlocked) confirmLeave(); else exitForm(); }}
/>
```

### Dirty tracking pattern (forms with many state fields)

Use a `useRef` initial-mount guard + `useEffect` watcher. Reset dirty on save or cancel via the parent's `onDirtyChange` prop.

```tsx
interface MyFormProps {
  onDirtyChange?: (dirty: boolean) => void;
  onComplete: () => void;
}

// Inside the form:
const _dirtyMountRef = useRef(true);
useEffect(() => {
  if (_dirtyMountRef.current) { _dirtyMountRef.current = false; return; }
  onDirtyChange?.(true);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [field1, field2, field3, arrayField]);

// In the parent (e.g., a view that hosts the form):
const [isFormDirty, setIsFormDirty] = useState(false);
<MyForm onDirtyChange={setIsFormDirty} onComplete={() => { setIsFormDirty(false); closeForm(); }} />
```

For modal-hosted forms (`ItemForm` in `Items.tsx`), guard the modal `onClose` with a `pendingCloseAction` pattern:
```tsx
const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);
// Modal onClose:
() => {
  if (isItemFormDirty) setPendingCloseAction(() => () => { setIsAddModalOpen(false); setIsItemFormDirty(false); });
  else setIsAddModalOpen(false);
}
```

### Vite env vars — not process.env
```ts
import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS  // correct
import.meta.env.DEV                           // correct (not process.env.NODE_ENV)
process.env.VITE_*                            // WRONG
```

### Import rules
- All imports at the top of file — never mid-file
- Named exports for all components
- `cn()` from `src/lib/utils` for conditional Tailwind classes

### No debug logs
Only `console.error` for real errors. Never `console.log` in production code.

---

## 5. Inventory Doc ID System

`getInventoryRef` builds a deterministic Firestore doc ID:

```
{itemId}_{locationId}
  [+ _{encodedSortedVariantJSON}]   if variant has keys
  [+ _SPEC-{encodedCustomSpec}]     if customSpec present
  [+ _SN-{encodedSerialNumber}]     if serialNumber present
  [+ _PN-{encodedPropertyNumber}]   if propertyNumber present
```

Encoding: `encodeURIComponent(...).replace(/%/g, '_').replace(/\./g, '-')`
Max length: 1000 chars (truncated).

**Fields that ARE part of the doc ID** (change = orphan old doc, create new):
- `itemId`
- `locationId`
- `variant` (keys and values, sorted)
- `customSpec`
- `serialNumber`
- `propertyNumber`

**Fields that are NOT part of the doc ID** (safe to change):
- `uomId`, `categoryId`, `name`, `description`, `tags`, `latestPrice`
- `averageCost`, `unitPrice`, `assignedJobsiteId`

**Why this matters:**
- Renaming a variant attribute name (e.g., "Color" → "Colour") creates a new doc ID — old inventory is orphaned (not deleted, just unreachable via new transactions).
- Adding/removing required variant keys to an item that already has inventory has the same problem.
- Always warn the user before allowing edits that change doc ID fields when stock exists.

---

## 6. Known Dangerous Operations

### Renaming variant attribute names
Old inventory docs become unreachable. New transactions can't find the stock.
**Guard:** Hard blocked in `ItemForm` submit handler — save is rejected with an error message
if any inventory exists for the item under the old attribute name.

### Removing variant attributes
Same orphan problem. Inventory docs keyed on removed attributes become invisible.
**Guard:** Hard blocked in `ItemForm` submit handler when existing variant inventory exists.

### Removing variant values with existing inventory
Strands the stock that was recorded against the removed value.
**Guard:** Amber inline warning + acknowledgement checkbox required before save.

### Adding a new variant attribute to an item that already has variant inventory
Existing inventory docs (keyed without the new attribute) become unreachable.
**Guard:** Amber inline warning + acknowledgement checkbox required before save.

### Changing base UOM with existing stock
Quantity numbers stored in inventory are in base UOM. Changing the base UOM makes all stored
quantities meaningless (e.g., "5 boxes" interpreted as "5 pieces").
**Guard:** Hard blocked in `ItemForm` submit handler — save is rejected if any inventory exists
and `uomId` is changing.

### Removing a UOM conversion used in open purchase orders
Open POs store the `uomId` — removing the conversion means the receive step can't calculate
the correct base quantity.
**Guard:** Amber inline warning + acknowledgement checkbox required before save.

### Turning on requireVariant with existing non-variant inventory
Old docs have no variant key — they won't match new transactions that require a variant selection.
**Guard:** Amber inline warning + acknowledgement checkbox required before save.

### Turning on requireCustomSpec with existing inventory
Old docs have no `customSpec` in their ID — stock becomes split across "has spec" and "no spec" docs.
**Guard:** Amber inline warning + acknowledgement checkbox required before save.

### updateSuppliersInvoice — pre-transaction deletion
Deletes old `price_history` docs (where `sourceId == invoice.id`) in a `writeBatch` BEFORE the
`runTransaction`. If the transaction then fails, the deletions are permanent — price history is lost.
This is a known architectural vulnerability, not yet resolved.

---

## 7. Guards Already in Place

### Item Edit Form Guards (ItemForm in Forms.tsx, triggered from Admin/Items.tsx)

| # | Guard | Type |
|---|---|---|
| 1 | Base UOM change with existing inventory → blocked | Hard block |
| 2 | `requireVariant` ON with existing no-variant inventory | Warn + acknowledge |
| 3 | `requireCustomSpec` ON with existing no-spec inventory | Warn + acknowledge |
| 4 | Variant attribute name renamed with existing inventory | Hard block |
| 5 | Variant attribute removed with existing inventory | Hard block |
| 6 | Variant value removed with existing inventory | Warn + acknowledge |
| 7 | UOM conversion removed when used in open POs | Warn + acknowledge |
| 8 | New variant attribute added with existing variant inventory | Warn + acknowledge |

### Business Rule Guards

| # | Guard | Type |
|---|---|---|
| 9 | Cannot receive more than PO ordered quantity | Hard block |
| 10 | Cannot transfer more stock than available at source | Hard block |
| 11 | Cannot delete PO that has been received | Hard block |
| 12 | Cannot over-pick beyond available source stock | Hard block |
| 13 | Supplier invoice deletion inconsistency detected | Warn + proceed anyway |
| 14 | Duplicate supplier invoice (same bill number + supplier) | Hard block |
| 15 | Duplicate request detection | Warn + submit anyway |
| 16 | Zero qty items silently skipped on bulk receive | Auto-correct |
| 17 | PO linked to invoice — edit triggers acknowledgement | Warn + acknowledge |
| 18 | Over-delivery on picking beyond request quantity | Warn + proceed anyway |

### UI / Form Guards

| # | Guard | Type |
|---|---|---|
| 19 | All write buttons disabled when offline (`!isOnline`) | Hard block |
| 20 | Human-readable Firestore error messages via `handleFirestoreError` | UX fix |
| 21 | Required variant validation on request edit | Hard block |
| 22 | Default pullout quantity = 0 (not pre-filled) | UX fix |
| 23 | `requireVariant` warning acknowledgement in item form | Warn + acknowledge |
| 24 | PO marked Received with some items not yet received | Warn only |
| 25 | Unsaved changes guard on PurchaseOrderForm, SuppliersInvoiceView, ItemForm | Modal confirm |

### Firestore rules (summary)
- Items: non-admin can only update `latestPrice`, `latestPriceDate`, `variantConfigs`, `totalQuantity` (plus timestamp fields).
- Inventory: non-admin cannot change `unitPrice`, `lastEditedBy`, `lastEditedAt`, `editNotes`.
- Transactions: `data.userId == request.auth.uid` enforced in rule.
- Requests: owner can only edit `pending` requests; can only change item/variant/qty/uom/note fields.
- Users: owners cannot change their own role, approval, activity, or assignedLocations.
- Engineers can only assign workers to locations they themselves are assigned to.
- `requests_archive`, `rbac_config`, `rbac_audit`: Cloud Functions write only.

### Service-layer guards (inventoryService.ts)
- `deleteItem`: blocked if item has stock, transactions, or assets.
- `recordTransaction`: throws if source inventory is insufficient.
- `deleteTransaction`: throws if destination doesn't have enough stock to revert.
- Admin-only routes: guarded by `<ProtectedRoute requireAdmin>` in `App.tsx`.

---

## 8. Roles & Permissions

### Role hierarchy (ascending)
`worker` < `engineer` < `warehouseman` < `manager` < `admin`

Note: `engineer` and `warehouseman` are parallel (both report to manager).
In Firestore rules, `isEngineer()` includes manager+admin; `isWarehouseman()` includes manager+admin.

### What each role can do

| Role | Create requests | Approve requests | Pick/Deliver | Manage items | Manage users | POs/Invoices |
|---|---|---|---|---|---|---|
| worker | Yes (own jobsite) | No | Receive only | No | No | No |
| engineer | Yes | Yes | Yes | No | Assign workers | No |
| warehouseman | Yes | No | Yes (pick+deliver) | No | No | No |
| manager | Yes | Yes | Yes | Read only | Read only | Read only |
| admin | Yes | Yes | Yes | Full CRUD | Full CRUD | Full CRUD |

### Custom claims
Set by Cloud Function `syncUserClaims` (triggers on `users/{userId}` write):
```js
{ role: string, isApproved: boolean, assignedLocationIds: string[] }
```
Users must **sign out and back in** for new claims to take effect (or trigger `getIdToken(true)` in App.tsx).
App.tsx detects claim changes via profile fingerprint and calls `user.getIdToken(true)` automatically.

### Key permission patterns in Firestore rules
```
isAdmin()     → request.auth.token.get('role', '') == 'admin'
isApproved()  → isAdmin() || token.isApproved == true
isAssignedLocation(locationId) → uses token.assignedLocationIds[] (NOT Firestore get())
```
**NEVER use `get()` or `exists()` for role checks.** Only `get()` allowed: checking `locations/{id}.type == 'system'`.

### Collection-specific rules (notable)
- `activeOperations`: approved users can create/delete their own docs; admin can read all.
- `price_history`: approved users can read and create; admin/manager/warehouseman can delete.

---

## 9. UOM Conversion System

### Concepts
- Every item has a **base UOM** (`item.uomId`). All inventory quantities stored in base UOM.
- **Conversion UOMs** are defined on the item via `uomConversions: [{ uomId, factor }]`.
- `conversionFactor` = number of base units per 1 conversion unit.
  - e.g., `factor: 50` means 1 box = 50 pieces (where piece is the base UOM).
- When a transaction uses a non-base UOM: `baseQuantity = quantity * conversionFactor`.

### In transactions
```ts
// Always stored in the transaction doc:
uomId: string;          // UOM the user selected
conversionFactor: number; // 1 if base UOM, >1 if conversion UOM
baseQuantity: number;   // quantity * conversionFactor — the actual stock change
```
Inventory and `item.totalQuantity` are always updated by `baseQuantity`.

### `getConvFactor(itemSnap, uomId, uomList)`
Defined in `suppliersInvoiceService.ts`. Resolves a `uomId` (which may be stored as either a
Firestore doc ID or as the UOM symbol) to the correct conversion factor.
Returns `1` if the UOM matches the item's base UOM or if no conversion is found.

### UOM ID resolution
UOMs can be stored as doc IDs or symbols in legacy data. `getConvFactor` and the
`uomMap` in `recordTransaction` both handle this by building a map keyed on both
`symbol.toLowerCase()` and `doc.id`.

---

## 10. Common Patterns

### Add a new form field end-to-end

1. Add field to the TypeScript interface in `src/types.ts`.
2. Add field to the Firestore rule validator in `firestore.rules` (both `hasOnlyAllowedFields` and optional/required check).
3. Add input to the form component in `Forms.tsx` or the relevant view.
4. Pass the value through `cleanData()` before writing to Firestore.
5. If the field affects inventory doc ID → update `getInventoryRef` signature AND all callers.
6. If the field is filterable in subscriptions → update the relevant `subscribe*` function.

### Add a new Firestore collection

1. Add TypeScript interface to `src/types.ts`.
2. Add collection rules to `firestore.rules` (no global wildcard — explicit match per collection).
3. Add subscribe function to `inventoryService.ts` following the existing patterns.
4. Add to `DataContextType` in `App.tsx` if it should be globally available.
5. Add to `DataProvider` useEffect subscription list with `safeSubscribe`.

### Add a new role permission

1. Update the RBAC config via Admin → RBAC dashboard (runtime, not code).
2. For Firestore rule changes: edit `firestore.rules` using only custom claims.
3. Never add `get()` calls for role checks — only token claims.

### Error handling pattern (component)
```tsx
const [error, setError] = useState<string | null>(null);

const handleAction = async () => {
  setError(null);
  try {
    await someService.doThing();
  } catch (err: any) {
    setError(err.message || 'Operation failed');
  }
};

// In JSX:
{error && (
  <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl text-sm text-red-700">
    <span>{error}</span>
    <button onClick={() => setError(null)}><X size={16} /></button>
  </div>
)}
```

### Loading state pattern (component)
```tsx
const [isSubmitting, setIsSubmitting] = useState(false);
const { isOnline } = useAuth();

const handleSubmit = async () => {
  setIsSubmitting(true);
  try {
    await service.doThing();
  } catch (err: any) {
    setError(err.message || 'Failed');
  } finally {
    setIsSubmitting(false);
  }
};

// Button:
<button
  onClick={handleSubmit}
  disabled={isSubmitting || !isOnline}
  title={!isOnline ? 'You are offline' : undefined}
  className={cn("...", (isSubmitting || !isOnline) && "opacity-50 cursor-not-allowed")}
>
  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
  {isSubmitting ? 'Saving...' : 'Save'}
</button>
```

---

## 11. Cloud Functions

Located in `functions/src/index.ts` (and imported modules).

| Function | Trigger | What it does |
|---|---|---|
| `syncUserClaims` | `onDocumentWritten('users/{userId}')` | Syncs `role`, `isApproved`, `assignedLocationIds` to Firebase custom claims |
| `forceSignOutAllUsers` | `onCall` (admin only) | Revokes all refresh tokens via Firebase Admin SDK + writes `forceSignOutAt` to `system/config`. `AuthProvider` listens for this and calls `signOut(auth)` for all connected clients. `forceSignOutBy` field prevents the calling admin from signing themselves out. |
| `updateRolePermissions` | `onCall` (admin only) | Updates `rbac_config` (from `rbacManager.ts`) |
| `createRole` | `onCall` (admin only) | Creates new RBAC role |
| `deleteRole` | `onCall` (admin only) | Deletes RBAC role |
| `archiveOldRequests` | Scheduled (every 24h) | Moves requests >30 days old to `requests_archive` |
| `manualArchiveRequests` | `onCall` (admin only) | Same as above, triggered manually |

---

## 12. Cost/Price Tracking Architecture

- `item.latestPrice` / `item.latestPriceDate` — most recent price paid (on item doc, NOT weighted average).
- `variantConfig.latestPrice` / `variantConfig.latestPriceDate` — per-variant equivalent.
- `inventory.averageCost` — location-level weighted average cost (kept for jobsite cost tracking).
- `price_history` collection — one doc per price event: `{ itemId, variantKey, variant, date, price, source, sourceId, sourceRef }`.
  - `variantKey: null` for base items; `normalizeVariant(variant)` for variant items.
  - `source`: `'po_receive'` | `'invoice'` | `'manual'`
- Price history is written inside `runTransaction` for PO receives and invoice creates.
- `updateSuppliersInvoice` deletes old price_history (writeBatch) then re-creates inside transaction.

---

## 13. Deployment

```bash
npm run build && firebase deploy --only hosting
```

Vite builds to `dist/`. Firebase Hosting serves it.

**Deploy Cloud Functions only:**
```bash
firebase deploy --only functions
```

**Deploy Firestore rules only:**
```bash
firebase deploy --only firestore:rules
```

**Deploy all:**
```bash
firebase deploy
```

Build warnings about chunk size are pre-existing — not new issues. The app uses lazy loading
(`React.lazy`) for all route-level components to mitigate.

**Run the database integrity check:**
```bash
cd scripts
npx tsx check-integrity.ts          # dry-run: reports issues, no writes
npx tsx check-integrity.ts --fix    # applies auto-fixes (latestPrice drift, orphaned docs)
```

**Service account key setup** (required for integrity script):
1. Firebase Console → Project Settings → Service Accounts → Generate new private key
2. Save as `scripts/serviceAccountKey.json` (already in `scripts/.gitignore` — never commit this)
3. The script auto-detects it; no env vars needed when the file is present.
