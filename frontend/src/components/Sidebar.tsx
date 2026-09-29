import { useState, useEffect } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'

/* ── 아이콘 ──────────────────────────────────────────── */
const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
)
const IcoStar = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)
const IcoChevron = ({ open }: { open: boolean }) => (
  <svg
    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
)
const IcoPicking = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
)
const IcoIncoming = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 12H2" /><path d="M12 22V12" />
    <path d="M7 17l5 5 5-5" />
    <path d="M2 7l10-5 10 5" /><path d="M2 7v5" /><path d="M22 7v5" />
  </svg>
)
const IcoCbm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)
const IcoTerminal = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" /><path d="m7 8 3 3-3 3" /><line x1="13" y1="14" x2="17" y2="14" />
  </svg>
)
const IcoTrigger = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)
const IcoAttendance = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

/* ── 메뉴 데이터 ─────────────────────────────────────── */
interface Leaf {
  kind: 'leaf'
  label: string
  to: string
}
interface Group {
  kind: 'group'
  label: string
  Icon: () => JSX.Element
  comingSoon?: boolean
  standalone?: boolean // 하위메뉴 없이 그 자체로 링크인 항목 (comingSoon과 달리 활성 상태로 표시)
  to?: string          // coming-soon / standalone 아이템의 링크 (선택)
  children: Leaf[]
}
interface Category {
  label: string
  items: Group[]
}

const MENU: Category[] = [
  {
    label: '근태관리',
    items: [
      {
        kind: 'group', label: '근태 마감', Icon: IcoAttendance,
        standalone: true, to: '/attendance', children: [],
      },
    ],
  },
  {
    label: '생산성',
    items: [
      {
        kind: 'group', label: '피킹생산성', Icon: IcoPicking,
        children: [
          { kind: 'leaf', label: '종합현황',      to: '/picking/overview' },
          { kind: 'leaf', label: '생산성 집계',    to: '/picking/productivity' },
          { kind: 'leaf', label: '작업자별 상세',  to: '/picking/worker' },
        ],
      },
      {
        kind: 'group', label: '입고생산성', Icon: IcoIncoming,
        children: [
          { kind: 'leaf', label: '종합현황',      to: '/inbound/overview' },
          { kind: 'leaf', label: '센터별 분석',    to: '/inbound/center' },
          { kind: 'leaf', label: '브랜드별 분석',  to: '/inbound/brand' },
          { kind: 'leaf', label: '생산성 집계',    to: '/inbound/productivity' },
          { kind: 'leaf', label: '작업자별 상세',  to: '/inbound/worker' },
        ],
      },
    ],
  },
  {
    label: 'CBM관리',
    items: [
      {
        kind: 'group', label: 'CBM관리', Icon: IcoCbm,
        comingSoon: true, to: '/cbm', children: [],
      },
    ],
  },
  {
    label: '장비관리',
    items: [
      {
        kind: 'group', label: '단말기 관리', Icon: IcoTerminal,
        comingSoon: true, to: '/equipment/terminal', children: [],
      },
    ],
  },
  {
    label: '데이터 관리',
    items: [
      {
        kind: 'group', label: '생산성 집계 실행', Icon: IcoTrigger,
        standalone: true, to: '/trigger', children: [],
      },
    ],
  },
]

/* 현재 경로가 속한 그룹 키 반환 */
function activeGroupKey(pathname: string): string | null {
  for (const cat of MENU) {
    for (const item of cat.items) {
      if (item.children.some(c => pathname.startsWith(c.to))) {
        return `${cat.label}::${item.label}`
      }
    }
  }
  return null
}

/* ── 컴포넌트 ─────────────────────────────────────────── */
/* ── 즐겨찾기 리프 목록 (로컬스토리지 기반) ── */
const FAV_KEY = 'letus_favs'
function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')) }
  catch { return new Set() }
}
function saveFavs(s: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...s]))
}
const ALL_LEAVES: Leaf[] = MENU.flatMap(cat => cat.items.flatMap(g => g.children))

export default function Sidebar() {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'fav'>('all')
  const [favs, setFavs] = useState<Set<string>>(loadFavs)
  const { pathname } = useLocation()

  const initKey = activeGroupKey(pathname)
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    initKey ? new Set([initKey]) : new Set(['생산성::피킹생산성', '생산성::입고생산성'])
  )

  useEffect(() => {
    const key = activeGroupKey(pathname)
    if (key) setOpenGroups(prev => new Set([...prev, key]))
  }, [pathname])

  const toggle = (key: string) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleFav = (to: string) =>
    setFavs(prev => {
      const next = new Set(prev)
      if (next.has(to)) next.delete(to)
      else next.add(to)
      saveFavs(next)
      return next
    })

  const favLeaves = ALL_LEAVES.filter(l => favs.has(l.to))

  return (
    <aside className="w-[248px] min-w-[248px] bg-letusSidebar min-h-screen flex flex-col shrink-0">

      {/* 로고 — 클릭 시 홈으로 */}
      <Link to="/" className="px-5 py-[18px] border-b border-white/8 block hover:bg-white/4 transition-colors">
        <p className="text-[15px] font-extrabold tracking-[0.10em]">
          <span className="text-white">LETUS </span>
          <span className="text-letusOrange">LOGIS</span>
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5 tracking-wide">WMS 생산성 관리</p>
      </Link>

      {/* 탭: 전체메뉴 · 즐겨찾기 */}
      <div className="flex border-b border-white/5 text-[11px]">
        <button
          onClick={() => setTab('all')}
          className={[
            'flex-1 flex items-center justify-center py-2.5 font-semibold transition-colors',
            tab === 'all'
              ? 'text-white border-b-2 border-letusOrange'
              : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent',
          ].join(' ')}
        >
          전체메뉴
        </button>
        <button
          onClick={() => setTab('fav')}
          className={[
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 font-semibold transition-colors',
            tab === 'fav'
              ? 'text-letusOrange border-b-2 border-letusOrange'
              : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent',
          ].join(' ')}
        >
          <IcoStar />
          즐겨찾기
        </button>
      </div>

      {/* 메뉴 검색 (전체메뉴 탭에서만) */}
      {tab === 'all' && (
        <div className="px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 bg-white/6 rounded-md px-3 py-1.5">
            <span className="text-slate-500"><IcoSearch /></span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="메뉴 검색..."
              className="flex-1 bg-transparent text-[12px] text-slate-300 placeholder-slate-600 outline-none"
            />
          </div>
        </div>
      )}

      {/* ── 전체메뉴 ── */}
      {tab === 'all' && (
        <nav className="flex-1 overflow-y-auto py-1.5">
          {MENU.map(cat => {
            const visibleItems = cat.items.filter(item => {
              if (!search) return true
              if (item.label.toLowerCase().includes(search.toLowerCase())) return true
              return item.children.some(c => c.label.toLowerCase().includes(search.toLowerCase()))
            })
            if (visibleItems.length === 0) return null

            return (
              <div key={cat.label} className="mb-0.5">
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[9.5px] text-slate-600 font-bold tracking-[0.14em] uppercase select-none">
                    {cat.label}
                  </p>
                </div>

                {visibleItems.map(item => {
                  const key = `${cat.label}::${item.label}`
                  const isOpen = openGroups.has(key)
                  const hasChildren = item.children.length > 0

                  return (
                    <div key={item.label}>
                      {item.comingSoon && item.to ? (
                        <NavLink
                          to={item.to}
                          className={({ isActive }) => [
                            'flex items-center gap-2.5 mx-2 px-3 py-2 rounded-md text-[12.5px] transition-all',
                            isActive ? 'bg-white/8 text-slate-300' : 'text-slate-600 hover:text-slate-400',
                          ].join(' ')}
                        >
                          <span className="opacity-60 shrink-0"><item.Icon /></span>
                          <span className="flex-1 text-left">{item.label}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-500 font-medium shrink-0">예정</span>
                        </NavLink>
                      ) : item.standalone && item.to ? (
                        <NavLink
                          to={item.to}
                          className={({ isActive }) => [
                            'flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-md text-[14px] font-medium transition-all duration-150',
                            isActive
                              ? 'bg-letusBlue text-white'
                              : 'text-slate-300 hover:text-white hover:bg-white/6',
                          ].join(' ')}
                        >
                          <span className="opacity-70 shrink-0"><item.Icon /></span>
                          <span className="flex-1 text-left">{item.label}</span>
                        </NavLink>
                      ) : (
                        <button
                          onClick={() => toggle(key)}
                          className="w-full flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-md text-[14px] font-medium text-slate-300 hover:text-white hover:bg-white/6 transition-all duration-150"
                          style={{ width: 'calc(100% - 1rem)' }}
                        >
                          <span className="opacity-70 shrink-0"><item.Icon /></span>
                          <span className="flex-1 text-left">{item.label}</span>
                          {hasChildren && <IcoChevron open={isOpen} />}
                        </button>
                      )}

                      {hasChildren && isOpen && (
                        <div className="mb-0.5">
                          {item.children
                            .filter(c => !search || c.label.toLowerCase().includes(search.toLowerCase()))
                            .map(child => (
                              <div key={child.to} className="flex items-center group mx-2">
                                <NavLink
                                  to={child.to}
                                  className={({ isActive }) => [
                                    'flex-1 flex items-center gap-2.5 pl-[42px] pr-2 py-2 rounded-l-md text-[13.5px] transition-all duration-150',
                                    isActive
                                      ? 'bg-letusBlue text-white font-semibold'
                                      : 'text-slate-400 hover:text-white hover:bg-white/5',
                                  ].join(' ')}
                                >
                                  <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" />
                                  {child.label}
                                </NavLink>
                                <button
                                  onClick={() => toggleFav(child.to)}
                                  title={favs.has(child.to) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                                  className={[
                                    'pr-2 pl-1 py-2 rounded-r-md transition-colors',
                                    favs.has(child.to)
                                      ? 'text-letusOrange'
                                      : 'text-slate-700 opacity-0 group-hover:opacity-100 hover:text-slate-400',
                                  ].join(' ')}
                                >
                                  <IcoStar />
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </nav>
      )}

      {/* ── 즐겨찾기 ── */}
      {tab === 'fav' && (
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {favLeaves.length === 0 ? (
            <div className="flex flex-col items-center gap-2 mt-10 text-slate-600">
              <IcoStar />
              <p className="text-[11px] text-center leading-relaxed">
                자주 쓰는 메뉴 옆<br />별표를 눌러 추가하세요
              </p>
            </div>
          ) : (
            <>
              <p className="text-[9.5px] text-slate-600 font-bold tracking-[0.14em] uppercase px-2 pb-2">즐겨찾기</p>
              {favLeaves.map(leaf => (
                <div key={leaf.to} className="flex items-center group">
                  <NavLink
                    to={leaf.to}
                    className={({ isActive }) => [
                      'flex-1 flex items-center gap-2.5 px-3 py-2 rounded-l-md text-[13px] transition-all duration-150',
                      isActive
                        ? 'bg-letusBlue text-white font-semibold'
                        : 'text-slate-400 hover:text-white hover:bg-white/5',
                    ].join(' ')}
                  >
                    <span className="text-letusOrange shrink-0"><IcoStar /></span>
                    {leaf.label}
                  </NavLink>
                  <button
                    onClick={() => toggleFav(leaf.to)}
                    title="즐겨찾기 해제"
                    className="pr-2 pl-1 py-2 rounded-r-md text-slate-700 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}
        </nav>
      )}

      {/* 사용자 */}
      <div className="border-t border-white/8 px-3 py-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-md">
          <div className="w-7 h-7 rounded-full bg-letusOrange/80 flex items-center justify-center text-white shrink-0 text-[11px] font-bold">
            이
          </div>
          <div>
            <p className="text-[12px] text-white font-semibold leading-tight">이문승</p>
            <p className="text-[10px] text-slate-500 leading-tight">바로스 · 관리자</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
