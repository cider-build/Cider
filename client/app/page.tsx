import CiderLogo from "@/components/CiderLogo";
import WaitlistForm from "@/components/WaitlistForm";


export default function Home() {
  return (
    <main className="page-shell">
      {/* ── Hero ─────────────────────────────────── */}
      <section className="hero">
        <CiderLogo iconSize={30} />

        <h1>
          MacOS Sandboxes
          <br />
          for Coding Agents.
        </h1>

        <p className="hero-subtitle">
          Spin up MacOS instances for your agents to build, test, and interact
          with native SwiftUI applications.
        </p>

        <WaitlistForm />
      </section>
    </main>
  );
}
