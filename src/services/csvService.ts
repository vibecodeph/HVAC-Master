import Papa from 'papaparse';
import { Item, Category, UOM, BOQItem, Tag, PurchaseOrder, PurchaseOrderItem, Location } from '../types';
import { addItem, updateItem, addPurchaseOrder, updatePurchaseOrder } from './inventoryService';
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
}

export interface CSVBOQRow {
  'Item Name': string;
  'Variant'?: string;
  'Custom Spec'?: string;
  'Target Quantity': string;
  'Unit Price'?: string;
  'Is Extra': string;
}

export interface CSVPOItemRow {
  'PO Number': string;
  'Date': string;
  'Supplier': string;
  'Status': string;
  'Payment Status'?: string;
  'Total Amount'?: string;
  'Notes'?: string;
  'Item Name': string;
  'Variant'?: string;
  'Quantity': string;
  'UOM': string;
  'Unit Price': string;
  'Received Qty'?: string;
  'Item Note'?: string;
}

export const exportPurchaseOrdersToCSV = (
  purchaseOrders: PurchaseOrder[],
  locations: Location[],
  items: Item[],
  uoms: UOM[]
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

    po.items.forEach(poItem => {
      const item = items.find(i => i.id === poItem.itemId);
      const uom = uoms.find(u => u.id === poItem.uomId);
      const variantStr = poItem.variant ? `[${Object.entries(poItem.variant).map(([k, v]) => `${k}:${v}`).join(', ')}]` : '';

      data.push({
        'PO Number': po.poNumber,
        'Date': dateStr,
        'Supplier': supplier?.name || po.supplierId,
        'Status': po.status,
        'Payment Status': po.paymentStatus || 'unpaid',
        'Total Amount': po.totalAmount.toString(),
        'Notes': po.notes || '',
        'Item Name': item?.name || poItem.itemId,
        'Variant': variantStr,
        'Quantity': poItem.quantity.toString(),
        'UOM': uom?.symbol || poItem.uomId,
        'Unit Price': poItem.unitPrice.toString(),
        'Received Qty': (poItem.receivedQuantity || 0).toString(),
        'Item Note': poItem.note || ''
      });
    });
  });

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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

            await addPurchaseOrder(poData);
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
        return `[${variantStr}] -> ${dataParts.join(', ')}`;
      }).join(' | '),
      'Require Custom Spec': item.requireCustomSpec ? 'TRUE' : 'FALSE',
      'Custom Spec Label': item.customSpecLabel || ''
    };
  });

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
  jobsiteName: string
) => {
  const data = boqItems.map(boq => {
    const item = items.find(i => i.id === boq.itemId);
    const variantStr = boq.variant ? `[${Object.entries(boq.variant).map(([k, v]) => `${k}:${v}`).join(', ')}]` : '';
    
    return {
      'Item Name': item?.name || 'Unknown Item',
      'Variant': variantStr,
      'Custom Spec': boq.customSpec || '',
      'Target Quantity': boq.targetQuantity || 0,
      'Unit Price': boq.unitPrice || 0,
      'Is Extra': boq.isExtra ? 'TRUE' : 'FALSE'
    };
  });

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
  onProgress?: (current: number, total: number) => void
) => {
  return new Promise<{ success: number; errors: string[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
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
            const rowTags = row.Tags ? row.Tags.split(',').map(t => t.trim()).filter(t => t) : [];
            const invalidTags = rowTags.filter(t => !tagSet.has(t.toLowerCase()));
            if (invalidTags.length > 0) {
              errors.push(`Row ${i + 1} (${row.Name}): Tags [${invalidTags.join(', ')}] do not exist.`);
              continue;
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
              tags: rowTags,
            };

            // 5. Parse Variants
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

            if (row.ID) {
              await updateItem(row.ID, itemData);
            } else {
              await addItem(itemData);
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

export const importJobsiteBOQFromCSV = async (
  file: File,
  jobsiteId: string,
  items: Item[],
  userName: string,
  onProgress?: (current: number, total: number) => void
) => {
  return new Promise<{ success: number; skipped: number; errors: string[]; data: Omit<BOQItem, 'id' | 'timestamp'>[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as any[];
        let successCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        const itemMap = new Map<string, Item>();
        items.forEach(item => itemMap.set(item.name.toLowerCase().trim(), item));

        const newBOQItems: Omit<BOQItem, 'id' | 'timestamp'>[] = [];

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

            // Parse Variant
            let variant: Record<string, string> | undefined = undefined;
            const variantRaw = getVal('Variant');
            if (variantRaw) {
              const vMatch = variantRaw.toString().match(/\[(.*)\]/);
              if (vMatch) {
                variant = {};
                vMatch[1].split(',').forEach(pair => {
                  const [k, v] = pair.split(':');
                  if (k && v) variant![k.trim()] = v.trim();
                });
              }
            }

            if (item.requireVariant && (!variant || Object.keys(variant).length === 0)) {
              errors.push(`Row ${i + 1} (${item.name}): Variant is required for this item.`);
              continue;
            }

            const targetQtyRaw = getVal('Target Quantity');
            const unitPriceRaw = getVal('Unit Price');
            const isExtraRaw = getVal('Is Extra');
            const customSpecRaw = getVal('Custom Spec');

            newBOQItems.push({
              jobsiteId,
              itemId: item.id,
              variant,
              customSpec: customSpecRaw?.toString().trim() || undefined,
              targetQuantity: parseFloat(targetQtyRaw || '0') || 0,
              currentQuantity: 0,
              unitPrice: parseFloat(unitPriceRaw || '0') || 0,
              isExtra: isExtraRaw?.toString().toUpperCase() === 'TRUE',
              addedBy: userName
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
