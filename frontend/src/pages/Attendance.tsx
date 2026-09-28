import { useEffect, useState } from 'react'
import { useAttendance } from '../hooks/useAttendance'

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
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

export default function Attendance() {
  const [date, setDate] = useState(todayStr())
  const { rows, loading, error, save } = useAttendance(date)

  return (
    <div className="p-5">
      <div className="max-w-[720px] mx-auto bg-white rounded-xl shadow-xl border border-gray-100 p-6">
        <h2 className="text-[15px] font-bold text-gray-800 mb-1">근태 마감</h2>
        <p className="text-[12px] text-gray-400 mb-4">
          도급사/협력사가 익일 확정하는 실제 출퇴근 기준 근무시간을 입력합니다. 아래 목록은
          선택한 날짜에 피킹 또는 입고 활동이 있었던 작업자가 자동으로 표시됩니다.
        </p>

        <div className="mb-4">
          <label className="text-[10px] text-gray-400 block mb-1">마감 대상 날짜</label>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue"
          />
        </div>

        {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-xs">
            이 날짜에 피킹/입고 활동 기록이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="text-left pb-2 pr-3 font-medium">이름</th>
                <th className="text-left pb-2 pr-3 font-medium">도급사</th>
                <th className="text-right pb-2 pr-3 font-medium">WMS시간(참고)</th>
                <th className="text-right pb-2 font-medium">근무시간</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.worker_name} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="py-2 pr-3 font-medium text-gray-700">{r.worker_name}</td>
                  <td className="py-2 pr-3 text-gray-500">{r.contractor}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-400">
                    {r.wms_time_hr > 0 ? `${r.wms_time_hr.toFixed(1)}h` : '-'}
                  </td>
                  <td className="py-2">
                    <HoursInput value={r.hours} onSave={v => save(r.worker_name, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
