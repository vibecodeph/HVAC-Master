"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualArchiveRequests = exports.archiveOldRequests = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const app_1 = require("firebase-admin/app");
const DB_ID = "ai-studio-bd36edda-8fe9-4e09-b9a3-dfe452f56d22";
const ARCHIVE_STATUSES = ["delivered", "rejected", "cancelled"];
const ARCHIVE_AFTER_DAYS = 30;
const BATCH_SIZE = 400;
function getDb() {
    return (0, firestore_1.getFirestore)((0, app_1.getApp)(), DB_ID);
}
async function runArchive(daysThreshold) {
    const db = getDb();
    const cutoff = firestore_1.Timestamp.fromDate(new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000));
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
                archivedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            batch.delete(snap.ref);
        }
        try {
            await batch.commit();
            archived += chunk.length;
            console.log(`Request archiver: committed batch of ${chunk.length} (total: ${archived}).`);
        }
        catch (err) {
            console.error(`Request archiver: batch starting at index ${i} failed:`, err);
        }
    }
    return archived;
}
exports.archiveOldRequests = (0, scheduler_1.onSchedule)({ schedule: "every 24 hours", timeZone: "Asia/Manila" }, async () => {
    try {
        const count = await runArchive(ARCHIVE_AFTER_DAYS);
        console.log(`Request archiver: archived ${count} document(s).`);
    }
    catch (err) {
        console.error("Request archiver: scheduled job failed:", err);
    }
});
exports.manualArchiveRequests = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    if (request.auth?.token?.role !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Admin only.");
    }
    try {
        const count = await runArchive(ARCHIVE_AFTER_DAYS);
        return { archived: count };
    }
    catch (err) {
        console.error("Request archiver: manual archive failed:", err);
        throw new https_1.HttpsError("internal", "Archive operation failed.");
    }
});
//# sourceMappingURL=requestArchiver.js.map