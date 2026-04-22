import PwaPrompt from "./PwaPrompt";

export default function AppShell({ children }) {
  return (
    <div className="app-frame">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />
      <main className="page-shell">
        <PwaPrompt />
        {children}
      </main>
    </div>
  );
}
