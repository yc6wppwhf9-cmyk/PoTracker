import { GrnImportForm } from "@/app/procurement/grn/import-form";

/**
 * The fallback import, behind a disclosure.
 *
 * The mailbox fetch loads the register every five minutes, so this is not a
 * task anyone comes here to do. It stays because the automation has one point
 * of failure nobody controls — a changed app password, a moved mailbox, a
 * paused cron job — and without it a broken fetch would leave no way to load a
 * register at all.
 */
export function ManualImport() {
  return (
    <details className="mt-6 rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
      <summary className="cursor-pointer list-none px-5 py-3 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ▸ Import a register by hand
        <span className="ml-2 text-xs text-neutral-400">
          only needed if the automated fetch is not running
        </span>
      </summary>
      <div className="border-t border-black/5 px-5 py-4 dark:border-white/5">
        <GrnImportForm />
        <p className="mt-4 max-w-3xl text-xs text-neutral-500">
          Re-importing is safe. Every GRC number in the file replaces its
          existing lines, so a corrected register overwrites rather than adds,
          and GRC numbers absent from the file are left untouched.
        </p>
      </div>
    </details>
  );
}
