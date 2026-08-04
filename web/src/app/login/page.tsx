import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const profile = await getSessionProfile();
  if (profile) redirect("/dashboard");

  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <LoginForm next={next} />
    </main>
  );
}
