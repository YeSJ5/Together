import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const HomePage = lazy(() => import("./pages/HomePage"));
const HostDashboardPage = lazy(() => import("./pages/HostDashboardPage"));
const ListenerJoinPage = lazy(() => import("./pages/ListenerJoinPage"));
const LiveSessionPage = lazy(() => import("./pages/LiveSessionPage"));

function PageFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
      <div className="spinner-disc" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/host" element={<HostDashboardPage />} />
        <Route path="/join" element={<ListenerJoinPage />} />
        <Route path="/join/:roomId" element={<ListenerJoinPage />} />
        <Route path="/listen/:roomId" element={<LiveSessionPage />} />
        <Route path="/session/:roomId" element={<LiveSessionPage />} />
      </Routes>
    </Suspense>
  );
}
