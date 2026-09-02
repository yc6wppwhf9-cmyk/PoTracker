"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export type ActionState = { error: string | null; ok: boolean };

const PHOTO_BUCKET = "rm-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB — a product photo, not a scan.
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Storage keys must be predictable; item codes can contain anything. */
function safeSegment(code: string): string {
  return code.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Set the on-hand quantity for an item. Admin-only — RLS enforces this too
 * (item_master_admin_write), but we check here to fail fast and clearly.
 */
export async function updateStock(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireRole("admin");

  const itemCode = String(formData.get("item_code") ?? "").trim();
  const raw = String(formData.get("stock_qty") ?? "").trim();

  if (!itemCode) return { error: "Missing item.", ok: false };

  const qty = Number(raw);
  if (raw === "" || !Number.isFinite(qty) || qty < 0) {
    return { error: "Enter a quantity of zero or more.", ok: false };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("item_master")
    .update({ stock_qty: qty, stock_updated_at: new Date().toISOString() })
    .eq("item_code", itemCode);

  if (error) return { error: error.message, ok: false };

  revalidatePath("/rm-stock");
  return { error: null, ok: true };
}

/**
 * Upload (or replace) the photo for an item. Admin-only. The new object is
 * stored under a timestamped key so browsers never serve a stale cached image;
 * the previous object, if any, is deleted so orphans don't accumulate.
 */
export async function uploadPhoto(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireRole("admin");

  const itemCode = String(formData.get("item_code") ?? "").trim();
  const file = formData.get("photo");

  if (!itemCode) return { error: "Missing item.", ok: false };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload.", ok: false };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { error: "Use a JPEG, PNG, WebP or GIF image.", ok: false };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "Image is larger than the 5 MB limit.", ok: false };
  }

  const supabase = await createClient();

  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
    : "jpg";
  const path = `${safeSegment(itemCode)}/${Date.now()}.${safeSegment(ext)}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: uploadError.message, ok: false };

  // Point the row at the new object, and remember the old one to clean up.
  const { data: prevRow } = await supabase
    .from("item_master")
    .select("photo_path")
    .eq("item_code", itemCode)
    .single();

  const { error: updateError } = await supabase
    .from("item_master")
    .update({ photo_path: path })
    .eq("item_code", itemCode);

  if (updateError) {
    // Roll back the orphaned upload so a failed link doesn't leave a stray file.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { error: updateError.message, ok: false };
  }

  const previous = prevRow?.photo_path;
  if (previous && previous !== path) {
    await supabase.storage.from(PHOTO_BUCKET).remove([previous]);
  }

  revalidatePath("/rm-stock");
  return { error: null, ok: true };
}
