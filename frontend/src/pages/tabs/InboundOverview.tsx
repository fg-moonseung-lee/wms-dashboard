import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAllInboundData } from '../../hooks/useAllInboundData'
import { useAllInboundWorkerData } from '../../hooks/useAllInboundWorkerData'
import { periodToRange, dateToBucket, bucketLabel, dateToWeekStart, getWeekEnd } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import {
  OWNER_COLOR, OWNERS,
  CENTERS, CENTER_COLOR, CENTER_OWNERS, CENTER_OWNER, INBOUND_TYPES,
} from '../../lib/supabase'
import type { InboundBrandDaily } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'
import type { InboundMetric } from '../inbound/InboundLayout'
import { exportInboundExcel } from '../../lib/exportInboundExcel'
import { fmtWon as fmtM } from '../../lib/format'
import { aggInbound, aggMetricValue, fmtHr } from '../../lib/inboundUtils'

interface Props { period: Period; metric: InboundMetric; granularity?: Granularity }

/** 드릴다운 단계: 전체 › 센터 › 브랜드 (브랜드는 전체에서 바로 올 수도, 센터를 거쳐 올 수도 있음) */
type Crumb =
  | { level: 'all' }
  | { level: 'center'; center: string }
  | { level: 'brand'; owner: string; fromCenter?: string }

const fmtQty   = (v: number) => `${v.toLocaleString('ko-KR')}개`
const fmtPlt   = (v: number) => `${v.toLocaleString('ko-KR')}plt`
const fmtNum   = (v: number) => v.toLocaleString('ko-KR')
const fmtPct   = (v: number) => `${v.toFixed(1)}%`

interface KpiResult {
  amount: number; qty: number; pallets: number; hours: number
  amtPerHr: number; qtyPerHr: number; palletPerHr: number
  normalRatio: number    // 정상입고 비율 (품질 참고 지표 — 표준시간 대비 개념 없음)
}

function aggregateKpi(rows: InboundBrandDaily[]): KpiResult {
  let amount = 0, qty = 0, pallets = 0, hours = 0, normal = 0
  for (const r of rows) {
    amount  += r.amt_total ?? 0
    qty     += r.qty_total ?? 0
    pallets += r.pallets   ?? 0
    hours   += r.hours     ?? 0
    normal  += r.qty_normal ?? 0
  }
  return {
    amount: amount / 1_000_000,
    qty, pallets, hours,
    amtPerHr:    hours > 0 ? (amount / 1_000_000) / hours : 0,
    qtyPerHr:    hours > 0 ? qty / hours : 0,
    palletPerHr: hours > 0 ? pallets / hours : 0,
    normalRatio: qty > 0 ? (normal / qty) * 100 : 0,
  }
}

function metricValue(kpi: KpiResult, metric: InboundMetric): number {
  return metric === 'amount' ? kpi.amount : metric === 'qty' ? kpi.qty : kpi.pallets
}
function metricFmt(v: number, metric: InboundMetric): string {
  return metric === 'amount' ? fmtM(v) : metric === 'qty' ? fmtQty(v) : fmtPlt(v)
}
function metricUnitLabel(metric: InboundMetric): string {
  return metric === 'amount' ? '' : metric === 'qty' ? '개' : 'plt'
}

function toTrendData(allRows: InboundBrandDaily[], gran: Granularity, metric: InboundMetric) {
  const map = new Map<string, Record<string, number>>()
  for (const r of allRows) {
    const bucket = dateToBucket(r.work_date, gran)
    if (!map.has(bucket)) map.set(bucket, {})
    const e = map.get(bucket)!
    const v = metric === 'amount' ? (r.amt_total ?? 0) / 1_000_000
      : metric === 'qty' ? (r.qty_total ?? 0)
      : (r.pallets ?? 0)
    e[r.brand]  = (e[r.brand]  ?? 0) + v
    e['_total'] = (e['_total'] ?? 0) + v
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, gran),
      ...Object.fromEntries(OWNERS.map(o => [o, +(e[o] ?? 0).toFixed(2)])),
      total: +(e['_total'] ?? 0).toFixed(2),
    }))
}

/* ── SVG 도넛 차트 (피킹과 동일 패턴) ── */
interface DonutSegment { value: number; color: string; name: string }

function SvgDonutChart({
  data, size = 140, thickness = 15, line1, line2, onSegmentClick,
}: {
  data: DonutSegment[]
  size?: number
  thickness?: number
  line1: string
  line2: string
  onSegmentClick?: (name: string) => void
}) {
  const r  = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const C  = 2 * Math.PI * r
  const GAP = 2

  const sum = data.reduce((s, d) => s + d.value, 0)

  const arcs = (() => {
    let cum = 0
    return data.map(d => {
      const frac   = sum > 0 ? d.value / sum : 0
      const arcLen = Math.max(0.1, frac * C - GAP)
      const start  = cum
      cum += frac
      return { ...d, arcLen, start }
    })
  })()

  return (
    <svg width={size} height={size} className="shrink-0">
      {sum > 0 && arcs.map((arc, i) => (
        <circle
          key={i}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${arc.arcLen} ${C}`}
          strokeDashoffset={0}
          transform={`rotate(${arc.start * 360 - 90}, ${cx}, ${cy})`}
          className={onSegmentClick ? 'cursor-pointer transition-opacity hover:opacity-75' : ''}
          onClick={() => onSegmentClick?.(arc.name)}
        />
      ))}
      <text
        x={cx} y={cy - 9}
        textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 13, fontWeight: 700, fill: '#111827', fontFamily: 'inherit' }}
      >
        {line1}
      </text>
      <text
        x={cx} y={cy + 9}
        textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 10, fill: '#9ca3af', fontFamily: 'inherit' }}
      >
        {line2}
      </text>
    </svg>
  )
}

function DonutCard({
  title, data, line1, line2, onSegmentClick, onRowClick,
}: {
  title: string
  data: DonutSegment[]
  line1: string
  line2: string
  onSegmentClick?: (name: string) => void
  onRowClick?: (name: string) => void
}) {
  const sum = data.reduce((s, d) => s + d.value, 0)
  return (
    <Card>
      <CardHeader className="px-5 py-3.5 border-b border-border">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="flex items-center gap-6">
          <SvgDonutChart data={data} line1={line1} line2={line2} onSegmentClick={onSegmentClick} />
          <div className="flex-1 space-y-2.5">
            {data.map(d => {
              const pct = sum > 0 ? ((d.value / sum) * 100).toFixed(1) : '0.0'
              return (
                <div
                  key={d.name}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 -mx-1.5 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-gray-50 active:bg-gray-100' : ''}`}
                  onClick={() => onRowClick?.(d.name)}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-gray-600 flex-1">{d.name}</span>
                  <span className="text-xs font-bold text-gray-800">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-muted-foreground font-medium mb-3">{label}</p>
        <p className="text-2xl font-bold leading-none"
          style={{ color: color ?? 'hsl(var(--foreground))' }}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-2">{sub}</p>}
      </CardContent>
    </Card>
  )
}

/* ── 브레드크럼 바 ── */
function CrumbBar({ crumb, onAll, onCenter }: {
  crumb: Crumb
  onAll: () => void
  onCenter: (center: string) => void
}) {
  if (crumb.level === 'all') return null
  return (
    <div className="flex items-center gap-1 text-xs">
      <button onClick={onAll}
        className="text-gray-400 hover:text-gray-700 px-2 py-0.5 rounded hover:bg-gray-100 transition-colors">
        전체
      </button>
      {crumb.level === 'center' && (
        <>
          <span className="text-gray-300">›</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-blue-50" style={{ color: CENTER_COLOR[crumb.center] }}>
            {crumb.center}
          </span>
        </>
      )}
      {crumb.level === 'brand' && (
        <>
          {crumb.fromCenter && (
            <>
              <span className="text-gray-300">›</span>
              <button onClick={() => onCenter(crumb.fromCenter!)}
                className="text-gray-400 hover:text-gray-700 px-2 py-0.5 rounded hover:bg-gray-100 transition-colors">
                {crumb.fromCenter}
              </button>
            </>
          )}
          <span className="text-gray-300">›</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-blue-50" style={{ color: OWNER_COLOR[crumb.owner] }}>
            {crumb.owner}
          </span>
        </>
      )}
    </div>
  )
}

/* ── 센터 요약 카드 (전체 레벨) ── */
function CenterCard({ center, kpi, metric, onClick }: {
  center: string; kpi: KpiResult; metric: InboundMetric; onClick?: () => void
}) {
  const color = CENTER_COLOR[center]
  const owners = CENTER_OWNERS[center]
  const hasData = kpi.hours > 0
  return (
    <Card
      className={onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-sm font-bold text-gray-700">{center}</span>
            <span className="text-xs text-gray-400">{owners.join(' · ')}</span>
          </div>
          {!hasData && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
              데이터 없음
            </span>
          )}
        </div>
        <p className="text-2xl font-bold mb-3" style={{ color }}>
          {metricFmt(metricValue(kpi, metric), metric)}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-400 mb-0.5">시간당 금액</p>
            <p className="text-sm font-semibold text-gray-700">{fmtM(kpi.amtPerHr)}/h</p>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-400 mb-0.5">시간당 수량</p>
            <p className="text-sm font-semibold text-gray-700">{fmtNum(Math.round(kpi.qtyPerHr))}개/h</p>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-400 mb-0.5">시간당 파렛트</p>
            <p className="text-sm font-semibold text-gray-700">{kpi.palletPerHr.toFixed(1)}/h</p>
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-400">
          <span>실적 {kpi.hours.toFixed(0)}h</span>
          <span>·</span>
          <span>파렛트 {fmtNum(kpi.pallets)}개</span>
        </div>
        {onClick && (
          <p className="mt-3 text-[11px] text-gray-300 hover:text-letusBlue transition-colors flex items-center gap-1">
            센터 상세 보기 ›
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ── 브랜드 요약 카드 (전체 레벨) ── */
function OwnerCard({ owner, kpi, metric, onClick }: {
  owner: string; kpi: KpiResult; metric: InboundMetric; onClick?: () => void
}) {
  const color = OWNER_COLOR[owner]
  const center = CENTER_OWNER[owner]
  const hasData = kpi.hours > 0
  return (
    <Card
      className={onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-sm font-bold text-gray-700">{owner}</span>
            <span className="text-xs text-gray-300">{center}</span>
          </div>
          {!hasData && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">없음</span>
          )}
        </div>
        <p className="text-xl font-bold mb-3" style={{ color }}>
          {metricFmt(metricValue(kpi, metric), metric)}
        </p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">시간당 금액</span>
            <span className="font-medium text-gray-700">{fmtM(kpi.amtPerHr)}/h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">시간당 수량</span>
            <span className="font-medium text-gray-700">{fmtNum(Math.round(kpi.qtyPerHr))}개/h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">시간당 파렛트</span>
            <span className="font-medium text-gray-700">{kpi.palletPerHr.toFixed(1)}/h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">실적시간</span>
            <span className="font-medium text-gray-700">{kpi.hours.toFixed(0)}h</span>
          </div>
        </div>
        {onClick && (
          <p className="mt-3 text-[11px] text-gray-300 hover:text-letusBlue transition-colors flex items-center gap-1">
            브랜드 상세 보기 ›
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ══════════════════ 메인 ══════════════════ */
export default function InboundOverview({ period, metric, granularity = 'month' }: Props) {
  const { rows, loading } = useAllInboundData()
  const { rows: wRows, loading: wLoading } = useAllInboundWorkerData()
  const location = useLocation()
  const navigate = useNavigate()
  const [crumb, setCrumb] = useState<Crumb>(() => {
    const st = location.state as { owner?: string; center?: string } | null
    if (st?.owner) return { level: 'brand', owner: st.owner }
    if (st?.center) return { level: 'center', center: st.center }
    return { level: 'all' }
  })

  if (loading || wLoading) {
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

  const total = aggregateKpi(pRows)
  const centerKpi = Object.fromEntries(
    CENTERS.map(c => [c, aggregateKpi(pRows.filter(r => CENTER_OWNERS[c].includes(r.brand)))])
  )
  const ownerKpi = Object.fromEntries(
    OWNERS.map(o => [o, aggregateKpi(pRows.filter(r => r.brand === o))])
  )

  const goToBrand  = (owner: string)   => setCrumb({ level: 'brand', owner })
  const goToCenter = (center: string)  => setCrumb({ level: 'center', center })
  const goToAll    = () => setCrumb({ level: 'all' })

  /* ══ 브랜드 레벨 (구 InboundBrand.tsx) ══ */
  if (crumb.level === 'brand') {
    const brand = crumb.owner
    const bRows  = rows.filter(r => r.work_date >= start && r.work_date <= end && r.brand === brand)
    const bwRows = wRows.filter(r => r.work_date >= start && r.work_date <= end && r.brand === brand)

    const agg = aggInbound(bRows)
    const typeRows = INBOUND_TYPES
      .map(t => ({ ...t, ...agg.byType[t.key] }))
      .filter(t => t.qty > 0 || t.amt > 0)
    const typeQtySum = typeRows.reduce((s, t) => s + t.qty, 0)

    const trendMap = new Map<string, Record<string, number>>()
    for (const r of bRows) {
      const bucket = dateToBucket(r.work_date, granularity)
      if (!trendMap.has(bucket)) trendMap.set(bucket, {})
      const e = trendMap.get(bucket)!
      for (const t of INBOUND_TYPES) {
        const v = metric === 'amount'
          ? (Number(r[`d_amt_${t.key}` as keyof typeof r]) || 0) / 1_000_000
          : Number(r[`d_qty_${t.key}` as keyof typeof r]) || 0
        e[t.label] = (e[t.label] ?? 0) + v
        e['_total'] = (e['_total'] ?? 0) + v
      }
    }
    const bTrendData = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, e]) => ({
        label: bucketLabel(bucket, granularity),
        ...Object.fromEntries(INBOUND_TYPES.map(t => [t.label, +(e[t.label] ?? 0).toFixed(2)])),
        total: +(e['_total'] ?? 0).toFixed(2),
      }))

    const workerMap = new Map<string, ReturnType<typeof aggInbound> & { worker: string; display: string; days: number }>()
    {
      const grouped = new Map<string, typeof bwRows>()
      for (const r of bwRows) {
        const list = grouped.get(r.worker) ?? []
        list.push(r)
        grouped.set(r.worker, list)
      }
      for (const [worker, list] of grouped) {
        workerMap.set(worker, {
          ...aggInbound(list),
          worker,
          display: list[0].worker_display,
          days: new Set(list.map(x => x.work_date)).size,
        })
      }
    }
    const workers = [...workerMap.values()].sort((a, b) => b.qty - a.qty)

    return (
      <div className="space-y-6 animate-fade-in">
        <CrumbBar crumb={crumb} onAll={goToAll} onCenter={goToCenter} />

        {/* 브랜드 선택 칩 */}
        <div className="flex items-center gap-2">
          {OWNERS.map(o => (
            <button
              key={o}
              onClick={() => {
                const stillSameCenter = crumb.fromCenter && CENTER_OWNERS[crumb.fromCenter].includes(o)
                setCrumb({ level: 'brand', owner: o, fromCenter: stillSameCenter ? crumb.fromCenter : undefined })
              }}
              className={[
                'flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all',
                brand === o
                  ? 'bg-white border-letusBlue text-letusBlue shadow-sm'
                  : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600',
              ].join(' ')}
            >
              <div className="w-2 h-2 rounded-full" style={{ background: OWNER_COLOR[o] }} />
              {o}
              <span className="text-[10px] text-gray-300">{CENTER_OWNER[o]}</span>
            </button>
          ))}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">총 입고금액</p>
            <p className="text-2xl font-bold leading-none" style={{ color: OWNER_COLOR[brand] }}>{fmtM(agg.amount)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">총 입고수량</p>
            <p className="text-2xl font-bold leading-none text-gray-800">{fmtNum(agg.qty)}개</p>
          </CardContent></Card>
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">파렛트 / 실적시간</p>
            <p className="text-2xl font-bold leading-none text-gray-800">
              {fmtNum(agg.pallets)}<span className="text-sm text-gray-400 font-medium"> plt · {fmtHr(agg.hours)}</span>
            </p>
          </CardContent></Card>
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">시간당 생산성</p>
            <p className="text-lg font-bold leading-none text-sky-500">{fmtM(agg.amtPerHr)}/h</p>
            <p className="text-xs text-muted-foreground mt-1.5">
              {fmtNum(Math.round(agg.qtyPerHr))}개/h · {agg.palletPerHr.toFixed(1)}plt/h
            </p>
          </CardContent></Card>
        </div>

        {/* 유형 구성 + 추이 */}
        <div className="grid grid-cols-5 gap-4">
          <Card className="col-span-2">
            <CardHeader className="px-5 py-3.5 border-b border-border">
              <CardTitle className="text-sm font-semibold">{brand} 입고유형 구성 (정산 기준)</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {typeRows.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-300 text-xs">데이터 없음</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex h-4 rounded-full overflow-hidden">
                    {typeRows.map(t => (
                      <div key={t.key}
                        style={{ width: `${typeQtySum > 0 ? (t.qty / typeQtySum) * 100 : 0}%`, background: t.color }}
                        title={`${t.label} ${fmtNum(t.qty)}개`} />
                    ))}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left  py-1.5 font-medium">유형</th>
                        <th className="text-right py-1.5 font-medium">수량</th>
                        <th className="text-right py-1.5 font-medium">금액</th>
                        <th className="text-right py-1.5 font-medium">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typeRows.map(t => (
                        <tr key={t.key} className="border-b border-gray-50">
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                              <span className="text-gray-700">{t.label}</span>
                            </div>
                          </td>
                          <td className="text-right text-gray-700">{fmtNum(t.qty)}</td>
                          <td className="text-right text-gray-700">{fmtM(t.amt / 1_000_000)}</td>
                          <td className="text-right font-semibold text-gray-800">
                            {fmtPct(typeQtySum > 0 ? (t.qty / typeQtySum) * 100 : 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-3">
            <CardHeader className="px-5 py-3.5 border-b border-border">
              <CardTitle className="text-sm font-semibold">
                유형별 입고 추이{metric === 'amount' ? '' : ' (수량)'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {bTrendData.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터가 없습니다</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={bTrendData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <Tooltip
                      content={(props: any) => (
                        <ChartTooltip
                          active={props.active}
                          payload={props.payload}
                          label={props.label}
                          formatter={(v) => metric === 'amount' ? fmtM(v) : fmtNum(v)}
                        />
                      )}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(v: string) => v === 'total' ? '합계' : v} />
                    {INBOUND_TYPES.map((t, i) => (
                      <Bar key={t.key} dataKey={t.label} stackId="a" fill={t.color}
                        radius={i === INBOUND_TYPES.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                    ))}
                    <Line dataKey="total" stroke="#94a3b8" strokeWidth={2}
                      dot={{ r: 3, fill: '#94a3b8' }} activeDot={{ r: 5 }} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 작업자 실적 */}
        <Card>
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">{brand} 작업자 실적 ({workers.length}명)</CardTitle>
              <button
                onClick={() => navigate('/inbound/worker', { state: { brand } })}
                className="text-xs text-gray-400 hover:text-letusBlue transition-colors"
              >
                작업자별 상세 보기 ›
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {workers.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-300 text-xs">데이터 없음</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left  py-2 font-medium">작업자</th>
                    <th className="text-right py-2 font-medium">근무일</th>
                    <th className="text-right py-2 font-medium">입고수량</th>
                    <th className="text-right py-2 font-medium">입고금액</th>
                    <th className="text-right py-2 font-medium">파렛트</th>
                    <th className="text-right py-2 font-medium">실적시간</th>
                    <th className="text-right py-2 font-medium">시간당 수량</th>
                    <th className="text-right py-2 font-medium">시간당 파렛트</th>
                    <th className="text-right py-2 font-medium">시간당 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map(w => (
                    <tr
                      key={w.worker}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => navigate('/inbound/worker', { state: { brand, worker: w.worker } })}
                    >
                      <td className="py-2.5 font-semibold text-gray-700">{w.display}</td>
                      <td className="text-right text-gray-500">{w.days}일</td>
                      <td className="text-right text-gray-700">{fmtNum(w.qty)}</td>
                      <td className="text-right text-gray-700">{fmtM(w.amount)}</td>
                      <td className="text-right text-gray-700">{fmtNum(w.pallets)}</td>
                      <td className="text-right text-gray-700">{fmtHr(w.hours)}</td>
                      <td className="text-right font-semibold text-gray-800">{fmtNum(Math.round(w.qtyPerHr))}개/h</td>
                      <td className="text-right font-semibold text-gray-800">{w.palletPerHr.toFixed(1)}plt/h</td>
                      <td className="text-right font-semibold text-gray-800">{fmtM(w.amtPerHr)}/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ══ 센터 레벨 (구 InboundCenter.tsx) ══ */
  if (crumb.level === 'center') {
    const selected = crumb.center
    const centerAggFull = Object.fromEntries(CENTERS.map(c => [c, aggInbound(pRows.filter(r => CENTER_OWNERS[c].includes(r.brand)))]))
    const totalFull = aggInbound(pRows)

    const selRows  = pRows.filter(r => CENTER_OWNERS[selected].includes(r.brand))
    const selAgg   = centerAggFull[selected]
    const selBrands = CENTER_OWNERS[selected]

    const brandAggs = selBrands.map(b => ({
      brand: b,
      agg: aggInbound(selRows.filter(r => r.brand === b)),
    }))

    const typeRows = INBOUND_TYPES
      .map(t => ({ ...t, ...selAgg.byType[t.key] }))
      .filter(t => t.qty > 0 || t.amt > 0)

    const trendMap = new Map<string, Record<string, number>>()
    for (const r of pRows) {
      const bucket = dateToBucket(r.work_date, granularity)
      if (!trendMap.has(bucket)) trendMap.set(bucket, {})
      const e = trendMap.get(bucket)!
      const c = CENTERS.find(cc => CENTER_OWNERS[cc].includes(r.brand))
      if (!c) continue
      const v = metric === 'amount' ? (Number(r.amt_total) || 0) / 1_000_000
        : metric === 'qty' ? Number(r.qty_total) || 0 : Number(r.pallets) || 0
      e[c] = (e[c] ?? 0) + v
      e['_total'] = (e['_total'] ?? 0) + v
    }
    const cTrendData = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, e]) => ({
        label: bucketLabel(bucket, granularity),
        ...Object.fromEntries(CENTERS.map(c => [c, +(e[c] ?? 0).toFixed(2)])),
        total: +(e['_total'] ?? 0).toFixed(2),
      }))

    const share = (v: number) => {
      const t = aggMetricValue(totalFull, metric)
      return t > 0 ? (v / t) * 100 : 0
    }

    return (
      <div className="space-y-6 animate-fade-in">
        <CrumbBar crumb={crumb} onAll={goToAll} onCenter={goToCenter} />

        {/* 센터 카드 (선택) */}
        <div className="grid grid-cols-3 gap-4">
          {CENTERS.map(c => {
            const a = centerAggFull[c]
            const active = c === selected
            return (
              <Card
                key={c}
                className={`cursor-pointer transition-all ${active ? 'ring-2 ring-letusBlue shadow-md' : 'hover:shadow-md'}`}
                onClick={() => goToCenter(c)}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: CENTER_COLOR[c] }} />
                      <span className="text-sm font-bold text-gray-700">{c}</span>
                      <span className="text-xs text-gray-400">{CENTER_OWNERS[c].join(' · ')}</span>
                    </div>
                    <span className="text-xs font-semibold text-gray-400">
                      {fmtPct(share(aggMetricValue(a, metric)))}
                    </span>
                  </div>
                  <p className="text-2xl font-bold mb-2" style={{ color: CENTER_COLOR[c] }}>
                    {metricFmt(aggMetricValue(a, metric), metric)}
                  </p>
                  <div className="flex gap-3 text-xs text-gray-400">
                    <span>{fmtHr(a.hours)}</span>
                    <span>·</span>
                    <span>{fmtM(a.amtPerHr)}/h</span>
                    <span>·</span>
                    <span>{fmtNum(Math.round(a.qtyPerHr))}개/h</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* 선택 센터: 브랜드별 + 유형 구성 */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="px-5 py-3.5 border-b border-border">
              <CardTitle className="text-sm font-semibold">{selected} 브랜드별 실적</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {brandAggs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-300 text-xs">데이터 없음</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left  py-2 font-medium">브랜드</th>
                      <th className="text-right py-2 font-medium">입고수량</th>
                      <th className="text-right py-2 font-medium">입고금액</th>
                      <th className="text-right py-2 font-medium">파렛트</th>
                      <th className="text-right py-2 font-medium">시간</th>
                      <th className="text-right py-2 font-medium">시간당 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandAggs.map(({ brand, agg }) => (
                      <tr
                        key={brand}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setCrumb({ level: 'brand', owner: brand, fromCenter: selected })}
                      >
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: OWNER_COLOR[brand] }} />
                            <span className="font-semibold text-gray-700">{brand}</span>
                          </div>
                        </td>
                        <td className="text-right text-gray-700">{fmtNum(agg.qty)}</td>
                        <td className="text-right text-gray-700">{fmtM(agg.amount)}</td>
                        <td className="text-right text-gray-700">{fmtNum(agg.pallets)}</td>
                        <td className="text-right text-gray-700">{fmtHr(agg.hours)}</td>
                        <td className="text-right font-semibold text-gray-800">{fmtM(agg.amtPerHr)}/h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-5 py-3.5 border-b border-border">
              <CardTitle className="text-sm font-semibold">{selected} 입고유형 구성 (정산 기준)</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {typeRows.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-300 text-xs">데이터 없음</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex h-4 rounded-full overflow-hidden">
                    {typeRows.map(t => {
                      const totalQty = typeRows.reduce((s, x) => s + x.qty, 0)
                      const w = totalQty > 0 ? (t.qty / totalQty) * 100 : 0
                      return <div key={t.key} style={{ width: `${w}%`, background: t.color }} title={`${t.label} ${fmtNum(t.qty)}개`} />
                    })}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left  py-1.5 font-medium">유형</th>
                        <th className="text-right py-1.5 font-medium">수량</th>
                        <th className="text-right py-1.5 font-medium">금액</th>
                        <th className="text-right py-1.5 font-medium">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typeRows.map(t => {
                        const totalQty = typeRows.reduce((s, x) => s + x.qty, 0)
                        return (
                          <tr key={t.key} className="border-b border-gray-50">
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                                <span className="text-gray-700">{t.label}</span>
                              </div>
                            </td>
                            <td className="text-right text-gray-700">{fmtNum(t.qty)}</td>
                            <td className="text-right text-gray-700">{fmtM(t.amt / 1_000_000)}</td>
                            <td className="text-right font-semibold text-gray-800">
                              {fmtPct(totalQty > 0 ? (t.qty / totalQty) * 100 : 0)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 센터별 추이 */}
        <Card>
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <CardTitle className="text-sm font-semibold">센터별 입고 추이</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {cTrendData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cTrendData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip
                    content={(props: any) => (
                      <ChartTooltip
                        active={props.active}
                        payload={props.payload}
                        label={props.label}
                        formatter={(v) => metricFmt(v, metric)}
                      />
                    )}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    formatter={(v: string) => v === 'total' ? '합계' : v} />
                  {CENTERS.map((c, i) => (
                    <Bar key={c} dataKey={c} stackId="a" fill={CENTER_COLOR[c]}
                      radius={i === CENTERS.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                  ))}
                  <Line dataKey="total" stroke="#94a3b8" strokeWidth={2}
                    dot={{ r: 3, fill: '#94a3b8' }} activeDot={{ r: 5 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ══ 전체 레벨 (기본) ══ */
  const chartRows = (() => {
    if (granularity !== 'day') return rows
    const ws = dateToWeekStart(start)
    const we = getWeekEnd(new Date(ws))
    const weStr = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, '0')}-${String(we.getDate()).padStart(2, '0')}`
    return rows.filter(r => r.work_date >= ws && r.work_date <= weStr)
  })()
  const trendData = toTrendData(chartRows, granularity, metric)
  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : '월간'
  const trendScope = granularity === 'day' ? '해당 주(금~목) 기준' : '전체 기간 기준'

  const brandDonut: DonutSegment[] = OWNERS.map(o => ({
    name: o, value: metricValue(ownerKpi[o], metric), color: OWNER_COLOR[o],
  }))
  const centerDonut: DonutSegment[] = CENTERS.map(c => ({
    name: c, value: metricValue(centerKpi[c], metric), color: CENTER_COLOR[c],
  }))

  const totalMetricVal = metricValue(total, metric)
  const donutLine1 = metric === 'pallet'
    ? fmtNum(Math.round(totalMetricVal))
    : metric === 'qty'
      ? fmtNum(totalMetricVal)
      : fmtM(totalMetricVal)
  const donutLine2 = metricUnitLabel(metric)

  function handleExport() {
    const filename = `입고실적_${start}_${end}.xlsx`
    exportInboundExcel(pRows, filename)
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── 엑셀 내보내기 ── */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          disabled={pRows.length === 0}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium
            bg-emerald-50 text-emerald-600 border border-emerald-200
            hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M2 2.5A.5.5 0 0 1 2.5 2h8a.5.5 0 0 1 .354.146l1.5 1.5a.5.5 0 0 1 .146.354v10a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 2 14V2.5zm1 .5v10h9V4.5h-1.5A.5.5 0 0 1 10 4V2.5L3 3zm4.5 5.854a.5.5 0 0 0 1 0V6.707l.646.647a.5.5 0 1 0 .708-.708l-1.5-1.5a.5.5 0 0 0-.708 0l-1.5 1.5a.5.5 0 1 0 .708.708L7.5 6.707V9.354z"/>
          </svg>
          엑셀 내보내기
        </button>
      </div>

      {/* ── 전체 KPI ── */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="총 입고금액"
          value={fmtM(total.amount)}
          sub={`${fmtNum(Math.round(total.amount * 100))}만원`}
          color="#FF6B35"
        />
        <KpiCard
          label="총 입고수량"
          value={fmtQty(total.qty)}
          color="#6366f1"
        />
        <KpiCard
          label="총 파렛트 수"
          value={fmtPlt(total.pallets)}
          color="#0ea5e9"
        />
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">시간당 입고 생산성</p>
            <div className="space-y-1.5">
              <p className="text-lg font-bold text-sky-500 leading-none">
                {fmtM(total.amtPerHr)}/h
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtNum(Math.round(total.qtyPerHr))}개/h · {total.palletPerHr.toFixed(1)}plt/h
              </p>
              <p className="text-[10px] text-gray-300 pt-1">정상입고 비율 {fmtPct(total.normalRatio)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 비중 분석 (도넛) ── */}
      <div className="grid grid-cols-2 gap-4">
        <DonutCard
          title="브랜드별 입고 비중"
          data={brandDonut}
          line1={donutLine1}
          line2={donutLine2}
          onSegmentClick={goToBrand}
          onRowClick={goToBrand}
        />
        <DonutCard
          title="센터별 입고 비중"
          data={centerDonut}
          line1={donutLine1}
          line2={donutLine2}
          onSegmentClick={goToCenter}
          onRowClick={goToCenter}
        />
      </div>

      {/* ── 센터별 현황 ── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">센터별 현황</p>
        <div className="grid grid-cols-3 gap-4">
          {CENTERS.map(c => (
            <CenterCard
              key={c} center={c} kpi={centerKpi[c]} metric={metric}
              onClick={() => goToCenter(c)}
            />
          ))}
        </div>
      </div>

      {/* ── 브랜드별 현황 ── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">브랜드별 현황</p>
        <div className="grid grid-cols-4 gap-4">
          {OWNERS.map(o => (
            <OwnerCard
              key={o} owner={o} kpi={ownerKpi[o]} metric={metric}
              onClick={() => goToBrand(o)}
            />
          ))}
        </div>
      </div>

      {/* ── 입고실적 추이 ── */}
      <Card>
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {granLabel} 입고{metric === 'amount' ? '금액' : metric === 'qty' ? '수량' : '파렛트'} 추이
            </CardTitle>
            <span className="text-xs text-muted-foreground">{trendScope}</span>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터가 없습니다</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={trendData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip
                  content={(props: any) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload}
                      label={props.label}
                      formatter={(v) => metricFmt(v, metric)}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  formatter={(v: string) => v === 'total' ? '합계' : v}
                />
                {OWNERS.map(o => (
                  <Bar key={o} dataKey={o} stackId="a" fill={OWNER_COLOR[o]}
                    radius={o === '3PL' ? [3,3,0,0] : [0,0,0,0]} />
                ))}
                <Line
                  dataKey="total" stroke="#94a3b8" strokeWidth={2}
                  dot={{ r: 3, fill: '#94a3b8' }} activeDot={{ r: 5 }} type="monotone"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
