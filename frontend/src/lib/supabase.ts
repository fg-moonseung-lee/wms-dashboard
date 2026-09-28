import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  as string
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

/* ── 테이블 타입 ─────────────────────────────────── */

export interface ZoneDaily {
  id:           number
  work_date:    string          // 'YYYY-MM-DD'
  center:       string          // '양지1센터' 등
  owner:        string          // '퍼시스' | '일룸' | '데스커' | '3PL'
  zone:         string          // 'H-I' | 'DPS' 등
  worker_name:  string | null
  shift:        string | null   // '주간' | '야간'
  wave_time_hr: number | null   // 작업시간 (wave 히스토리 합산 — 실제 피킹에 쓴 시간)
  wms_time_hr:  number | null   // WMS 근무시간 (첫 픽~마지막 픽 전체 span)
  pick_amount:  number | null
  pick_box:     number | null
}

export interface WorkerDaily {
  id:           number
  work_date:    string
  center:       string
  owner:        string
  zone:         string
  worker_name:  string
  shift:        string | null
  wave_time_hr: number | null
  wms_time_hr:  number | null
  pick_amount:  number | null
  pick_box:     number | null
}

/* ── 브랜드 색상 ─────────────────────────────────── */
export const OWNER_COLOR: Record<string, string> = {
  '일룸':  '#8B5CF6',
  '퍼시스': '#3B82F6',
  '데스커': '#10B981',
  '3PL':   '#F97316',
}

export const OWNERS = ['퍼시스', '일룸', '데스커', '3PL'] as const
export type Owner = typeof OWNERS[number]

/* ── 센터 매핑 ─────────────────────────────────── */
export const CENTER_OWNER: Record<string, string> = {
  '퍼시스': '1센터',
  '일룸':   '1센터',
  '데스커': '2센터',
  '3PL':   '3센터',
}
export const CENTERS = ['1센터', '2센터', '3센터'] as const
export type Center = typeof CENTERS[number]

export const CENTER_OWNERS: Record<string, string[]> = {
  '1센터': ['퍼시스', '일룸'],
  '2센터': ['데스커'],
  '3센터': ['3PL'],
}
export const CENTER_COLOR: Record<string, string> = {
  '1센터': '#3B82F6',
  '2센터': '#10B981',
  '3센터': '#F97316',
}

/* ── 입고 실적 (inbound_brand_daily / inbound_worker_daily) ── */
// 표준시간 개념 없음(피킹과 차이) — 시간당 수량/금액/파렛트로 생산성 표현
// d_* = 정산용 6유형 세분화 (총량은 일반 분류와 동일, 유형 구성만 다름)
interface InboundMetrics {
  qty_normal: number
  qty_return: number
  qty_cut:    number
  qty_total:  number
  amt_normal: number
  amt_return: number
  amt_cut:    number
  amt_total:  number
  pallets:    number
  hours:      number
  d_qty_normal:  number
  d_qty_return:  number
  d_qty_certify: number
  d_qty_reentry: number
  d_qty_inspect: number
  d_qty_cut:     number
  d_amt_normal:  number
  d_amt_return:  number
  d_amt_certify: number
  d_amt_reentry: number
  d_amt_inspect: number
  d_amt_cut:     number
  d_pallets:     number
}

export interface InboundBrandDaily extends InboundMetrics {
  id:         number
  work_date:  string
  center:     string
  brand:      string          // '일룸' | '퍼시스' | '데스커' | '3PL'
}

export interface InboundWorkerDaily extends InboundMetrics {
  id:             number
  work_date:      string
  center:         string
  brand:          string
  worker:         string       // raw ([주간]/[야간] 태그 포함)
  worker_display: string       // 태그 제거
}

/* ── 입고유형 (정산용 세분화 6유형) ── */
export const INBOUND_TYPES = [
  { key: 'normal',  label: '정상입고',        color: '#3B82F6' },
  { key: 'return',  label: '반품입고',        color: '#F97316' },
  { key: 'certify', label: '정품화입고',      color: '#8B5CF6' },
  { key: 'reentry', label: '재입고',          color: '#10B981' },
  { key: 'inspect', label: '검사이동·업체반송', color: '#F59E0B' },
  { key: 'cut',     label: 'CUT',            color: '#94A3B8' },
] as const
export type InboundTypeKey = typeof INBOUND_TYPES[number]['key']
