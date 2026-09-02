import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { supabaseUrl } from "@/lib/env";
import { ItemCard } from "./item-card";

const PAGE_SIZE = 48;

export type RmItem = {
  item_code: string;
  name: string;
  category: string;
  base_unit: string;
  stock_qty: number;
  stock_updated_at: string | null;
  photo_path: string | null;
};

/** Public URL for a photo object, or null when no photo has been uploaded. */
export function photoUrl(path: string | null): string | null {
  if (!path) return null;
  return `${supabaseUrl()}/storage/v1/object/public/rm-photos/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export default async function RmStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const profile = await requireUser();
  const { q: rawQ, page: rawPage } = await searchParams;

  const q = (rawQ ?? "").trim();
  const page = Math.max(1, Number(rawPage) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("item_master")
    .select(
      "item_code, name, category, base_unit, stock_qty, stock_updated_at, photo_path",
      { count: "exact" }
    );

  if (q) {
    // Escape PostgREST's or() delimiters so a comma or paren in the search
    // can't break out of the filter.
    const safe = q.replace(/[,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,item_code.ilike.%${safe}%`);
  }

  const { data, count } = await query
    .order("name", { ascending: true })
    .range(from, to);

  const items = (data ?? []) as RmItem[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isAdmin = profile.role === "admin";

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/rm-stock?${qs}` : "/rm-stock";
  };

  return (
    <AppShell profile={profile}>
      <h1 className="text-2xl font-semibold tracking-tight">RM Stock</h1>
      <p className="mt-1 text-neutral-500">
        {total.toLocaleString()} raw material{total === 1 ? "" : "s"} on file.
        {isAdmin
          ? " Upload a photo and keep the on-hand quantity current on each card."
          : " Browse the catalogue with photos and current on-hand stock."}
      </p>

      <form method="get" className="mt-6 flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name or item code…"
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:bg-neutral-900 dark:focus:border-white/30"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          Search
        </button>
        {q && (
          <Link
            href="/rm-stock"
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
          >
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <p className="mt-16 text-center text-neutral-500">
          {q ? `No items match “${q}”.` : "No items on file yet."}
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <ItemCard
              key={item.item_code}
              item={item}
              photoUrl={photoUrl(item.photo_path)}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              ← Previous
            </Link>
          ) : (
            <span className="rounded-lg border border-black/5 px-3 py-1.5 text-neutral-400 dark:border-white/5">
              ← Previous
            </span>
          )}
          <span className="text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded-lg border border-black/5 px-3 py-1.5 text-neutral-400 dark:border-white/5">
              Next →
            </span>
          )}
        </nav>
      )}
    </AppShell>
  );
}
