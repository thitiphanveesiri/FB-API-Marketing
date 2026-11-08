"use client";
import { ReactNode } from "react";
import { ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export const PALETTE = ["#087a58", "#3b82f6", "#e0a431", "#8b5cf6", "#dc6b6b", "#14b8a6"];

export interface Series { key: string; name: string; color?: string; type?: "line" | "area" | "bar"; dashed?: boolean; yAxisId?: "left" | "right" }

export function TimeChart({ data, series, height = 260, fmt = (n: number) => n.toLocaleString("en-US"), fmtRight, xKey = "label", stacked = false }: {
  data: Record<string, number | string | null>[]; series: Series[]; height?: number; fmt?: (n: number) => string; fmtRight?: (n: number) => string; xKey?: string; stacked?: boolean;
}) {
  const hasRight = series.some((s) => s.yAxisId === "right");
  return (
    <div style={{ height }} role="img" aria-label="Chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={24} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmt(Number(v))} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => (fmtRight ?? fmt)(Number(v))} />}
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}
            formatter={(v, name, item) => [typeof v === "number" ? ((item as { payload?: unknown; dataKey?: string }).dataKey && series.find((s) => s.key === (item as { dataKey?: string }).dataKey)?.yAxisId === "right" ? (fmtRight ?? fmt)(v) : fmt(v)) : "—", name as string]}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => {
            const color = s.color ?? PALETTE[i % PALETTE.length];
            const common = { dataKey: s.key, name: s.name, yAxisId: s.yAxisId ?? "left", stroke: color, isAnimationActive: false } as const;
            if (s.type === "bar") return <Bar key={s.key} dataKey={s.key} name={s.name} yAxisId={s.yAxisId ?? "left"} fill={color} radius={[3, 3, 0, 0]} stackId={stacked ? "a" : undefined} isAnimationActive={false} />;
            if (s.type === "area") return <Area key={s.key} {...common} fill={color} fillOpacity={0.14} strokeWidth={2} type="monotone" connectNulls />;
            return <Line key={s.key} {...common} strokeWidth={2} dot={false} type="monotone" strokeDasharray={s.dashed ? "5 4" : undefined} connectNulls />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartCard({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-sm font-semibold">{title}</h3>{subtitle && <p className="text-xs text-muted">{subtitle}</p>}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
