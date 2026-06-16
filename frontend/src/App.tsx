import { useEffect } from "react";

import CiderLogo from "@/components/CiderLogo";
import WaitlistForm from "@/components/WaitlistForm";

export default function App() {
  useEffect(() => {
    document.title = "cider.build — macOS sandboxes for AI agents";
  }, []);

  return (
    <main className="page-shell">
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
