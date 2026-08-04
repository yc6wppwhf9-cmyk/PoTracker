import type { AppRole } from "@/lib/database.types";

export const ALL_ROLES: AppRole[] = [
  "uploader",
  "purchase_head",
  "buyer",
  "po_team",
  "approver",
  "md",
  "admin",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  uploader: "Uploader",
  purchase_head: "Purchase Head",
  buyer: "Buyer",
  po_team: "PO Team",
  approver: "Approver",
  md: "Managing Director",
  admin: "Admin",
};

/** Where each role lands after login. */
export const ROLE_HOME: Record<AppRole, string> = {
  uploader: "/procurement/upload",
  purchase_head: "/procurement/assign",
  buyer: "/procurement/buyer",
  po_team: "/procurement/po-team",
  approver: "/procurement/approver",
  md: "/procurement/md",
  admin: "/admin",
};

export function homeForRole(role: AppRole): string {
  return ROLE_HOME[role] ?? "/dashboard";
}
