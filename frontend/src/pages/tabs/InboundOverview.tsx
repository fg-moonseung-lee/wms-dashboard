import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { useAllInboundData } from '../../hooks/useAllInboundData'
import { periodToRange, dateToBucket, bucketLabel, dateToWeekStart, getWeekEnd } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import {
  OWNER_COLOR, OWNERS,
  CENTERS, CENTER_COLOR, CENTER_OWNERS, CENTER_OWNER,
} from '../../lib/supabase'
import type { InboundBrandDaily } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'
import type { InboundMetric } from '../inbound/InboundLayout'
import { exportInboundExcel } from '../../lib/exportInboundExcel'
import { fmtWon as fmtM } from '../../lib/format'

interface Props { period: Period; metric: InboundMetric; granularity?: Granularity }

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

/* ── 센터 요약 카드 ── */
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

/* ── 브랜드 요약 카드 ── */
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

/* ── 메인 ── */
export default function InboundOverview({ period, metric, granularity = 'month' }: Props) {
  const { rows, loading } = useAllInboundData()
  const navigate = useNavigate()

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

  const total = aggregateKpi(pRows)
  const centerKpi = Object.fromEntries(
    CENTERS.map(c => [c, aggregateKpi(pRows.filter(r => CENTER_OWNERS[c].includes(r.brand)))])
  )
  const ownerKpi = Object.fromEntries(
    OWNERS.map(o => [o, aggregateKpi(pRows.filter(r => r.brand === o))])
  )

  // 추이 차트: 일별은 선택일이 속한 주(금~목) 전체, 주간/월간은 전체 히스토리
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

  const goToBrand  = (owner: string)   => navigate('/inbound/brand',  { state: { owner } })
  const goToCenter = (center?: string) => navigate('/inbound/center', { state: { center } })

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
