import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import HostDashboardPage from "./pages/HostDashboardPage";
import ListenerJoinPage from "./pages/ListenerJoinPage";
import LiveSessionPage from "./pages/LiveSessionPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/host" element={<HostDashboardPage />} />
      <Route path="/join" element={<ListenerJoinPage />} />
      <Route path="/join/:roomId" element={<ListenerJoinPage />} />
      <Route path="/session/:roomId" element={<LiveSessionPage />} />
    </Routes>
  );
}
