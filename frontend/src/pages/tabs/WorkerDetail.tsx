import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { useLocation } from 'react-router-dom'
import { useAllZoneData } from '../../hooks/useAllZoneData'
import { useWorkerStats } from '../../hooks/useWorkerStats'
import { useWorkerAttendance } from '../../hooks/useAttendance'
import { useHierarchy } from '../../hooks/useHierarchy'
import { OWNER_COLOR, OWNERS } from '../../lib/supabase'
import { periodToRange } from '../../lib/weekUtils'
import type { ZoneDaily } from '../../lib/supabase'
import type { Period, WorkerAgg, DailyPoint } from '../../lib/types'
import type { Metric } from './Overview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'

interface Props { period: Period; metric: Metric }

const fmtM   = (v: number) => `${v.toFixed(1)}백만`
const fmtBox = (v: number) => `${v.toLocaleString('ko-KR')}박스`
const fmtNum = (v: number) => v.toLocaleString('ko-KR')

/* ── Breadcrumb ─────────────────────────────────────── */
function Breadcrumb({ items }: { items: { label: string; onClick: () => void }[] }) {
  return (
    <div className="flex items-center gap-1 text-xs mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">›</span>}
          <button
            onClick={item.onClick}
            className={[
              'px-2 py-0.5 rounded',
              i === items.length - 1
                ? 'font-semibold text-letusBlue bg-blue-50'
                : 'text-gray-400 hover:text-gray-700',
            ].join(' ')}
          >
            {item.label}
          </button>
        </span>
      ))}
    </div>
  )
}

/* ── Depth 0: 브랜드 그리드 ─────────────────────────── */
function BrandGrid({ rows, metric, onSelect }: {
  rows: ZoneDaily[]; metric: Metric; onSelect: (owner: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {OWNERS.map(owner => {
        const oRows = rows.filter(r => r.owner === owner)
        let wave = 0, box = 0, amt = 0
        const zones = new Set<string>()
        for (const r of oRows) {
          wave += r.wave_time_hr ?? 0
          box += r.pick_box ?? 0; amt += r.pick_amount ?? 0
          zones.add(r.zone)
        }
        const isAmt = metric === 'amount'
        const primary = isAmt ? fmtM(amt / 1_000_000) : fmtBox(box)
        return (
          <button
            key={owner}
            onClick={() => onSelect(owner)}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-gray-200 transition-all group"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ background: OWNER_COLOR[owner] }} />
              <span className="text-sm font-bold text-gray-700 group-hover:text-letusBlue">{owner}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: OWNER_COLOR[owner] }}>{primary}</p>
            <div className="flex gap-3 mt-2 text-xs text-gray-400">
              <span>{zones.size}개 구역</span>
              <span>·</span>
              <span>작업시간 {wave.toFixed(0)}h</span>
            </div>
            <div className="mt-3 text-xs text-gray-300 group-hover:text-letusBlue flex items-center gap-1">
              <span>구역 상세 보기</span>
              <span>›</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ── Depth 1: 구역 그리드 ──────────────────────────── */
function ZoneGrid({ rows, owner, metric, onSelect }: {
  rows: ZoneDaily[]; owner: string; metric: Metric; onSelect: (zone: string) => void
}) {
  const color = OWNER_COLOR[owner]
  const oRows = rows.filter(r => r.owner === owner)
  const zoneMap = new Map<string, { wave: number; box: number; amt: number; days: Set<string> }>()
  for (const r of oRows) {
    if (!zoneMap.has(r.zone)) zoneMap.set(r.zone, { wave: 0, box: 0, amt: 0, days: new Set() })
    const e = zoneMap.get(r.zone)!
    e.wave += r.wave_time_hr ?? 0
    e.box += r.pick_box ?? 0; e.amt += r.pick_amount ?? 0
    e.days.add(r.work_date)
  }
  const zones = [...zoneMap.entries()]
    .map(([zone, e]) => ({ zone, ...e, days: e.days.size }))
    .sort((a, b) => b.amt - a.amt)

  const isAmt = metric === 'amount'

  return (
    <div className="grid grid-cols-3 gap-3">
      {zones.map(z => (
        <button
          key={z.zone}
          onClick={() => onSelect(z.zone)}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md hover:border-gray-200 transition-all group"
        >
          <div className="mb-2">
            <span className="text-sm font-bold text-gray-700 group-hover:text-letusBlue">{z.zone}</span>
          </div>
          <p className="text-lg font-bold" style={{ color }}>
            {isAmt ? fmtM(z.amt / 1_000_000) : fmtBox(z.box)}
          </p>
          <div className="mt-1 text-xs text-gray-400">{z.days}일 운영 · 작업시간 {z.wave.toFixed(0)}h</div>
          <div className="mt-2 text-xs text-gray-300 group-hover:text-letusBlue flex items-center gap-1">
            <span>작업자 보기</span><span>›</span>
          </div>
        </button>
      ))}
    </div>
  )
}

/* ── Depth 2: 작업자 테이블 ─────────────────────────── */
function WorkerTable({ workers, metric, onSelect }: {
  workers: WorkerAgg[]; metric: Metric; onSelect: (worker: string) => void
}) {
  const isAmt = metric === 'amount'
  if (workers.length === 0) return (
    <div className="flex items-center justify-center h-40 text-gray-300 text-[12px]">데이터 없음</div>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 text-gray-400 font-medium">#</th>
            <th className="text-left py-2 px-3 text-gray-400 font-medium">작업자</th>
            <th className="text-left py-2 px-3 text-gray-400 font-medium">구역</th>
            <th className="text-left py-2 px-3 text-gray-400 font-medium">시프트</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">{isAmt ? '금액(백만)' : '박스수'}</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">WMS시간</th>
            <th className="text-right py-2 px-3 text-gray-400 font-medium">작업시간</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w, i) => (
            <tr
              key={`${w.worker_name}-${w.zone}`}
              className={`cursor-pointer hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? 'bg-gray-50/30' : ''}`}
              onClick={() => onSelect(w.worker_name)}
            >
              <td className="py-2 px-3 text-gray-300">{i + 1}</td>
              <td className="py-2 px-3 font-semibold text-gray-700">{w.worker_name}</td>
              <td className="py-2 px-3 text-gray-500">{w.zone}</td>
              <td className="py-2 px-3 text-gray-500">{w.shift ?? '-'}</td>
              <td className="py-2 px-3 text-right text-gray-700">
                {isAmt ? fmtM(w.pick_amount / 1_000_000) : fmtNum(w.pick_box)}
              </td>
              <td className="py-2 px-3 text-right text-gray-500">{w.wms_time_hr.toFixed(1)}h</td>
              <td className="py-2 px-3 text-right text-gray-500">{w.wave_time_hr.toFixed(1)}h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Depth 3: 작업자 일별 상세 ──────────────────────── */
function WorkerDailyDetail({ daily, metric, attendance }: {
  workerName: string; daily: DailyPoint[]; metric: Metric; attendance: Map<string, number>
}) {
  const isAmt = metric === 'amount'
  if (daily.length === 0) return (
    <div className="flex items-center justify-center h-40 text-gray-300 text-[12px]">데이터 없음</div>
  )

  const chartData = daily.map(d => ({
    date: d.work_date.slice(5), // 'MM-DD'
    value: isAmt
      ? +(( d.pick_amount / 1_000_000)).toFixed(2)
      : d.pick_box,
    wave: +d.wave_time_hr.toFixed(1),
    wms:  +d.wms_time_hr.toFixed(1),
  }))

  const totalWave = daily.reduce((s, d) => s + d.wave_time_hr, 0)
  const totalWms  = daily.reduce((s, d) => s + d.wms_time_hr, 0)
  const totalAtt  = daily.reduce((s, d) => s + (attendance.get(d.work_date) ?? 0), 0)
  const attCount  = daily.filter(d => attendance.has(d.work_date)).length

  return (
    <div className="space-y-4">
      {/* 요약 — 1순위 WMS시간 · 2순위 근무시간(근태) · 3순위 작업시간(wave) */}
      <div className="flex gap-6 text-xs">
        <div><span className="text-gray-400">WMS시간 합계 </span><span className="font-bold text-gray-700">{totalWms.toFixed(1)}h</span></div>
        <div>
          <span className="text-gray-400">근무시간 합계 </span>
          <span className="font-bold text-gray-700">
            {attCount > 0 ? `${totalAtt.toFixed(1)}h` : '미입력'}
          </span>
          {attCount > 0 && attCount < daily.length && (
            <span className="text-gray-300"> ({attCount}/{daily.length}일)</span>
          )}
        </div>
        <div><span className="text-gray-400">작업시간 합계 </span><span className="font-bold text-gray-700">{totalWave.toFixed(1)}h</span></div>
        <div><span className="text-gray-400">가동일수 </span><span className="font-bold text-gray-700">{daily.length}일</span></div>
        <div>
          <span className="text-gray-400">{isAmt ? '총 금액 ' : '총 박스 '}</span>
          <span className="font-bold text-gray-700">
            {isAmt
              ? fmtM(daily.reduce((s, d) => s + d.pick_amount, 0) / 1_000_000)
              : fmtBox(daily.reduce((s, d) => s + d.pick_box, 0))}
          </span>
        </div>
      </div>

      {/* WMS시간 일별 차트 */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">일별 WMS시간 추이 (h)</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} domain={[0, 'auto']} unit="h" />
            <Tooltip
              content={(props: any) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  formatter={(v) => `${v}h`}
                />
              )}
            />
            <Bar dataKey="wms" fill="#FF6B35" radius={[3,3,0,0]} maxBarSize={32}
              label={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 일별 상세표 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-1.5 px-2 text-gray-400 font-medium">날짜</th>
              <th className="text-right py-1.5 px-2 text-gray-400 font-medium">{isAmt ? '금액(백만)' : '박스수'}</th>
              <th className="text-right py-1.5 px-2 text-gray-400 font-medium">WMS시간</th>
              <th className="text-right py-1.5 px-2 text-gray-400 font-medium">근무시간</th>
              <th className="text-right py-1.5 px-2 text-gray-400 font-medium">작업시간</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d, i) => {
              const att = attendance.get(d.work_date)
              return (
                <tr key={d.work_date} className={i % 2 === 0 ? 'bg-gray-50/40' : ''}>
                  <td className="py-1.5 px-2 text-gray-600">{d.work_date}</td>
                  <td className="py-1.5 px-2 text-right text-gray-700">
                    {isAmt ? fmtM(d.pick_amount / 1_000_000) : fmtNum(d.pick_box)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-gray-500">{d.wms_time_hr.toFixed(1)}h</td>
                  <td className="py-1.5 px-2 text-right text-gray-500">{att != null ? `${att.toFixed(1)}h` : '미입력'}</td>
                  <td className="py-1.5 px-2 text-right text-gray-500">{d.wave_time_hr.toFixed(1)}h</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── 메인 컴포넌트 ──────────────────────────────────── */
export default function WorkerDetail({ period, metric }: Props) {
  const location = useLocation()
  const { rows, loading: zoneLoading } = useAllZoneData()
  const initFilter = (() => {
    const s = location.state as { owner?: string; zone?: string } | null
    if (!s) return {}
    if (s.zone && s.owner) return { owner: s.owner, zone: s.zone }
    if (s.owner) return { owner: s.owner }
    return {}
  })()
  const { filter, depth, breadcrumb, selectOwner, selectZone, selectWorker } = useHierarchy(initFilter)

  /* depth 2-3 용: worker stats 훅 */
  const { workerAggs, dailyPoints, loading: workerLoading } = useWorkerStats(period, {
    owner:  filter.owner,
    zone:   filter.zone,
    worker: filter.worker,
  })
  const attendance = useWorkerAttendance(filter.worker, dailyPoints.map(d => d.work_date))

  const { start, end } = periodToRange(period)

  /* zone rows filtered by period */
  const pRows = rows.filter(r => r.work_date >= start && r.work_date <= end)

  const loading = zoneLoading || (depth >= 2 && workerLoading)

  return (
    <div className="space-y-4 animate-fade-in">

      {/* 헤더 */}
      <Card>
        <CardContent className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold mb-1">작업자 상세</p>
              <Breadcrumb items={breadcrumb} />
            </div>
            {depth > 0 && (
              <div className="text-xs text-muted-foreground">
                {depth === 1 && `${filter.owner} · 구역 선택`}
                {depth === 2 && `${filter.owner} › ${filter.zone} · 작업자 선택`}
                {depth === 3 && `${filter.owner} › ${filter.zone} › ${filter.worker}`}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center h-40 text-gray-400">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-letusOrange border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-[12px]">로딩 중...</p>
          </div>
        </div>
      )}

      {!loading && depth === 0 && (
        <BrandGrid rows={pRows} metric={metric} onSelect={selectOwner} />
      )}

      {!loading && depth === 1 && filter.owner && (
        <ZoneGrid rows={pRows} owner={filter.owner} metric={metric} onSelect={selectZone} />
      )}

      {!loading && depth === 2 && (
        <Card>
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold">
              {filter.owner} › {filter.zone} · 작업자별 실적 (금액 순)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <WorkerTable workers={workerAggs} metric={metric} onSelect={selectWorker} />
          </CardContent>
        </Card>
      )}

      {!loading && depth === 3 && filter.worker && (
        <Card>
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold">
              {filter.worker} · 일별 실적 상세
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <WorkerDailyDetail
              workerName={filter.worker}
              daily={dailyPoints}
              metric={metric}
              attendance={attendance}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
