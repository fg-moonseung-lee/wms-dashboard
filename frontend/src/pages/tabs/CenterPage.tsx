import { useState } from 'react'
import {
  ComposedChart, Bar, Line, BarChart,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAllZoneData } from '../../hooks/useAllZoneData'
import { useAllWorkerData } from '../../hooks/useAllWorkerData'
import { useAllAttendanceData } from '../../hooks/useAllAttendanceData'
import { periodToRange, dateToBucket, bucketLabel } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import { OWNER_COLOR, CENTERS, CENTER_COLOR, CENTER_OWNERS, CENTER_OWNER, sumAttendanceHours } from '../../lib/supabase'
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
function metricScale(metric: Metric) { return metric === 'amount' ? 1_000_000 : 1 }

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

export default function CenterPage({ period, metric, granularity }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { rows, loading } = useAllZoneData()
  const { rows: workerRows, loading: workerLoading } = useAllWorkerData()
  const { rows: attendance, loading: attLoading } = useAllAttendanceData()
  const [selectedCenter, setSelectedCenter] = useState<string | null>(
    (location.state as { center?: string } | null)?.center ?? null
  )

  if (loading || workerLoading || attLoading) {
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
  const pWorkerRows = workerRows.filter(r => r.work_date >= start && r.work_date <= end)
  const isAmt = metric === 'amount'
  const scale = metricScale(metric)
  const unit = isAmt ? '백만원' : '박스'
  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : '월간'

  /* ── 센터별 KPI ── */
  const centerKpi = CENTERS.map(center => {
    const cOwners = CENTER_OWNERS[center]
    const cRows = pRows.filter(r => cOwners.includes(r.owner))
    let wave = 0, wms = 0, wmsVal = 0, val = 0
    const zones = new Set<string>()
    for (const r of cRows) {
      wave += r.wave_time_hr ?? 0
      val += metricVal(r, metric) / scale
      zones.add(r.zone)
      if (r.wms_time_hr != null && r.wms_time_hr > 0) {
        wms += r.wms_time_hr
        wmsVal += metricVal(r, metric) / scale
      }
    }
    const { hours: attHr, hasAny: hasAtt } = sumAttendanceHours(
      pWorkerRows.filter(r => cOwners.includes(r.owner)), attendance,
    )
    return {
      center,
      val: +val.toFixed(2),
      wave, wms,
      att: hasAtt ? attHr : null,
      pph: wave > 0 ? val / wave : 0,
      pphWms: wms > 0 ? wmsVal / wms : null,
      pphAtt: hasAtt && attHr > 0 ? val / attHr : null,
      zones: zones.size,
      owners: cOwners,
    }
  })

  /* ── 차트 데이터 ── */
  const chartRows = granularity === 'day' ? pRows : rows

  const trendMap = new Map<string, Record<string, number>>()
  for (const r of chartRows) {
    const bucket = dateToBucket(r.work_date, granularity)
    const center = CENTER_OWNER[r.owner] ?? '기타'
    if (!trendMap.has(bucket)) trendMap.set(bucket, {})
    const e = trendMap.get(bucket)!
    e[center]   = (e[center]   ?? 0) + metricVal(r, metric) / scale
    e['_total'] = (e['_total'] ?? 0) + metricVal(r, metric) / scale
  }
  const trendData = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, granularity),
      ...Object.fromEntries(CENTERS.map(c => [c, +(e[c] ?? 0).toFixed(2)])),
      total: +(e['_total'] ?? 0).toFixed(2),
    }))

  const c1Owners = CENTER_OWNERS['1센터']
  const c1TrendMap = new Map<string, Record<string, number>>()
  for (const r of chartRows.filter(r => c1Owners.includes(r.owner))) {
    const bucket = dateToBucket(r.work_date, granularity)
    if (!c1TrendMap.has(bucket)) c1TrendMap.set(bucket, {})
    const e = c1TrendMap.get(bucket)!
    e[r.owner] = (e[r.owner] ?? 0) + metricVal(r, metric) / scale
  }
  const c1TrendData = [...c1TrendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, granularity),
      ...Object.fromEntries(c1Owners.map(o => [o, +(e[o] ?? 0).toFixed(2)])),
    }))

  const tooltipFmt = (v: number) => isAmt ? fmtM(v) : fmtBox(v)

  /* ── 선택 센터 브랜드 KPI ── */
  const selOwners = selectedCenter ? CENTER_OWNERS[selectedCenter] : []
  const brandKpis = selOwners.map(owner => {
    const oRows = pRows.filter(r => r.owner === owner)
    let wave = 0, wms = 0, val = 0
    const zones = new Set<string>()
    for (const r of oRows) {
      wave += r.wave_time_hr ?? 0
      val += metricVal(r, metric) / scale; zones.add(r.zone)
      if (r.wms_time_hr != null && r.wms_time_hr > 0) wms += r.wms_time_hr
    }
    return { owner, val: +val.toFixed(2), wave, wms, zones: zones.size }
  })
  const selTrendMap = new Map<string, Record<string, number>>()
  for (const r of chartRows.filter(r => selOwners.includes(r.owner))) {
    const bucket = dateToBucket(r.work_date, granularity)
    if (!selTrendMap.has(bucket)) selTrendMap.set(bucket, {})
    const e = selTrendMap.get(bucket)!
    e[r.owner] = (e[r.owner] ?? 0) + metricVal(r, metric) / scale
  }
  const selTrendData = [...selTrendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, granularity),
      ...Object.fromEntries(selOwners.map(o => [o, +(e[o] ?? 0).toFixed(2)])),
    }))

  if (selectedCenter) {
    return (
      <div className="space-y-5 animate-fade-in">

        {/* 브레드크럼 */}
        <div className="flex items-center gap-1 text-xs">
          <button onClick={() => setSelectedCenter(null)}
            className="text-gray-400 hover:text-gray-700 px-2 py-0.5 rounded hover:bg-gray-100 transition-colors">
            전체 센터
          </button>
          <span className="text-gray-300">›</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-blue-50"
            style={{ color: CENTER_COLOR[selectedCenter] }}>
            {selectedCenter}
          </span>
        </div>

        {/* 브랜드 KPI 카드 */}
        <div className={`grid gap-4 ${selOwners.length === 1 ? 'grid-cols-1 max-w-sm' : 'grid-cols-2'}`}>
          {brandKpis.map(b => (
            <Card key={b.owner}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/picking/brand', { state: { owner: b.owner } })}>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ background: OWNER_COLOR[b.owner] }} />
                  <span className="text-sm font-bold text-gray-700">{b.owner}</span>
                </div>
                <p className="text-2xl font-bold mb-3" style={{ color: OWNER_COLOR[b.owner] }}>
                  {isAmt ? fmtM(b.val) : fmtBox(b.val)}
                </p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>WMS {b.wms.toFixed(0)}h</span>
                  <span>·</span>
                  <span>작업시간 {b.wave.toFixed(0)}h</span>
                  <span>·</span>
                  <span>구역 {b.zones}개</span>
                </div>
                <p className="mt-3 text-[11px] text-gray-300 flex items-center gap-1">
                  브랜드 상세 보기 ›
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 브랜드별 추이 */}
        {selTrendData.length > 0 && (
          <SectionCard title={`${selectedCenter} 브랜드별 ${granLabel} 추이 (${unit})`}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={selTrendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={v => isAmt ? `${v}백만` : fmtNum(v)} />
                <Tooltip content={(props: any) => (
                  <ChartTooltip active={props.active} payload={props.payload}
                    label={props.label} formatter={tooltipFmt} />
                )} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {selOwners.map((o, i) => (
                  <Bar key={o} dataKey={o} stackId="a" fill={OWNER_COLOR[o]}
                    radius={i === selOwners.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* 센터 KPI 카드 3개 */}
      <div className="grid grid-cols-3 gap-4">
        {centerKpi.map(c => (
          <Card key={c.center}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedCenter(c.center)}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: CENTER_COLOR[c.center] }} />
                <p className="text-sm font-semibold text-gray-700">{c.center}</p>
              </div>
              <p className="text-2xl font-bold" style={{ color: CENTER_COLOR[c.center] }}>
                {isAmt ? fmtM(c.val) : fmtBox(c.val)}
              </p>
              <div className="flex gap-3 mt-2 text-xs text-gray-400">
                <span>{c.owners.join(' · ')}</span>
                <span>·</span>
                <span>구역 {c.zones}개</span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-gray-400">
                <span>WMS {c.wms.toFixed(0)}h</span>
                <span>·</span>
                <span>시간당 {c.pphWms != null ? (isAmt ? fmtM(c.pphWms) : fmtNum(Math.round(c.pphWms))) : '-'}</span>
              </div>
              <p className="mt-3 text-[11px] text-gray-300">브랜드 상세 보기 ›</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 센터별 실적 추이 */}
      <SectionCard title={`센터별 피킹실적 ${granLabel} 추이 (${unit})`}>
        {trendData.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터 없음</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={trendData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
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
                    formatter={tooltipFmt}
                  />
                )}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(v: string) => v === 'total' ? '합계' : v}
              />
              {[...CENTERS].reverse().map((c, i) => (
                <Bar key={c} dataKey={c} stackId="a"
                  fill={CENTER_COLOR[c]}
                  radius={i === CENTERS.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              <Line dataKey="total" stroke="#94a3b8" strokeWidth={2}
                dot={{ r: 3, fill: '#94a3b8' }} activeDot={{ r: 5 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* 센터별 시간당 생산성 + 1센터 브랜드 비중 추이 */}
      <div className="grid grid-cols-2 gap-5">

        {/* 센터별 시간당 생산성 (WMS 기준) */}
        <SectionCard title="센터별 시간당 생산성" subtitle="선택 기간 · WMS시간 기준">
          <div className="space-y-3 py-1">
            {[...centerKpi].sort((a, b) => (b.pphWms ?? 0) - (a.pphWms ?? 0)).map(c => {
              const maxPph = Math.max(...centerKpi.map(x => x.pphWms ?? 0), 1)
              const pct = Math.max(4, ((c.pphWms ?? 0) / maxPph) * 100)
              return (
                <div key={c.center}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: CENTER_COLOR[c.center] }} />
                      <span className="text-sm font-semibold text-gray-700">{c.center}</span>
                      <span className="text-[11px] text-gray-400">{c.owners.join(' · ')}</span>
                    </div>
                    <span className="text-sm font-bold" style={{ color: CENTER_COLOR[c.center] }}>
                      {c.pphWms != null ? `${isAmt ? fmtM(c.pphWms) : fmtNum(Math.round(c.pphWms))}/h` : '-'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CENTER_COLOR[c.center] }} />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    근태 {c.pphAtt != null ? `${isAmt ? fmtM(c.pphAtt) : fmtNum(Math.round(c.pphAtt))}/h` : '미입력'}
                    {' · '}작업 {isAmt ? fmtM(c.pph) : fmtNum(Math.round(c.pph))}/h
                  </p>
                </div>
              )
            })}
          </div>
        </SectionCard>

        {/* 1센터 브랜드 비중 추이 */}
        <SectionCard title={`1센터 브랜드별 추이 (${unit})`} subtitle="퍼시스 · 일룸">
          {c1TrendData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={c1TrendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
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
                      formatter={tooltipFmt}
                    />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {c1Owners.map((o, i) => (
                  <Bar key={o} dataKey={o} stackId="a"
                    fill={OWNER_COLOR[o]}
                    radius={i === c1Owners.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
