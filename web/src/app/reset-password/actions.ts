"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ResetState = { error: string | null };

/** Long enough to be worth having; Supabase's own minimum is 6. */
const MIN_LENGTH = 10;

/**
 * Set a new password for whoever the recovery link signed in.
 *
 * The link itself is the authentication: opening it establishes a session, and
 * this runs as that user. There is no user id in the form, so a stale or
 * copied form cannot be pointed at somebody else's account.
 */
export async function setNewPassword(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_LENGTH)
    return { error: `Use at least ${MIN_LENGTH} characters.` };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const supabase = await createClient();

  // The session comes from the recovery link. Without it updateUser would
  // fail with a message about a missing session, which reads as a bug rather
  // than an expired link — which is what it almost always is.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      error:
        "This reset link has expired or has already been used. Request a new " +
        "one from the sign-in page.",
    };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
