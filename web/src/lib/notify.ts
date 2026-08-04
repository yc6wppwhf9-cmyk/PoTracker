import "server-only";

type Email = { to: string[]; subject: string; html: string };

/**
 * Send a transactional email via Resend. Degrades gracefully: if RESEND_API_KEY
 * is absent (or there are no recipients) it logs and returns without throwing,
 * so a missing email config never blocks the core workflow.
 */
export async function sendEmail(email: Email): Promise<{ ok: boolean; skipped?: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "Procurement <onboarding@resend.dev>";
  const to = email.to.filter(Boolean);

  if (!key || to.length === 0) {
    console.log(`[notify skipped] "${email.subject}" → ${to.join(", ") || "(no recipients)"}`);
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: email.subject, html: email.html }),
    });
    if (!res.ok) {
      console.error(`[notify failed] ${res.status} ${await res.text()}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[notify error]", e);
    return { ok: false };
  }
}

/** Escape user-supplied text before interpolating it into an email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}
