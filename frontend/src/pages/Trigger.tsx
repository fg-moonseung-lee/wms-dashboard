import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SERVER_URL = 'http://localhost:8787'

interface StatusResponse {
  job_id: string
  date: string
  status: 'running' | 'done' | 'error'
  returncode: number | null
  started_at: string
  finished_at: string | null
  log: string[]
}

type HistoryEntry = Omit<StatusResponse, 'log'>

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function StatusBadge({ status }: { status: 'running' | 'done' | 'error' }) {
  const cls = {
    running: 'bg-blue-50 text-blue-600',
    done: 'bg-green-50 text-green-600',
    error: 'bg-red-50 text-red-600',
  }[status]
  const label = { running: '실행 중', done: '완료', error: '오류' }[status]
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

export default function Trigger() {
  const [date, setDate] = useState(todayStr())
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [selected, setSelected] = useState<StatusResponse | null>(null)

  const pollRef = useRef<number | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const logBoxRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => { selectedIdRef.current = selected?.job_id ?? null }, [selected])

  function checkServer() {
    setChecking(true)
    fetch(`${SERVER_URL}/api/health`)
      .then(r => setServerUp(r.ok))
      .catch(() => setServerUp(false))
      .finally(() => setChecking(false))
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${SERVER_URL}/api/history`)
      if (!res.ok) return
      const data: HistoryEntry[] = await res.json()
      setHistory(data)
      const running = data.find(h => h.status === 'running')
      if (running) {
        setActiveJobId(prev => prev ?? running.job_id)
        if (!selectedIdRef.current) viewJob(running.job_id)
        pollStatus(running.job_id)
      }
    } catch {
      /* 서버 미기동 시 조용히 무시 — serverUp 배너로 이미 안내됨 */
    }
  }

  useEffect(() => {
    checkServer()
    loadHistory()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [selected?.log])

  async function viewJob(jobId: string) {
    try {
      const res = await fetch(`${SERVER_URL}/api/status?job_id=${jobId}`)
      if (!res.ok) return
      const data: StatusResponse = await res.json()
      setSelected(data)
    } catch {
      /* 무시 */
    }
  }

  function pollStatus(jobId: string) {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/status?job_id=${jobId}`)
        if (!res.ok) return
        const data: StatusResponse = await res.json()
        if (selectedIdRef.current === jobId) setSelected(data)
        if (data.status !== 'running') {
          if (pollRef.current) window.clearInterval(pollRef.current)
          setActiveJobId(cur => (cur === jobId ? null : cur))
          loadHistory()
        }
      } catch {
        /* 일시적 네트워크 오류는 다음 폴링에서 재시도 */
      }
    }, 2000)
  }

  async function handleTrigger() {
    setErrorMsg(null)
    try {
      const res = await fetch(`${SERVER_URL}/api/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const data = await res.json()
      if (res.status === 409) {
        setErrorMsg('이미 실행 중인 집계 작업이 있습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      if (!res.ok) {
        setErrorMsg(data.error ?? '집계 요청에 실패했습니다.')
        return
      }
      const jobId = data.job_id as string
      setActiveJobId(jobId)
      setSelected({
        job_id: jobId, date, status: 'running',
        returncode: null, started_at: new Date().toISOString(), finished_at: null, log: [],
      })
      loadHistory()
      pollStatus(jobId)
    } catch {
      setServerUp(false)
      setErrorMsg('로컬 서버에 연결할 수 없습니다. 자동화 PC에서 대시보드를 열었는지 확인해주세요.')
    }
  }

  return (
    <div className="p-5 space-y-5 animate-fade-in">

      {/* 필터 바 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">집계 대상 날짜</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                disabled={activeJobId !== null}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue disabled:opacity-50"
              />
            </div>
            <button
              onClick={handleTrigger}
              disabled={activeJobId !== null || serverUp === false}
              className="bg-letusBlue hover:bg-blue-600 text-white text-xs font-semibold py-1.5 px-4 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              집계 실행
            </button>
            {activeJobId && <span className="text-[12px] font-semibold text-blue-600">실행 중...</span>}
            <p className="text-[11px] text-gray-400 leading-relaxed ml-2 max-w-[480px]">
              선택한 날짜의 피킹+입고 데이터를 다시 수집해 DB에 반영합니다. RPA 자동 스케줄은 꺼져
              있으므로, 명절/휴무일 등으로 자동 집계가 안 된 날짜는 여기서 수동으로 실행하세요.
            </p>
          </div>

          {serverUp === false && (
            <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-[12px] text-amber-700">
                로컬 트리거 서버에 연결할 수 없습니다. 이 기능은 자동화 PC에서 대시보드를 열었을 때만 동작합니다.
              </p>
              <button
                onClick={checkServer}
                disabled={checking}
                className="shrink-0 text-[11px] font-semibold text-amber-700 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                {checking ? '확인 중...' : '다시 확인'}
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="text-[12px] text-red-500 mt-3">{errorMsg}</p>
          )}
        </CardContent>
      </Card>

      {/* 실행 이력 */}
      <Card>
        <CardHeader className="px-5 py-3.5 border-b border-border">
          <CardTitle className="text-sm font-semibold">실행 이력</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="text-xs text-gray-300 text-center py-10">
              {serverUp === false ? '서버에 연결되면 이력이 표시됩니다.' : '아직 실행 이력이 없습니다.'}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-border">
                  <th className="text-left font-medium py-2 px-5">집계 대상 날짜</th>
                  <th className="text-left font-medium py-2 px-3">시작</th>
                  <th className="text-left font-medium py-2 px-3">완료</th>
                  <th className="text-left font-medium py-2 px-3">상태</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr
                    key={h.job_id}
                    onClick={() => viewJob(h.job_id)}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-gray-50 transition-colors ${
                      selected?.job_id === h.job_id ? 'bg-blue-50/60 hover:bg-blue-50/60' : ''
                    }`}
                  >
                    <td className="py-2 px-5 font-semibold text-gray-700">{h.date}</td>
                    <td className="py-2 px-3 text-gray-500">{fmtDateTime(h.started_at)}</td>
                    <td className="py-2 px-3 text-gray-500">{fmtDateTime(h.finished_at)}</td>
                    <td className="py-2 px-3"><StatusBadge status={h.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 선택한 실행의 로그 */}
      {selected && (
        <Card>
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">{selected.date} 실행 로그</CardTitle>
              <StatusBadge status={selected.status} />
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <pre
              ref={logBoxRef}
              className="bg-gray-900 text-gray-200 text-[11px] leading-relaxed rounded-lg p-3 h-[420px] overflow-y-auto whitespace-pre-wrap"
            >
              {selected.log.join('\n')}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
