"use client";

import { useActionState } from "react";
import { updateRole, type UpdateRoleState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles";
import type { AppRole } from "@/lib/database.types";

const initial: UpdateRoleState = { error: null, ok: false };

export function RoleSelect({
  userId,
  currentRole,
  disabled,
}: {
  userId: string;
  currentRole: AppRole;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateRole, initial);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        disabled={disabled || pending}
        className="rounded-md border border-black/10 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-950"
      >
        {ALL_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={disabled || pending}
        className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.ok && <span className="text-xs text-green-600">Saved</span>}
      {state.error && (
        <span className="text-xs text-red-600">{state.error}</span>
      )}
    </form>
  );
}
