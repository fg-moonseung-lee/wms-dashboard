import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { Period } from '../../lib/types'
import { yesterday, recentDataWeek, recentDataMonth, recentDataYear, periodToRange } from '../../lib/weekUtils'
import type { Granularity } from '../../lib/weekUtils'

export type InboundMetric = 'amount' | 'qty' | 'pallet'

export interface InboundCtx {
  period: Period
  metric: InboundMetric
  granularity: Granularity
}

const PAGE_LABELS: Record<string, string> = {
  '/inbound/overview':     '종합현황',
  '/inbound/productivity': '생산성 집계',
  '/inbound/worker':       '작업자별 상세',
}

/** 집계 단위별 기본 기간 */
function defaultPeriodFor(g: Granularity): Period {
  if (g === 'day')  return { type: 'custom', start: yesterday(), end: yesterday() }
  if (g === 'week') return recentDataWeek()
  if (g === 'year') return recentDataYear()
  return recentDataMonth()
}

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8"  y1="2" x2="8"  y2="6" />
      <line x1="3"  y1="10" x2="21" y2="10" />
    </svg>
  )
}

export default function InboundLayout() {
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [period, setPeriod]           = useState<Period>(defaultPeriodFor('day'))
  const [metric, setMetric]           = useState<InboundMetric>('amount')

  // 달력 팝오버
  const [showPicker, setShowPicker]   = useState(false)
  const initR = periodToRange(defaultPeriodFor('day'))
  const [pickerStart, setPickerStart] = useState(initR.start)
  const [pickerEnd, setPickerEnd]     = useState(initR.end)
  const [pickerYear, setPickerYear]   = useState(new Date().getFullYear() - 1)
  const pickerRef = useRef<HTMLDivElement>(null)
  const YEAR_LIST = [2023, 2024, 2025, 2026]

  const navigate    = useNavigate()
  const { pathname } = useLocation()
  const pageLabel = PAGE_LABELS[pathname] ?? '입고생산성'
  const canGoBack = pathname !== '/inbound/overview'
  const ctx: InboundCtx = { period, metric, granularity }

  const range = periodToRange(period)
  const rangeLabel = period.type === 'yearly'
    ? `${period.year}년`
    : range.start === range.end ? range.start : `${range.start} ~ ${range.end}`

  function handleGranularity(g: Granularity) {
    const p = defaultPeriodFor(g)
    setGranularity(g)
    setPeriod(p)
    const r = periodToRange(p)
    setPickerStart(r.start)
    setPickerEnd(r.end)
    setShowPicker(false)
  }

  function openPicker() {
    if (period.type === 'yearly') setPickerYear(period.year)
    const r = periodToRange(period)
    setPickerStart(r.start)
    setPickerEnd(r.end)
    setShowPicker(v => !v)
  }

  function applyCustomRange() {
    if (!pickerStart || !pickerEnd) return
    const start = pickerStart <= pickerEnd ? pickerStart : pickerEnd
    const end   = pickerStart <= pickerEnd ? pickerEnd   : pickerStart
    setPeriod({ type: 'custom', start, end })
    setShowPicker(false)
  }

  useEffect(() => {
    if (!showPicker) return
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPicker])

  const GRAN_OPTS: { key: Granularity; label: string }[] = [
    { key: 'day',   label: '일별' },
    { key: 'week',  label: '주간' },
    { key: 'month', label: '월간' },
    { key: 'year',  label: '연간' },
  ]

  const METRIC_OPTS: { key: InboundMetric; label: string }[] = [
    { key: 'amount', label: '금액' },
    { key: 'qty',    label: '수량' },
    { key: 'pallet', label: '파렛트' },
  ]

  return (
    <div className="flex flex-col">

      {/* ── 서브 헤더 ── */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex items-center px-6 gap-3 h-11">

          {canGoBack && (
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-letusBlue transition-colors shrink-0 -ml-1"
              title="뒤로가기"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span className="hidden sm:inline">뒤로</span>
            </button>
          )}

          <span className="text-sm font-semibold text-gray-700 shrink-0">{pageLabel}</span>
          <span className="text-gray-200 select-none">|</span>
          <span className="text-xs text-gray-400 shrink-0">입고생산성</span>

          <div className="flex-1" />

          {/* 집계 단위 */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {GRAN_OPTS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleGranularity(key)}
                className={[
                  'px-3 py-1 rounded-md text-xs font-medium transition-all',
                  granularity === key
                    ? 'bg-white text-letusBlue shadow-sm'
                    : 'text-gray-400 hover:text-gray-600',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 날짜 범위 (달력) — 항상 현재 범위 표시 */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={openPicker}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                showPicker
                  ? 'border-letusBlue text-letusBlue bg-blue-50/50'
                  : 'border-gray-200 text-gray-600 hover:border-letusBlue hover:text-letusBlue',
              ].join(' ')}
              title="기간 직접 선택"
            >
              <CalendarIcon />
              <span>{rangeLabel}</span>
            </button>

            {showPicker && (
              <div className="absolute right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-gray-100 p-4 z-50 w-[220px]">
                {granularity === 'year' ? (
                  <>
                    <p className="text-[11px] font-semibold text-gray-600 mb-3">연도 선택</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {YEAR_LIST.map(y => (
                        <button
                          key={y}
                          onClick={() => {
                            setPeriod({ type: 'yearly', year: y })
                            setPickerYear(y)
                            setShowPicker(false)
                          }}
                          className={[
                            'py-2 rounded-lg text-xs font-semibold transition-all',
                            pickerYear === y
                              ? 'bg-letusBlue text-white'
                              : 'bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-letusBlue',
                          ].join(' ')}
                        >
                          {y}년
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-gray-600 mb-3">기간 직접 선택</p>
                    <div className="space-y-2.5">
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-1">시작일</label>
                        <input
                          type="date"
                          value={pickerStart}
                          onChange={e => setPickerStart(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-1">종료일</label>
                        <input
                          type="date"
                          value={pickerEnd}
                          onChange={e => setPickerEnd(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
                        />
                      </div>
                    </div>
                    <button
                      onClick={applyCustomRange}
                      disabled={!pickerStart || !pickerEnd}
                      className="mt-3 w-full bg-letusBlue hover:bg-blue-600 text-white text-xs font-semibold py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                    >
                      적용
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <span className="text-gray-200 select-none">|</span>

          {/* 지표 토글 */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
            {METRIC_OPTS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={[
                  'px-3 py-1 rounded text-xs font-medium transition-all',
                  metric === key
                    ? 'bg-white text-letusBlue shadow-sm'
                    : 'text-gray-400 hover:text-gray-600',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 콘텐츠 ── */}
      <div className="p-5 flex-1">
        <Outlet context={ctx} />
      </div>
    </div>
  )
}
