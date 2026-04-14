import Papa from 'papaparse';
import { Item, Category, UOM, BOQItem } from '../types';
import { addItem, updateItem, addCategory, addUOM } from './inventoryService';
import { Timestamp } from 'firebase/firestore';

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
}

export interface CSVBOQRow {
  'Item Name': string;
  'Variant'?: string;
  'Target Quantity': string;
  'Unit Price'?: string;
  'Is Extra': string;
}

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
      }).join(' | ')
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

        // Pre-cache categories and uoms for faster lookup/creation
        const categoryMap = new Map<string, string>(); // name -> id
        categories.forEach(c => categoryMap.set(c.name.toLowerCase(), c.id));

        const uomMap = new Map<string, string>(); // symbol -> id
        uoms.forEach(u => uomMap.set(u.symbol.toLowerCase(), u.id));

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
                const newCatId = await addCategory({ name: catName }) as string;
                categoryId = newCatId;
                categoryMap.set(lowerCatName, newCatId);
              }
            }

            // 2. Resolve Subcategory
            let subcategoryId = '';
            if (row.Subcategory && categoryId) {
              const subCatName = row.Subcategory.trim();
              const lowerSubCatName = subCatName.toLowerCase();
              
              // We need a way to find subcategories specifically under this parent
              const existingSub = categories.find(c => c.parentId === categoryId && c.name.toLowerCase() === lowerSubCatName);
              
              if (existingSub) {
                subcategoryId = existingSub.id;
              } else {
                const newSubId = await addCategory({ name: subCatName, parentId: categoryId }) as string;
                subcategoryId = newSubId;
              }
            }

            // 3. Resolve UOM
            let uomId = '';
            const uomSymbol = row.UOM.trim();
            const lowerUomSymbol = uomSymbol.toLowerCase();
            if (uomMap.has(lowerUomSymbol)) {
              uomId = uomMap.get(lowerUomSymbol)!;
            } else {
              const newUomId = await addUOM({ name: uomSymbol, symbol: uomSymbol }) as string;
              uomId = newUomId;
              uomMap.set(lowerUomSymbol, newUomId);
            }

            // 4. Prepare Item Data
            const itemData: any = {
              name: row.Name.trim(),
              description: row.Description?.trim() || '',
              categoryId: categoryId || null,
              subcategoryId: subcategoryId || null,
              uomId: uomId,
              isTool: row['Is Tool']?.toUpperCase() === 'TRUE',
              isActive: row['Is Active']?.toUpperCase() !== 'FALSE', // Default to true
              requireVariant: row['Require Variant']?.toUpperCase() === 'TRUE',
              averageCost: parseFloat(row['Average Cost'] || '0') || 0,
              reorderLevel: parseFloat(row['Reorder Level'] || '0') || 0,
              tags: row.Tags ? row.Tags.split(',').map(t => t.trim()).filter(t => t) : [],
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

            newBOQItems.push({
              jobsiteId,
              itemId: item.id,
              variant,
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
