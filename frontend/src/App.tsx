import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import PickingLayout from './pages/picking/PickingLayout'
import OverviewPage from './pages/picking/OverviewPage'
import BrandPage from './pages/picking/BrandPage'
import ProductivityPage from './pages/picking/ProductivityPage'
import WorkerPage from './pages/picking/WorkerPage'
import CenterPage from './pages/picking/CenterPage'
import InboundLayout from './pages/inbound/InboundLayout'
import InboundOverviewPage from './pages/inbound/OverviewPage'
import InboundBrandPage from './pages/inbound/BrandPage'
import InboundProductivityPage from './pages/inbound/ProductivityPage'
import InboundWorkerPage from './pages/inbound/WorkerPage'
import InboundCenterPage from './pages/inbound/CenterPage'
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
            <Route path="brand"        element={<BrandPage />} />
            <Route path="productivity" element={<ProductivityPage />} />
            <Route path="worker"       element={<WorkerPage />} />
            <Route path="center"       element={<CenterPage />} />
          </Route>
          <Route path="/inbound" element={<InboundLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview"     element={<InboundOverviewPage />} />
            <Route path="brand"        element={<InboundBrandPage />} />
            <Route path="productivity" element={<InboundProductivityPage />} />
            <Route path="worker"       element={<InboundWorkerPage />} />
            <Route path="center"       element={<InboundCenterPage />} />
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
