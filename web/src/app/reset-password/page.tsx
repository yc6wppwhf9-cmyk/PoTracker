import { ResetForm } from "./reset-form";
import { BrandHeader } from "@/components/brand";

/**
 * Where a recovery link lands.
 *
 * A shell only. The link carries its tokens in the URL fragment, which is
 * never sent to a server, so everything that decides what to show — a valid
 * link, an expired one, the form itself — happens in the browser.
 */
export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <BrandHeader />
        <h1 className="text-center text-base font-semibold tracking-tight">
          Choose a new password
        </h1>

        <ResetForm />
      </div>
    </main>
  );
}
