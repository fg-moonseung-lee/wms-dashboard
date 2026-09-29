import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import PickingLayout from './pages/picking/PickingLayout'
import OverviewPage from './pages/picking/OverviewPage'
import ProductivityPage from './pages/picking/ProductivityPage'
import WorkerPage from './pages/picking/WorkerPage'
import InboundLayout from './pages/inbound/InboundLayout'
import InboundOverviewPage from './pages/inbound/OverviewPage'
import InboundProductivityPage from './pages/inbound/ProductivityPage'
import InboundWorkerPage from './pages/inbound/WorkerPage'
import ComingSoon from './pages/ComingSoon'
import Home from './pages/Home'
import Trigger from './pages/Trigger'
import Attendance from './pages/Attendance'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/picking" element={<PickingLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview"     element={<OverviewPage />} />
            <Route path="productivity" element={<ProductivityPage />} />
            <Route path="worker"       element={<WorkerPage />} />
            {/* 센터별/브랜드별 분석은 종합현황 안에 브레드크럼 드릴다운으로 흡수됨 */}
            <Route path="brand"  element={<Navigate to="/picking/overview" replace />} />
            <Route path="center" element={<Navigate to="/picking/overview" replace />} />
          </Route>
          <Route path="/inbound" element={<InboundLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview"     element={<InboundOverviewPage />} />
            <Route path="productivity" element={<InboundProductivityPage />} />
            <Route path="worker"       element={<InboundWorkerPage />} />
            {/* 센터별/브랜드별 분석은 종합현황 안에 브레드크럼 드릴다운으로 흡수됨 */}
            <Route path="brand"  element={<Navigate to="/inbound/overview" replace />} />
            <Route path="center" element={<Navigate to="/inbound/overview" replace />} />
          </Route>
          <Route path="/cbm"                 element={<ComingSoon title="CBM관리" />} />
          <Route path="/equipment/terminal"  element={<ComingSoon title="단말기 관리" />} />
          <Route path="/trigger"             element={<Trigger />} />
          <Route path="/attendance"          element={<Attendance />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
