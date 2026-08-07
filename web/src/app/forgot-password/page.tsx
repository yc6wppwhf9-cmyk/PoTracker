import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <h1 className="text-xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          We will email you a link to set a new one.
        </p>

        <ForgotForm />

        <p className="mt-6 text-center text-xs text-neutral-500">
          <Link href="/login" className="hover:underline">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
