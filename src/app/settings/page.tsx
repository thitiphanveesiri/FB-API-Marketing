"use client";
import { useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import { aggregate, fmtMoney, fmtPct, leadStats } from "@/lib/metrics";
import { Avatar, Badge, Btn, Card, Column, DataTable, Modal, Select, TextInput, cn, DemoBadge } from "@/components/ui";
import { Agency, FbPage, ROLES, Role, User } from "@/lib/types";

type Tab = "pages" | "agencies" | "users" | "roles";
const TABS: { id: Tab; label: string }[] = [{ id: "pages", label: "Facebook Pages" }, { id: "agencies", label: "Agencies" }, { id: "users", label: "Users" }, { id: "roles", label: "Roles & Permissions" }];
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export default function SettingsPage() {
  const { user } = useStore();
  const [tab, setTab] = useState<Tab>("pages");
  const canManage = roleCan.manageSettings(user.role);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Setting</h1><DemoBadge />
        {!canManage && <Badge tone="blue">Read-only for your role</Badge>}</div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
        {TABS.map((t) => <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>{t.label}</button>)}
      </nav>
      {tab === "pages" && <PagesTab canManage={canManage} />}
      {tab === "agencies" && <AgenciesTab canManage={canManage} />}
      {tab === "users" && <UsersTab canManage={canManage} />}
      {tab === "roles" && <RolesTab />}
    </div>
  );
}

function PagesTab({ canManage }: { canManage: boolean }) {
  const { data, savePage, toast, confirm } = useStore();
  const [edit, setEdit] = useState<FbPage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const reps = data.users.filter((u) => u.role === "Sales Representative" && u.active);
  const agName = (id: string | null) => data.agencies.find((a) => a.id === id)?.name ?? "—";
  const save = () => {
    if (!edit) return;
    const e: Record<string, string> = {};
    if (edit.name.trim().length < 3) e.name = "Enter at least 3 characters";
    if (data.pages.some((p) => p.id !== edit.id && p.name.toLowerCase() === edit.name.trim().toLowerCase())) e.name = "A page with this name already exists";
    setErr(e); if (Object.keys(e).length) return;
    savePage({ ...edit, name: edit.name.trim() }); toast(isNew ? "Page added" : "Page updated"); setEdit(null);
  };
  const cols: Column<FbPage>[] = [
    { key: "n", header: "Page", sort: (p) => p.name, render: (p) => <span className="font-medium">{p.name}</span> },
    { key: "a", header: "Agency", sort: (p) => agName(p.agencyId), render: (p) => agName(p.agencyId) },
    { key: "t", header: "Sales team", render: (p) => <div className="flex -space-x-1.5">{p.teamIds.map((id) => { const u = data.users.find((x) => x.id === id); return u ? <span key={id} title={u.name}><Avatar name={u.name} hue={u.hue} size={26} /></span> : null; })}{p.teamIds.length === 0 && <span className="text-xs text-gray-400">None</span>}</div> },
    { key: "s", header: "Status", sort: (p) => String(p.active), render: (p) => <Badge tone={p.active ? "green" : "gray"}>{p.active ? "Active" : "Disabled"}</Badge> },
    { key: "x", header: "", render: (p) => canManage && <div className="flex gap-1"><Btn size="sm" onClick={() => { setIsNew(false); setErr({}); setEdit({ ...p }); }}>Edit</Btn>
      <Btn size="sm" onClick={async () => { if (p.active) { const r = await confirm({ title: `Disable ${p.name}?`, message: "The page is hidden from selectors and new imports. Existing data is kept.", tone: "danger", confirmLabel: "Disable" }); if (!r.ok) return; } savePage({ ...p, active: !p.active }); toast(p.active ? "Page disabled" : "Page enabled"); }}>{p.active ? "Disable" : "Enable"}</Btn></div> },
  ];
  return (
    <Card title="Facebook Pages" subtitle="Connect pages to agencies and sales teams." right={canManage && <Btn variant="primary" onClick={() => { setIsNew(true); setErr({}); setEdit({ id: `PG-${data.pages.length + 1}`, name: "", active: true, agencyId: null, teamIds: [] }); }}><Plus size={15} /> Add Facebook Page</Btn>}>
      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Pages here are entered manually. Linking a real Page (OAuth + page access token) is part of the Meta API phase.</p>
      <DataTable columns={cols} rows={data.pages} rowKey={(p) => p.id} caption="Facebook pages" />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Add Facebook Page" : "Edit page"} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" onClick={save}>Save</Btn></>}>
        {edit && <div className="space-y-3">
          <TextInput label="Page name *" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={err.name} />
          <Select label="Agency" value={edit.agencyId ?? ""} onChange={(v) => setEdit({ ...edit, agencyId: v || null })} options={[{ value: "", label: "No agency" }, ...data.agencies.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name }))]} />
          <fieldset><legend className="mb-1 text-xs font-medium text-muted">Sales team</legend><div className="grid gap-1 sm:grid-cols-2">{reps.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#087a58]" checked={edit.teamIds.includes(r.id)} onChange={(e) => setEdit({ ...edit, teamIds: e.target.checked ? [...edit.teamIds, r.id] : edit.teamIds.filter((x) => x !== r.id) })} />{r.name}</label>))}</div></fieldset>
        </div>}
      </Modal>
    </Card>
  );
}

function AgenciesTab({ canManage }: { canManage: boolean }) {
  const { data, saveAgency, assignCampaigns, toast } = useStore();
  const [edit, setEdit] = useState<Agency | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [assign, setAssign] = useState<Agency | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [perf, setPerf] = useState<Agency | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    if (!edit) return;
    const e: Record<string, string> = {};
    if (edit.name.trim().length < 2) e.name = "Enter an agency name";
    if (!emailOk(edit.email)) e.email = "Enter a valid email";
    setErr(e); if (Object.keys(e).length) return;
    saveAgency(edit); toast(isNew ? "Agency added" : "Agency updated"); setEdit(null);
  };
  const stats = (a: Agency) => {
    const adIds = new Set(data.ads.filter((ad) => data.campaigns.find((c) => c.id === ad.campaignId)?.agencyId === a.id).map((x) => x.id));
    const p = aggregate(data.perf.filter((x) => adIds.has(x.adId)));
    const ls = leadStats(data.leads.filter((l) => l.adId && adIds.has(l.adId)));
    return { campaigns: data.campaigns.filter((c) => c.agencyId === a.id).length, spend: p.spend, ls, cpq: ls.qualified ? p.spend / ls.qualified : null };
  };
  const cols: Column<Agency>[] = [
    { key: "n", header: "Agency", sort: (a) => a.name, render: (a) => <div><span className="font-medium">{a.name}</span><span className="block text-xs text-muted">{a.contact} · {a.email}</span></div> },
    { key: "c", header: "Campaigns", align: "right", sort: (a) => stats(a).campaigns, render: (a) => stats(a).campaigns },
    { key: "s", header: "Status", render: (a) => <Badge tone={a.active ? "green" : "gray"}>{a.active ? "Active" : "Disabled"}</Badge> },
    { key: "x", header: "", render: (a) => <div className="flex gap-1"><Btn size="sm" onClick={() => setPerf(a)}>Performance</Btn>{canManage && <><Btn size="sm" onClick={() => { setIsNew(false); setErr({}); setEdit({ ...a }); }}>Edit</Btn><Btn size="sm" onClick={() => { setPicked(data.campaigns.filter((c) => c.agencyId === a.id).map((c) => c.id)); setAssign(a); }}>Assign campaigns</Btn></>}</div> },
  ];
  const ps = perf ? stats(perf) : null;
  return (
    <Card title="Agencies" right={canManage && <Btn variant="primary" onClick={() => { setIsNew(true); setErr({}); setEdit({ id: `AG-${data.agencies.length + 1}`, name: "", contact: "", email: "", active: true }); }}><Plus size={15} /> Add Agency</Btn>}>
      <DataTable columns={cols} rows={data.agencies} rowKey={(a) => a.id} caption="Agencies" />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Add agency" : "Edit agency"} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" onClick={save}>Save</Btn></>}>
        {edit && <div className="space-y-3"><TextInput label="Agency name *" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={err.name} /><TextInput label="Contact person" value={edit.contact} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /><TextInput label="Email *" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} error={err.email} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#087a58]" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label></div>}
      </Modal>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign campaigns · ${assign?.name ?? ""}`} footer={<><Btn onClick={() => setAssign(null)}>Cancel</Btn><Btn variant="primary" onClick={() => { if (assign) { assignCampaigns(assign.id, picked); toast("Campaigns assigned"); setAssign(null); } }}>Save</Btn></>}>
        <ul className="space-y-1.5">{data.campaigns.map((c) => <li key={c.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#087a58]" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />{c.name}<span className="text-xs text-muted">· currently {data.agencies.find((a) => a.id === c.agencyId)?.name ?? "none"}</span></label></li>)}</ul>
      </Modal>
      <Modal open={!!perf} onClose={() => setPerf(null)} title={`Agency performance · ${perf?.name ?? ""}`}>
        {ps && <div className="grid grid-cols-2 gap-2">{[["Campaigns", ps.campaigns], ["Spend (all time)", fmtMoney(ps.spend)], ["Valid leads", ps.ls.valid], ["Qualified rate", fmtPct(ps.ls.qualifiedRate)], ["Cost per qualified", fmtMoney(ps.cpq, 0)], ["Converted", ps.ls.converted]].map(([k, v]) => <div key={String(k)} className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-muted">{k}</p><p className="text-lg font-semibold tabnum">{v}</p></div>)}</div>}
      </Modal>
    </Card>
  );
}

function UsersTab({ canManage }: { canManage: boolean }) {
  const { data, saveUser, toast, confirm, user: me } = useStore();
  const [edit, setEdit] = useState<User | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    if (!edit) return;
    const e: Record<string, string> = {};
    if (edit.name.trim().length < 2) e.name = "Enter a name";
    if (!emailOk(edit.email)) e.email = "Enter a valid email";
    if (data.users.some((u) => u.id !== edit.id && u.email.toLowerCase() === edit.email.toLowerCase())) e.email = "Email already in use";
    if (edit.role === "Agency" && !edit.agencyId) e.agency = "Choose the agency this user belongs to";
    setErr(e); if (Object.keys(e).length) return;
    saveUser({ ...edit, agencyId: edit.role === "Agency" ? edit.agencyId : undefined }); toast(isNew ? "User added" : "User updated"); setEdit(null);
  };
  const cols: Column<User>[] = [
    { key: "n", header: "User", sort: (u) => u.name, render: (u) => <div className="flex items-center gap-2"><Avatar name={u.name} hue={u.hue} size={30} /><div><span className="font-medium">{u.name}</span><span className="block text-xs text-muted">{u.email}</span></div></div> },
    { key: "r", header: "Role", sort: (u) => u.role, render: (u) => <Badge tone={u.role === "Administrator" ? "violet" : "blue"}>{u.role}</Badge> },
    { key: "s", header: "Status", sort: (u) => String(u.active), render: (u) => <Badge tone={u.active ? "green" : "gray"}>{u.active ? "Active" : "Disabled"}</Badge> },
    { key: "x", header: "", render: (u) => canManage && <div className="flex gap-1"><Btn size="sm" onClick={() => { setIsNew(false); setErr({}); setEdit({ ...u }); }}>Edit</Btn>
      <Btn size="sm" disabled={u.id === me.id} title={u.id === me.id ? "You cannot disable yourself" : ""} onClick={async () => { if (u.active) { const r = await confirm({ title: `Disable ${u.name}?`, message: "They can no longer sign in. Their leads stay assigned until you reassign them.", tone: "danger", confirmLabel: "Disable" }); if (!r.ok) return; } saveUser({ ...u, active: !u.active }); toast(u.active ? "User disabled" : "User enabled"); }}>{u.active ? "Disable" : "Enable"}</Btn></div> },
  ];
  return (
    <Card title="Users" subtitle="Demo users only — real sign-in (Supabase Auth / SSO) arrives with the database phase." right={canManage && <Btn variant="primary" onClick={() => { setIsNew(true); setErr({}); setEdit({ id: `U-${Date.now().toString(36)}`, name: "", email: "", role: "Viewer", active: true, hue: Math.floor(Math.random() * 360) }); }}><Plus size={15} /> Add User</Btn>}>
      <DataTable columns={cols} rows={data.users} rowKey={(u) => u.id} searchText={(u) => `${u.name} ${u.email} ${u.role}`} searchPlaceholder="Search users…" caption="Users" />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Add user" : "Edit user"} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" onClick={save}>Save</Btn></>}>
        {edit && <div className="space-y-3"><TextInput label="Full name *" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={err.name} /><TextInput label="Email *" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} error={err.email} />
          <Select label="Role" value={edit.role} onChange={(v) => setEdit({ ...edit, role: v as Role })} options={ROLES.map((r) => ({ value: r, label: r }))} />
          {edit.role === "Agency" && <><Select label="Agency *" value={edit.agencyId ?? ""} onChange={(v) => setEdit({ ...edit, agencyId: v })} options={[{ value: "", label: "— select —" }, ...data.agencies.map((a) => ({ value: a.id, label: a.name }))]} />{err.agency && <p className="text-xs text-red-500">{err.agency}</p>}</>}</div>}
      </Modal>
    </Card>
  );
}

const PERMS: { label: string; check: (r: Role) => boolean }[] = [
  { label: "Dashboard (all views)", check: (r) => r !== "Agency" },
  { label: "Dashboard — own campaigns only", check: (r) => r === "Agency" },
  { label: "Inbox", check: (r) => roleCan.nav(r, "inbox") },
  { label: "Board", check: (r) => roleCan.nav(r, "board") },
  { label: "Edit leads / move stages", check: (r) => roleCan.editLeads(r) },
  { label: "Mark Converted", check: (r) => roleCan.moveToConverted(r) },
  { label: "Reassign leads", check: (r) => roleCan.reassign(r) },
  { label: "Upload data", check: (r) => roleCan.upload(r) },
  { label: "Quality (view)", check: (r) => roleCan.nav(r, "quality") },
  { label: "Quality (evaluate)", check: (r) => roleCan.evaluate(r) },
  { label: "Settings (view)", check: (r) => roleCan.nav(r, "settings") },
  { label: "Settings (manage)", check: (r) => roleCan.manageSettings(r) },
];
function RolesTab() {
  const rows = useMemo(() => PERMS, []);
  return (
    <Card title="Role-based access control" subtitle="Permissions are enforced in the demo UI. In production, enforce the same rules on the server (and with database row-level security).">
      <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs"><tr><th className="px-3 py-2 text-left">Permission</th>{ROLES.map((r) => <th key={r} className="px-3 py-2 text-center font-semibold">{r}</th>)}</tr></thead>
        <tbody>{rows.map((p) => <tr key={p.label} className="border-t border-line"><td className="px-3 py-2">{p.label}</td>{ROLES.map((r) => <td key={r} className="px-3 py-2 text-center">{p.check(r) ? <Check size={16} className="mx-auto text-emerald-600" aria-label="Allowed" /> : <Minus size={16} className="mx-auto text-gray-300" aria-label="Not allowed" />}</td>)}</tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-muted">Sales Representatives see only their own assigned leads; Agency users only see campaigns assigned to their agency. To change a user&apos;s role, edit the user on the Users tab.</p>
    </Card>
  );
}
