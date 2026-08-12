import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

type MailRow = {
  message_id: string;
  sender: string | null;
  subject: string | null;
  filename: string | null;
  status: string;
  detail: string | null;
  lines: number;
  processed_at: string;
};

/**
 * Whether the scheduled mailbox fetch is actually running.
 *
 * This is the reason the register no longer needs a manual import in front of
 * it — and the reason it needs watching. A scheduled task that stops is worse
 * than one that never existed, because nobody looks: the register simply stops
 * growing and everything downstream quietly reports stale figures.
 */
export async function FetchStatus() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("grn_mail")
    .select("message_id, sender, subject, filename, status, detail, lines, processed_at")
    .order("processed_at", { ascending: false })
    .limit(5);

  // The table arrives with a later migration; saying so beats an empty panel.
  if (error)
    return (
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        The automated fetch log is unavailable — apply
        supabase/migrations/20260811_grn_mail.sql if you are expecting the
        mailbox import to run.
      </p>
    );

  const rows = (data ?? []) as MailRow[];
  const last = rows[0];
  const lastImport = rows.find((r) => r.status === "imported");
  const failures = rows.filter((r) => r.status === "failed");

  // Only imports and failures used to be shown, and skipped messages appeared
  // nowhere at all. So when the job spent a day reading the same fifty unread
  // newsletters and rejecting every one, the panel said "Last checked" and
  // looked healthy. The job was explaining itself into a table nothing
  // displayed. Worth surfacing only when nothing is getting through: a skip
  // beside a working import is ordinary mailbox noise.
  const skipped = rows.filter((r) => r.status === "skipped");
  const nothingGettingThrough = !lastImport && skipped.length > 0;

  // Reading the clock is impure, which the rule flags — but this is a Server
  // Component rendered once per request, not a client component that may
  // re-render at any moment, so "now" cannot shift underneath the output.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const hoursSince = last
    ? Math.floor((now - Date.parse(last.processed_at)) / 3_600_000)
    : null;
  // The job runs every 5 minutes, so nothing seen in a day means it is not
  // running rather than that no register has arrived.
  const stale = hoursSince !== null && hoursSince > 24;

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-xs ${
        failures.length > 0 || stale || nothingGettingThrough
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
          : "border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">
          Automated mailbox fetch
        </span>
        {rows.length === 0 ? (
          <span className="text-neutral-500">
            Nothing collected yet — the schedule may not be configured. See
            docs/grn-auto-fetch.md.
          </span>
        ) : (
          <span className="text-neutral-500">
            Last checked {formatDateTime(last.processed_at)}
            {stale && (
              <strong className="ml-1 text-amber-700 dark:text-amber-400">
                — over a day ago; the job runs every 5 minutes, so it may have
                stopped.
              </strong>
            )}
          </span>
        )}
      </div>

      {lastImport && (
        <p className="mt-1 text-neutral-500">
          Last register imported:{" "}
          <strong className="text-neutral-700 dark:text-neutral-200">
            {lastImport.filename ?? lastImport.subject ?? "—"}
          </strong>{" "}
          — {lastImport.lines.toLocaleString()} line(s) on{" "}
          {formatDateTime(lastImport.processed_at)}
        </p>
      )}

      {nothingGettingThrough && (
        <div className="mt-1 text-amber-800 dark:text-amber-300">
          <p>
            The job is running but has imported nothing. The last{" "}
            {skipped.length} message(s) it looked at were rejected:
          </p>
          <ul className="mt-0.5 space-y-0.5 pl-4">
            {skipped.slice(0, 3).map((s) => (
              <li key={s.message_id} className="list-disc">
                <span className="text-neutral-600 dark:text-neutral-400">
                  {s.sender ?? "unknown sender"}
                </span>{" "}
                — {s.detail}
              </li>
            ))}
          </ul>
          <p className="mt-0.5 text-neutral-500">
            If none of those is the ERP, check GRN_ALLOWED_SENDERS and
            GRN_SUBJECT_CONTAINS on the API service.
          </p>
        </div>
      )}

      {failures.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-300">
          {failures.map((f) => (
            <li key={f.message_id}>
              Failed: {f.subject ?? f.filename ?? "a message"} — {f.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
