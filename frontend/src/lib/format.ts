/** 금액 포맷 — 입력은 "백만원" 단위(기존 fmtM과 동일한 관례). 1억 이상은 억 단위, 미만은 만원 단위로 자동 전환. */
export function fmtWon(million: number): string {
  const sign = million < 0 ? '-' : ''
  const abs = Math.abs(million)
  if (abs >= 100) return `${sign}${(abs / 100).toFixed(1)}억`
  if (abs >= 0.01) return `${sign}${Math.round(abs * 100).toLocaleString('ko-KR')}만`
  return `${sign}${Math.round(abs * 1_000_000).toLocaleString('ko-KR')}원`
}
