import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { OrdersPage } from './pages/OrdersPage'
import { BuildsPage } from './pages/BuildsPage'
import { ShortagesPage } from './pages/ShortagesPage'
import { DeviceShipmentsPage } from './pages/DeviceShipmentsPage'
import { SimulationPage } from './pages/SimulationPage'
import { ReportingPage } from './pages/ReportingPage'
import { AdminUsersPage } from './pages/AdminUsersPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="builds" element={<BuildsPage />} />
        <Route path="shortages" element={<ShortagesPage />} />
        <Route path="device-shipments" element={<DeviceShipmentsPage />} />
        <Route path="simulation" element={<SimulationPage />} />
        <Route path="reporting" element={<ReportingPage />} />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
