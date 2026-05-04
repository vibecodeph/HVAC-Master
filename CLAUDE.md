# HVAC Master — Claude Code Instructions

## Project Overview
This is a Firebase + React + TypeScript inventory management app for HVAC field professionals.
Built with Vite, Tailwind CSS, Firestore, and Firebase Auth (Google Sign-in).

## Tech Stack
- Frontend: React + TypeScript + Vite
- Styling: Tailwind CSS
- Backend: Firebase (Firestore, Auth, Cloud Functions)
- State: React Context (AuthContext, DataContext)

## CODING STANDARDS — ALWAYS FOLLOW THESE

### Security
- NEVER hardcode emails, UIDs, or any credentials in code or Firestore rules
- Admin emails must always come from environment variables (`import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS`)
- Firestore rules must NEVER have a global wildcard `match /{document=**}` block

### Firestore Rules (firestore.rules)
- Role checking must ALWAYS use Firebase Custom Claims (`request.auth.token.get('role', '')`)
- NEVER use `get()` or `exists()` for role checks
- `isAssignedLocation` uses `request.auth.token.get('assignedLocationIds', [])` — NOT Firestore `get()`
- Location type checks (`type == 'system'`) are the ONLY allowed `get()` calls in rules
- Counter writes restricted to: admin, warehouseman, engineer only
- Transaction creates restricted to: admin, warehouseman, engineer only
- System config read rule: `allow read: if isAuthenticated() || configId == 'config'`
- No global wildcard rule allowed

### Firestore Subscriptions (src/services/inventoryService.ts)
- `subscribeToItems` must filter `where('isActive', '==', true)`
- `subscribeToUOMs` must filter `where('isActive', '==', true)`
- `subscribeToCategories` must use `where('isActive', '==', true)` and `orderBy('name', 'asc')`
- `subscribeToTags` must use `where('isActive', '==', true)` and `orderBy('name', 'asc')`
- Purchase orders subscription gated to admin and manager roles only

### Code Structure (src/services/inventoryService.ts)
- `getInventoryRef` is a single module-level function — NEVER duplicate inside other functions
- `sortVariant` is a single module-level function — NEVER duplicate inside other functions
- Location documents must only be fetched ONCE inside `runTransaction`

### App.tsx
- `DataProvider` useEffect dependency array must be:
  `[user?.uid, profile?.isApproved, profile?.role, JSON.stringify(profile?.assignedLocationIds)]`
- Purchase orders collection only loaded for admin and manager roles

### UI / Components
- NEVER use `confirm()`, `alert()`, or any browser dialogs anywhere
- Always replace with React state-based inline UI (confirmation buttons, error banners)
- Example pattern for confirmation:
```tsx
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Show inline Yes/No buttons when confirmId matches item id
```
- Example pattern for errors:
```tsx
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Show dismissible red banner in JSX
```

### General Rules
- Never use `isApproved()` as the sole gate for sensitive write operations — always add role checks
- Always use the most specific role check needed for each operation
- No copy-pasted functions — extract shared logic to module-level helpers
- BOQ items do NOT require variants — never validate variant presence for BOQ imports

## Firebase Custom Claims
- Roles and approval status are stored as Firebase Custom Claims
- The `syncUserClaims` Cloud Function automatically syncs claims when a user document is updated
- After updating a user's role in Firestore, the function sets `role` and `isApproved` as claims
- Users must sign out and back in for new claims to take effect

## Project Structure
- `src/App.tsx` — Auth + Data providers, routing
- `src/firebase.ts` — Firebase initialization
- `src/types.ts` — TypeScript interfaces
- `src/services/inventoryService.ts` — All Firestore operations
- `src/services/csvService.ts` — CSV import/export
- `src/components/views/` — Page components
- `src/components/views/Admin/` — Admin-only pages
- `src/components/common/` — Shared UI components
- `firestore.rules` — Firestore security rules
- `functions/src/index.ts` — Firebase Cloud Functions