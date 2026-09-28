import { useEffect, useMemo, useState } from 'react'
import { useAttendance, type AttendanceRow } from '../hooks/useAttendance'
import { CONTRACTORS } from '../lib/supabase'

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
        className="text-[11px] font-semibold text-letusBlue border border-letusBlue rounded-lg px-2.5 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-50 transition-colors"
      >
        빈칸({count}명)에 일괄 적용
      </button>
    </div>
  )
}

function ShiftGroup({ shift, rows, save, bulkFillEmpty }: {
  shift: string; rows: AttendanceRow[]
  save: (name: string, hours: number) => Promise<boolean>
  bulkFillEmpty: (names: string[], hours: number) => Promise<boolean>
}) {
  const emptyCount = rows.filter(r => r.hours == null).length

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-bold text-gray-600">{shift} ({rows.length}명)</p>
        <BulkFill count={emptyCount} onApply={h => bulkFillEmpty(rows.map(r => r.worker_name), h)} />
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(r => (
            <tr key={r.worker_name} className="border-b border-gray-50 hover:bg-gray-50/60">
              <td className="py-2 pr-3 font-medium text-gray-700 w-[30%]">{r.worker_name}</td>
              <td className="py-2 pr-3 text-gray-500 w-[25%]">{r.contractor}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-400 w-[20%]">
                {r.wms_time_hr > 0 ? `${r.wms_time_hr.toFixed(1)}h` : '-'}
              </td>
              <td className="py-2 w-[25%]">
                <HoursInput value={r.hours} onSave={v => save(r.worker_name, v)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className="p-5">
      <div className="max-w-[840px] mx-auto bg-white rounded-xl shadow-xl border border-gray-100 p-6">
        <h2 className="text-[15px] font-bold text-gray-800 mb-1">근태 마감</h2>
        <p className="text-[12px] text-gray-400 mb-4">
          도급사/협력사가 익일 확정하는 실제 출퇴근 기준 근무시간을 입력합니다. 아래 목록은
          선택한 날짜에 피킹 또는 입고 활동이 있었던 작업자가 자동으로 표시됩니다. 주간/야간/석간
          등 파트별로 묶여 있어, 같은 값이면 일괄 적용도 가능합니다.
        </p>

        <div className="flex items-end gap-3 mb-5">
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
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
            >
              <option value="전체">전체</option>
              {CONTRACTORS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">
            {rows.length === 0 ? '이 날짜에 피킹/입고 활동 기록이 없습니다.' : '이 회사 소속 작업자가 없습니다.'}
          </div>
        ) : (
          groups.map(g => (
            <ShiftGroup key={g.shift} shift={g.shift} rows={g.rows} save={save} bulkFillEmpty={bulkFillEmpty} />
          ))
        )}
      </div>
    </div>
  )
}
