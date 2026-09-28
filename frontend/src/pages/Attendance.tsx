import { useEffect, useMemo, useState } from 'react'
import { useAttendance, type AttendanceRow } from '../hooks/useAttendance'
import { CONTRACTORS } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const SHIFT_ORDER = ['주간', '석간', '야간']
function sortShifts(shifts: string[]): string[] {
  return [...shifts].sort((a, b) => {
    const ia = SHIFT_ORDER.indexOf(a), ib = SHIFT_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b, 'ko')
  })
}

function HoursInput({ value, onSave }: { value: number | null; onSave: (v: number) => Promise<boolean> }) {
  const [text, setText] = useState(value != null ? String(value) : '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setText(value != null ? String(value) : '') }, [value])

  async function commit() {
    const n = Number(text)
    if (text === '' || Number.isNaN(n) || n < 0) { setText(value != null ? String(value) : ''); return }
    const ok = await onSave(n)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <input
        type="number" step="0.1" min="0" value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder="-"
        className="w-20 text-right border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
      />
      <span className="text-[11px] text-gray-400 w-4">h</span>
      <span className={`text-[10px] w-10 transition-opacity ${saved ? 'opacity-100 text-green-600' : 'opacity-0'}`}>저장됨</span>
    </div>
  )
}

function BulkFill({ count, onApply }: { count: number; onApply: (hours: number) => void }) {
  const [text, setText] = useState('')
  const n = Number(text)
  const valid = text !== '' && !Number.isNaN(n) && n >= 0

  return (
    <div className="flex items-center gap-2">
      <input
        type="number" step="0.1" min="0" value={text}
        onChange={e => setText(e.target.value)}
        placeholder="일괄 입력"
        className="w-20 text-right border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
      />
      <span className="text-[11px] text-gray-400">h</span>
      <button
        disabled={!valid || count === 0}
        onClick={() => { onApply(n); setText('') }}
        className="text-[11px] font-semibold text-letusBlue border border-letusBlue rounded-lg px-2.5 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-50 transition-colors whitespace-nowrap"
      >
        선택 {count}명에 일괄 적용
      </button>
    </div>
  )
}

function ShiftSection({ shift, rows, save, bulkFillEmpty }: {
  shift: string; rows: AttendanceRow[]
  save: (name: string, hours: number) => Promise<boolean>
  bulkFillEmpty: (names: string[], hours: number) => Promise<boolean>
}) {
  // 부분 잔업 등으로 일부만 다른 시간이 적용되는 경우가 있어, 대상자를 체크박스로
  // 골라서 그 사람들에게만(그 중 아직 미입력인 사람만) 일괄 적용 — 기본은 전체 선택.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map(r => r.worker_name)))
  const rowKey = rows.map(r => r.worker_name).join(',')
  useEffect(() => { setSelected(new Set(rows.map(r => r.worker_name))) }, [rowKey])

  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.worker_name))
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.worker_name)))
  const toggleOne = (name: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const selectedEmptyCount = rows.filter(r => selected.has(r.worker_name) && r.hours == null).length

  return (
    <Card>
      <CardHeader className="px-5 py-3.5 border-b border-border flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold">{shift} <span className="text-muted-foreground font-normal">({rows.length}명)</span></CardTitle>
        <BulkFill
          count={selectedEmptyCount}
          onApply={h => bulkFillEmpty(rows.filter(r => selected.has(r.worker_name)).map(r => r.worker_name), h)}
        />
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="w-10 py-2.5 px-5">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-letusBlue" />
              </th>
              <th className="text-left py-2.5 px-5 font-medium">이름</th>
              <th className="text-left py-2.5 px-5 font-medium">도급사</th>
              <th className="text-right py-2.5 px-5 font-medium">WMS시간(참고)</th>
              <th className="text-right py-2.5 px-5 font-medium">근무시간</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.worker_name} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                <td className="py-2.5 px-5">
                  <input
                    type="checkbox" checked={selected.has(r.worker_name)}
                    onChange={() => toggleOne(r.worker_name)} className="accent-letusBlue"
                  />
                </td>
                <td className="py-2.5 px-5 font-medium text-gray-700">{r.worker_name}</td>
                <td className="py-2.5 px-5 text-gray-500">{r.contractor}</td>
                <td className="py-2.5 px-5 text-right tabular-nums text-gray-400">
                  {r.wms_time_hr > 0 ? `${r.wms_time_hr.toFixed(1)}h` : '-'}
                </td>
                <td className="py-2.5 px-5">
                  <HoursInput value={r.hours} onSave={v => save(r.worker_name, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export default function Attendance() {
  const [date, setDate] = useState(yesterdayStr())
  const [company, setCompany] = useState('전체')
  const { rows, loading, error, save, bulkFillEmpty } = useAttendance(date)

  const filtered = company === '전체' ? rows : rows.filter(r => r.contractor === company)

  const groups = useMemo(() => {
    const m = new Map<string, AttendanceRow[]>()
    for (const r of filtered) {
      if (!m.has(r.shift)) m.set(r.shift, [])
      m.get(r.shift)!.push(r)
    }
    return sortShifts([...m.keys()]).map(shift => ({ shift, rows: m.get(shift)! }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered])

  return (
    <div className="p-5 space-y-5 animate-fade-in">

      {/* 필터 바 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">마감 대상 날짜</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">소속 회사</label>
              <select
                value={company} onChange={e => setCompany(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue min-w-[120px]"
              >
                <option value="전체">전체</option>
                {CONTRACTORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed ml-2 max-w-[520px]">
              도급사/협력사가 익일 확정하는 실제 출퇴근 기준 근무시간을 입력합니다. 선택한 날짜에
              피킹 또는 입고 활동이 있었던 작업자가 주간/야간/석간 파트별로 자동 표시됩니다.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-[12px] text-red-500">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-letusOrange border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-[12px]">불러오는 중...</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center h-40 text-gray-300 text-xs">
            {rows.length === 0 ? '이 날짜에 피킹/입고 활동 기록이 없습니다.' : '이 회사 소속 작업자가 없습니다.'}
          </CardContent>
        </Card>
      ) : (
        groups.map(g => (
          <ShiftSection key={g.shift} shift={g.shift} rows={g.rows} save={save} bulkFillEmpty={bulkFillEmpty} />
        ))
      )}
    </div>
  )
}
