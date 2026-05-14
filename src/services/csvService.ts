import Papa from 'papaparse';
import { Item, Category, UOM, BOQItem, Tag, PurchaseOrder, PurchaseOrderItem, Location, POPayment } from '../types';
import { addItem, updateItem, addPurchaseOrder, updatePurchaseOrder, addLocation, updateLocation, addPOPayment } from './inventoryService';
import { Timestamp } from 'firebase/firestore';
import { format, parse, isValid } from 'date-fns';

export interface CSVItemRow {
  ID?: string;
  Name: string;
  Description?: string;
  Category?: string;
  Subcategory?: string;
  UOM: string;
  'Is Tool': string;
  'Average Cost'?: string;
  'Reorder Level'?: string;
  Tags?: string;
  'Is Active': string;
  'Require Variant'?: string;
  'Variant Attributes'?: string;
  'Variant Configurations'?: string;
  'Require Custom Spec'?: string;
  'Custom Spec Label'?: string;
  'Components'?: string;
}

export interface CSVBOQRow {
  'Item Name': string;
  'Variant'?: string;
  'Custom Spec'?: string;
  'Target Quantity': string;
  'Unit Price'?: string;
  'UOM'?: string;
  'Is Extra': string;
  'Note'?: string;
}

export interface CSVPOItemRow {
  'PO Number': string;
  'Date': string;
  'Supplier': string;
  'Status': string;
  'Payment Status'?: string;
  'Amount Paid'?: string;
  'Total Amount'?: string;
  'Notes'?: string;
  'Item Name': string;
  'Variant'?: string;
  'Quantity': string;
  'UOM': string;
  'Unit Price': string;
  'Received Qty'?: string;
  'Item Note'?: string;
  'Payments'?: string;
}

export const exportPurchaseOrdersToCSV = (
  purchaseOrders: PurchaseOrder[],
  locations: Location[],
  items: Item[],
  uoms: UOM[],
  paymentsMap: Map<string, POPayment[]> = new Map()
) => {
  const data: CSVPOItemRow[] = [];

  purchaseOrders.forEach(po => {
    const supplier = locations.find(l => l.id === po.supplierId);
    let dateStr = '';
    if (po.date) {
      try {
        const d = po.date.toDate();
        dateStr = format(d, 'yyyy-MM-dd');
      } catch (e) {
        console.error('Error formatting date:', e);
      }
    }

    // Encode payments as a compact string on the first item row only
    const poPayments = paymentsMap.get(po.id) || [];
    const paymentsStr = poPayments.map(p => {
      let pDateStr = '';
      try { pDateStr = p.date ? format(p.date.toDate(), 'yyyy-MM-dd') : ''; } catch {}
      const deductionsStr = (p.deductions || []).map(d => `${d.type}:${d.amount}`).join(',');
      return [
        pDateStr,
        p.cvNumber || '',
        p.grossAmount ?? 0,
        p.amount ?? 0,
        p.status || '',
        p.chequeNumber || '',
        p.notes || '',
        deductionsStr,
      ].join('|');
    }).join('; ');

    po.items.forEach((poItem, itemIndex) => {
      const item = items.find(i => i.id === poItem.itemId);
      const uom = uoms.find(u => u.id === poItem.uomId);
      const variantStr = (poItem.variant && Object.keys(poItem.variant).length > 0) ? `[${Object.entries(poItem.variant).map(([k, v]) => `${k}:${v}`).join(', ')}]` : '';

      data.push({
        'PO Number': po.poNumber,
        'Date': dateStr,
        'Supplier': supplier?.name || po.supplierId,
        'Status': po.status,
        'Payment Status': po.paymentStatus || 'unpaid',
        'Amount Paid': (po.amountPaid || 0).toString(),
        'Total Amount': po.totalAmount.toString(),
        'Notes': po.notes || '',
        'Item Name': item?.name || poItem.itemId,
        'Variant': variantStr,
        'Quantity': poItem.quantity.toString(),
        'UOM': uom?.symbol || poItem.uomId,
        'Unit Price': poItem.unitPrice.toString(),
        'Received Qty': (poItem.receivedQuantity || 0).toString(),
        'Item Note': poItem.note || '',
        'Payments': itemIndex === 0 ? paymentsStr : '',
      });
    });
  });

  const csv = Papa.unparse(data);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `purchase_orders_export_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const importPurchaseOrdersFromCSV = async (
  file: File,
  items: Item[],
  locations: Location[],
  uoms: UOM[],
  onProgress?: (current: number, total: number) => void
) => {
  return new Promise<{ success: number; errors: string[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: async (results) => {
        const rows = results.data as CSVPOItemRow[];
        let successCount = 0;
        const errors: string[] = [];

        // Group rows by PO Number
        const poGroups = rows.reduce((acc, row) => {
          const poNumber = row['PO Number']?.trim();
          if (!poNumber) return acc;
          if (!acc[poNumber]) acc[poNumber] = [];
          acc[poNumber].push(row);
          return acc;
        }, {} as Record<string, CSVPOItemRow[]>);

        const poNumbers = Object.keys(poGroups);
        const itemMap = new Map<string, string>();
        items.forEach(i => itemMap.set(i.name.toLowerCase().trim(), i.id));

        const supplierMap = new Map<string, string>();
        locations.filter(l => l.type === 'supplier').forEach(l => supplierMap.set(l.name.toLowerCase().trim(), l.id));

        const uomMap = new Map<string, string>();
        uoms.forEach(u => uomMap.set(u.symbol.toLowerCase().trim(), u.id));

        for (let i = 0; i < poNumbers.length; i++) {
          const poNumber = poNumbers[i];
          const group = poGroups[poNumber];
          const firstRow = group[0];

          try {
            // 1. Resolve Supplier
            const supplierName = firstRow.Supplier?.trim().toLowerCase();
            const supplierId = supplierMap.get(supplierName) || firstRow.Supplier;
            if (!supplierId) {
              errors.push(`PO ${poNumber}: Supplier "${firstRow.Supplier}" not found.`);
              continue;
            }

            // 2. Parse Items
            const poItems: PurchaseOrderItem[] = [];
            let totalAmount = 0;

            for (const row of group) {
              const itemName = row['Item Name']?.trim().toLowerCase();
              const itemId = itemMap.get(itemName);
              if (!itemId) {
                errors.push(`PO ${poNumber}: Item "${row['Item Name']}" not found.`);
                continue;
              }

              const uomSymbol = row.UOM?.trim().toLowerCase();
              const uomId = uomMap.get(uomSymbol) || row.UOM;

              let variant: Record<string, string> | undefined = undefined;
              if (row.Variant) {
                const vMatch = row.Variant.match(/\[(.*)\]/);
                if (vMatch) {
                  variant = {};
                  vMatch[1].split(',').forEach(pair => {
                    const [k, v] = pair.split(':');
                    if (k && v) variant![k.trim()] = v.trim();
                  });
                }
              }

              const qty = parseFloat(row.Quantity) || 0;
              const price = parseFloat(row['Unit Price']) || 0;
              const subtotal = qty * price;

              poItems.push({
                itemId,
                variant,
                quantity: qty,
                uomId: uomId || '',
                unitPrice: price,
                totalPrice: subtotal,
                receivedQuantity: parseFloat(row['Received Qty'] || '0') || 0,
                note: row['Item Note'] || ''
              });

              totalAmount += subtotal;
            }

            if (poItems.length === 0) continue;

            let poDate = Timestamp.now();
            if (firstRow.Date) {
              const dateStr = firstRow.Date.trim();
              // Try parsing as yyyy-MM-dd first (our export format)
              let d = parse(dateStr, 'yyyy-MM-dd', new Date());
              
              if (!isValid(d)) {
                // If not yyyy-MM-dd, fall back to native Date parsing
                // which handles common formats like MM/DD/YYYY or DD/MM/YYYY depending on browser/locale
                d = new Date(dateStr);
              }

              if (isValid(d)) {
                poDate = Timestamp.fromDate(d);
              }
            }

            const poData: any = {
              poNumber,
              supplierId,
              date: poDate,
              status: (firstRow.Status?.toLowerCase() || 'sent') as any,
              paymentStatus: (firstRow['Payment Status']?.toLowerCase() || 'unpaid') as any,
              notes: firstRow.Notes || '',
              items: poItems,
              totalAmount: parseFloat((firstRow['Total Amount'] || '').toString().replace(/,/g, '')) || totalAmount
            };

            const newPoId = await addPurchaseOrder(poData);

            // Restore payment records if present
            if (newPoId && firstRow['Payments']) {
              const paymentEntries = (firstRow['Payments'] as string).split('; ').filter(Boolean);
              for (const entry of paymentEntries) {
                const parts = entry.split('|');
                const [dateStr, cvNumber, grossAmtStr, amtStr, status, chequeNumber, notes, deductionsStr] = parts;

                let payDate = Timestamp.now();
                if (dateStr?.trim()) {
                  const d = parse(dateStr.trim(), 'yyyy-MM-dd', new Date());
                  if (isValid(d)) payDate = Timestamp.fromDate(d);
                }

                const deductions: { type: string; amount: number }[] = deductionsStr
                  ? deductionsStr.split(',').map(d => {
                      const colonIdx = d.lastIndexOf(':');
                      if (colonIdx < 1) return null;
                      return { type: d.slice(0, colonIdx).trim(), amount: parseFloat(d.slice(colonIdx + 1)) || 0 };
                    }).filter(Boolean) as { type: string; amount: number }[]
                  : [];

                const validStatuses: POPayment['status'][] = ['processing', 'prepared', 'collected', 'bank_deposit'];
                const payStatus = validStatuses.includes(status?.trim() as POPayment['status'])
                  ? (status.trim() as POPayment['status'])
                  : 'processing';

                await addPOPayment(newPoId, {
                  poId: newPoId,
                  date: payDate,
                  cvNumber: cvNumber?.trim() || '',
                  grossAmount: parseFloat(grossAmtStr) || 0,
                  amount: parseFloat(amtStr) || 0,
                  status: payStatus,
                  chequeNumber: chequeNumber?.trim() || undefined,
                  notes: notes?.trim() || undefined,
                  deductions,
                });
              }
            }

            successCount++;
            if (onProgress) onProgress(i + 1, poNumbers.length);
          } catch (err: any) {
            errors.push(`PO ${poNumber}: ${err.message}`);
          }
        }

        resolve({ success: successCount, errors });
      },
      error: (error) => reject(error)
    });
  });
};

export const exportItemsToCSV = (
  items: Item[],
  categories: Category[],
  uoms: UOM[]
) => {
  const data = items.map(item => {
    const category = categories.find(c => c.id === item.categoryId);
    const subcategory = categories.find(c => c.id === item.subcategoryId);
    const uom = uoms.find(u => u.id === item.uomId);

    return {
      ID: item.id,
      Name: item.name,
      Description: item.description || '',
      Category: category?.name || '',
      Subcategory: subcategory?.name || '',
      UOM: uom?.symbol || item.uomId,
      'Is Tool': item.isTool ? 'TRUE' : 'FALSE',
      'Average Cost': item.averageCost || 0,
      'Reorder Level': item.reorderLevel || 0,
      Tags: (item.tags || []).join(', '),
      'Is Active': item.isActive ? 'TRUE' : 'FALSE',
      'Require Variant': item.requireVariant ? 'TRUE' : 'FALSE',
      'Variant Attributes': (item.variantAttributes || []).map(attr => 
        `${attr.name}: ${attr.values.join(', ')}`
      ).join(' | '),
      'Variant Configurations': (item.variantConfigs || []).map(config => {
        const variantStr = Object.entries(config.variant).map(([k, v]) => `${k}:${v}`).join(', ');
        const dataParts = [];
        if (config.averageCost !== undefined) dataParts.push(`Cost:${config.averageCost}`);
        if (config.reorderLevel !== undefined) dataParts.push(`Reorder:${config.reorderLevel}`);
        return variantStr ? `[${variantStr}] -> ${dataParts.join(', ')}` : dataParts.join(', ');
      }).join(' | '),
      'Require Custom Spec': item.requireCustomSpec ? 'TRUE' : 'FALSE',
      'Custom Spec Label': item.customSpecLabel || '',
      'Components': (item.components || []).map(comp => {
        const compItem = items.find(i => i.id === comp.itemId);
        return `${compItem?.name || comp.itemId}: ${comp.quantity}`;
      }).join(' | ')
    };
  });

  const csv = Papa.unparse(data);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `inventory_export_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportJobsiteBOQToCSV = (
  boqItems: BOQItem[],
  items: Item[],
  uoms: UOM[],
  jobsiteName: string
) => {
  const data = boqItems.map(boq => {
    const item = items.find(i => i.id === boq.itemId);
    const uom = uoms.find(u => u.id === boq.uomId || u.id === item?.uomId || u.symbol === item?.uomId);
    const variantStr = (boq.variant && Object.keys(boq.variant).length > 0) ? `[${Object.entries(boq.variant).map(([k, v]) => `${k}:${v}`).join(', ')}]` : '';
    
    return {
      'Item Name': item?.name || 'Unknown Item',
      'Variant': variantStr,
      'Custom Spec': boq.customSpec || '',
      'Target Quantity': boq.targetQuantity || 0,
      'Unit Price': boq.unitPrice || 0,
      'UOM': uom?.symbol || boq.uomId || item?.uomId || '',
      'Is Extra': boq.isExtra ? 'TRUE' : 'FALSE',
      'Note': boq.note || ''
    };
  });

  const csv = Papa.unparse(data);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `BOQ_${jobsiteName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const importItemsFromCSV = async (
  file: File,
  categories: Category[],
  uoms: UOM[],
  tags: Tag[],
  allItems: Item[],
  onProgress?: (current: number, total: number) => void
) => {
  return new Promise<{ success: number; errors: string[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: async (results) => {
        const rows = results.data as CSVItemRow[];
        let successCount = 0;
        const errors: string[] = [];

        // Pre-cache categories, uoms, and tags for faster lookup
        const categoryMap = new Map<string, string>(); // name -> id (top-level)
        const subcategoryMap = new Map<string, string>(); // parentId:name -> id
        
        categories.forEach(c => {
          if (!c.parentId) {
            categoryMap.set(c.name.toLowerCase(), c.id);
          } else {
            subcategoryMap.set(`${c.parentId}:${c.name.toLowerCase()}`, c.id);
          }
        });

        const uomMap = new Map<string, string>(); // symbol -> id
        uoms.forEach(u => uomMap.set(u.symbol.toLowerCase(), u.id));

        const tagSet = new Set(tags.map(t => t.name.toLowerCase()));

        const itemByName = new Map<string, string>();
        allItems.forEach(item => itemByName.set(item.name.toLowerCase().trim(), item.id));
        // Also map existing items in the CSV to their name so we can try to resolve them
        // if they are updated. But new items don't have IDs yet.
        // We'll update this map as we add items.

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            if (!row.Name || !row.UOM) {
              errors.push(`Row ${i + 1}: Name and UOM are required.`);
              continue;
            }

            // 1. Resolve Category
            let categoryId = '';
            if (row.Category) {
              const catName = row.Category.trim();
              const lowerCatName = catName.toLowerCase();
              if (categoryMap.has(lowerCatName)) {
                categoryId = categoryMap.get(lowerCatName)!;
              } else {
                errors.push(`Row ${i + 1} (${row.Name}): Category "${catName}" does not exist.`);
                continue;
              }
            }

            // 2. Resolve Subcategory
            let subcategoryId = '';
            if (row.Subcategory && categoryId) {
              const subCatName = row.Subcategory.trim();
              const lowerSubCatName = subCatName.toLowerCase();
              const subKey = `${categoryId}:${lowerSubCatName}`;
              
              if (subcategoryMap.has(subKey)) {
                subcategoryId = subcategoryMap.get(subKey)!;
              } else {
                errors.push(`Row ${i + 1} (${row.Name}): Subcategory "${subCatName}" does not exist under category "${row.Category}".`);
                continue;
              }
            }

            // 3. Resolve UOM
            let uomId = '';
            const uomSymbol = row.UOM.trim();
            const lowerUomSymbol = uomSymbol.toLowerCase();
            if (uomMap.has(lowerUomSymbol)) {
              uomId = uomMap.get(lowerUomSymbol)!;
            } else {
              errors.push(`Row ${i + 1} (${row.Name}): UOM "${uomSymbol}" does not exist.`);
              continue;
            }

            // 4. Resolve Tags
            let rowTags: string[] | undefined;
            if (row.hasOwnProperty('Tags')) {
              rowTags = (row.Tags || '').split(',').map(t => t.trim()).filter(t => t);
              const invalidTags = rowTags.filter(t => !tagSet.has(t.toLowerCase()));
              if (invalidTags.length > 0) {
                errors.push(`Row ${i + 1} (${row.Name}): Tags [${invalidTags.join(', ')}] do not exist.`);
                continue;
              }
            }

            // 5. Prepare Item Data
            const itemData: any = {
              name: row.Name.trim(),
              description: row.Description?.trim() || '',
              categoryId: categoryId || null,
              subcategoryId: subcategoryId || null,
              uomId: uomId,
              isTool: row['Is Tool']?.toUpperCase() === 'TRUE',
              isActive: row['Is Active']?.toUpperCase() !== 'FALSE', // Default to true
              requireVariant: row['Require Variant']?.toUpperCase() === 'TRUE',
              requireCustomSpec: row['Require Custom Spec']?.toUpperCase() === 'TRUE',
              customSpecLabel: row['Custom Spec Label']?.trim() || '',
              averageCost: parseFloat(row['Average Cost'] || '0') || 0,
              reorderLevel: parseFloat(row['Reorder Level'] || '0') || 0,
            };

            if (rowTags !== undefined) {
              itemData.tags = rowTags;
            }

            // 5. Parse Variants
            if (row.hasOwnProperty('Variant Attributes')) {
              itemData.variantAttributes = (row['Variant Attributes'] || '').split('|').map(s => {
                const [name, valuesStr] = s.split(':');
                if (name && valuesStr) {
                  return {
                    name: name.trim(),
                    values: valuesStr.split(',').map(v => v.trim()).filter(v => v)
                  };
                }
                return null;
              }).filter(a => a);
            }

            if (row.hasOwnProperty('Variant Configurations')) {
              itemData.variantConfigs = (row['Variant Configurations'] || '').split('|').map(s => {
              const [variantStr, dataStr] = s.split('->');
              if (variantStr && dataStr) {
                const variant: Record<string, string> = {};
                const vMatch = variantStr.match(/\[(.*)\]/);
                if (vMatch) {
                  vMatch[1].split(',').forEach(pair => {
                    const [k, v] = pair.split(':');
                    if (k && v) variant[k.trim()] = v.trim();
                  });
                }

                const config: any = { variant };
                dataStr.split(',').forEach(pair => {
                  const [k, v] = pair.split(':');
                  if (k && v) {
                    const key = k.trim().toLowerCase();
                    const val = parseFloat(v.trim());
                    if (key === 'cost') config.averageCost = val;
                    if (key === 'reorder') config.reorderLevel = val;
                  }
                });
                return config;
              }
              return null;
            }).filter(c => c);
            }

            // 6. Parse Components
            if (row.hasOwnProperty('Components')) {
              itemData.components = (row.Components || '').split('|').map(s => {
                const parts = s.split(':');
                if (parts.length >= 2) {
                  const name = parts[0].trim().toLowerCase();
                  const qty = parseFloat(parts[1].trim()) || 0;
                  const itemId = itemByName.get(name);
                  if (itemId) {
                    return { itemId, quantity: qty };
                  } else {
                    // Could not resolve component - try to find it in the CSV too?
                    const csvComp = rows.find(r => r.Name?.toLowerCase().trim() === name);
                    if (csvComp && csvComp.ID) {
                      return { itemId: csvComp.ID, quantity: qty };
                    }
                    // If still not found, we'll skip this component
                    return null;
                  }
                }
                return null;
              }).filter(c => (c as any) !== null);
            }

            if (row.ID) {
              await updateItem(row.ID, itemData);
              itemByName.set(itemData.name.toLowerCase(), row.ID);
            } else {
              const newId = await addItem(itemData);
              if (newId) itemByName.set(itemData.name.toLowerCase(), newId);
            }

            successCount++;
            if (onProgress) onProgress(i + 1, rows.length);
          } catch (err: any) {
            errors.push(`Row ${i + 1} (${row.Name}): ${err.message}`);
          }
        }

        resolve({ success: successCount, errors });
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};

export interface CSVLocationRow {
  ID?: string;
  Name: string;
  'Long Name'?: string;
  Type: string;
  Address?: string;
  'Contact Person'?: string;
  'Contact Number'?: string;
  Terms?: string;
  'Is Active': string;
}

const VALID_LOCATION_TYPES = ['warehouse', 'jobsite', 'supplier'] as const;

export const exportLocationsToCSV = (
  locations: Location[],
  types?: string[],
  includeInactive = false
) => {
  const filtered = locations.filter(l => {
    if (l.type === 'system') return false;
    if (!includeInactive && !l.isActive) return false;
    if (types && types.length > 0) return types.includes(l.type);
    return true;
  });

  const data: CSVLocationRow[] = filtered.map(loc => ({
    ID: loc.id,
    Name: loc.name,
    'Long Name': loc.longName || '',
    Type: loc.type,
    Address: loc.address || '',
    'Contact Person': loc.contactPerson || '',
    'Contact Number': loc.contactNumber || '',
    Terms: loc.terms || '',
    'Is Active': loc.isActive ? 'TRUE' : 'FALSE'
  }));

  const csv = Papa.unparse(data);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `locations_export_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const importLocationsFromCSV = async (
  file: File,
  existingLocations: Location[],
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; errors: string[] }> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: async (results) => {
        const rows = results.data as CSVLocationRow[];
        let successCount = 0;
        const errors: string[] = [];

        const existingIdSet = new Set(existingLocations.map(l => l.id));

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            const name = row.Name?.trim();
            if (!name) {
              errors.push(`Row ${i + 2}: Name is required.`);
              continue;
            }

            const type = row.Type?.trim().toLowerCase() as typeof VALID_LOCATION_TYPES[number];
            if (!VALID_LOCATION_TYPES.includes(type)) {
              errors.push(`Row ${i + 2} ("${name}"): Invalid type "${row.Type}". Must be warehouse, jobsite, or supplier.`);
              continue;
            }

            const locationData = {
              name,
              longName: row['Long Name']?.trim() || name,
              type,
              address: row.Address?.trim() || '',
              contactPerson: row['Contact Person']?.trim() || '',
              contactNumber: row['Contact Number']?.trim() || '',
              terms: row.Terms?.trim() || '',
              isActive: row['Is Active']?.trim().toUpperCase() !== 'FALSE'
            };

            const existingId = row.ID?.trim();
            if (existingId && existingIdSet.has(existingId)) {
              await updateLocation(existingId, locationData);
            } else {
              await addLocation(locationData);
            }

            successCount++;
            if (onProgress) onProgress(i + 1, rows.length);
          } catch (err: any) {
            errors.push(`Row ${i + 2} ("${row.Name || 'unknown'}"): ${err.message}`);
          }
        }

        resolve({ success: successCount, errors });
      },
      error: (error) => reject(error)
    });
  });
};

export const importJobsiteBOQFromCSV = async (
  file: File,
  jobsiteId: string,
  items: Item[],
  uoms: UOM[],
  userName: string,
  onProgress?: (current: number, total: number) => void
) => {
  return new Promise<{ success: number; skipped: number; errors: string[]; data: Omit<BOQItem, 'id' | 'timestamp'>[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: async (results) => {
        const rows = results.data as any[];
        let successCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        const itemMap = new Map<string, Item>();
        items.forEach(item => itemMap.set(item.name.toLowerCase().trim(), item));

        const newBOQItems: Omit<BOQItem, 'id' | 'timestamp'>[] = [];

        const uomMap = new Map<string, string>();
        uoms.forEach(u => uomMap.set(u.symbol.toLowerCase().trim(), u.id));

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            // Find keys regardless of exact casing or leading/trailing spaces
            const getVal = (key: string) => {
              const actualKey = Object.keys(row).find(k => k.trim().toLowerCase() === key.toLowerCase());
              return actualKey ? row[actualKey] : undefined;
            };

            const itemNameRaw = getVal('Item Name');
            if (!itemNameRaw) {
              errors.push(`Row ${i + 1}: Item Name is missing.`);
              continue;
            }

            const itemName = itemNameRaw.toString().trim().toLowerCase();
            const item = itemMap.get(itemName);

            if (!item) {
              skippedCount++;
              continue; // Skip as per user request
            }

            // Parse Variant - be more robust with formats [Key: Val, Key2: Val2] or Key: Val, Key2: Val2
            let variant: Record<string, string> | undefined = undefined;
            const variantRaw = getVal('Variant')?.toString().trim();
            if (variantRaw) {
              const cleanedRaw = variantRaw.replace(/^\[/, '').replace(/\]$/, '');
              if (cleanedRaw) {
                variant = {};
                cleanedRaw.split(',').forEach(pair => {
                  const [k, v] = pair.split(':');
                  if (k && v) variant![k.trim()] = v.trim();
                });
              }
            }


            const targetQtyRaw = getVal('Target Quantity');
            const unitPriceRaw = getVal('Unit Price');
            const uomRaw = getVal('UOM');
            const isExtraRaw = getVal('Is Extra');
            const customSpecRaw = getVal('Custom Spec');
            const noteRaw = getVal('Note');

            const uomId = uomRaw ? (uomMap.get(uomRaw.toString().toLowerCase().trim()) || uomRaw.toString()) : item.uomId;

            newBOQItems.push({
              jobsiteId,
              itemId: item.id,
              variant,
              customSpec: customSpecRaw?.toString().trim() || undefined,
              targetQuantity: parseFloat(targetQtyRaw || '0') || 0,
              currentQuantity: 0,
              unitPrice: parseFloat(unitPriceRaw || '0') || 0,
              uomId,
              isExtra: isExtraRaw?.toString().toUpperCase() === 'TRUE',
              addedBy: userName,
              note: noteRaw?.toString().trim() || undefined
            });

            successCount++;
            if (onProgress) onProgress(i + 1, rows.length);
          } catch (err: any) {
            errors.push(`Row ${i + 1} (${row['Item Name']}): ${err.message}`);
          }
        }

        resolve({ success: successCount, skipped: skippedCount, errors, data: newBOQItems });
      },
      error: (error) => {
        reject(error);
      }
    });
  });
};
