import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";

initializeApp();

export const syncUserClaims = onDocumentWritten("users/{userId}", async (event) => {
  const userId = event.params.userId;
  const newData = event.data?.after.data();

  // If the document was deleted, we skip the update
  if (!newData) {
    console.log(`User ${userId} deleted. Skipping claims update.`);
    return;
  }

  const { role, isApproved, assignedLocationIds } = newData;

  try {
    await getAuth().setCustomUserClaims(userId, {
      role: role || "",
      isApproved: !!isApproved,
      assignedLocationIds: assignedLocationIds || []
    });
    console.log(`Successfully updated custom claims for user ${userId}: { role: ${role}, isApproved: ${isApproved}, assignedLocationIds: ${JSON.stringify(assignedLocationIds || [])} }`);
  } catch (error) {
    console.error(`Error updating custom claims for user ${userId}:`, error);
  }
});
