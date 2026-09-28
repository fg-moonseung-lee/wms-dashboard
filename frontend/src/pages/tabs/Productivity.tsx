import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAllZoneData } from '../../hooks/useAllZoneData'
import { periodToRange, dateToBucket, bucketLabel } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import { OWNER_COLOR, OWNERS } from '../../lib/supabase'
import type { ZoneDaily } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import type { Metric } from './Overview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'

interface Props { period: Period; metric: Metric; granularity: Granularity }

const fmtM   = (v: number) => `${v.toFixed(1)}백만`
const fmtBox = (v: number) => `${v.toLocaleString('ko-KR')}박스`
const fmtNum = (v: number) => v.toLocaleString('ko-KR')

function metricVal(r: ZoneDaily, metric: Metric) {
  return metric === 'amount' ? (r.pick_amount ?? 0) : (r.pick_box ?? 0)
}

function SectionCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="px-5 py-3.5 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  )
}

/* ── 브랜드별 시간당 생산성 추이 (전체 데이터, granularity) ── */
function weeklyPphByOwner(rows: ZoneDaily[], metric: Metric, gran: Granularity) {
  const scale = metric === 'amount' ? 1_000_000 : 1
  const map = new Map<string, Map<string, { val: number; wave: number }>>()
  for (const r of rows) {
    const bucket = dateToBucket(r.work_date, gran)
    if (!map.has(bucket)) map.set(bucket, new Map())
    const bm = map.get(bucket)!
    if (!bm.has(r.owner)) bm.set(r.owner, { val: 0, wave: 0 })
    const e = bm.get(r.owner)!
    e.val  += metricVal(r, metric) / scale
    e.wave += r.wave_time_hr ?? 0
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, bm]) => ({
      label: bucketLabel(bucket, gran),
      ...Object.fromEntries(OWNERS.map(o => {
        const e = bm.get(o) ?? { val: 0, wave: 0 }
        return [o, e.wave > 0 ? +(e.val / e.wave).toFixed(3) : null]
      })),
    }))
}

/* ── 구역별 시간당 생산성 집계 (작업시간 기준) ── */
interface ZonePphRow {
  zone: string; owner: string; pph: number; val: number; wave: number
}
function zonePph(rows: ZoneDaily[], metric: Metric): ZonePphRow[] {
  const scale = metric === 'amount' ? 1_000_000 : 1
  const map = new Map<string, ZonePphRow>()
  for (const r of rows) {
    const key = `${r.owner}|${r.zone}`
    if (!map.has(key)) map.set(key, { zone: r.zone, owner: r.owner, pph: 0, val: 0, wave: 0 })
    const e = map.get(key)!
    e.val  += metricVal(r, metric) / scale
    e.wave += r.wave_time_hr ?? 0
  }
  return [...map.values()]
    .map(e => ({ ...e, pph: e.wave > 0 ? e.val / e.wave : 0 }))
    .sort((a, b) => b.pph - a.pph)
}

/* ── 구역별 작업시간 기준 vs WMS기준 생산성 비교 ── */
interface ZoneWmsRow {
  zone: string; owner: string
  wave: number; wms: number; val: number
  pphWave: number; pphWms: number
}
function zoneWmsComparison(rows: ZoneDaily[], metric: Metric): ZoneWmsRow[] {
  const scale = metric === 'amount' ? 1_000_000 : 1
  const map = new Map<string, { zone: string; owner: string; wave: number; wms: number; val: number }>()
  for (const r of rows) {
    const key = `${r.owner}|${r.zone}`
    if (!map.has(key)) map.set(key, { zone: r.zone, owner: r.owner, wave: 0, wms: 0, val: 0 })
    const e = map.get(key)!
    e.wave += r.wave_time_hr ?? 0
    if (r.wms_time_hr != null && r.wms_time_hr > 0) e.wms += r.wms_time_hr
    e.val += metricVal(r, metric) / scale
  }
  return [...map.values()]
    .filter(e => e.wms > 0)
    .map(e => ({
      ...e,
      pphWave: e.wave > 0 ? e.val / e.wave : 0,
      pphWms:  e.wms > 0 ? e.val / e.wms : 0,
    }))
    .sort((a, b) => b.pphWave - a.pphWave)
}

/* ── 브랜드별 시간당 피킹 (전체 데이터, granularity) — 그룹 바용 ── */
function pickPerHourByBrand(rows: ZoneDaily[], metric: Metric, gran: Granularity) {
  const scale = metric === 'amount' ? 1_000_000 : 1
  const map = new Map<string, Map<string, { val: number; wave: number }>>()
  for (const r of rows) {
    const bucket = dateToBucket(r.work_date, gran)
    if (!map.has(bucket)) map.set(bucket, new Map())
    const bm = map.get(bucket)!
    if (!bm.has(r.owner)) bm.set(r.owner, { val: 0, wave: 0 })
    const e = bm.get(r.owner)!
    e.val  += metricVal(r, metric) / scale
    e.wave += r.wave_time_hr ?? 0
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, bm]) => ({
      label: bucketLabel(bucket, gran),
      ...Object.fromEntries(OWNERS.map(o => {
        const e = bm.get(o) ?? { val: 0, wave: 0 }
        return [o, e.wave > 0 ? +(e.val / e.wave).toFixed(3) : null]
      })),
    }))
}

/* ── 메인 컴포넌트 ── */
export default function Productivity({ period, metric, granularity }: Props) {
  const { rows, loading } = useAllZoneData()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-letusOrange border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs">데이터 로딩 중...</p>
        </div>
      </div>
    )
  }

  const { start, end } = periodToRange(period)
  const pRows = rows.filter(r => r.work_date >= start && r.work_date <= end)
  const isAmt = metric === 'amount'
  const unit = isAmt ? '백만원' : '박스'
  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : '월간'

  /* 전체 KPI — 선택 기간 기준 */
  let totalWave = 0, totalVal = 0, totalWms = 0, totalValWms = 0
  const scale = isAmt ? 1_000_000 : 1
  for (const r of pRows) {
    totalWave += r.wave_time_hr ?? 0
    totalVal += metricVal(r, metric) / scale
    if (r.wms_time_hr != null && r.wms_time_hr > 0) {
      totalWms += r.wms_time_hr
      totalValWms += metricVal(r, metric) / scale
    }
  }
  const pickPerHr    = totalWave > 0 ? totalVal / totalWave : 0
  const pickPerHrWms = totalWms > 0 ? totalValWms / totalWms : null

  /* 차트 데이터 — 일별은 선택 기간, 주간/월간은 전체 기반 */
  const chartRows = granularity === 'day' ? pRows : rows
  const pphTrendByOwner = weeklyPphByOwner(chartRows, metric, granularity)
  const zonePphRows     = zonePph(pRows, metric)   // 구역별 시간당생산성은 기간 기준 유지
  const pphTrend        = pickPerHourByBrand(chartRows, metric, granularity)
  const zoneWms         = zoneWmsComparison(pRows, metric)

  return (
    <div className="space-y-5 animate-fade-in">

      {/* KPI 요약 — 선택 기간 기준 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">총 작업시간</p>
            <p className="text-2xl font-bold text-sky-600">{totalWave.toFixed(0)}h</p>
            <p className="text-xs text-muted-foreground mt-1">
              WMS {totalWms > 0 ? totalWms.toFixed(0) + 'h' : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              시간당 피킹 ({unit}/h)
            </p>
            <p className="text-2xl font-bold text-[#FF6B35]">
              {isAmt ? fmtM(pickPerHr) : fmtBox(Math.round(pickPerHr))}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              작업시간 기준 · WMS기준&nbsp;
              <span className="font-medium text-foreground">
                {pickPerHrWms != null ? (isAmt ? fmtM(pickPerHrWms) : fmtBox(Math.round(pickPerHrWms))) : '-'}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">총 {isAmt ? '피킹금액' : '피킹박스수'}</p>
            <p className="text-2xl font-bold">{isAmt ? fmtM(totalVal) : fmtBox(Math.round(totalVal))}</p>
            <p className="text-xs text-muted-foreground mt-1">선택 기간 합계</p>
          </CardContent>
        </Card>
      </div>

      {/* 브랜드별 시간당 생산성 추이 — 전체 히스토리 */}
      <SectionCard title={`브랜드별 시간당 생산성 ${granLabel} 추이 (${unit}/h)`} subtitle="작업시간 기준">
        {pphTrendByOwner.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터 없음</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={pphTrendByOwner} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={v => isAmt ? `${v}백만` : fmtNum(v)}
              />
              <Tooltip
                content={(props: any) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload}
                    label={props.label}
                    formatter={(v) => isAmt ? `${fmtM(v)}/h` : `${fmtBox(Math.round(v))}/h`}
                  />
                )}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {OWNERS.map(o => (
                <Line
                  key={o} dataKey={o}
                  stroke={OWNER_COLOR[o]} strokeWidth={2.5}
                  dot={{ r: 4, fill: OWNER_COLOR[o] }} activeDot={{ r: 6 }}
                  type="monotone" connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* 구역별 시간당 생산성 + 브랜드별 시간당 나란히 */}
      <div className="grid grid-cols-2 gap-5">

        {/* 구역별 시간당 생산성 수평 막대 — 선택 기간 기준 */}
        <SectionCard title={`구역별 시간당 생산성 비교 (${unit}/h)`} subtitle="작업시간 기준 · 높은 순">
          {zonePphRows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, zonePphRows.length * 28)}>
              <BarChart
                data={zonePphRows}
                layout="vertical"
                margin={{ top: 4, right: 48, left: 24, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickFormatter={v => isAmt ? `${v}백만` : fmtNum(v)}
                />
                <YAxis
                  type="category" dataKey="zone"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  width={36}
                />
                <Tooltip
                  formatter={((v: number, _: string, props: any) => {
                    const item = props.payload as ZonePphRow
                    return [isAmt ? `${fmtM(v)}/h` : `${fmtBox(Math.round(v))}/h`, `${item?.owner ?? ''} · ${item?.zone ?? ''}`]
                  }) as any}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="pph" radius={[0, 4, 4, 0]} maxBarSize={20}
                  label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: ((v: number) => isAmt ? v.toFixed(1) : fmtNum(Math.round(v))) as any }}
                >
                  {zonePphRows.map(z => (
                    <Cell key={z.zone} fill={OWNER_COLOR[z.owner]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* 브랜드별 시간당 피킹 — 그룹 바, 전체 히스토리 */}
        <SectionCard
          title={`브랜드별 시간당 피킹 ${granLabel} 추이 (${unit}/h)`}
          subtitle="작업시간 기준"
        >
          {pphTrend.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pphTrend} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={v => isAmt ? `${v}백만` : fmtNum(v)}
                />
                <Tooltip
                  content={(props: any) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload}
                      label={props.label}
                      formatter={(v) => isAmt ? `${fmtM(v)}/h` : `${fmtBox(Math.round(v))}/h`}
                    />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {OWNERS.map(o => (
                  <Bar key={o} dataKey={o} fill={OWNER_COLOR[o]} radius={[3,3,0,0]} maxBarSize={20} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* 구역별 시간 기준별 생산성 비교 테이블 */}
      {zoneWms.length > 0 && (
        <SectionCard
          title={`구역별 생산성 비교 (${unit}/h)`}
          subtitle="작업시간 기준 vs WMS 근무시간 기준"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-3 font-medium">구역</th>
                  <th className="text-right pb-2 pr-3 font-medium">작업시간</th>
                  <th className="text-right pb-2 pr-3 font-medium">WMS시간</th>
                  <th className="text-right pb-2 pr-3 font-medium">몰입률</th>
                  <th className="text-right pb-2 pr-3 font-medium">작업시간기준</th>
                  <th className="text-right pb-2 font-medium">WMS기준</th>
                </tr>
              </thead>
              <tbody>
                {zoneWms.map(z => {
                  const ratio = z.wms > 0 ? (z.wave / z.wms) * 100 : null
                  const ratioColor = ratio == null ? '' : ratio >= 80 ? '#10b981' : ratio >= 60 ? '#f97316' : '#ef4444'
                  const fmtVal = (v: number) => isAmt ? fmtM(v) : fmtBox(Math.round(v))
                  return (
                    <tr key={`${z.owner}|${z.zone}`} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{z.zone}</span>
                        <span className="text-muted-foreground ml-1.5 text-[10px]">{z.owner}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{z.wave.toFixed(0)}h</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{z.wms.toFixed(0)}h</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-medium" style={{ color: ratioColor }}>
                        {ratio != null ? ratio.toFixed(1) + '%' : '-'}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-[#FF6B35]">
                        {fmtVal(z.pphWave)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmtVal(z.pphWms)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
