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
  type: 'delivery' | 'usage' | 'return' | 'adjustment' | 'pick';
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
  status: 'pending' | 'approved' | 'for delivery' | 'delivered' | 'rejected' | 'cancelled';
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
  backorderOf?: string; // Original request ID if this is a backorder
  batchId?: string; // Grouped delivery ID
  serialNumbers?: string[]; // Selected serial numbers for tools
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
  timestamp: Timestamp;
}

export interface SystemConfig {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
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
  description?: string; // Snapshot for printing
  uom?: string; // Snapshot for printing
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
  paymentStatus?: 'unpaid' | 'processing' | 'prepared' | 'paid';
  items?: PurchaseOrderItem[];
  discount?: number; // Added PO-level discount
  discountType?: 'amount' | 'percentage'; // Added PO-level discount type
  discountAmount?: number; // Calculated numeric discount
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

export interface POPayment {
  id: string;
  poId: string;
  date: Timestamp;
  amount: number; // Net amount
  grossAmount: number;
  cvNumber: string;
  chequeNumber?: string;
  status: 'processing' | 'prepared' | 'collected';
  deductions: {
    type: string;
    amount: number;
  }[];
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
}
