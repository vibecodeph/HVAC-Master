#!/usr/bin/env ts-node
/**
 * One-time migration: copy priceHistory arrays from items/variantConfigs
 * into the separate price_history collection.
 *
 * Run IMMEDIATELY after deploying the code update (before non-admin users
 * trigger item writes, since priceHistory is no longer in isValidItem's
 * allowed-fields list).
 *
 * Phase 1 (default): copy priceHistory entries to price_history collection.
 * Phase 2 (--cleanup): remove priceHistory arrays from item/variantConfig docs.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npx ts-node scripts/migrate-price-history.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npx ts-node scripts/migrate-price-history.ts --cleanup
 */

import * as admin from 'firebase-admin';

const doCleanup = process.argv.includes('--cleanup');

admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 400;

function normalizeVariant(variant: Record<string, string>): string {
  if (!variant || Object.keys(variant).length === 0) return '{}';
  const sortedKeys = Object.keys(variant).sort();
  const normalized: Record<string, string> = {};
  sortedKeys.forEach(k => { normalized[k] = variant[k]; });
  return JSON.stringify(normalized);
}

async function migratePhase1() {
  console.log('Phase 1: Copying priceHistory entries to price_history collection...');
  const itemsSnap = await db.collection('items').get();
  console.log(`  Found ${itemsSnap.size} items`);

  let batch = db.batch();
  let batchCount = 0;
  let totalWritten = 0;

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    totalWritten += batchCount;
    console.log(`  Written ${totalWritten} price_history docs so far...`);
    batch = db.batch();
    batchCount = 0;
  };

  for (const itemDoc of itemsSnap.docs) {
    const item = itemDoc.data();
    const itemId = itemDoc.id;

    // Base item priceHistory
    if (item.priceHistory && Array.isArray(item.priceHistory)) {
      for (const entry of item.priceHistory) {
        const phRef = db.collection('price_history').doc();
        batch.set(phRef, {
          id: phRef.id,
          itemId,
          variantKey: null,
          variant: null,
          date: entry.date,
          price: entry.price,
          source: entry.source || 'manual',
          sourceId: null,
          sourceRef: null,
        });
        batchCount++;
        if (batchCount >= BATCH_SIZE) await flush();
      }
    }

    // Per-variant priceHistory in variantConfigs
    if (item.variantConfigs && Array.isArray(item.variantConfigs)) {
      for (const vc of item.variantConfigs) {
        if (!vc.priceHistory || !Array.isArray(vc.priceHistory) || vc.priceHistory.length === 0) continue;
        const vk = vc.variant && Object.keys(vc.variant).length > 0
          ? normalizeVariant(vc.variant)
          : null;
        for (const entry of vc.priceHistory) {
          const phRef = db.collection('price_history').doc();
          batch.set(phRef, {
            id: phRef.id,
            itemId,
            variantKey: vk,
            variant: vc.variant || null,
            date: entry.date,
            price: entry.price,
            source: entry.source || 'manual',
            sourceId: null,
            sourceRef: null,
          });
          batchCount++;
          if (batchCount >= BATCH_SIZE) await flush();
        }
      }
    }
  }

  await flush();
  console.log(`Phase 1 complete. Total price_history docs written: ${totalWritten}`);
}

async function migratePhase2() {
  console.log('Phase 2: Removing priceHistory from item/variantConfig docs...');
  const itemsSnap = await db.collection('items').get();

  let batch = db.batch();
  let batchCount = 0;
  let totalUpdated = 0;

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    totalUpdated += batchCount;
    console.log(`  Updated ${totalUpdated} item docs so far...`);
    batch = db.batch();
    batchCount = 0;
  };

  for (const itemDoc of itemsSnap.docs) {
    const item = itemDoc.data();
    const hasBaseHistory = item.priceHistory && Array.isArray(item.priceHistory);
    const hasVariantHistory = Array.isArray(item.variantConfigs) &&
      item.variantConfigs.some((vc: any) => Array.isArray(vc.priceHistory) && vc.priceHistory.length > 0);

    if (!hasBaseHistory && !hasVariantHistory) continue;

    const update: Record<string, any> = {};
    if (hasBaseHistory) {
      update.priceHistory = admin.firestore.FieldValue.delete();
    }
    if (hasVariantHistory) {
      update.variantConfigs = item.variantConfigs.map((vc: any) => {
        const { priceHistory: _ph, ...rest } = vc;
        return rest;
      });
    }

    batch.update(itemDoc.ref, update);
    batchCount++;
    if (batchCount >= BATCH_SIZE) await flush();
  }

  await flush();
  console.log(`Phase 2 complete. Total item docs cleaned: ${totalUpdated}`);
}

(async () => {
  try {
    if (doCleanup) {
      await migratePhase2();
    } else {
      await migratePhase1();
      console.log('\nRun with --cleanup to remove priceHistory arrays from item docs.');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
