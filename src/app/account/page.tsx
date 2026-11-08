"use client";
import { useStore } from "@/lib/store";
import { Avatar, Badge, Card } from "@/components/ui";
import { scopeFor } from "@/lib/queries";

export default function Account() {
  const { user, data } = useStore();
  const scope = scopeFor(user);
  const ag = data.agencies.find((a) => a.id === scope.agencyId);
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">User Account</h1>
      <Card>
        <div className="flex items-center gap-4"><Avatar name={user.name} hue={user.hue} size={64} /><div><p className="text-lg font-semibold">{user.name}</p><p className="text-sm text-muted">{user.email}</p><div className="mt-1 flex gap-1.5"><Badge tone="blue">{user.role}</Badge><Badge tone={user.active ? "green" : "gray"}>{user.active ? "Active" : "Disabled"}</Badge></div></div></div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Data you can see</dt><dd>{scope.repId ? "Only leads assigned to you" : scope.agencyId ? `Only campaigns of ${ag?.name}` : user.role === "Viewer" ? "Read-only dashboards" : "All pages, campaigns and leads"}</dd></div>
          <div><dt className="text-xs text-muted">Session</dt><dd>Demo session — no real sign-in</dd></div>
        </dl>
      </Card>
      <Card title="Switch demo user"><p className="text-sm text-muted">Use the account menu (top right) → “Demo: view as another user” to see how each role&apos;s navigation, data scope and permissions change.</p></Card>
    </div>
  );
}
