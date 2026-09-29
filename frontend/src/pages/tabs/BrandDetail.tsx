import {
  Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, ComposedChart, Line,
} from 'recharts'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAllZoneData } from '../../hooks/useAllZoneData'
import { useAllWorkerData } from '../../hooks/useAllWorkerData'
import type { WorkerActivityRow } from '../../hooks/useAllWorkerData'
import { useAllAttendanceData } from '../../hooks/useAllAttendanceData'
import type { AttendanceRecord } from '../../hooks/useAllAttendanceData'
import { periodToRange, dateToBucket, bucketLabel } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import { OWNER_COLOR, OWNERS, sumAttendanceHours } from '../../lib/supabase'
import type { ZoneDaily } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import type { Metric } from './Overview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'
import { fmtWon as fmtM } from '../../lib/format'

interface Props { period: Period; metric: Metric; granularity: Granularity }

const fmtBox = (v: number) => `${v.toLocaleString('ko-KR')}박스`
const fmtNum = (v: number) => v.toLocaleString('ko-KR')

function metricVal(r: ZoneDaily, metric: Metric) {
  return metric === 'amount' ? (r.pick_amount ?? 0) : (r.pick_box ?? 0)
}
function metricScale(metric: Metric) { return metric === 'amount' ? 1_000_000 : 1 }
function metricUnit(metric: Metric)  { return metric === 'amount' ? '' : '박스' }

/* ── Zone별 집계 ── */
interface ZoneRow {
  zone: string
  wave: number; wms: number; att: number | null
  box: number; amount: number
  days: number
}

function aggregateZones(
  rows: ZoneDaily[], workerRows: WorkerActivityRow[], attendance: AttendanceRecord[],
): ZoneRow[] {
  const map = new Map<string, ZoneRow>()
  const dayCnt = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!map.has(r.zone)) map.set(r.zone, { zone: r.zone, wave: 0, wms: 0, att: null, box: 0, amount: 0, days: 0 })
    if (!dayCnt.has(r.zone)) dayCnt.set(r.zone, new Set())
    const e = map.get(r.zone)!
    e.wave   += r.wave_time_hr ?? 0
    e.wms    += r.wms_time_hr  ?? 0
    e.box    += r.pick_box    ?? 0
    e.amount += r.pick_amount ?? 0
    dayCnt.get(r.zone)!.add(r.work_date)
  }
  return [...map.values()].map(e => {
    const { hours, hasAny } = sumAttendanceHours(workerRows.filter(w => w.zone === e.zone), attendance)
    return { ...e, att: hasAny ? hours : null, days: dayCnt.get(e.zone)!.size }
  }).sort((a, b) => (b.amount / (b.wms || 1)) - (a.amount / (a.wms || 1)))
}

/* ── 구역별 실적 추이 (전체 데이터 기반, granularity) ── */
function zoneValueTrend(rows: ZoneDaily[], metric: Metric, gran: Granularity) {
  const scale = metricScale(metric)
  const zonesSet = new Set(rows.map(r => r.zone))
  const zones = [...zonesSet].sort()
  const map = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const bucket = dateToBucket(r.work_date, gran)
    if (!map.has(bucket)) map.set(bucket, {})
    const e = map.get(bucket)!
    e[r.zone]   = (e[r.zone]   ?? 0) + metricVal(r, metric) / scale
    e['_total'] = (e['_total'] ?? 0) + metricVal(r, metric) / scale
  }
  const data = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, gran),
      ...Object.fromEntries(zones.map(z => [z, +(e[z] ?? 0).toFixed(2)])),
      total: +(e['_total'] ?? 0).toFixed(2),
    }))
  return { data, zones }
}

/* ── 색상 팔레트 (구역용) ── */
const ZONE_COLORS = [
  '#3B82F6','#8B5CF6','#10B981','#F97316',
  '#EC4899','#06B6D4','#84CC16','#F59E0B',
  '#6366F1','#14B8A6',
]

function ZoneTable({ zones, metric, onSelect }: { zones: ZoneRow[]; metric: Metric; onSelect?: (zone: string) => void }) {
  const isAmt = metric === 'amount'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 text-gray-400 font-medium">구역</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">시간당생산성(WMS)</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">{isAmt ? '금액' : '박스수'}</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">WMS시간</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">근태시간</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">작업시간</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">가동일수</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z, i) => {
            const pph = z.wms > 0 ? (isAmt ? (z.amount / 1_000_000) / z.wms : z.box / z.wms) : 0
            return (
            <tr key={z.zone}
              className={[i % 2 === 0 ? 'bg-gray-50/50' : '', onSelect ? 'cursor-pointer hover:bg-blue-50/40 transition-colors' : ''].join(' ')}
              onClick={() => onSelect?.(z.zone)}>
              <td className="py-2 px-3 font-medium text-gray-700">{z.zone}</td>
              <td className="py-2 px-3 text-right text-gray-700">
                {z.wms > 0 ? (isAmt ? `${fmtM(pph)}/h` : `${fmtNum(Math.round(pph))}박스/h`) : '-'}
              </td>
              <td className="py-2 px-3 text-right text-gray-700">
                {isAmt ? fmtM(z.amount / 1_000_000) : fmtNum(z.box)}
              </td>
              <td className="py-2 px-3 text-right text-gray-500">{z.wms.toFixed(1)}h</td>
              <td className="py-2 px-3 text-right text-gray-500">{z.att != null ? `${z.att.toFixed(1)}h` : '미입력'}</td>
              <td className="py-2 px-3 text-right text-gray-500">{z.wave.toFixed(1)}h</td>
              <td className="py-2 px-3 text-right text-gray-500">{z.days}일</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="px-5 py-3.5 border-b border-border">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  )
}

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

/* ── 메인 컴포넌트 ── */
export default function BrandDetail({ period, metric, granularity }: Props) {
  const { rows, loading } = useAllZoneData()
  const { rows: workerRows, loading: workerLoading } = useAllWorkerData()
  const { rows: attendance, loading: attLoading } = useAllAttendanceData()
  const location = useLocation()
  const navigate = useNavigate()
  const [selectedOwner, setSelectedOwner] = useState<string>(
    location.state?.owner ?? OWNERS[0]
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
  const ownerRows = pRows.filter(r => r.owner === selectedOwner)
  const pWorkerRows = workerRows.filter(r => r.work_date >= start && r.work_date <= end && r.owner === selectedOwner)
  /* 추이 차트: 일별은 선택 기간, 주간/월간은 전체 히스토리 */
  const ownerAllRows  = rows.filter(r => r.owner === selectedOwner)
  const chartOwnerRows = granularity === 'day' ? ownerRows : ownerAllRows

  /* 선택 브랜드 KPI — 선택 기간 기준 */
  let totalWave = 0, totalWms = 0, totalBox = 0, totalAmt = 0
  for (const r of ownerRows) {
    totalWave += r.wave_time_hr ?? 0
    totalWms  += r.wms_time_hr  ?? 0
    totalBox  += r.pick_box ?? 0
    totalAmt  += r.pick_amount ?? 0
  }
  const { hours: totalAtt, hasAny: hasAtt } = sumAttendanceHours(pWorkerRows, attendance)
  const unit = metricUnit(metric)
  const isAmt = metric === 'amount'

  /* 구역 집계 — 선택 기간 기준 */
  const zoneAggs = aggregateZones(ownerRows, pWorkerRows, attendance)

  /* 추이 차트 */
  const { data: trendData, zones } = zoneValueTrend(chartOwnerRows, metric, granularity)
  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : '월간'

  return (
    <div className="space-y-5 animate-fade-in">

      {/* 브랜드 선택 탭 */}
      <div className="flex items-center gap-2">
        {OWNERS.map(o => (
          <button
            key={o}
            onClick={() => setSelectedOwner(o)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-semibold transition-all border',
              selectedOwner === o
                ? 'text-white border-transparent shadow-sm'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
            ].join(' ')}
            style={selectedOwner === o ? { background: OWNER_COLOR[o], borderColor: OWNER_COLOR[o] } : {}}
          >
            {o}
          </button>
        ))}
      </div>

      {/* 선택 브랜드 KPI 요약 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full" style={{ background: OWNER_COLOR[selectedOwner] }} />
            <p className="text-sm font-semibold">{selectedOwner} 요약</p>
            <span className="text-xs text-gray-400 ml-1">선택 기간 기준</span>
          </div>
          {ownerRows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">선택 기간에 데이터가 없습니다</p>
          ) : (
            <div className="flex gap-8 justify-around">
              <StatBadge
                label={isAmt ? '총 피킹금액' : '총 피킹박스수'}
                value={isAmt ? fmtM(totalAmt / 1_000_000) : fmtBox(totalBox)}
                color={OWNER_COLOR[selectedOwner]}
              />
              <StatBadge label="WMS시간 합계" value={`${totalWms.toFixed(1)}h`} color="#64748b" />
              <StatBadge label="근태시간 합계" value={hasAtt ? `${totalAtt.toFixed(1)}h` : '미입력'} color="#64748b" />
              <StatBadge label="작업시간 합계" value={`${totalWave.toFixed(1)}h`} color="#64748b" />
              <StatBadge label="활동 구역수" value={String(zoneAggs.length)} color="#64748b" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 구역별 실적표 + 구역별 추이 나란히 */}
      <div className="grid grid-cols-2 gap-5">

        {/* 구역별 실적표 (시간당생산성 순, 선택 기간) */}
        <SectionCard title={`${selectedOwner} · 구역별 실적 (시간당생산성 순)`}>
          {zoneAggs.length === 0 ? (
            <p className="text-xs text-gray-300 text-center py-8">데이터 없음</p>
          ) : (
            <ZoneTable zones={zoneAggs} metric={metric}
              onSelect={z => navigate('/picking/worker', { state: { owner: selectedOwner, zone: z } })} />
          )}
        </SectionCard>

        {/* 구역별 실적 추이 (전체 히스토리) */}
        <SectionCard title={`${selectedOwner} · ${granLabel} 구역별 추이${unit ? ` (${unit})` : ''}`}>
          {trendData.length === 0 ? (
            <p className="text-xs text-gray-300 text-center py-8">데이터 없음</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={v => isAmt ? fmtM(v) : fmtNum(v)}
                />
                <Tooltip
                  content={(props: any) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload}
                      label={props.label}
                      formatter={(v) => isAmt ? fmtM(v) : fmtBox(v)}
                    />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(v: string) => v === 'total' ? '합계' : v} />
                {zones.map((z, i) => (
                  <Bar key={z} dataKey={z} stackId="a"
                    fill={ZONE_COLORS[i % ZONE_COLORS.length]}
                    radius={i === zones.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                ))}
                <Line dataKey="total" stroke={OWNER_COLOR[selectedOwner]} strokeWidth={2}
                  dot={{ r: 3, fill: OWNER_COLOR[selectedOwner] }} activeDot={{ r: 5 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
