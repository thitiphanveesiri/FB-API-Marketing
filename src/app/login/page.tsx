import { Suspense } from "react";
import { connection } from "next/server";
import { authConfigured, safeNext } from "@/lib/auth";
import { sheetsConfigured } from "@/lib/googleSheets";
import { LoginForm } from "./LoginForm";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <Suspense fallback={<main className="min-h-screen" />}><LoginCard searchParams={searchParams} /></Suspense>;
}

async function LoginCard({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-card">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">B</span>
          <span className="text-base font-semibold">BEQ</span>
        </div>
        <h1 className="text-xl font-semibold">เข้าสู่ระบบ</h1>
        {authConfigured() ? <LoginForm next={safeNext(next)} /> : (
          <p className="mt-5 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-muted">
            {sheetsConfigured() ? "ยังไม่ได้ตั้งค่าล็อกอิน ข้อมูลจึงถูกล็อกไว้ " : ""}ตั้งค่า <code>AUTH_SECRET</code> (สุ่ม 32 ตัวอักษรขึ้นไป) ดู docs/DEPLOY.md
          </p>
        )}
      </div>
    </main>
  );
}
