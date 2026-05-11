import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

const DB_ID = "ai-studio-bd36edda-8fe9-4e09-b9a3-dfe452f56d22";
const ARCHIVE_STATUSES = ["delivered", "rejected", "cancelled"];
const ARCHIVE_AFTER_DAYS = 30;
const BATCH_SIZE = 400;

function getDb() {
  return getFirestore(getApp(), DB_ID);
}

async function runArchive(daysThreshold: number): Promise<number> {
  const db = getDb();
  const cutoff = Timestamp.fromDate(
    new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000)
  );

  const snapshot = await db
    .collection("requests")
    .where("status", "in", ARCHIVE_STATUSES)
    .where("timestamp", "<", cutoff)
    .get();

  if (snapshot.empty) {
    console.log("Request archiver: nothing to archive.");
    return 0;
  }

  let archived = 0;
  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);
    for (const snap of chunk) {
      const archiveRef = db.collection("requests_archive").doc(snap.id);
      batch.set(archiveRef, {
        ...snap.data(),
        archivedAt: FieldValue.serverTimestamp(),
      });
      batch.delete(snap.ref);
    }
    try {
      await batch.commit();
      archived += chunk.length;
      console.log(
        `Request archiver: committed batch of ${chunk.length} (total: ${archived}).`
      );
    } catch (err) {
      console.error(
        `Request archiver: batch starting at index ${i} failed:`,
        err
      );
    }
  }

  return archived;
}

export const archiveOldRequests = onSchedule(
  { schedule: "every 24 hours", timeZone: "Asia/Manila" },
  async () => {
    try {
      const count = await runArchive(ARCHIVE_AFTER_DAYS);
      console.log(`Request archiver: archived ${count} document(s).`);
    } catch (err) {
      console.error("Request archiver: scheduled job failed:", err);
    }
  }
);

export const manualArchiveRequests = onCall(
  { enforceAppCheck: false },
  async (request) => {
    if (request.auth?.token?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }
    try {
      const count = await runArchive(ARCHIVE_AFTER_DAYS);
      return { archived: count };
    } catch (err) {
      console.error("Request archiver: manual archive failed:", err);
      throw new HttpsError("internal", "Archive operation failed.");
    }
  }
);
