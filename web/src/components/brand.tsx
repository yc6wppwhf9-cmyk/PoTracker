import Image from "next/image";

/**
 * The company mark, in one place.
 *
 * It lived inline in the app shell, so the login, forgot-password and
 * reset-password screens — the first thing anyone sees, and the one place a
 * person decides whether a page asking for their password is really yours —
 * had no branding at all.
 *
 * TO USE A REAL LOGO FILE: drop it at `web/public/logo.png` (or .svg) and set
 * LOGO_SRC below. Until that file exists the lettermark renders instead, so a
 * missing image degrades to something deliberate rather than a broken icon.
 */
const LOGO_SRC: string | null = null; // e.g. "/logo.png"

export function BrandMark({ size = 36 }: { size?: number }) {
  if (LOGO_SRC)
    return (
      <Image
        src={LOGO_SRC}
        alt="HSCVPL"
        width={size}
        height={size}
        className="rounded-xl object-contain"
        priority
      />
    );

  return (
    <span
      style={{ height: size, width: size }}
      className="flex items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-blue-500 text-xs font-black text-white shadow-md shadow-indigo-500/25 ring-2 ring-indigo-500/20"
    >
      RM
    </span>
  );
}

/**
 * Mark plus wordmark, for the sign-in screens.
 *
 * The company name is spelled out here and not in the app shell: someone
 * already inside knows whose system this is, someone at a login screen may be
 * checking.
 */
export function BrandHeader() {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <BrandMark size={48} />
      <h1 className="mt-3 text-lg font-extrabold tracking-tight">
        Procurement Engine
      </h1>
      <p className="text-xs font-medium text-neutral-400">
        High Spirit Commercial Ventures Pvt Ltd
      </p>
    </div>
  );
}
