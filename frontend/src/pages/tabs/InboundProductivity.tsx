import { useNavigate } from 'react-router-dom'
import { useAllInboundData } from '../../hooks/useAllInboundData'
import { periodToRange, dateToBucket, bucketLabel } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'
import { OWNER_COLOR, OWNERS } from '../../lib/supabase'
import type { Period } from '../../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InboundMetric } from '../inbound/InboundLayout'
import {
  aggInbound, aggMetricValue, metricFmt, metricUnit, fmtM, fmtNum, fmtHr,
} from '../../lib/inboundUtils'

interface Props { period: Period; metric: InboundMetric; granularity?: Granularity }

export default function InboundProductivity({ period, metric, granularity = 'day' }: Props) {
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

  /* 버킷(일/주/월) 목록 */
  const buckets = [...new Set(pRows.map(r => dateToBucket(r.work_date, granularity)))].sort()

  /* 버킷 × 브랜드 실적 매트릭스 */
  const cell = new Map<string, ReturnType<typeof aggInbound>>()
  for (const b of buckets) {
    for (const o of OWNERS) {
      const sub = pRows.filter(r => dateToBucket(r.work_date, granularity) === b && r.brand === o)
      if (sub.length) cell.set(`${b}|${o}`, aggInbound(sub))
    }
  }

  const brandTotal = Object.fromEntries(
    OWNERS.map(o => [o, aggInbound(pRows.filter(r => r.brand === o))])
  )
  const grand = aggInbound(pRows)

  const granLabel = granularity === 'day' ? '일별' : granularity === 'week' ? '주간' : granularity === 'year' ? '연간' : '월간'

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── 실적 매트릭스 (버킷 × 브랜드) ── */}
      <Card>
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {granLabel} 브랜드별 입고실적{metricUnit(metric) && ` (${metricUnit(metric)})`}
            </CardTitle>
            <span className="text-xs text-muted-foreground">{start} ~ {end}</span>
          </div>
        </CardHeader>
        <CardContent className="p-5 overflow-x-auto">
          {buckets.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-300 text-xs">데이터가 없습니다</div>
          ) : (
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 pr-4 font-medium sticky left-0 bg-white">{granLabel.replace('별','')}</th>
                  {OWNERS.map(o => (
                    <th key={o} className="text-right py-2 px-3 font-medium">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: OWNER_COLOR[o] }} />
                        {o}
                      </div>
                    </th>
                  ))}
                  <th className="text-right py-2 pl-3 font-semibold text-gray-500">합계</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map(b => {
                  const rowRows = pRows.filter(r => dateToBucket(r.work_date, granularity) === b)
                  const rowAgg  = aggInbound(rowRows)
                  return (
                    <tr key={b} className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 font-semibold text-gray-700 sticky left-0 bg-white">
                        {bucketLabel(b, granularity)}
                      </td>
                      {OWNERS.map(o => {
                        const a = cell.get(`${b}|${o}`)
                        return (
                          <td key={o} className="text-right py-2.5 px-3 text-gray-700">
                            {a ? metricFmt(aggMetricValue(a, metric), metric) : <span className="text-gray-200">-</span>}
                          </td>
                        )
                      })}
                      <td className="text-right py-2.5 pl-3 font-semibold text-gray-800">
                        {metricFmt(aggMetricValue(rowAgg, metric), metric)}
                      </td>
                    </tr>
                  )
                })}
                {/* 합계 행 */}
                <tr className="border-t-2 border-gray-200 bg-gray-50/50">
                  <td className="py-2.5 pr-4 font-bold text-gray-700 sticky left-0 bg-gray-50">합계</td>
                  {OWNERS.map(o => (
                    <td key={o} className="text-right py-2.5 px-3 font-semibold text-gray-800">
                      {metricFmt(aggMetricValue(brandTotal[o], metric), metric)}
                    </td>
                  ))}
                  <td className="text-right py-2.5 pl-3 font-bold text-letusBlue">
                    {metricFmt(aggMetricValue(grand, metric), metric)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── 시간당 생산성 집계 ── */}
      <Card>
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <CardTitle className="text-sm font-semibold">브랜드별 시간당 생산성 (기간 합산)</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left  py-2 font-medium">브랜드</th>
                <th className="text-right py-2 font-medium">입고수량</th>
                <th className="text-right py-2 font-medium">입고금액</th>
                <th className="text-right py-2 font-medium">파렛트</th>
                <th className="text-right py-2 font-medium">실적시간</th>
                <th className="text-right py-2 font-medium">시간당 수량</th>
                <th className="text-right py-2 font-medium">시간당 금액</th>
                <th className="text-right py-2 font-medium">시간당 파렛트</th>
              </tr>
            </thead>
            <tbody>
              {OWNERS.map(o => {
                const a = brandTotal[o]
                if (a.hours === 0 && a.qty === 0) return null
                return (
                  <tr
                    key={o}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate('/inbound/brand', { state: { owner: o } })}
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: OWNER_COLOR[o] }} />
                        <span className="font-semibold text-gray-700">{o}</span>
                      </div>
                    </td>
                    <td className="text-right text-gray-700">{fmtNum(a.qty)}</td>
                    <td className="text-right text-gray-700">{fmtM(a.amount)}</td>
                    <td className="text-right text-gray-700">{fmtNum(a.pallets)}</td>
                    <td className="text-right text-gray-700">{fmtHr(a.hours)}</td>
                    <td className="text-right font-semibold text-gray-800">{fmtNum(Math.round(a.qtyPerHr))}개/h</td>
                    <td className="text-right font-semibold text-gray-800">{fmtM(a.amtPerHr)}/h</td>
                    <td className="text-right font-semibold text-gray-800">{a.palletPerHr.toFixed(1)}plt/h</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-gray-200 bg-gray-50/50">
                <td className="py-2.5 font-bold text-gray-700">전체</td>
                <td className="text-right font-semibold text-gray-800">{fmtNum(grand.qty)}</td>
                <td className="text-right font-semibold text-gray-800">{fmtM(grand.amount)}</td>
                <td className="text-right font-semibold text-gray-800">{fmtNum(grand.pallets)}</td>
                <td className="text-right font-semibold text-gray-800">{fmtHr(grand.hours)}</td>
                <td className="text-right font-bold text-letusBlue">{fmtNum(Math.round(grand.qtyPerHr))}개/h</td>
                <td className="text-right font-bold text-letusBlue">{fmtM(grand.amtPerHr)}/h</td>
                <td className="text-right font-bold text-letusBlue">{grand.palletPerHr.toFixed(1)}plt/h</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

    </div>
  )
}
