import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { useAllZoneData } from '../../hooks/useAllZoneData'
import { useAllWorkerData } from '../../hooks/useAllWorkerData'
import type { WorkerActivityRow } from '../../hooks/useAllWorkerData'
import { useAllAttendanceData } from '../../hooks/useAllAttendanceData'
import type { AttendanceRecord } from '../../hooks/useAllAttendanceData'
import { periodToRange, dateToBucket, bucketLabel, dateToWeekStart, getWeekEnd } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import {
  OWNER_COLOR, OWNERS,
  CENTERS, CENTER_COLOR, CENTER_OWNERS, CENTER_OWNER,
  sumAttendanceHours,
} from '../../lib/supabase'
import type { ZoneDaily } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'
import { exportZoneExcel } from '../../lib/exportExcel'
import { fmtWon as fmtM } from '../../lib/format'

export type Metric = 'amount' | 'box'

interface Props { period: Period; metric: Metric; granularity?: Granularity }

const fmtBox = (v: number) => `${v.toLocaleString('ko-KR')}박스`
const fmtNum = (v: number) => v.toLocaleString('ko-KR')

interface KpiResult {
  amount: number; box: number
  wave: number; wms: number; att: number | null
  zones: number
  // 시간당 생산성 3단계: 1순위 WMS시간 · 2순위 근태시간(근무시간) · 3순위 작업시간(wave)
  amtPerHrWms: number | null; boxPerHrWms: number | null
  amtPerHrAtt: number | null; boxPerHrAtt: number | null
  amtPerHr: number;    boxPerHr: number
}

function aggregateKpi(
  rows: ZoneDaily[], workerRows: WorkerActivityRow[], attendance: AttendanceRecord[],
): KpiResult {
  let amount = 0, box = 0, wave = 0, wms = 0, wmsAmt = 0, wmsBox = 0
  const zoneSet = new Set<string>()
  for (const r of rows) {
    amount += r.pick_amount ?? 0
    box    += r.pick_box    ?? 0
    zoneSet.add(r.zone)
    if (r.wave_time_hr != null && r.wave_time_hr > 0) {
      wave += r.wave_time_hr
    }
    if (r.wms_time_hr != null && r.wms_time_hr > 0) {
      wms    += r.wms_time_hr
      wmsAmt += r.pick_amount ?? 0
      wmsBox += r.pick_box    ?? 0
    }
  }
  const { hours: attHr, hasAny: hasAtt } = sumAttendanceHours(workerRows, attendance)
  return {
    amount: amount / 1_000_000,
    box, wave, wms, att: hasAtt ? attHr : null,
    zones: zoneSet.size,
    amtPerHrWms:    wms > 0 ? (wmsAmt / 1_000_000) / wms : null,
    boxPerHrWms:    wms > 0 ? wmsBox / wms : null,
    amtPerHrAtt:    hasAtt && attHr > 0 ? (amount / 1_000_000) / attHr : null,
    boxPerHrAtt:    hasAtt && attHr > 0 ? box / attHr : null,
    amtPerHr:       wave > 0 ? (amount / 1_000_000) / wave : 0,
    boxPerHr:       wave > 0 ? box / wave : 0,
  }
}

function toTrendData(allRows: ZoneDaily[], gran: Granularity) {
  const map = new Map<string, Record<string, number>>()
  for (const r of allRows) {
    const bucket = dateToBucket(r.work_date, gran)
    if (!map.has(bucket)) map.set(bucket, {})
    const e = map.get(bucket)!
    e[r.owner]  = (e[r.owner]  ?? 0) + (r.pick_amount ?? 0) / 1_000_000
    e['_total'] = (e['_total'] ?? 0) + (r.pick_amount ?? 0) / 1_000_000
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, gran),
      ...Object.fromEntries(OWNERS.map(o => [o, +(e[o] ?? 0).toFixed(2)])),
      total: +(e['_total'] ?? 0).toFixed(2),
    }))
}

/* ── SVG 도넛 차트 ── */
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
      {/* 세그먼트: transform rotate로 시작 각도 지정 → 음수 dashoffset 없이 정확한 위치 */}
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
      {/* 중앙 텍스트 */}
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

/* ── 도넛 카드 ── */
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
          <SvgDonutChart
            data={data}
            line1={line1}
            line2={line2}
            onSegmentClick={onSegmentClick}
          />
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

/* ── KPI 카드 ── */
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
  center: string; kpi: KpiResult; metric: Metric; onClick?: () => void
}) {
  const color = CENTER_COLOR[center]
  const owners = CENTER_OWNERS[center]
  const isAmt = metric === 'amount'
  return (
    <Card
      className={onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-sm font-bold text-gray-700">{center}</span>
          <span className="text-xs text-gray-400">{owners.join(' · ')}</span>
        </div>
        <p className="text-2xl font-bold mb-3" style={{ color }}>
          {isAmt ? fmtM(kpi.amount) : fmtBox(kpi.box)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-400 mb-0.5">시간당 금액</p>
            <p className="text-sm font-semibold text-gray-700">
              {kpi.amtPerHrWms != null ? `${fmtM(kpi.amtPerHrWms)}/h` : '-'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              근태 {kpi.amtPerHrAtt != null ? `${fmtM(kpi.amtPerHrAtt)}/h` : '미입력'} · 작업 {fmtM(kpi.amtPerHr)}/h
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-400 mb-0.5">시간당 박스</p>
            <p className="text-sm font-semibold text-gray-700">
              {kpi.boxPerHrWms != null ? `${fmtNum(Math.round(kpi.boxPerHrWms))}박스/h` : '-'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              근태 {kpi.boxPerHrAtt != null ? `${fmtNum(Math.round(kpi.boxPerHrAtt))}박스/h` : '미입력'} · 작업 {fmtNum(Math.round(kpi.boxPerHr))}박스/h
            </p>
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-400">
          <span>WMS {kpi.wms.toFixed(0)}h</span>
          <span>·</span>
          <span>구역 {kpi.zones}개</span>
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
  owner: string; kpi: KpiResult; metric: Metric; onClick?: () => void
}) {
  const color = OWNER_COLOR[owner]
  const isAmt = metric === 'amount'
  const center = CENTER_OWNER[owner]
  return (
    <Card
      className={onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-sm font-bold text-gray-700">{owner}</span>
          <span className="text-xs text-gray-300">{center}</span>
        </div>
        <p className="text-xl font-bold mb-3" style={{ color }}>
          {isAmt ? fmtM(kpi.amount) : fmtBox(kpi.box)}
        </p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between items-start">
            <span className="text-gray-400">시간당 금액</span>
            <div className="text-right">
              <span className="font-medium text-gray-700">
                {kpi.amtPerHrWms != null ? `${fmtM(kpi.amtPerHrWms)}/h` : '-'}
              </span>
              <span className="block text-[10px] text-gray-400">
                근태 {kpi.amtPerHrAtt != null ? `${fmtM(kpi.amtPerHrAtt)}/h` : '미입력'} · 작업 {fmtM(kpi.amtPerHr)}/h
              </span>
            </div>
          </div>
          <div className="flex justify-between items-start">
            <span className="text-gray-400">시간당 박스</span>
            <div className="text-right">
              <span className="font-medium text-gray-700">
                {kpi.boxPerHrWms != null ? `${fmtNum(Math.round(kpi.boxPerHrWms))}박스/h` : '-'}
              </span>
              <span className="block text-[10px] text-gray-400">
                근태 {kpi.boxPerHrAtt != null ? `${fmtNum(Math.round(kpi.boxPerHrAtt))}박스/h` : '미입력'} · 작업 {fmtNum(Math.round(kpi.boxPerHr))}박스/h
              </span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">WMS시간</span>
            <span className="font-medium text-gray-700">{kpi.wms.toFixed(0)}h</span>
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
export default function Overview({ period, metric, granularity = 'month' }: Props) {
  const { rows, loading } = useAllZoneData()
  const { rows: workerRows, loading: workerLoading } = useAllWorkerData()
  const { rows: attendance, loading: attLoading } = useAllAttendanceData()
  const navigate = useNavigate()

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

  const total = aggregateKpi(pRows, pWorkerRows, attendance)
  const centerKpi = Object.fromEntries(
    CENTERS.map(c => [c, aggregateKpi(
      pRows.filter(r => CENTER_OWNERS[c].includes(r.owner)),
      pWorkerRows.filter(r => CENTER_OWNERS[c].includes(r.owner)),
      attendance,
    )])
  )
  const ownerKpi = Object.fromEntries(
    OWNERS.map(o => [o, aggregateKpi(
      pRows.filter(r => r.owner === o),
      pWorkerRows.filter(r => r.owner === o),
      attendance,
    )])
  )

  // 추이 차트 데이터: 일별은 '선택일이 속한 주(금~목)'의 근무일 전체를 막대로,
  //                  주간/월간은 전체 히스토리 기반
  const chartRows = (() => {
    if (granularity !== 'day') return rows
    const ws = dateToWeekStart(start)               // 선택일이 속한 주 시작(금)
    const we = getWeekEnd(new Date(ws))
    const weStr = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, '0')}-${String(we.getDate()).padStart(2, '0')}`
    return rows.filter(r => r.work_date >= ws && r.work_date <= weStr)
  })()
  const trendData = toTrendData(chartRows, granularity)
  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : '월간'
  const trendScope = granularity === 'day' ? '해당 주(금~목) 기준' : '전체 기간 기준'

  /* 도넛 데이터 */
  const brandDonut: DonutSegment[] = OWNERS.map(o => ({
    name: o,
    value: isAmt ? ownerKpi[o].amount : ownerKpi[o].box,
    color: OWNER_COLOR[o],
  }))
  const centerDonut: DonutSegment[] = CENTERS.map(c => ({
    name: c,
    value: isAmt ? centerKpi[c].amount : centerKpi[c].box,
    color: CENTER_COLOR[c],
  }))

  const donutLine1 = isAmt ? fmtM(total.amount) : fmtNum(total.box)
  const donutLine2 = isAmt ? '' : '박스'

  const goToBrand = (owner: string) =>
    navigate('/picking/brand', { state: { owner } })
  const goToCenter = (center?: string) =>
    navigate('/picking/center', { state: { center } })

  function handleExport() {
    const filename = `피킹실적_${start}_${end}.xlsx`
    exportZoneExcel(pRows, filename)
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
          label="총 피킹금액"
          value={fmtM(total.amount)}
          sub={`${fmtNum(Math.round(total.amount * 100))}만원`}
          color="#FF6B35"
        />
        <KpiCard
          label="총 피킹박스수"
          value={fmtBox(total.box)}
          color="#6366f1"
        />
        <KpiCard
          label="총 WMS시간"
          value={`${fmtNum(Math.round(total.wms))}h`}
          sub={[
            total.att != null ? `근태 ${fmtNum(Math.round(total.att))}h` : null,
            `작업시간 ${fmtNum(Math.round(total.wave))}h`,
          ].filter(Boolean).join(' · ')}
          color="#0ea5e9"
        />
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium mb-3">시간당 피킹 생산성</p>
            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">WMS기준</p>
                <p className="text-xl font-bold text-sky-500 leading-none">
                  {total.amtPerHrWms != null ? `${fmtM(total.amtPerHrWms)}/h` : '-'}
                  <span className="text-sm font-medium text-muted-foreground ml-2">
                    · {total.boxPerHrWms != null ? `${fmtNum(Math.round(total.boxPerHrWms))}박스/h` : '-'}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">근태시간 기준</p>
                <p className="text-sm font-semibold text-muted-foreground leading-none">
                  {total.amtPerHrAtt != null ? `${fmtM(total.amtPerHrAtt)}/h` : '미입력'}
                  {total.amtPerHrAtt != null && (
                    <span className="text-xs font-medium text-muted-foreground ml-2">
                      · {fmtNum(Math.round(total.boxPerHrAtt!))}박스/h
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">작업시간 기준</p>
                <p className="text-sm font-semibold text-muted-foreground leading-none">
                  {fmtM(total.amtPerHr)}/h
                  <span className="text-xs font-medium text-muted-foreground ml-2">· {fmtNum(Math.round(total.boxPerHr))}박스/h</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 비중 분석 (도넛) ── */}
      <div className="grid grid-cols-2 gap-4">
        <DonutCard
          title="브랜드별 피킹 비중"
          data={brandDonut}
          line1={donutLine1}
          line2={donutLine2}
          onSegmentClick={goToBrand}
          onRowClick={goToBrand}
        />
        <DonutCard
          title="센터별 피킹 비중"
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

      {/* ── 피킹실적 추이 ── */}
      <Card>
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{granLabel} {isAmt ? '피킹금액' : '피킹박스수'} 추이</CardTitle>
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
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={v => fmtM(v)}
                />
                <Tooltip
                  content={(props: any) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload}
                      label={props.label}
                      formatter={(v) => fmtM(v)}
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
