import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import Explore from "@/pages/explore"
import Login from "@/pages/login"
import { AuthProvider, RequireAuth } from "@/lib/auth"

const Studio = lazy(() => import("@/pages/studio"))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/explore" element={<RequireAuth><Explore /></RequireAuth>} />
            <Route path="/studio" element={<RequireAuth><Studio /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
