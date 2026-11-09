"use client";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, RefreshCw, UploadCloud } from "lucide-react";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import { autoMap, errorsToCsv, FIELDS, isAdsType, validate, ValidationResult } from "@/lib/importer";
import { Badge, Btn, Card, Column, DataTable, EmptyState, Select, cn } from "@/components/ui";
import { Ad, Campaign, ImportDataType, ImportRecord } from "@/lib/types";
import { fmtDate, fmtDateTime, nowStamp } from "@/lib/dates";

const TYPE_INFO: { type: ImportDataType; title: string; from: string; hint: string }[] = [
  { type: "Inbox Conversations", title: "แชท/ลูกค้าจาก Inbox เพจ", from: "Meta Business Suite → กล่องข้อความ (หรือไฟล์ส่งออกจากเครื่องมือแชทที่คุณใช้)", hint: "ชื่อลูกค้า วันที่ทัก ข้อความล่าสุด โฆษณาต้นทาง → กลายเป็นการ์ดบน Board" },
  { type: "Ad-Level Performance", title: "สถิติโฆษณา (รายโฆษณา)", from: "Ads Manager → Reports → Export (breakdown: Day, ระดับ Ad)", hint: "ค่าโฆษณา การเข้าถึง การแสดงผล ข้อความที่เริ่มต้น รายวัน รายโฆษณา" },
  { type: "Campaign Performance", title: "สถิติโฆษณา (รายแคมเปญ)", from: "Ads Manager → Reports → Export (ระดับ Campaign)", hint: "ตัวเลขรวมระดับแคมเปญ ใช้เมื่อไม่มีไฟล์รายโฆษณา" },
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
  const [type, setType] = useState<ImportDataType>("Inbox Conversations");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"incremental" | "replace">("incremental");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<ImportRecord | null>(null);
  const [viewErr, setViewErr] = useState<ImportRecord | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = FIELDS[type];
  const allowed = roleCan.upload(user.role);

  const existingPerfKeys = useMemo(() => new Set(data.perf.map((p) => `${p.adId}|${p.date}`)), [data.perf]);
  const validation: ValidationResult | null = useMemo(() => {
    if (step < 5 || rows.length === 0) return null;
    return validate({
      type, mapping, rows, mode, importId: "IMP-PREVIEW", existingPerfKeys, existingAdIds: new Set(data.ads.map((a) => a.id)), existingLeadIds: new Set(data.leads.map((l) => l.id)), existingInsightKeys: new Set(data.insights.map((i) => `${i.pageId}|${i.date}`)),
      pageId, repsByName: new Map(data.users.filter((u) => u.role === "Sales Representative").map((u) => [u.name.toLowerCase(), u.id])), nextLeadNo: data.leads.length + 1,
    });
  }, [step, rows, mapping, mode, type, pageId, data, existingPerfKeys]);

  const reset = () => { setStep(0); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setErr(""); setSummary(null); setMode("incremental"); };

  const loadFile = async (file: File) => {
    setErr(""); setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["csv", "xlsx", "xls"].includes(ext ?? "")) throw new Error("Unsupported file type. Please upload a .csv, .xlsx or .xls file.");
      if (file.size > MAX_BYTES) throw new Error("File is larger than 8 MB. Split it by date range and import in parts.");
      let hdr: string[] = [], recs: Record<string, string>[] = [];
      if (ext === "csv") {
        const text = await file.text();
        const out = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
        hdr = out.meta.fields ?? []; recs = out.data;
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
        hdr = (raw[0] ?? []).map((h) => String(h).trim());
        recs = raw.slice(1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => Object.fromEntries(hdr.map((h, i) => [h, String(r[i] ?? "")])));
      }
      hdr = hdr.filter((h) => h && h.trim() !== "");
      if (hdr.length === 0 || recs.length === 0) throw new Error("The file has no header row or no data rows.");
      setFileName(file.name); setHeaders(hdr); setRows(recs); setMapping(autoMap(hdr, fields)); setStep(3);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not read the file."); }
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
    const patches = type === "Sales Performance" ? validation.salesPatches.map((p) => ({ lead_id: p.leadId, set: { assigned_to: p.repName, ...(p.firstResponseMin != null ? { first_response_min: p.firstResponseMin } : {}), ...(p.followUps != null ? { follow_ups: p.followUps } : {}) } })) : [];
    setBusy(true);
    const ok = await commitImport(rec, perf, validation.leads, mode === "replace" ? new Set([...validation.replaceKeys, ...validation.replaceInsightKeys]) : null, newAds, newCamps, validation.insights, patches);
    setBusy(false);
    if (!ok) return; // the store already showed why it was not saved; stay on this step so nothing is lost
    setSummary(rec); setStep(7);
    toast(`บันทึก ${validation.ok} จาก ${validation.total} แถวลง Google Sheet แล้ว`);
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
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Upload</h1><Badge tone="blue">ข้อมูลเพจ Facebook · CSV / XLSX</Badge>
        <Btn size="sm" className="ml-auto" onClick={() => download(`sample-${type.toLowerCase().replace(/[^a-z]+/g, "-")}.csv`, SAMPLES[type])}><Download size={14} /> ดาวน์โหลดไฟล์ตัวอย่าง</Btn></div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", i === step ? "bg-brand text-white" : i < step ? "bg-brand-soft text-brand" : "bg-gray-100 text-muted")}>
            {i < step ? <Check size={12} /> : <span>{i + 1}</span>}{s}</li>))}
      </ol>

      <Card>
        {step === 0 && (<div className="max-w-md space-y-4"><h2 className="font-semibold">ขั้นที่ 1 · เลือกเพจ Facebook</h2>
          <Select label="เพจ Facebook" value={pageId} onChange={setPageId} options={data.pages.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
          <p className="text-xs text-muted">ข้อมูลทั้งหมดในไฟล์จะถูกบันทึกให้เพจนี้ (แคมเปญ/โฆษณาใหม่จะถูกสร้างภายใต้เพจนี้)</p>{data.pages.length === 0 && <p className="text-sm text-amber-700">ยังไม่มีเพจในระบบ — เพิ่มที่หน้า Setting → Pages หรือในแท็บ pages ของ Google Sheet ก่อน</p>}<Btn variant="primary" disabled={!pageId} onClick={() => setStep(1)}>ต่อไป</Btn></div>)}

        {step === 1 && (<div className="max-w-3xl space-y-4"><h2 className="font-semibold">ขั้นที่ 2 · เลือกประเภทไฟล์ที่จะอัปโหลด</h2>
          <div className="grid gap-2 sm:grid-cols-2">{TYPE_INFO.map((t) => (
            <label key={t.type} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3 text-sm", type === t.type ? "border-brand-2 bg-brand-faint" : "border-line hover:bg-gray-50")}>
              <input type="radio" name="dtype" checked={type === t.type} onChange={() => setType(t.type)} className="mt-1 accent-[#087a58]" />
              <span><span className="block font-medium">{t.title}</span><span className="mt-0.5 block text-xs text-muted">{t.hint}</span><span className="mt-1 block text-[11px] text-muted">ดาวน์โหลดจาก: {t.from}</span></span></label>))}</div>
          <div className="flex gap-2"><Btn onClick={() => setStep(0)}>ย้อนกลับ</Btn><Btn variant="primary" onClick={() => setStep(2)}>ต่อไป</Btn></div></div>)}

        {step === 2 && (<div className="space-y-4"><h2 className="font-semibold">ขั้นที่ 3 · อัปโหลดไฟล์</h2>
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
            {[["Total rows", validation.total, ""], ["Will import", validation.ok, "text-emerald-600"], ["Failed", validation.failed, validation.failed ? "text-red-500" : ""], ["Duplicates", validation.duplicates, validation.duplicates ? "text-amber-600" : ""], ["Warnings", validation.warnings, validation.warnings ? "text-amber-600" : ""]].map(([k, v, c]) => (
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
            {(isAdsType(type) || type === "Page Insights") && validation.periodStart && <li>Period covered: {fmtDate(validation.periodStart)} – {fmtDate(validation.periodEnd)}.</li>}
            {isAdsType(type) && <li>{validation.newAdIds.length} new ad(s) will be created. {validation.replaceKeys.size > 0 ? `${validation.replaceKeys.size} existing ad/day records will be replaced.` : "No existing records will be changed."}</li>}
            <li>{validation.failed} failed and {validation.duplicates} duplicate rows will be skipped.</li></ul>
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

const SAMPLES: Record<ImportDataType, string> = {
  "Inbox Conversations": `ชื่อลูกค้า,วันที่ทัก,ข้อความล่าสุด,วันที่ข้อความล่าสุด,Ad ID,เบอร์โทร,สถานะ
สมชาย ใจดี,2026-11-01,สนใจสอบถามราคาครับ,2026-11-02,AD-9001,0812345678,พอได้คุย
Napat K.,2026-11-02,ขอบคุณค่ะ จะติดต่อกลับ,2026-11-03,AD-9001,,ไม่ตอบ
มาลี รักดี,2026-11-03,นัดวันเสาร์นี้ได้ไหมคะ,2026-11-05,AD-9002,0899999999,นัดได้แล้ว
`,
  "Ads Performance": "", "Ad-Level Performance": `Day,Campaign name,Ad ID,Ad name,Amount spent (THB),Reach,Impressions,Link clicks,Messaging conversations started,Purchases
2026-10-20,Sample Always-On,AD-9001,Hero image,520,8200,10400,180,24,1
2026-10-21,Sample Always-On,AD-9001,Hero image,540,8600,10900,190,27,2
2026-10-20,Sample Always-On,AD-9002,UGC video,610,9100,11800,230,35,2
2026-10-21,Sample Always-On,AD-9002,UGC video,598,9000,11500,222,33,1
2026-10-22,Sample Always-On,,Missing id example,300,4000,5200,80,9,0
2026-13-40,Sample Always-On,AD-9003,Bad date example,300,4000,5200,80,9,0
`,
  "Campaign Performance": `Day,Campaign name,Amount spent (THB),Reach,Impressions,Link clicks,Messaging conversations started,Purchases
2026-10-20,Sample Always-On,1130,17300,22200,410,59,3
2026-10-21,Sample Always-On,1138,17600,22400,412,60,3
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
