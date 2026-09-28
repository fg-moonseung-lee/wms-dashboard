import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

const PAGE_TITLE_MAP: { prefix: string; title: string }[] = [
  { prefix: '/picking',   title: '피킹생산성' },
  { prefix: '/incoming',  title: '입고생산성' },
  { prefix: '/cbm',       title: 'CBM관리' },
  { prefix: '/equipment', title: '장비관리' },
  { prefix: '/trigger',   title: '생산성 집계 수동 실행' },
]

const IcoMenu = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)
const IcoStar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)
const IcoRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
)
const IcoBell = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export default function Layout() {
  const location = useLocation()
  const title = PAGE_TITLE_MAP.find(({ prefix }) => location.pathname.startsWith(prefix))?.title ?? '생산성 관리'

  return (
    <div className="flex" style={{ minHeight: '100vh' }}>
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">

        {/* 헤더 */}
        <header className="h-[52px] bg-white border-b border-gray-100 flex items-center px-5 gap-3 shrink-0 sticky top-0 z-20 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <button className="text-gray-400 hover:text-gray-600 transition-colors">
            <IcoMenu />
          </button>
          <button className="text-gray-300 hover:text-yellow-400 transition-colors">
            <IcoStar />
          </button>
          <h1 className="text-[14px] font-bold text-gray-800 whitespace-nowrap">{title}</h1>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <IcoRefresh />
            </button>
            <button className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
              <IcoBell />
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
              <div className="w-7 h-7 rounded-full bg-letusOrange/10 flex items-center justify-center">
                <span className="text-[11px] font-bold text-letusOrange">이</span>
              </div>
              <div className="leading-tight">
                <p className="text-[12px] font-semibold text-gray-700">이문승</p>
                <p className="text-[10px] text-gray-400">바로스 · 관리자</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto" style={{ backgroundColor: '#f0f3f7' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
