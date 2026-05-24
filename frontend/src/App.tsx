import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider } from "@/lib/auth";
import Dashboard from "@/pages/dashboard/Dashboard";
import DashboardChrome from "@/pages/dashboard/DashboardChrome";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Viewer from "@/pages/viewer/Viewer";

const TITLES: Record<string, string> = {
  "/": "cider.build — macOS sandboxes for AI agents",
  "/login": "Sign in — Cider",
  "/signup": "Sign up — Cider",
  "/dashboard": "Dashboard — Cider",
};

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title =
      TITLES[pathname] ??
      (pathname.startsWith("/view/") ? "Sandbox view — Cider" : TITLES["/"]);
    document.title = title;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <DocumentTitle />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/dashboard"
          element={
            <AuthProvider requireAuth>
              <DashboardChrome>
                <Dashboard />
              </DashboardChrome>
            </AuthProvider>
          }
        />
        <Route
          path="/view/:id"
          element={
            <AuthProvider requireAuth>
              <Viewer />
            </AuthProvider>
          }
        />
      </Routes>
    </>
  );
}
