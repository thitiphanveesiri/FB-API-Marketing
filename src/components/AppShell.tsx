"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, Inbox, KanbanSquare, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Upload, UserRound, X, ClipboardCheck, Timer, BellRing, MessageSquare, Layers } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import { ChannelIcon, Avatar, Badge, FeedbackHost, cn, type ChannelMark } from "./ui";
import DisplayMenu from "./DisplayMenu";
import { ANCHOR, fmtShort, nowStamp } from "@/lib/dates";
import { SLA_RULES, chatEvents } from "@/lib/sla";

const NAV = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard/ads", icon: LayoutDashboard },
  { key: "inbox", label: "Inbox", href: "/inbox", icon: Inbox },
  { key: "board", label: "Board", href: "/board", icon: KanbanSquare },
  { key: "upload", label: "Upload", href: "/upload", icon: Upload },
  { key: "settings", label: "Setting", href: "/settings", icon: Settings },
  { key: "quality", label: "Quality", href: "/quality", icon: ClipboardCheck },
  { key: "sla", label: "SLA", href: "/sla", icon: Timer },
  { key: "comments", label: "Comments", href: "/comments", icon: MessageSquare },
  { key: "followup", label: "ติดตาม", href: "/followup", icon: BellRing },
];

/** Which chat platform a page belongs to, from its id/name — Instagram pages are the "… (Instagram)" rows. */
export function pageChannelOf(p: { id: string; name: string }): ChannelMark {
  const id = p.id.toLowerCase(), name = p.name.toLowerCase();
  if (/^ig-/.test(id) || name.includes("instagram") || /\(ig\)/.test(name)) return "instagram";
  if (/^line-/.test(id) || /line oa|ไลน์/.test(name)) return "line";
  if (/^wa-/.test(id) || name.includes("whatsapp")) return "whatsapp";
  return "facebook";
}

/** Registers the service worker once, so the browser offers "install app" and push alerts can arrive. */
function useServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("[pwa] service worker registration failed", error instanceof Error ? error.name : "UnknownError");
    });
  }, []);
}

function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, close]);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  useServiceWorker();
  const { data, user, filters, setFilters, eff, source, sourceMeta, reloadData, authed, signOut } = useStore();
  const [showWarn, setShowWarn] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menu = menuAt === path; // auto-closes when the route changes
  const setMenu = (fn: boolean | ((m: boolean) => boolean)) => setMenuAt((cur) => ((typeof fn === "function" ? fn(cur === path) : fn) ? path : null));
  const [acct, setAcct] = useState(false);
  const [bell, setBell] = useState(false);
  const acctRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  useOutside(acctRef, () => setAcct(false));
  useOutside(bellRef, () => setBell(false));

  const visible = NAV.filter((n) => roleCan.nav(user.role, n.key));
  const current = path.startsWith("/account") ? "account" : NAV.find((n) => path.startsWith("/" + (n.key === "dashboard" ? "dashboard" : n.key)))?.key;

  // guard: bounce to dashboard if the current role may not open this page
  useEffect(() => {
    if (source === "sheets" && current && !roleCan.nav(user.role, current)) router.replace("/dashboard/ads"); // only once the real user is known
  }, [current, user.role, router, source]);

  const pagesForUser = data.pages.filter((p) => p.active && (eff.agencyId === "all" || p.agencyId === eff.agencyId));
  const selectedPage = data.pages.find((p) => p.id === filters.pageId);
  const pageMark: ChannelMark | null = selectedPage ? pageChannelOf(selectedPage) : null;
  const myLeads = data.leads.filter((l) => !l.dropped && (user.role !== "Sales Representative" || l.repId === user.id));
  const unread = myLeads.filter((l) => l.unread).length;
  const unassigned = data.leads.filter((l) => !l.repId && !l.dropped).length;
  // Customers still waiting for a reply (only chats whose last message is the customer's), longest wait first.
  const [nowIso, setNowIso] = useState(""); // set after mount (a clock must not be read while the page is prerendered) and every minute
  useEffect(() => { const tick = () => setNowIso(nowStamp().slice(0, 16)); const first = setTimeout(tick, 0), every = setInterval(tick, 60_000); return () => { clearTimeout(first); clearInterval(every); }; }, []);
  const waiting = !nowIso ? [] : myLeads.filter((l) => l.valid && l.unread).flatMap((l) => chatEvents(l, data.messages[l.id] ?? [], nowIso, (id) => data.users.some((u) => u.id === id && u.role === "Sales Representative")).filter((e) => e.open && !e.holiday && e.minutes >= 5)).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  const dueFollow = myLeads.filter((l) => l.followUpDate && l.followUpDate <= ANCHOR).slice(0, 5);

  if (source === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted" role="status"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-brand-soft border-t-brand" />Loading data…</div>;
  }
  if (source === "setup") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card">
          <p className="text-base font-semibold">Connect your Google Sheet to get started</p>
          <p className="mt-2 text-sm text-muted">No data source is connected yet, so there is nothing to show. Set these in Vercel (Settings → Environment Variables), then redeploy:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm"><li><code>GOOGLE_SHEET_ID</code></li><li><code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> (share the sheet with it as <b>Editor</b>)</li><li><code>GOOGLE_PRIVATE_KEY</code></li></ul>
          <p className="mt-3 text-sm text-muted">Step-by-step guide: <code>docs/DEPLOY.md</code>. Template sheet: <a className="font-medium text-brand underline" href="/google-sheet-template.xlsx">google-sheet-template.xlsx</a>.</p>
          <div className="mt-4 flex gap-2"><button onClick={() => { void reloadData(true); }} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-[#066a4d]">Check again</button>{authed && <button onClick={() => { void signOut(); }} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium hover:bg-gray-50">Sign out</button>}</div>
        </div>
      </div>
    );
  }
  if (source === "forbidden") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <p className="text-base font-semibold">This account has no access</p>
          <p className="mt-2 text-sm text-muted"><b>{sourceMeta?.message}</b> is not on the allow-list (or is switched off). Ask an Administrator to add the email to the <code>users</code> tab of the Google Sheet.</p>
          <div className="mt-4 flex justify-center"><button onClick={() => { void signOut(); }} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-[#066a4d]">Sign out and use another account</button></div>
        </div>
      </div>
    );
  }
  if (source === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <p className="text-base font-semibold">Couldn&apos;t load your Google Sheet</p>
          <p className="mt-2 text-sm text-muted">{sourceMeta?.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => { void reloadData(true); }} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-[#066a4d]">Try again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-3 px-4 lg:px-6">
          <button className="rounded-md p-1.5 text-muted hover:bg-gray-100 lg:hidden" onClick={() => setMenu((m) => !m)} aria-label="Toggle menu">{menu ? <X size={20} /> : <Menu size={20} />}</button>
          <Link href="/dashboard/ads" className="flex items-center gap-2 font-semibold text-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white"><ShieldCheck size={17} /></span>
            <span className="hidden sm:block leading-tight">BEQ</span>
          </Link>

          <label className="ml-1 hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-sm md:flex">
            {pageMark ? <ChannelIcon id={pageMark} size={15} /> : <Layers size={15} className="text-muted" aria-hidden />}
            <span className="sr-only">Page</span>
            <select value={filters.pageId} onChange={(e) => setFilters({ pageId: e.target.value })} className="max-w-[190px] bg-transparent py-0.5 text-sm font-medium focus:outline-none">
              <option value="all">All Pages</option>
              {pagesForUser.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <nav className="ml-3 hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {visible.map((n) => {
              const Icon = n.icon;
              const on = current === n.key;
              return (
                <Link key={n.key} href={n.href} aria-current={on ? "page" : undefined}
                  className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", on ? "bg-brand-soft text-brand" : "text-muted hover:bg-gray-100 hover:text-ink")}>
                  <Icon size={16} />{n.label}
                  {n.key === "inbox" && unread > 0 && <span className="ml-0.5 rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <Badge tone="green" className="hidden xl:inline-flex">Google Sheets · as of {fmtShort(ANCHOR)}</Badge>
            <DisplayMenu />
            <div className="relative" ref={bellRef}>
              <button onClick={() => setBell((b) => !b)} aria-label="Notifications" className="relative rounded-lg p-2 text-muted hover:bg-gray-100">
                <Bell size={18} />
                {(waiting.length > 0 || unread > 0 || dueFollow.length > 0) && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-surface", waiting.some((e) => e.minutes >= SLA_RULES.chatMinutes) ? "bg-red-500" : "bg-red-400")} />}
              </button>
              {bell && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-line bg-surface p-2 shadow-pop">
                  <p className="px-2 py-1 text-xs font-semibold text-muted">Notifications</p>
                  <Link href="/inbox" className="flex justify-between rounded-lg px-2 py-2 text-sm hover:bg-gray-50"><span>Unread conversations</span><b>{unread}</b></Link>
                  {roleCan.reassign(user.role) && <Link href="/board" className="flex justify-between rounded-lg px-2 py-2 text-sm hover:bg-gray-50"><span>Unassigned leads</span><b>{unassigned}</b></Link>}
                  <p className="px-2 pt-2 text-xs font-semibold text-muted">ลูกค้ารอตอบ</p>
                  {waiting.length === 0 && <p className="px-2 py-2 text-sm text-muted">ไม่มีแชทที่รอตอบ</p>}
                  {waiting.map((e) => <Link key={e.leadId + e.inAt} href="/inbox" className="flex justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"><span className="truncate">{e.leadName}</span><span className={cn("shrink-0 text-xs font-semibold", e.minutes >= SLA_RULES.chatMinutes ? "text-red-600" : "text-amber-600")}>{e.minutes >= 120 ? `${Math.floor(e.minutes / 60)} ชม.` : `${e.minutes} นาที`}</span></Link>)}
                  <p className="px-2 pt-2 text-xs font-semibold text-muted">Follow-ups due</p>
                  {dueFollow.length === 0 && <p className="px-2 py-2 text-sm text-muted">Nothing due.</p>}
                  {dueFollow.map((l) => <Link key={l.id} href="/inbox" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">{l.name} <span className="text-xs text-muted">· {fmtShort(l.followUpDate!)}</span></Link>)}
                </div>
              )}
            </div>
            <div className="relative" ref={acctRef}>
              <button onClick={() => setAcct((a) => !a)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-gray-100" aria-label="Account menu">
                <Avatar name={user.name} hue={user.hue} size={30} />
                <span className="hidden text-left text-xs leading-tight md:block"><b className="block whitespace-nowrap text-sm font-semibold">{user.name}</b><span className="text-muted">{user.role}</span></span>
                <ChevronDown size={14} className="text-muted" />
              </button>
              {acct && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-pop">
                  <Link href="/account" onClick={() => setAcct(false)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-gray-50"><UserRound size={16} /> User Account</Link>
                  <div className="my-1 border-t border-line" />
                  {authed
                    ? <button onClick={() => { void signOut(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-gray-50"><LogOut size={16} /> Sign out</button>
                    : <p className="px-2 py-2 text-xs text-muted">Sign-in is off (ALLOW_PUBLIC). Turn on Google sign-in to enable Sign out.</p>}
                </div>
              )}
            </div>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line bg-surface p-2 lg:hidden" aria-label="Mobile">
            <label className="mb-1 flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm md:hidden">{pageMark ? <ChannelIcon id={pageMark} size={15} /> : <Layers size={15} className="text-muted" aria-hidden />}
              <select value={filters.pageId} onChange={(e) => setFilters({ pageId: e.target.value })} className="w-full bg-transparent focus:outline-none">
                <option value="all">All Pages</option>
                {pagesForUser.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {visible.map((n) => { const Icon = n.icon; return <Link key={n.key} href={n.href} className={cn("flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium", current === n.key ? "bg-brand-soft text-brand" : "text-ink hover:bg-gray-50")}><Icon size={16} />{n.label}</Link>; })}
          </nav>
        )}
      </header>
      {source === "sheets" && (
        <div className="border-b border-emerald-200 bg-emerald-50 text-emerald-900">
          <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs lg:px-6">
            <span><b>Connected to your Google Sheet.</b> Changes you make here are saved to the sheet. Other people see them within about a minute.</span>
            <span className="text-emerald-700">Loaded {sourceMeta?.fetchedAt ? new Date(sourceMeta.fetchedAt).toLocaleTimeString() : ""}</span>
            <button className="font-semibold underline" disabled={reloading} onClick={async () => { setReloading(true); await reloadData(true); setReloading(false); }}>{reloading ? "Reloading…" : "Reload from sheet"}</button>
            {(sourceMeta?.warningCount ?? 0) > 0 || (sourceMeta?.missingTabs.length ?? 0) > 0 ? <button className="font-semibold underline" onClick={() => setShowWarn((v) => !v)}>{sourceMeta?.warningCount} data warning(s) {showWarn ? "▲" : "▼"}</button> : <span>No data warnings</span>}
          </div>
          {showWarn && (
            <div className="mx-auto max-w-[1560px] px-4 pb-2 text-xs lg:px-6">
              {(sourceMeta?.missingTabs.length ?? 0) > 0 && <p className="mb-1 font-semibold">Missing required tab(s): {sourceMeta?.missingTabs.join(", ")}</p>}
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">{sourceMeta?.warnings.map((w, i) => <li key={i}>{w.tab} · row {w.row}: {w.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-6">{children}</main>
      <FeedbackHost />
    </div>
  );
}
