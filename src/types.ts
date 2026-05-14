import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'worker' | 'engineer' | 'warehouseman';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  isApproved?: boolean;
  isActive: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  photoURL?: string;
  skills?: string[];
  assignedLocationIds?: string[];
  createdAt?: Timestamp;
  lastLoginAt?: Timestamp | null;
  lastLogoutAt?: Timestamp | null;
}

export interface UnplannedStock {
  id: string;
  itemId: string;
  jobsiteId: string;
  quantity: number;
  uomId: string;
  addedBy: string;
  timestamp: Timestamp;
}

export interface VariantAttribute {
  name: string;
  values: string[];
}

export interface UomConversion {
  uomId: string;
  factor: number; // multiplier to get base UOM quantity (e.g., 50 for a box of 50 pieces)
}

export interface VariantConfig {
  variant: Record<string, string>;
  reorderLevel?: number;
  averageCost?: number;
}

export interface ItemComponent {
  itemId: string;
  quantity: number; // Quantity of this component per 1 unit of the parent item
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  subcategoryId?: string;
  uomId: string; // Base UOM
  uomConversions?: UomConversion[];
  tags?: string[];
  isTool: boolean;
  isActive: boolean;
  averageCost?: number; // Default average cost per base unit
  averageCostPerVariant?: Record<string, number>; // Weighted avg cost per variant key
  totalQuantity?: number; // Total quantity across all locations
  reorderLevel?: number; // Default reorder level in base UOM
  preferredSupplierId?: string; // Optional preferred supplier
  variantAttributes?: VariantAttribute[]; // e.g., [{ name: "Color", values: ["Red", "Blue"] }]
  requireVariant?: boolean; // If true, variant selection is mandatory for transactions
  variantConfigs?: VariantConfig[]; // Variant-specific reorder levels and costs
  components?: ItemComponent[]; // If present, this is a composite item (kit)
  requireCustomSpec?: boolean; // If true, custom specification is mandatory
  customSpecLabel?: string; // Label for the custom spec field (e.g., "Size", "Length")
  createdAt: Timestamp;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  isActive: boolean;
}

export interface Location {
  id: string;
  name: string;
  longName?: string;
  type: 'warehouse' | 'jobsite' | 'supplier' | 'system';
  parentId?: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  terms?: string;
  isActive: boolean;
}

export interface Asset {
  id: string; // Serial Number
  propertyNumber?: string;
  itemId: string;
  variant?: Record<string, string>;
  locationId: string;
  notes?: string;
  updatedAt: Timestamp;
}

export interface Inventory {
  id?: string;
  itemId: string;
  locationId: string;
  variant?: Record<string, string>; // e.g., { "Color": "Red", "Size": "L" }
  customSpec?: string;
  serialNumber?: string;
  propertyNumber?: string;
  quantity: number;
  uomId?: string;
  unitPrice?: number;
  lastEditedBy?: string;
  lastEditedAt?: Timestamp;
  editNotes?: string;
  assignedJobsiteId?: string;
  assignedJobsiteName?: string;
}

export interface Transaction {
  id: string;
  itemId: string;
  variant?: Record<string, string>;
  customSpec?: string;
  serialNumber?: string;
  propertyNumber?: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number; // Quantity in the UOM used
  uomId: string; // UOM used for this transaction
  conversionFactor: number; // Factor used to convert to base UOM
  baseQuantity: number; // Quantity in base UOM (quantity * conversionFactor)
  type: 'delivery' | 'usage' | 'return' | 'adjustment' | 'pick' | 'consumption' | 'supplier_invoice';
  floor?: string;
  room?: string;
  totalPrice?: number; // Total price for this transaction
  unitPrice?: number; // Unit price (totalPrice / quantity) in the transaction UOM
  timestamp: Timestamp;
  userId: string;
  userName?: string;
  notes?: string;
  batchId?: string; // For grouped deliveries
  requestIds?: string[]; // Linked requests
  poNumber?: string;
  poId?: string;
  supplierInvoice?: string;
  supplierDR?: string;
  invoiceId?: string;
}

export interface Request {
  id: string;
  itemId: string;
  variant?: Record<string, string>;
  customSpec?: string;
  requestedQty: number;
  approvedQty?: number;
  deliveredQty?: number;
  uomId: string;
  jobsiteId: string;
  sourceLocationId?: string;
  status: 'pending' | 'approved' | 'for delivery' | 'delivered' | 'rejected' | 'for_pull_out';
  requestorId: string;
  requestorName?: string;
  approverId?: string;
  approverName?: string;
  warehousemanId?: string;
  warehousemanName?: string;
  workerNote?: string;
  engineerNote?: string;
  timestamp: Timestamp;
  approvedAt?: Timestamp;
  deliveredAt?: Timestamp;
  receiverId?: string;
  receiverName?: string;
  backorderOf?: string;
  batchId?: string;
  serialNumbers?: string[];
  linkedConsumptionId?: string;
  adjustmentHistory?: {
    oldQty: number;
    newQty: number;
    timestamp: string;
    userId: string;
  }[];
}

export interface UOM {
  id: string;
  name: string;
  symbol: string;
  baseUomId?: string;
  conversionFactor?: number;
  isActive: boolean;
}

export interface Tag {
  id: string;
  name: string;
  isActive: boolean;
}

export interface BOQItem {
  id: string;
  jobsiteId: string;
  itemId: string;
  variant?: Record<string, string>;
  customSpec?: string;
  targetQuantity?: number;
  currentQuantity: number;
  unitPrice?: number;
  isExtra: boolean;
  addedBy: string;
  uomId?: string;
  note?: string;
  timestamp: Timestamp;
}

export interface SystemConfig {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  autoApproveNewUsers?: boolean;
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface PurchaseOrderItem {
  id?: string;
  itemId: string;
  variant?: Record<string, string>;
  quantity: number;
  uomId: string;
  srp?: number; // Added SRP field
  discount?: number; // Added discount field
  discountType?: 'amount' | 'percentage'; // Added discount type
  unitPrice: number;
  totalPrice: number;
  receivedQuantity: number;
  note?: string;
  conversionFactor?: number;
  description?: string; // Snapshot for printing
  uom?: string; // Snapshot for printing
  sortOrder?: number;
  assignedJobsiteId?: string;
  assignedJobsiteName?: string;
}

export interface POTemplate {
  id: string;
  companyName: string;
  companyAddress: string;
  companyPhones: string;
  companyEmail: string;
  companyTIN: string;
  signatories: {
    preparedBy: string;
    requestedBy: string;
    approvedBy1: string;
    approvedBy1Role: string;
    approvedBy2: string;
    approvedBy2Role: string;
  };
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  supplierLongName?: string;
  supplierAddress?: string;
  requestedBy?: string;
  attention?: string;
  contactNo?: string;
  project?: string;
  terms?: string;
  deliverTo?: string;
  status: 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
  paymentStatus?: 'unpaid' | 'processing' | 'prepared' | 'paid' | 'partially_paid' | 'fully_paid';
  amountPaid?: number;
  items?: PurchaseOrderItem[];
  discount?: number; // Added PO-level discount
  discountType?: 'amount' | 'percentage'; // Added PO-level discount type
  discountAmount?: number; // Calculated numeric discount
  vatEnabled?: boolean; // true = VAT-inclusive prices (default); false = DR price, no VAT
  vatAmount?: number; // Extracted VAT = totalAmount / 1.12 * 0.12
  totalAmount: number;
  notes?: string;
  generalNotes?: string;
  date: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface SupplierPricingRecord {
  id: string;
  supplierId: string;
  supplierName: string;
  itemId: string;
  variant?: Record<string, string> | null;
  uomId: string;
  unitPrice: number;
  quantityReceived: number;
  baseQuantity: number;
  totalCost: number;
  receivedDate: Timestamp;
  conversionFactor: number;
  poId: string;
  poNumber: string;
}

export interface SuppliersInvoiceItem {
  itemId: string;
  itemName: string;
  variant?: Record<string, string>;
  quantity: number;
  unitPrice: number;
  uomId: string;
  uomSymbol: string;
  totalPrice: number;
}

export interface LinkedPO {
  poId: string;
  poNumber: string;
  amount: number;
}

export interface InvoicePayment {
  method: 'cash' | 'check' | 'bank_transfer' | 'credit_card';
  amount: number;
  netAmount: number;
  deductions: {
    tax: number;
    other: Array<{ type: string; amount: number }>;
  };
  paymentDate: Timestamp;
  chequeNumber?: string;
  chequeDate?: Timestamp;
  bank?: string;
  depositReference?: string;
  depositDate?: Timestamp;
  status: 'recorded';
}

export interface SuppliersInvoice {
  id: string;
  supplierName: string;
  supplierId?: string;
  billNumber: string;
  purchaseDate: Timestamp;
  items: SuppliersInvoiceItem[];
  locationId: string;
  locationName: string;
  totalAmount: number;
  notes?: string;
  linkedPOs?: LinkedPO[];
  payment?: InvoicePayment;
  invoiceStatus?: 'for_processing' | 'with_cheque' | 'paid';
  createdBy: string;
  createdAt: Timestamp;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

export interface RBACRoleConfig {
  permissions: string[];
  description: string;
  lastUpdatedBy?: string;
  lastUpdatedAt?: Timestamp;
}

export interface RBACauditEntry {
  id: string;
  changeType: 'added_role' | 'updated_permissions' | 'deleted_role';
  roleId: string;
  changedBy: string;
  changedByName?: string;
  changedAt: Timestamp;
  oldPermissions: string[];
  newPermissions: string[];
}

export interface POPayment {
  id: string;
  poId: string;
  date: Timestamp;
  amount: number; // Net amount
  grossAmount: number;
  cvNumber: string;
  chequeNumber?: string;
  status: 'processing' | 'prepared' | 'collected' | 'bank_deposit';
  deductions: {
    type: string;
    amount: number;
  }[];
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
  lastEditedBy?: string;
  lastEditedAt?: Timestamp;
}
