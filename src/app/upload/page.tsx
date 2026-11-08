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

const TYPES: ImportDataType[] = ["Ads Performance", "Campaign Performance", "Ad-Level Performance", "Lead Data", "Sales Performance"];
const STEPS = ["Page", "Data type", "File", "Preview", "Map columns", "Validate", "Confirm", "Summary"];
const MAX_BYTES = 8 * 1024 * 1024;

function download(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: mime + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export default function UploadPage() {
  const { data, user, commitImport, patchLead, toast, confirm } = useStore();
  const [step, setStep] = useState(0);
  const [pageId, setPageId] = useState(data.pages.find((p) => p.active)?.id ?? "");
  const [type, setType] = useState<ImportDataType>("Ads Performance");
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
      type, mapping, rows, mode, importId: "IMP-PREVIEW", existingPerfKeys, existingAdIds: new Set(data.ads.map((a) => a.id)), existingLeadIds: new Set(data.leads.map((l) => l.id)),
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
    const id = `IMP-${String(data.imports.length + 1).padStart(3, "0")}`;
    const perf = validation.perf.map((p) => ({ ...p, importId: id }));
    const camps = new Map(data.campaigns.map((c) => [c.name.toLowerCase() + "|" + c.pageId, c]));
    const newCamps: Campaign[] = []; const newAds: Ad[] = [];
    const page = data.pages.find((p) => p.id === pageId);
    if (isAdsType(type)) {
      validation.newAdIds.forEach((n, i) => {
        const key = n.campaignName.toLowerCase() + "|" + pageId;
        let c = camps.get(key) ?? newCamps.find((x) => x.name.toLowerCase() === n.campaignName.toLowerCase() && x.pageId === pageId);
        if (!c) { c = { id: `CP-I${data.campaigns.length + newCamps.length + 1}`, name: n.campaignName, pageId, agencyId: page?.agencyId ?? "", objective: "Imported" }; newCamps.push(c); }
        newAds.push({ id: n.adId, name: n.adName, campaignId: c.id, status: "Active", creative: { type: "Image", hue: (i * 53 + 20) % 360 }, updatedAt: validation.periodEnd ?? nowStamp().slice(0, 10) });
      });
    }
    const rec: ImportRecord = {
      id, at: nowStamp(), pageId, dataType: type, fileName, mode, total: validation.total, imported: validation.ok, failed: validation.failed, duplicates: validation.duplicates,
      errors: validation.issues.map((i) => ({ row: i.row, message: `[${i.level}] ${i.message}` })), by: user.name, rows, mapping,
    };
    commitImport(rec, perf, validation.leads, mode === "replace" ? validation.replaceKeys : null, newAds, newCamps);
    if (type === "Sales Performance") validation.salesPatches.forEach((p) => patchLead(p.leadId, { repId: p.repName, ...(p.firstResponseMin != null ? { firstResponseMin: p.firstResponseMin } : {}), ...(p.followUps != null ? { followUps: p.followUps } : {}) }));
    setSummary(rec); setStep(7);
    toast(`Imported ${validation.ok} of ${validation.total} rows`);
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
    { key: "a", header: "", render: (r) => <div className="flex gap-1"><Btn size="sm" onClick={() => setViewErr(r)} disabled={r.errors.length === 0}>Errors</Btn><Btn size="sm" onClick={() => reimport(r)}><RefreshCw size={13} /> Re-import</Btn></div> },
  ];

  if (!allowed) return <EmptyState title="Upload is not available for your role" hint="Ask a Marketing Manager or Administrator to import data." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Upload</h1><Badge tone="blue">Facebook Ads Manager export · CSV / XLSX</Badge>
        <Btn size="sm" className="ml-auto" onClick={() => download("sample-ads-export.csv", SAMPLE)}><Download size={14} /> Download sample file</Btn></div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", i === step ? "bg-brand text-white" : i < step ? "bg-brand-soft text-brand" : "bg-gray-100 text-muted")}>
            {i < step ? <Check size={12} /> : <span>{i + 1}</span>}{s}</li>))}
      </ol>

      <Card>
        {step === 0 && (<div className="max-w-md space-y-4"><h2 className="font-semibold">Step 1 · Select Facebook Page</h2>
          <Select label="Facebook Page" value={pageId} onChange={setPageId} options={data.pages.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
          <p className="text-xs text-muted">New campaigns and ads found in the file are created under this Page.</p><Btn variant="primary" disabled={!pageId} onClick={() => setStep(1)}>Continue</Btn></div>)}

        {step === 1 && (<div className="max-w-xl space-y-4"><h2 className="font-semibold">Step 2 · Select data type</h2>
          <div className="grid gap-2 sm:grid-cols-2">{TYPES.map((t) => (
            <label key={t} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm", type === t ? "border-brand-2 bg-brand-faint" : "border-line hover:bg-gray-50")}><input type="radio" name="dtype" checked={type === t} onChange={() => setType(t)} className="accent-[#087a58]" />{t}</label>))}</div>
          <div className="flex gap-2"><Btn onClick={() => setStep(0)}>Back</Btn><Btn variant="primary" onClick={() => setStep(2)}>Continue</Btn></div></div>)}

        {step === 2 && (<div className="space-y-4"><h2 className="font-semibold">Step 3 · Upload file</h2>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}
            className={cn("flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center", drag ? "border-brand-2 bg-brand-faint" : "border-line")}>
            <UploadCloud size={30} className="text-brand" /><p className="text-sm font-medium">Drag a file here or</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
            <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose file"}</Btn>
            <p className="text-xs text-muted">CSV, XLSX or XLS · up to 8 MB · first sheet · header in row 1 · files are read in your browser</p></div>
          {err && <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"><AlertTriangle size={15} />{err}</p>}
          <Btn onClick={() => setStep(1)}>Back</Btn></div>)}

        {step === 3 && (<div className="space-y-4"><h2 className="font-semibold">Step 4 · Preview data</h2>
          <p className="text-sm text-muted">{fileName} · {rows.length.toLocaleString()} data rows · {headers.length} columns. Showing the first 8 rows.</p>
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-xs"><thead className="bg-gray-50"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-line">{headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-1.5">{r[h]}</td>)}</tr>)}</tbody></table></div>
          <div className="flex gap-2"><Btn onClick={() => { setStep(2); }}>Choose another file</Btn><Btn variant="primary" onClick={() => setStep(4)}>Continue to mapping</Btn></div></div>)}

        {step === 4 && (<div className="space-y-4"><h2 className="font-semibold">Step 5 · Map columns</h2>
          <p className="text-sm text-muted">Match each system field to a column in your file. Required fields are marked *. We auto-matched what we could.</p>
          <div className="grid gap-3 md:grid-cols-2">{fields.map((f) => (
            <Select key={f.key} label={`${f.label}${f.required ? " *" : ""}`} value={mapping[f.key] ?? ""} onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
              options={[{ value: "", label: f.required ? "— select column —" : "— not in file —" }, ...headers.map((h) => ({ value: h, label: `${h}  (e.g. ${rows[0]?.[h] ?? ""})` }))]} />))}</div>
          {missingMap.length > 0 && <p role="alert" className="text-sm text-amber-700">Still to map: {missingMap.map((f) => f.label).join(", ")}</p>}
          <div className="flex gap-2"><Btn onClick={() => setStep(3)}>Back</Btn><Btn variant="primary" disabled={missingMap.length > 0} onClick={() => setStep(5)}>Validate data</Btn></div></div>)}

        {step === 5 && validation && (<div className="space-y-4"><h2 className="font-semibold">Step 6 · Validate data</h2>
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

        {step === 6 && validation && (<div className="max-w-2xl space-y-4"><h2 className="font-semibold">Step 7 · Confirm import</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["incremental", "Incremental update", "Adds new rows only. Rows already imported (same Ad ID + date) are skipped. Safest option."], ["replace", "Data replacement", "Overwrites existing rows for the same Ad ID + date. Other dates and history stay untouched."]] as const).map(([v, t, d]) => (
              <label key={v} className={cn("cursor-pointer rounded-xl border p-3 text-sm", mode === v ? "border-brand-2 bg-brand-faint" : "border-line")}><span className="flex items-center gap-2 font-medium"><input type="radio" checked={mode === v} onChange={() => setMode(v)} className="accent-[#087a58]" />{t}</span><span className="mt-1 block text-xs text-muted">{d}</span></label>))}</div>
          <ul className="space-y-1 rounded-xl bg-gray-50 p-3 text-sm"><li><b>{validation.ok}</b> rows will be imported into <b>{data.pages.find((p) => p.id === pageId)?.name}</b> as <b>{type}</b>.</li>
            {isAdsType(type) && validation.periodStart && <li>Period covered: {fmtDate(validation.periodStart)} – {fmtDate(validation.periodEnd)}.</li>}
            {isAdsType(type) && <li>{validation.newAdIds.length} new ad(s) will be created. {validation.replaceKeys.size > 0 ? `${validation.replaceKeys.size} existing ad/day records will be replaced.` : "No existing records will be changed."}</li>}
            <li>{validation.failed} failed and {validation.duplicates} duplicate rows will be skipped.</li></ul>
          <div className="flex gap-2"><Btn onClick={() => setStep(5)}>Back</Btn><Btn variant="primary" onClick={commit} disabled={validation.ok === 0}>Confirm import</Btn></div></div>)}

        {step === 7 && summary && (<div className="space-y-4"><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="text-emerald-600" size={20} /> Step 8 · Import summary</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Total rows", summary.total], ["Imported", summary.imported], ["Failed", summary.failed], ["Duplicates", summary.duplicates]].map(([k, v]) => <div key={String(k)} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{k}</p><p className="text-2xl font-semibold tabnum">{v}</p></div>)}</div>
          <p className="text-sm text-muted">{summary.id} · {summary.fileName} · {summary.mode} · Imported data is labelled &ldquo;import&rdquo; and now appears across the Dashboard (this demo keeps data in memory for the current session).</p>
          <div className="flex flex-wrap gap-2">{summary.errors.length > 0 && <Btn onClick={() => download(`error-report-${summary.id}.csv`, ["Row,Description", ...summary.errors.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`)].join("\n"))}><Download size={14} /> Download error report</Btn>}<Btn variant="primary" onClick={reset}>Import another file</Btn></div></div>)}
      </Card>

      <Card title="Import history" subtitle="Every import is kept. Re-import re-opens the stored file at the validation step.">
        <DataTable columns={histCols} rows={data.imports} rowKey={(r) => r.id} emptyTitle="No imports yet" emptyHint="Your imports will be listed here. Try the sample file above." caption="Import history" />
      </Card>
      {viewErr && (<Card title={`Errors · ${viewErr.id}`} right={<div className="flex gap-2"><Btn size="sm" onClick={() => download(`error-report-${viewErr.id}.csv`, ["Row,Description", ...viewErr.errors.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`)].join("\n"))}><Download size={13} /> Download</Btn><Btn size="sm" onClick={() => setViewErr(null)}>Close</Btn></div>}>
        <ul className="max-h-60 divide-y divide-line overflow-y-auto text-sm">{viewErr.errors.slice(0, 200).map((e, i) => <li key={i} className="py-1.5">Row {e.row}: {e.message}</li>)}</ul></Card>)}
    </div>
  );
}

const SAMPLE = `Day,Campaign name,Ad ID,Ad name,Amount spent (THB),Reach,Impressions,Link clicks,Messaging conversations started,Purchases
2026-10-20,Sample Always-On,AD-9001,Hero image,520,8200,10400,180,24,1
2026-10-21,Sample Always-On,AD-9001,Hero image,540,8600,10900,190,27,2
2026-10-22,Sample Always-On,AD-9001,Hero image,505,8000,10100,170,21,0
2026-10-20,Sample Always-On,AD-9002,UGC video,610,9100,11800,230,35,2
2026-10-21,Sample Always-On,AD-9002,UGC video,598,9000,11500,222,33,1
2026-10-21,Sample Always-On,AD-9002,UGC video,598,9000,11500,222,33,1
2026-10-22,Sample Always-On,,Missing id example,300,4000,5200,80,9,0
2026-13-40,Sample Always-On,AD-9003,Bad date example,300,4000,5200,80,9,0
2026-10-22,Sample Always-On,AD-9003,Bad number,abc,4000,5200,80,9,0
2026-10-23,Sample Always-On Renamed,AD-9001,Hero image,515,8100,10200,175,22,1
`;
