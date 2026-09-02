"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import { updateStock, uploadPhoto, type ActionState } from "./actions";
import type { RmItem } from "./page";

const INITIAL: ActionState = { error: null, ok: false };

export function ItemCard({
  item,
  photoUrl,
  isAdmin,
}: {
  item: RmItem;
  photoUrl: string | null;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
      <div className="relative aspect-square w-full bg-neutral-100 dark:bg-neutral-800">
        {photoUrl ? (
          // Plain <img>: no next/image remote-host config, and these are public
          // bucket URLs already sized for a card.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-400">
            <NoPhotoIcon />
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          {item.stock_qty.toLocaleString()} {item.base_unit}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="font-mono text-xs text-neutral-500">{item.item_code}</p>
        <h3 className="mt-1 line-clamp-2 text-sm font-medium leading-snug">
          {item.name}
        </h3>
        <p className="mt-1 text-xs text-neutral-500">{item.category}</p>

        <p className="mt-2 text-xs text-neutral-400">
          {item.stock_updated_at
            ? `Stock updated ${formatDate(item.stock_updated_at)}`
            : "Stock not yet set"}
        </p>

        {isAdmin && (
          <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/5">
            {editing ? (
              <AdminEditor item={item} onDone={() => setEditing(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
              >
                Edit photo & stock
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminEditor({ item, onDone }: { item: RmItem; onDone: () => void }) {
  const [stockState, stockAction, stockPending] = useActionState(
    updateStock,
    INITIAL
  );
  const [photoState, photoAction, photoPending] = useActionState(
    uploadPhoto,
    INITIAL
  );
  const photoFormRef = useRef<HTMLFormElement>(null);

  // Clear the file input once an upload succeeds so a repeat submit doesn't
  // re-send the same file.
  useEffect(() => {
    if (photoState.ok) photoFormRef.current?.reset();
  }, [photoState.ok]);

  return (
    <div className="space-y-3">
      <form action={stockAction} className="flex items-end gap-2">
        <input type="hidden" name="item_code" value={item.item_code} />
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            On-hand stock ({item.base_unit})
          </span>
          <input
            type="number"
            name="stock_qty"
            min={0}
            step="any"
            defaultValue={item.stock_qty}
            className="w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:bg-neutral-800 dark:focus:border-white/30"
          />
        </label>
        <button
          type="submit"
          disabled={stockPending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {stockPending ? "Saving…" : "Save"}
        </button>
      </form>
      {stockState.error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {stockState.error}
        </p>
      )}
      {stockState.ok && (
        <p className="text-xs text-green-600 dark:text-green-400">Stock saved.</p>
      )}

      <form ref={photoFormRef} action={photoAction} className="space-y-2">
        <input type="hidden" name="item_code" value={item.item_code} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {item.photo_path ? "Replace photo" : "Add photo"}
          </span>
          <input
            type="file"
            name="photo"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-neutral-900 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
        </label>
        <button
          type="submit"
          disabled={photoPending}
          className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          {photoPending ? "Uploading…" : "Upload photo"}
        </button>
      </form>
      {photoState.error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {photoState.error}
        </p>
      )}
      {photoState.ok && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Photo uploaded.
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="text-xs font-medium text-neutral-500 hover:underline"
      >
        Done
      </button>
    </div>
  );
}

function NoPhotoIcon() {
  return (
    <svg
      className="h-10 w-10"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
