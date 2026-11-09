import { Suspense } from "react";
import { connection } from "next/server";
import { authConfigured, safeNext } from "@/lib/auth";
import { sheetsConfigured } from "@/lib/googleSheets";

const MESSAGES: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  state: "The sign-in session expired. Please try again.",
  google: "Google could not verify this account. Please try again.",
  config: "Sign-in is not set up on this server yet.",
};

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; detail?: string }> }) {
  return <Suspense fallback={<main className="min-h-screen" />}><LoginCard searchParams={searchParams} /></Suspense>;
}

async function LoginCard({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; detail?: string }> }) {
  await connection();
  const { error, next, detail } = await searchParams;
  const ready = authConfigured();
  const hint = detail && /^[a-z_0-9]{1,40}$/.test(detail) ? ` (${detail})` : "";
  const msg = error ? (MESSAGES[error] ?? "Sign-in failed.") + hint : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-card">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">M</span>
          <span className="text-base font-semibold">Marketing Intelligence</span>
        </div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use your Google account. Only emails listed by an Administrator can get in.</p>
        {msg && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</p>}
        {ready ? (
          <a href={`/api/auth/login?next=${encodeURIComponent(safeNext(next))}`} className="mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface text-sm font-medium transition-colors hover:bg-gray-50">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </a>
        ) : (
          <p className="mt-5 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-muted">
            {sheetsConfigured() ? "Sign-in isn't configured, so data is locked. " : ""}Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>AUTH_SECRET</code> (see docs/DEPLOY.md).
          </p>
        )}
      </div>
    </main>
  );
}
