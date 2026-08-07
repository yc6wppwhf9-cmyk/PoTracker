import Image from "next/image";

/**
 * The High Spirit brand, in one place.
 *
 * Two assets, because one does not do both jobs. `logo.png` is the full
 * lockup — symbol, "highspirit", and "Commercial Ventures Pvt. Ltd." — which
 * reads properly at the size a sign-in screen allows. At 36px in the app
 * header the company line would be about two pixels tall, so the header uses
 * `mark.png`: the HS symbol alone, cropped from the same original.
 *
 * Both are trimmed to their ink and sit on white. The white square is
 * deliberate rather than lazy: the logo has no transparency and its blue and
 * black would disappear against a dark background, so it is given its own
 * light surface in both themes instead.
 */

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      style={{ height: size, width: size }}
      className="flex items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/10"
    >
      <Image
        src="/mark.png"
        alt="High Spirit Commercial Ventures"
        width={size}
        height={size}
        // The source is square and already padded, so it needs no cropping —
        // contain keeps the symbol whole at every size it is asked for.
        className="h-full w-full object-contain p-0.5"
        priority
      />
    </span>
  );
}

/**
 * The full lockup, for the screens shown before anyone is signed in.
 *
 * Those are where somebody decides whether a page asking for their password
 * really belongs to their employer, so the company is named in full rather
 * than reduced to a symbol.
 */
export function BrandHeader() {
  return (
    <div className="mb-6 flex flex-col items-center">
      <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
        <Image
          src="/logo.png"
          alt="High Spirit Commercial Ventures Pvt. Ltd."
          width={2064}
          height={2000}
          className="h-auto w-36"
          priority
        />
      </div>
      <p className="mt-3 text-sm font-semibold tracking-tight">
        Procurement Engine
      </p>
    </div>
  );
}
