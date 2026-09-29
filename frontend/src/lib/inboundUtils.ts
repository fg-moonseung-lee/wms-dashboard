import type { InboundTypeKey } from './supabase'
import type { InboundMetric } from '../pages/inbound/InboundLayout'
import { fmtWon } from './format'

/* ── 포맷터 ── */
export const fmtM   = fmtWon
export const fmtQty = (v: number) => `${v.toLocaleString('ko-KR')}개`
export const fmtPlt = (v: number) => `${v.toLocaleString('ko-KR')}plt`
export const fmtNum = (v: number) => v.toLocaleString('ko-KR')
export const fmtPct = (v: number) => `${v.toFixed(1)}%`
export const fmtHr  = (v: number) => `${v.toFixed(1)}h`

export function metricFmt(v: number, metric: InboundMetric): string {
  return metric === 'amount' ? fmtM(v) : metric === 'qty' ? fmtQty(v) : fmtPlt(v)
}
export function metricUnit(metric: InboundMetric): string {
  return metric === 'amount' ? '' : metric === 'qty' ? '개' : 'plt'
}

/* ── 집계 ── */
// d_* 필드를 가진 행이면 무엇이든 집계 가능 (brand_daily / worker_daily 공용)
export interface InboundRow {
  qty_total: number; amt_total: number; pallets: number; hours: number
  d_qty_normal: number; d_qty_return: number; d_qty_certify: number
  d_qty_reentry: number; d_qty_inspect: number; d_qty_cut: number
  d_amt_normal: number; d_amt_return: number; d_amt_certify: number
  d_amt_reentry: number; d_amt_inspect: number; d_amt_cut: number
  d_pallets: number
}

export interface InboundAgg {
  qty: number; amount: number; pallets: number; hours: number
  amtPerHr: number; qtyPerHr: number; palletPerHr: number
  byType: Record<InboundTypeKey, { qty: number; amt: number }>
}

const TYPE_KEYS: InboundTypeKey[] = ['normal', 'return', 'certify', 'reentry', 'inspect', 'cut']

export function aggInbound(rows: InboundRow[]): InboundAgg {
  let qty = 0, amount = 0, pallets = 0, hours = 0
  const byType = Object.fromEntries(
    TYPE_KEYS.map(k => [k, { qty: 0, amt: 0 }])
  ) as InboundAgg['byType']

  for (const r of rows) {
    qty     += Number(r.qty_total) || 0
    amount  += Number(r.amt_total) || 0
    pallets += Number(r.pallets)   || 0
    hours   += Number(r.hours)     || 0
    for (const k of TYPE_KEYS) {
      byType[k].qty += Number(r[`d_qty_${k}` as keyof InboundRow]) || 0
      byType[k].amt += Number(r[`d_amt_${k}` as keyof InboundRow]) || 0
    }
  }
  return {
    qty, amount: amount / 1_000_000, pallets, hours,
    amtPerHr:    hours > 0 ? (amount / 1_000_000) / hours : 0,
    qtyPerHr:    hours > 0 ? qty / hours : 0,
    palletPerHr: hours > 0 ? pallets / hours : 0,
    byType,
  }
}

export function aggMetricValue(a: InboundAgg, metric: InboundMetric): number {
  return metric === 'amount' ? a.amount : metric === 'qty' ? a.qty : a.pallets
}
