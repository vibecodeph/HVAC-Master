import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

const DB_ID = "ai-studio-bd36edda-8fe9-4e09-b9a3-dfe452f56d22";

const BUILT_IN_ROLES = ["admin", "manager", "engineer", "warehouseman", "worker"];

function getDb() {
  return getFirestore(getApp(), DB_ID);
}

async function writeAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  changeType: string,
  roleId: string,
  changedBy: string,
  changedByName: string,
  oldPermissions: string[],
  newPermissions: string[]
) {
  await db.collection("rbac_audit").add({
    changeType,
    roleId,
    changedBy,
    changedByName,
    changedAt: FieldValue.serverTimestamp(),
    oldPermissions,
    newPermissions,
  });
}

export const updateRolePermissions = onCall(async (request) => {
  if (!request.auth || request.auth.token["role"] !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can update role permissions.");
  }

  const { roleId, permissions, description } = request.data as {
    roleId: string;
    permissions: string[];
    description?: string;
  };

  if (!roleId || typeof roleId !== "string") {
    throw new HttpsError("invalid-argument", "roleId is required.");
  }
  if (!Array.isArray(permissions)) {
    throw new HttpsError("invalid-argument", "permissions must be an array.");
  }
  if (roleId === "admin" && permissions.length === 0) {
    throw new HttpsError("failed-precondition", "Cannot remove all permissions from the admin role.");
  }

  const db = getDb();
  const docRef = db.collection("rbac_config").doc(roleId);
  const existing = await docRef.get();
  const oldPermissions: string[] = existing.exists ? (existing.data()?.permissions ?? []) : [];

  const updateData: Record<string, unknown> = {
    permissions,
    lastUpdatedBy: request.auth.uid,
    lastUpdatedAt: FieldValue.serverTimestamp(),
  };
  if (description !== undefined) updateData.description = description;

  await docRef.set(updateData, { merge: true });
  await writeAudit(
    db,
    "updated_permissions",
    roleId,
    request.auth.uid,
    (request.auth.token["name"] as string) || request.auth.uid,
    oldPermissions,
    permissions
  );

  return { success: true };
});

export const createRole = onCall(async (request) => {
  if (!request.auth || request.auth.token["role"] !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can create roles.");
  }

  const { roleId, permissions, description } = request.data as {
    roleId: string;
    permissions: string[];
    description: string;
  };

  if (!roleId || !/^[a-z][a-z0-9_]{1,29}$/.test(roleId)) {
    throw new HttpsError(
      "invalid-argument",
      "Role ID must be 2–30 lowercase letters, digits, or underscores, starting with a letter."
    );
  }
  if (!Array.isArray(permissions)) {
    throw new HttpsError("invalid-argument", "permissions must be an array.");
  }
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    throw new HttpsError("invalid-argument", "description is required.");
  }

  const db = getDb();
  const docRef = db.collection("rbac_config").doc(roleId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw new HttpsError("already-exists", `Role "${roleId}" already exists.`);
  }

  await docRef.set({
    permissions,
    description: description.trim(),
    lastUpdatedBy: request.auth.uid,
    lastUpdatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit(
    db,
    "added_role",
    roleId,
    request.auth.uid,
    (request.auth.token["name"] as string) || request.auth.uid,
    [],
    permissions
  );

  return { success: true };
});

export const deleteRole = onCall(async (request) => {
  if (!request.auth || request.auth.token["role"] !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can delete roles.");
  }

  const { roleId } = request.data as { roleId: string };

  if (!roleId) {
    throw new HttpsError("invalid-argument", "roleId is required.");
  }
  if (BUILT_IN_ROLES.includes(roleId)) {
    throw new HttpsError("failed-precondition", `Cannot delete built-in role "${roleId}".`);
  }

  const db = getDb();

  const usersSnap = await db
    .collection("users")
    .where("role", "==", roleId)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (!usersSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      `Cannot delete role "${roleId}": there are active users assigned to it.`
    );
  }

  const docRef = db.collection("rbac_config").doc(roleId);
  const existing = await docRef.get();
  const oldPermissions: string[] = existing.exists ? (existing.data()?.permissions ?? []) : [];

  await docRef.delete();
  await writeAudit(
    db,
    "deleted_role",
    roleId,
    request.auth.uid,
    (request.auth.token["name"] as string) || request.auth.uid,
    oldPermissions,
    []
  );

  return { success: true };
});
