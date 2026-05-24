import NodesPanel from "./NodesPanel";
import SandboxesPanel from "./SandboxesPanel";

export default function Dashboard() {
  return (
    <div className="dash-grid">
      <NodesPanel />
      <SandboxesPanel />
    </div>
  );
}
