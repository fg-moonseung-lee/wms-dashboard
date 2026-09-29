import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAllInboundData } from '../../hooks/useAllInboundData'
import { useAllInboundWorkerData } from '../../hooks/useAllInboundWorkerData'
import { periodToRange, dateToBucket, bucketLabel } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import { OWNER_COLOR, OWNERS, CENTER_OWNER, INBOUND_TYPES } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltip } from '@/components/ChartTooltip'
import type { InboundMetric } from '../inbound/InboundLayout'
import { aggInbound, fmtM, fmtNum, fmtPct, fmtHr } from '../../lib/inboundUtils'

interface Props { period: Period; metric: InboundMetric; granularity?: Granularity }

export default function InboundBrand({ period, metric, granularity = 'day' }: Props) {
  const { rows, loading }        = useAllInboundData()
  const { rows: wRows, loading: wLoading } = useAllInboundWorkerData()
  const location = useLocation()
  const navigate = useNavigate()
  const [brand, setBrand] = useState<string>(
    (location.state as { owner?: string } | null)?.owner ?? '일룸'
  )

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
  const pRows  = rows.filter(r => r.work_date >= start && r.work_date <= end && r.brand === brand)
  const pwRows = wRows.filter(r => r.work_date >= start && r.work_date <= end && r.brand === brand)

  const agg = aggInbound(pRows)

  /* 유형 구성 */
  const typeRows = INBOUND_TYPES
    .map(t => ({ ...t, ...agg.byType[t.key] }))
    .filter(t => t.qty > 0 || t.amt > 0)
  const typeQtySum = typeRows.reduce((s, t) => s + t.qty, 0)

  /* 일별 유형 스택 추이 (정산용 6유형) */
  const trendMap = new Map<string, Record<string, number>>()
  for (const r of pRows) {
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
  const trendData = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => ({
      label: bucketLabel(bucket, granularity),
      ...Object.fromEntries(INBOUND_TYPES.map(t => [t.label, +(e[t.label] ?? 0).toFixed(2)])),
      total: +(e['_total'] ?? 0).toFixed(2),
    }))

  /* 작업자 집계 (기간 합산) */
  const workerMap = new Map<string, ReturnType<typeof aggInbound> & { worker: string; display: string; days: number }>()
  {
    const grouped = new Map<string, typeof pwRows>()
    for (const r of pwRows) {
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

      {/* ── 브랜드 선택 칩 ── */}
      <div className="flex items-center gap-2">
        {OWNERS.map(o => (
          <button
            key={o}
            onClick={() => setBrand(o)}
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

      {/* ── KPI ── */}
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

      {/* ── 유형 구성 + 추이 ── */}
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
            {trendData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-gray-300 text-xs">데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
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

      {/* ── 작업자 실적 ── */}
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
