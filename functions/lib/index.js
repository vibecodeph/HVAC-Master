"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncUserClaims = exports.manualArchiveRequests = exports.archiveOldRequests = exports.deleteRole = exports.createRole = exports.updateRolePermissions = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const auth_1 = require("firebase-admin/auth");
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
var rbacManager_1 = require("./rbacManager");
Object.defineProperty(exports, "updateRolePermissions", { enumerable: true, get: function () { return rbacManager_1.updateRolePermissions; } });
Object.defineProperty(exports, "createRole", { enumerable: true, get: function () { return rbacManager_1.createRole; } });
Object.defineProperty(exports, "deleteRole", { enumerable: true, get: function () { return rbacManager_1.deleteRole; } });
var requestArchiver_1 = require("./requestArchiver");
Object.defineProperty(exports, "archiveOldRequests", { enumerable: true, get: function () { return requestArchiver_1.archiveOldRequests; } });
Object.defineProperty(exports, "manualArchiveRequests", { enumerable: true, get: function () { return requestArchiver_1.manualArchiveRequests; } });
exports.syncUserClaims = (0, firestore_1.onDocumentWritten)({
    document: "users/{userId}",
    database: "ai-studio-bd36edda-8fe9-4e09-b9a3-dfe452f56d22",
}, async (event) => {
    const userId = event.params.userId;
    const newData = event.data?.after.data();
    if (!newData) {
        console.log(`User ${userId} deleted. Skipping claims update.`);
        return;
    }
    const { role, isApproved, assignedLocationIds } = newData;
    try {
        await (0, auth_1.getAuth)().setCustomUserClaims(userId, {
            role: role || "",
            isApproved: !!isApproved,
            assignedLocationIds: assignedLocationIds || [],
        });
        console.log(`Successfully updated custom claims for user ${userId}: { role: ${role}, isApproved: ${isApproved}, assignedLocationIds: ${JSON.stringify(assignedLocationIds || [])} }`);
    }
    catch (error) {
        console.error(`Error updating custom claims for user ${userId}:`, error);
    }
});
//# sourceMappingURL=index.js.map