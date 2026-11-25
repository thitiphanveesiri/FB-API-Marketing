"use client";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, RefreshCw, UploadCloud } from "lucide-react";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import FbSyncCard from "@/components/FbSyncCard";
import RepairPagesCard from "@/components/RepairPagesCard";
import ChannelsCard from "@/components/ChannelsCard";
import AdsSyncCard from "@/components/AdsSyncCard";
import { autoMap, detectType, errorsToCsv, FIELDS, isAdsType, leadNameKey, validate, ValidationResult } from "@/lib/importer";
import { Badge, Btn, Card, Column, DataTable, EmptyState, Select, cn } from "@/components/ui";
import { Ad, Campaign, ImportDataType, ImportRecord, Lead } from "@/lib/types";
import { fmtDate, fmtDateTime, nowStamp } from "@/lib/dates";

const PICKER_TYPES: ImportDataType[] = ["Ads Performance", "Ad-Level Performance", "Campaign Performance", "Page Insights", "Lead Data", "Inbox Conversations", "Chat Messages", "Post Comments", "Sales Performance"];
const TYPE_INFO: { type: ImportDataType; title: string; from: string; hint: string }[] = [
  { type: "Inbox Conversations", title: "แชท/ลูกค้าจาก Inbox เพจ", from: "Meta Business Suite → กล่องข้อความ (หรือไฟล์ส่งออกจากเครื่องมือแชทที่คุณใช้)", hint: "ชื่อลูกค้า วันที่ทัก ข้อความล่าสุด โฆษณาต้นทาง → กลายเป็นการ์ดบน Board" },
  { type: "Ads Performance", title: "สถิติโฆษณา (รูปแบบทั่วไป/เดิม)", from: "Ads Manager → Reports → Export", hint: "ข้อมูลรายวันระดับโฆษณา ใช้รูปแบบเดียวกับสถิติรายโฆษณา" },
  { type: "Ad-Level Performance", title: "สถิติโฆษณา (รายโฆษณา)", from: "Ads Manager → Reports → Export (breakdown: Day, ระดับ Ad)", hint: "ค่าโฆษณา การเข้าถึง การแสดงผล ข้อความที่เริ่มต้น รายวัน รายโฆษณา" },
  { type: "Campaign Performance", title: "สถิติโฆษณา (รายแคมเปญ)", from: "Ads Manager → Reports → Export (ระดับ Campaign)", hint: "ตัวเลขรวมระดับแคมเปญ ใช้เมื่อไม่มีไฟล์รายโฆษณา" },
  { type: "Chat Messages", title: "ข้อความแชทรายข้อความ (สำหรับตรวจเวลาตอบ)", from: "ไฟล์ส่งออกจากเครื่องมือแชท / Meta Business Suite ที่มีเวลาของแต่ละข้อความ", hint: "ลูกค้าหรือเซลล์ส่ง + วันที่และเวลา ใช้คำนวณ SLA ตอบภายใน 15 นาที — ต้องมี Lead/Conversation ในระบบก่อน (นำเข้า Lead Data หรือ Inbox Conversations ก่อน)" },
  { type: "Post Comments", title: "คอมเมนต์ใต้โพสต์ (สำหรับตรวจเวลาตอบ)", from: "Meta Business Suite → กล่องข้อความ → คอมเมนต์ หรือเครื่องมือจัดการคอมเมนต์", hint: "เวลาที่ลูกค้าคอมเมนต์ + เวลาที่เพจตอบ ใช้คำนวณ SLA ตอบภายใน 1 ชั่วโมง" },
  { type: "Page Insights", title: "Insights ของเพจ", from: "Meta Business Suite → Insights → Export data", hint: "การเข้าถึง การดู การมีส่วนร่วม ผู้ติดตาม รายวัน" },
  { type: "Lead Data", title: "Leads Center / Lead Ads", from: "Meta Business Suite → Leads Center → Download", hint: "ลีดจากฟอร์ม Lead Ads (ชื่อ เบอร์ โฆษณาต้นทาง)" },
  { type: "Sales Performance", title: "ผลงานเซลล์ (อัปเดตลีดเดิม)", from: "ไฟล์ของทีมขาย", hint: "ผู้ดูแล เวลาตอบครั้งแรก จำนวนการติดตาม ของ Lead ID ที่มีอยู่แล้ว" },
];
const STEPS = ["เลือกเพจ", "ประเภทไฟล์", "อัปโหลด", "ดูตัวอย่าง", "จับคู่คอลัมน์", "ตรวจสอบ", "ยืนยัน", "สรุป"];
const MAX_BYTES = 8 * 1024 * 1024;

function download(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: mime + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export default function UploadPage() {
  const { data, user, commitImport, toast, confirm } = useStore();
  const [step, setStep] = useState(0);
  const [pageId, setPageId] = useState(data.pages.find((p) => p.active)?.id ?? "");
  const [type, setType] = useState<ImportDataType>("Ad-Level Performance");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"incremental" | "replace">("incremental");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [summary, setSummary] = useState<ImportRecord | null>(null);
  const [viewErr, setViewErr] = useState<ImportRecord | null>(null);
  const [drag, setDrag] = useState(false);
  const [auto, setAuto] = useState(true); // detect file type + map columns automatically
  const [igChoice, setIgChoice] = useState<"auto" | "none" | string>("auto"); // where rows whose Channel is Instagram go
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = FIELDS[type];
  const allowed = roleCan.upload(user.role);

  const existingPerfKeys = useMemo(() => new Set(data.perf.map((p) => `${p.adId}|${p.date}`)), [data.perf]);
  const pageLeads = useMemo(() => data.leads.filter((l) => l.pageId === pageId), [data.leads, pageId]);
  const selPage = data.pages.find((p) => p.id === pageId);
  /** The "… (Instagram)" page of the chosen page: where Instagram rows of the file are stored. */
  const autoIgPage = useMemo(() => {
    if (!selPage) return undefined;
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const label = norm(`${selPage.name.replace(/\s*\(instagram\)\s*$/i, "")} (Instagram)`);
    return data.pages.find((p) => p.active && p.id !== selPage.id && norm(p.name) === label);
  }, [data.pages, selPage]);
  const igTargetId = igChoice === "auto" ? autoIgPage?.id ?? "" : igChoice === "none" ? "" : igChoice;
  const channelPageIds = useMemo(() => (igTargetId ? { instagram: igTargetId } : undefined), [igTargetId]);
  const leadsByPage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    for (const l of data.leads) { const list = m.get(l.pageId); if (list) list.push(l); else m.set(l.pageId, [l]); }
    return m;
  }, [data.leads]);
  /** Name → lead id, but null when two leads on the page share the name: an upload only links when the match is unambiguous. */
  const leadIdsByName = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const l of pageLeads) { const k = leadNameKey(l.name); m.set(k, m.has(k) ? null : l.id); }
    return m;
  }, [pageLeads]);
  const validation: ValidationResult | null = useMemo(() => {
    if (step < 5 || rows.length === 0) return null;
    return validate({
      type, mapping, rows, mode, importId: "IMP-PREVIEW", existingPerfKeys, existingAdIds: new Set(data.ads.map((a) => a.id)), existingLeadIds: new Set(data.leads.map((l) => l.id)), existingInsightKeys: new Set(data.insights.map((i) => `${i.pageId}|${i.date}`)),
      existingLeads: pageLeads, leadIdByName: leadIdsByName, channelPageIds, leadsByPage,
      existingMessageIds: new Set(Object.values(data.messages).flat().map((m) => m.id)), existingCommentIds: new Set(data.comments.map((c) => c.id)),
      pageId, repsByName: new Map(data.users.filter((u) => u.role === "Sales Representative").map((u) => [u.name.toLowerCase(), u.id])),
      reps: data.users.filter((u) => u.role === "Sales Representative" && u.active).map((u) => ({ id: u.id, name: u.name })), nextLeadNo: data.leads.length + 1,
    });
  }, [step, rows, mapping, mode, type, pageId, data, existingPerfKeys, pageLeads, leadIdsByName, channelPageIds, leadsByPage]);

  /** Where the lead rows in the confirm step will land (new chats + updates to existing ones). */
  const pageSplit = useMemo(() => {
    if (!validation) return [];
    const counts = new Map<string, number>();
    for (const l of validation.leads) counts.set(l.pageId, (counts.get(l.pageId) ?? 0) + 1);
    for (const p of validation.leadPatches) { const l = data.leads.find((x) => x.id === p.leadId); if (l) counts.set(l.pageId, (counts.get(l.pageId) ?? 0) + 1); }
    return [...counts.entries()].map(([id, n]) => ({ id, name: data.pages.find((x) => x.id === id)?.name ?? id, n }));
  }, [validation, data]);
  const igMerged = useMemo(() => (validation?.leads ?? []).filter((l) => l.channel === "instagram" && l.pageId === pageId).length, [validation, pageId]);

  const reset = () => { setStep(0); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setErr(""); setSaveErr(""); setSummary(null); setMode("incremental"); setIgChoice("auto"); };

  const loadFile = async (file: File) => {
    setErr(""); setSaveErr(""); setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["csv", "xlsx", "xls"].includes(ext ?? "")) throw new Error("รองรับเฉพาะไฟล์ .csv, .xlsx หรือ .xls");
      if (file.size > MAX_BYTES) throw new Error("ไฟล์ใหญ่เกิน 8 MB กรุณาแยกตามช่วงวันที่แล้วอัปโหลดทีละส่วน");
      let hdr: string[] = [], recs: Record<string, string>[] = [];
      if (ext === "csv") {
        const text = await file.text();
        const out = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
        if (out.errors.length > 0) {
          const e = out.errors[0];
          throw new Error(`อ่านไฟล์ CSV ไม่สำเร็จที่แถว ${(e.row ?? 0) + 2}: ${e.message}`);
        }
        hdr = out.meta.fields ?? []; recs = out.data;
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error("ไม่พบชีตข้อมูลในไฟล์ Excel");
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
        hdr = (raw[0] ?? []).map((h) => String(h).trim());
        recs = raw.slice(1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => Object.fromEntries(hdr.map((h, i) => [h, String(r[i] ?? "")])));
      }
      hdr = hdr.filter((h) => h && h.trim() !== "");
      if (hdr.length === 0 || recs.length === 0) throw new Error("ไม่พบหัวตารางหรือข้อมูลในไฟล์ กรุณาตรวจสอบว่าหัวตารางอยู่แถวแรกและมีข้อมูลอย่างน้อย 1 แถว");
      setFileName(file.name); setHeaders(hdr); setRows(recs);
      const det0 = auto ? detectType(hdr) : null;
      const det = det0;
      if (det) {
        // Recognised: switch to the detected type and, when every required field is mapped, go straight to validation.
        setType(det.type); setMapping(det.mapping);
        const label = TYPE_INFO.find((t) => t.type === det.type)?.title ?? det.type;
        toast(`ตรวจพบประเภทไฟล์: ${label} · จับคู่คอลัมน์ให้อัตโนมัติแล้ว กรุณาตรวจสอบก่อนยืนยัน`, "info");
        setStep(5);
      } else {
        setMapping(autoMap(hdr, fields));
        if (auto) toast("ระบบเดาประเภทไฟล์ไม่ได้ กรุณาเลือกประเภทและจับคู่คอลัมน์เอง", "info");
        setStep(auto ? 4 : 3);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  };

  const required = fields.filter((f) => f.required);
  const missingMap = required.filter((f) => !mapping[f.key]);

  const commit = async () => {
    if (!validation) return;
    if (validation.ok === 0) { toast("Nothing valid to import.", "error"); return; }
    if (mode === "replace" && validation.replaceKeys.size > 0) {
      const r = await confirm({ title: "Replace existing data?", message: `${validation.replaceKeys.size} existing ad/day records will be replaced with values from this file. Other dates are not touched and the previous import stays in history.`, confirmLabel: "Replace", tone: "danger" });
      if (!r.ok) return;
    }
    const id = `IMP-${Date.now().toString(36).toUpperCase()}`;
    const perf = validation.perf.map((p) => ({ ...p, importId: id }));
    const camps = new Map(data.campaigns.map((c) => [c.name.toLowerCase() + "|" + c.pageId, c]));
    const newCamps: Campaign[] = []; const newAds: Ad[] = [];
    const page = data.pages.find((p) => p.id === pageId);
    if (isAdsType(type)) {
      validation.newAdIds.forEach((n, i) => {
        const key = n.campaignName.toLowerCase() + "|" + pageId;
        let c = camps.get(key) ?? newCamps.find((x) => x.name.toLowerCase() === n.campaignName.toLowerCase() && x.pageId === pageId);
        if (!c) { c = { id: `CP-${Date.now().toString(36).toUpperCase()}${newCamps.length}`, name: n.campaignName, pageId, agencyId: page?.agencyId ?? "", objective: "Imported" }; newCamps.push(c); }
        newAds.push({ id: n.adId, name: n.adName, campaignId: c.id, status: "Active", creative: { type: "Image", hue: (i * 53 + 20) % 360 }, updatedAt: validation.periodEnd ?? nowStamp().slice(0, 10) });
      });
    }
    const rec: ImportRecord = {
      id, at: nowStamp(), pageId, dataType: type, fileName, mode, total: validation.total, imported: validation.ok, failed: validation.failed, duplicates: validation.duplicates,
      errors: validation.issues.map((i) => ({ row: i.row, message: `[${i.level}] ${i.message}` })), by: user.name, rows, mapping,
    };
    const patches = [
      ...(type === "Sales Performance" ? validation.salesPatches.map((p) => ({ lead_id: p.leadId, set: { assigned_to: p.repName, ...(p.firstResponseMin != null ? { first_response_min: p.firstResponseMin } : {}), ...(p.followUps != null ? { follow_ups: p.followUps } : {}) } })) : []),
      ...validation.leadPatches.map((p) => ({ lead_id: p.leadId, set: p.set })),
    ];
    setBusy(true); setSaveErr("");
    let result;
    try {
      result = await commitImport(rec, perf, validation.leads, mode === "replace" ? new Set([...validation.replaceKeys, ...validation.replaceInsightKeys]) : null, newAds, newCamps, validation.insights, patches, {
        users: validation.newReps.map((r) => ({ user_id: r.id, name: r.name })),
        messages: validation.messages.map((m) => ({ message_id: m.id, lead_id: m.leadId, direction: m.direction, text: m.text, sent_at: m.at.replace("T", " ").slice(0, 16) })),
        comments: validation.comments.map((c) => ({ comment_id: c.id, page_id: c.pageId, post_id: c.postId, commenter: c.commenter, text: c.text, commented_at: c.at.replace("T", " ").slice(0, 16), replied_at: c.repliedAt ? c.repliedAt.replace("T", " ").slice(0, 16) : "", replied_by: c.repliedBy })),
      });
    } catch {
      result = { ok: false, message: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
    } finally {
      setBusy(false);
    }
    if (!result.ok) { setSaveErr(result.message); return; }
    setSummary(rec); setStep(7);
    toast(`บันทึก ${validation.ok} จาก ${validation.total} แถวลง Google Sheet แล้ว${validation.merged ? ` · อัปเดต ${validation.merged} แชทที่จับคู่ไว้แล้ว` : ""}`);
  };

  const reimport = (rec: ImportRecord) => {
    setPageId(rec.pageId); setType(rec.dataType); setFileName(rec.fileName); setRows(rec.rows); setHeaders(Object.keys(rec.rows[0] ?? {})); setMapping(rec.mapping); setMode("replace"); setSummary(null); setStep(5);
    toast("Loaded previous file for re-import. Review and confirm.", "info");
  };

  const histCols: Column<ImportRecord>[] = [
    { key: "id", header: "Import", sort: (r) => r.id, render: (r) => <span className="font-medium">{r.id}</span> },
    { key: "at", header: "When", sort: (r) => r.at, render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.at)}</span> },
    { key: "file", header: "File", render: (r) => <span className="flex items-center gap-1"><FileSpreadsheet size={14} className="text-muted" />{r.fileName}</span> },
    { key: "type", header: "Type", render: (r) => <Badge>{r.dataType}</Badge> },
    { key: "mode", header: "Mode", render: (r) => <Badge tone={r.mode === "replace" ? "amber" : "green"}>{r.mode}</Badge> },
    { key: "imp", header: "Imported", align: "right", render: (r) => `${r.imported}/${r.total}` },
    { key: "f", header: "Failed", align: "right", render: (r) => r.failed },
    { key: "d", header: "Duplicates", align: "right", render: (r) => r.duplicates },
    { key: "by", header: "By", render: (r) => r.by },
    { key: "a", header: "", render: (r) => <div className="flex gap-1"><Btn size="sm" onClick={() => setViewErr(r)} disabled={r.errors.length === 0}>Errors</Btn>{r.rows.length > 0 && <Btn size="sm" onClick={() => reimport(r)}><RefreshCw size={13} /> Re-import</Btn>}</div> },
  ];

  if (!allowed) return <EmptyState title="Upload is not available for your role" hint="Ask a Marketing Manager or Administrator to import data." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Upload</h1><Badge tone="blue">นำเข้าข้อมูล · CSV / XLSX</Badge>
        <Btn size="sm" className="ml-auto" onClick={() => download(`sample-${type.toLowerCase().replace(/[^a-z]+/g, "-")}.csv`, SAMPLES[type])}><Download size={14} /> ดาวน์โหลดไฟล์ตัวอย่าง</Btn></div>

      <ChannelsCard />
      <FbSyncCard />
      <RepairPagesCard />
      <AdsSyncCard />

      <p className="text-sm text-muted"><b>อัปโหลดข้อมูลเพจ (สำรอง)</b> — รองรับสถิติโฆษณา/Insights, Lead Data, Inbox Conversations, Chat Messages, Post Comments และ Sales Performance; ใช้เมื่อดึงจาก Meta โดยตรงไม่ได้หรือมีไฟล์ส่งออกจากเครื่องมืออื่น</p>
      <ol className="flex flex-wrap gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", i === step ? "bg-brand text-white" : i < step ? "bg-brand-soft text-brand" : "bg-gray-100 text-muted")}>
            {i < step ? <Check size={12} /> : <span>{i + 1}</span>}{s}</li>))}
      </ol>

      <Card>
          {step === 0 && (<div className="max-w-lg space-y-4"><h2 className="font-semibold">ขั้นที่ 1 · เลือกเพจ</h2>
            <Select label="เพจหลักของไฟล์" value={pageId} onChange={setPageId} options={data.pages.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
            <Select label="เพจ Instagram (สำหรับแถวที่ช่องทางเป็น IG)" value={igChoice} onChange={setIgChoice}
              options={[
                { value: "auto", label: autoIgPage ? `อัตโนมัติ — ${autoIgPage.name}` : "อัตโนมัติ — ยังไม่พบเพจ Instagram" },
                { value: "none", label: "ไม่แยก — เก็บรวมกับเพจหลัก" },
                ...data.pages.filter((p) => p.active && p.id !== pageId).map((p) => ({ value: p.id, label: `แยกไปที่ ${p.name}` })),
              ]} />
            <p className="text-xs text-muted">แถวอื่นทั้งหมดจะถูกบันทึกให้เพจหลัก (แคมเปญ/โฆษณาใหม่สร้างภายใต้เพจหลัก) · ถ้าไฟล์มีคอลัมน์ <b>Channel</b> แถวที่ระบุ Instagram จะไปเพจ Instagram ที่เลือกไว้ ไม่ปนกับแชท Facebook · เพจ Instagram ในระบบมักชื่อ “ชื่อเพจ (Instagram)” สร้างได้ที่ Setting → Pages</p>
            {igTargetId && igTargetId !== pageId && <p className="text-xs text-emerald-700">แถว Instagram จะถูกเก็บแยกในเพจ “{data.pages.find((p) => p.id === igTargetId)?.name}” — ชื่อ/เบอร์ที่ตรงกับแชท Instagram เดิมจะอัปเดตการ์ดเดิม</p>}
            {data.pages.length === 0 && <p className="text-sm text-amber-700">ยังไม่มีเพจในระบบ — เพิ่มที่หน้า Setting → Pages หรือในแท็บ pages ของ Google Sheet ก่อน</p>}<div className="flex flex-wrap gap-2"><Btn variant="primary" disabled={!pageId} onClick={() => { setAuto(true); setStep(2); }}>เลือกไฟล์เลย (ให้ระบบตรวจประเภทให้)</Btn><Btn disabled={!pageId} onClick={() => setStep(1)}>เลือกประเภทไฟล์เอง</Btn></div></div>)}

        {step === 1 && (<div className="max-w-3xl space-y-4"><h2 className="font-semibold">ขั้นที่ 2 · เลือกประเภทไฟล์ที่จะอัปโหลด</h2>
          <div className="grid gap-2 sm:grid-cols-2">{TYPE_INFO.filter((t) => PICKER_TYPES.includes(t.type)).map((t) => (
            <label key={t.type} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3 text-sm", type === t.type ? "border-brand-2 bg-brand-faint" : "border-line hover:bg-gray-50")}>
              <input type="radio" name="dtype" checked={type === t.type} onChange={() => setType(t.type)} className="mt-1 accent-[#087a58]" />
              <span><span className="block font-medium">{t.title}</span><span className="mt-0.5 block text-xs text-muted">{t.hint}</span><span className="mt-1 block text-[11px] text-muted">ดาวน์โหลดจาก: {t.from}</span></span></label>))}</div>
          <div className="flex gap-2"><Btn onClick={() => setStep(0)}>ย้อนกลับ</Btn><Btn variant="primary" onClick={() => setStep(2)}>ต่อไป</Btn></div></div>)}

        {step === 2 && (<div className="space-y-4"><h2 className="font-semibold">ขั้นที่ 3 · อัปโหลดไฟล์</h2>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1 accent-[#087a58]" /><span><span className="block font-medium">ตรวจประเภทไฟล์และจับคู่คอลัมน์อัตโนมัติ</span><span className="block text-xs text-muted">ระบบดูจากหัวคอลัมน์ ถ้าช่องที่จำเป็นครบจะข้ามไปขั้นตรวจสอบเลย (เลือกประเภทในขั้นก่อนหน้าไว้เป็นค่าตั้งต้นเท่านั้น) ปิดช่องนี้ถ้าอยากจับคู่เอง</span></span></label>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}
            className={cn("flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center", drag ? "border-brand-2 bg-brand-faint" : "border-line")}>
            <UploadCloud size={30} className="text-brand" /><p className="text-sm font-medium">ลากไฟล์มาวางที่นี่ หรือ</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
            <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "กำลังอ่าน…" : "เลือกไฟล์"}</Btn>
            <p className="text-xs text-muted">CSV, XLSX หรือ XLS · ไม่เกิน 8 MB · ชีตแรก · หัวตารางอยู่แถวที่ 1 · ไฟล์ถูกอ่านในเบราว์เซอร์ของคุณก่อน แล้วค่อยบันทึกลง Google Sheet เมื่อกดยืนยัน</p></div>
          {err && <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"><AlertTriangle size={15} />{err}</p>}
          <Btn onClick={() => setStep(1)}>ย้อนกลับ</Btn></div>)}

        {step === 3 && (<div className="space-y-4"><h2 className="font-semibold">ขั้นที่ 4 · ดูตัวอย่างข้อมูล</h2>
          <p className="text-sm text-muted">{fileName} · {rows.length.toLocaleString()} data rows · {headers.length} columns. Showing the first 8 rows.</p>
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-xs"><thead className="bg-gray-50"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-line">{headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-1.5">{r[h]}</td>)}</tr>)}</tbody></table></div>
          <div className="flex gap-2"><Btn onClick={() => { setStep(2); }}>Choose another file</Btn><Btn variant="primary" onClick={() => setStep(4)}>Continue to mapping</Btn></div></div>)}

        {step === 4 && (<div className="space-y-4"><h2 className="font-semibold">ขั้นที่ 5 · จับคู่คอลัมน์</h2>
          <p className="text-sm text-muted">จับคู่ช่องของระบบกับคอลัมน์ในไฟล์ ช่องที่มี * จำเป็นต้องมี ระบบจับคู่ให้อัตโนมัติเท่าที่ทำได้ (รองรับหัวคอลัมน์ภาษาไทย/อังกฤษ)</p>
          <div className="grid gap-3 md:grid-cols-2">{fields.map((f) => (
            <Select key={f.key} label={`${f.label}${f.required ? " *" : ""}`} value={mapping[f.key] ?? ""} onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
              options={[{ value: "", label: f.required ? "— select column —" : "— not in file —" }, ...headers.map((h) => ({ value: h, label: `${h}  (e.g. ${rows[0]?.[h] ?? ""})` }))]} />))}</div>
          {missingMap.length > 0 && <p role="alert" className="text-sm text-amber-700">Still to map: {missingMap.map((f) => f.label).join(", ")}</p>}
          <div className="flex gap-2"><Btn onClick={() => setStep(3)}>Back</Btn><Btn variant="primary" disabled={missingMap.length > 0} onClick={() => setStep(5)}>Validate data</Btn></div></div>)}

        {step === 5 && validation && (<div className="space-y-4"><h2 className="font-semibold">ขั้นที่ 6 · ตรวจสอบข้อมูล</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([["Total rows", validation.total, ""], ["Will import", validation.ok, "text-emerald-600"], ...(validation.merged ? [["Updated", validation.merged, "text-brand"]] : []), ["Failed", validation.failed, validation.failed ? "text-red-500" : ""], ["Duplicates", validation.duplicates, validation.duplicates ? "text-amber-600" : ""], ["Warnings", validation.warnings, validation.warnings ? "text-amber-600" : ""]] as [string, number, string][]).map(([k, v, c]) => (
              <div key={String(k)} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{k}</p><p className={cn("text-2xl font-semibold tabnum", String(c))}>{v}</p></div>))}</div>
          {validation.issues.length > 0 ? (<div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Issues ({validation.issues.length})</h3>
            <Btn size="sm" onClick={() => download(`error-report-${fileName}.csv`, errorsToCsv(validation.issues))}><Download size={13} /> Download error report</Btn></div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-line"><table className="w-full text-sm"><thead className="sticky top-0 bg-gray-50 text-xs"><tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Description</th></tr></thead>
              <tbody>{validation.issues.slice(0, 200).map((i, k) => <tr key={k} className="border-t border-line"><td className="px-3 py-1.5 tabnum">{i.row}</td><td className="px-3 py-1.5"><Badge tone={i.level === "error" ? "red" : "amber"}>{i.level}</Badge></td><td className="px-3 py-1.5">{i.message}</td></tr>)}</tbody></table></div>
            {validation.issues.length > 200 && <p className="mt-1 text-xs text-muted">Showing first 200. Download the report for all.</p>}</div>)
            : <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} /> No problems found.</p>}
          <div className="flex gap-2"><Btn onClick={() => setStep(4)}>Back to mapping</Btn><Btn variant="primary" disabled={validation.ok === 0} onClick={() => setStep(6)}>Continue</Btn></div></div>)}

        {step === 6 && validation && (<div className="max-w-2xl space-y-4"><h2 className="font-semibold">ขั้นที่ 7 · ยืนยันการนำเข้า</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["incremental", "เพิ่มเฉพาะแถวใหม่", "ข้ามแถวที่เคยนำเข้าแล้ว (Ad ID + วันที่ / Lead ID / วันที่ของเพจ เดียวกัน) ปลอดภัยที่สุด"], ["replace", "เขียนทับ", "เขียนทับแถวเดิมที่คีย์ตรงกัน วันที่อื่นและประวัติไม่ถูกแตะ"]] as const).map(([v, t, d]) => (
              <label key={v} className={cn("cursor-pointer rounded-xl border p-3 text-sm", mode === v ? "border-brand-2 bg-brand-faint" : "border-line")}><span className="flex items-center gap-2 font-medium"><input type="radio" checked={mode === v} onChange={() => setMode(v)} className="accent-[#087a58]" />{t}</span><span className="mt-1 block text-xs text-muted">{d}</span></label>))}</div>
          <ul className="space-y-1 rounded-xl bg-gray-50 p-3 text-sm"><li><b>{validation.ok}</b> rows will be imported into <b>{data.pages.find((p) => p.id === pageId)?.name}</b> as <b>{type}</b>.</li>
            {(isAdsType(type) || type === "Page Insights" || type === "Chat Messages" || type === "Post Comments") && validation.periodStart && <li>Period covered: {fmtDate(validation.periodStart)} – {fmtDate(validation.periodEnd)}.</li>}
            {isAdsType(type) && <li>{validation.newAdIds.length} new ad(s) will be created. {validation.replaceKeys.size > 0 ? `${validation.replaceKeys.size} existing ad/day records will be replaced.` : "No existing records will be changed."}</li>}
            {(type === "Lead Data" || type === "Inbox Conversations") && <li>ตรงกับลีด/แชทที่มีอยู่แล้ว <b>{validation.merged}</b> แถว (อัปเดตการ์ดเดิม ไม่สร้างซ้ำ) · ไม่ตรง <b>{validation.leads.length}</b> แถว (จะสร้างการ์ดใหม่)</li>}
            {(type === "Lead Data" || type === "Inbox Conversations") && pageSplit.length > 1 &&
              <li>แยกตามเพจ: {pageSplit.map((p) => <span key={p.id} className="mr-2 whitespace-nowrap"><b>{p.name}</b> {p.n} แถว</span>)}</li>}
            {(type === "Lead Data" || type === "Inbox Conversations") && igMerged > 0 && !igTargetId &&
              <li className="text-amber-700">มี {igMerged} แถว Instagram ที่จะถูกเก็บรวมในเพจหลัก — ถ้าต้องการแยก ให้กลับไปขั้นที่ 1 แล้วเลือกเพจ Instagram</li>}
            {(type === "Lead Data" || type === "Inbox Conversations") && validation.merged === 0 && validation.leads.length > 0 &&
              <li className="text-amber-700">ไม่ตรงกับลีดเดิมเลย — ถ้าควรจะตรง ให้ตรวจ 2 อย่าง: เพจที่เลือกต้องเป็นเพจเดียวกับแชท และชื่อในไฟล์ต้องเขียนเหมือนชื่อที่แสดงบนแชท (หรือมีเบอร์/อีเมลตรงกับลีดเดิม)</li>}
            <li>{validation.failed} failed and {validation.duplicates} duplicate rows will be skipped.</li></ul>
          {saveErr && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>บันทึกไม่สำเร็จ</b><br />{saveErr} ข้อมูลในหน้าจอยังอยู่ สามารถกดยืนยันอีกครั้งได้</span></p>}
          <div className="flex gap-2"><Btn onClick={() => setStep(5)}>Back</Btn><Btn variant="primary" onClick={commit} disabled={validation.ok === 0 || busy}>{busy ? "กำลังบันทึกลง Google Sheet…" : "ยืนยันและบันทึก"}</Btn></div></div>)}

        {step === 7 && summary && (<div className="space-y-4"><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="text-emerald-600" size={20} /> ขั้นที่ 8 · สรุปการนำเข้า</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Total rows", summary.total], ["Imported", summary.imported], ["Failed", summary.failed], ["Duplicates", summary.duplicates]].map(([k, v]) => <div key={String(k)} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{k}</p><p className="text-2xl font-semibold tabnum">{v}</p></div>)}</div>
          <p className="text-sm text-muted">{summary.id} · {summary.fileName} · {summary.mode} · บันทึกลง Google Sheet แล้ว และแสดงในแดชบอร์ด/บอร์ดทันที</p>
          <div className="flex flex-wrap gap-2">{summary.errors.length > 0 && <Btn onClick={() => download(`error-report-${summary.id}.csv`, ["Row,Description", ...summary.errors.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`)].join("\n"))}><Download size={14} /> Download error report</Btn>}<Btn variant="primary" onClick={reset}>อัปโหลดไฟล์อื่น</Btn></div></div>)}
      </Card>

      <Card title="ประวัติการอัปโหลด" subtitle="บันทึกในแท็บ import_log ของ Google Sheet ทุกครั้งที่อัปโหลด">
        <DataTable columns={histCols} rows={data.imports} rowKey={(r) => r.id} emptyTitle="ยังไม่มีการอัปโหลด" emptyHint="เลือกประเภทไฟล์แล้วอัปโหลดได้เลย หรือดาวน์โหลดไฟล์ตัวอย่างด้านบนเพื่อลองก่อน" caption="Import history" />
      </Card>
      {viewErr && (<Card title={`Errors · ${viewErr.id}`} right={<div className="flex gap-2"><Btn size="sm" onClick={() => download(`error-report-${viewErr.id}.csv`, ["Row,Description", ...viewErr.errors.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`)].join("\n"))}><Download size={13} /> Download</Btn><Btn size="sm" onClick={() => setViewErr(null)}>Close</Btn></div>}>
        <ul className="max-h-60 divide-y divide-line overflow-y-auto text-sm">{viewErr.errors.slice(0, 200).map((e, i) => <li key={i} className="py-1.5">Row {e.row}: {e.message}</li>)}</ul></Card>)}
    </div>
  );
}

const AD_PERFORMANCE_SAMPLE = `Day,Campaign name,Ad ID,Ad name,Amount spent (THB),Reach,Impressions,Link clicks,Messaging conversations started,Purchases
2026-10-20,Sample Always-On,AD-9001,Hero image,520,8200,10400,180,24,1
2026-10-21,Sample Always-On,AD-9001,Hero image,540,8600,10900,190,27,2
2026-10-20,Sample Always-On,AD-9002,UGC video,610,9100,11800,230,35,2
2026-10-21,Sample Always-On,AD-9002,UGC video,598,9000,11500,222,33,1
2026-10-22,Sample Always-On,,Missing id example,300,4000,5200,80,9,0
2026-13-40,Sample Always-On,AD-9003,Bad date example,300,4000,5200,80,9,0
`;
const SAMPLES: Record<ImportDataType, string> = {
  "Inbox Conversations": `ชื่อลูกค้า,วันที่ทัก,ข้อความล่าสุด,วันที่ข้อความล่าสุด,Ad ID,เบอร์โทร,สถานะ
สมชาย ใจดี,2026-11-01,สนใจสอบถามราคาครับ,2026-11-02,AD-9001,0812345678,พอได้คุย
Napat K.,2026-11-02,ขอบคุณค่ะ จะติดต่อกลับ,2026-11-03,AD-9001,,ไม่ตอบ
มาลี รักดี,2026-11-03,นัดวันเสาร์นี้ได้ไหมคะ,2026-11-05,AD-9002,0899999999,นัดได้แล้ว
`,
  "Ads Performance": AD_PERFORMANCE_SAMPLE, "Ad-Level Performance": AD_PERFORMANCE_SAMPLE,
  "Campaign Performance": `Day,Campaign name,Amount spent (THB),Reach,Impressions,Link clicks,Messaging conversations started,Purchases
2026-10-20,Sample Always-On,1130,17300,22200,410,59,3
2026-10-21,Sample Always-On,1138,17600,22400,412,60,3
`,
  "Chat Messages": `ช่องทาง,ชื่อลูกค้า,ผู้ส่ง,เวลา,ข้อความ
fb,สมชาย ใจดี,ลูกค้า,2026-11-01 10:05,สนใจสอบถามราคาครับ
fb,สมชาย ใจดี,เพจ,2026-11-01 10:12,ยินดีให้บริการค่ะ
ig,Napat K.,ลูกค้า,2026-11-02 11:00,ขอรายละเอียดหน่อยค่ะ
ig,Napat K.,เพจ,2026-11-02 11:40,ส่งให้ทางข้อความแล้วค่ะ
`,
  "Post Comments": `โพสต์,ชื่อลูกค้า,ความคิดเห็น,เวลาคอมเมนต์,เวลาที่เพจตอบ
POST-001,มาลี รักดี,ราคาเท่าไหร่คะ,2026-11-01 10:30,2026-11-01 10:50
POST-001,Chai W.,สนใจค่ะ,2026-11-01 13:00,2026-11-01 14:30
POST-002,สมหญิง ศรีสุข,มีสาขาไหนบ้าง,2026-11-02 15:00,
`,
  "Page Insights": `Date,Reach,Views,Engagements,Followers,New followers,Link clicks
2026-10-20,5200,8100,410,12840,12,95
2026-10-21,4900,7600,380,12851,11,88
2026-10-22,6100,9300,520,12866,15,120
`,
  "Lead Data": `full_name,created_time,phone_number,ad_id,lead_status
สมหญิง ศรีสุข,2026-10-20,0811111111,AD-9001,Qualified
Chai W.,2026-10-21,0822222222,AD-9002,มีคุณสมบัติ
`,
  "Sales Performance": `Lead ID,Salesperson,First response (min),Follow-ups
L-00001,Anan Wong,12,3
`,
};
