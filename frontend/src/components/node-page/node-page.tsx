import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { deleteNode, getNode } from "../../api";
import { ConfigurationForm } from "../configuration-form/configuration-form";
import { DetailHead, DetailPane, DetailSection, Facts, Signals } from "../detail";
import { Button, StatusText } from "../ui";
import { required } from "../ui/names";
import { displayGib } from "./node-page.utils";
import styles from "./node-page.module.css";

export function NodePage() {
  const nodeId = required(useParams().nodeId, "nodeId");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const node = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => getNode(nodeId),
  });
  const remove = useMutation({
    mutationFn: () => deleteNode(nodeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      await navigate("/nodes");
    },
  });

  if (node.status === "pending")
    return <p className={styles.desc}>Loading node</p>;
  if (node.error)
    return (
      <p className={styles.alert} role="alert">
        {node.error.message}
      </p>
    );

  const metadata = node.data.metadata;
  const configuration = node.data.configuration;
  const usedBytes = metadata
    ? metadata.storage_total_bytes - metadata.storage_available_bytes
    : 0;
  const usedShare
    = metadata && metadata.storage_total_bytes > 0
      ? Math.round((usedBytes / metadata.storage_total_bytes) * 100)
      : 0;

  return (
    <section>
      <DetailHead
        title={node.data.name}
        id={node.data.id}
        actions={(
          <>
            <Button
              kind="quiet"
              onClick={() => {
                void navigate("/nodes");
              }}
            >
              ← Nodes
            </Button>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove node \u201C${node.data.name}\u201D from your account? Its servers must be deleted first, and running sandboxes on it become unreachable.`,
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              {remove.isPending ? "Removing" : "Remove node"}
            </Button>
          </>
        )}
      />
      <DetailPane>
        <Signals
          items={[
            {
              label: "Connection",
              value: node.data.connected ? "Connected" : "Offline",
            },
            { label: "Disk used", value: metadata ? `${usedShare}%` : "—" },
            {
              label: "CPU",
              value: metadata ? `${metadata.cpu_count} cores` : "—",
            },
            {
              label: "Memory",
              value: metadata ? displayGib(metadata.memory_bytes) : "—",
            },
          ]}
        />
        {remove.error && (
          <p className={styles.alert} role="alert">
            {remove.error.message}
          </p>
        )}
        {metadata
          ? (
              <Facts
                items={[
                  ["Model", metadata.hardware_model],
                  ["Chip", metadata.chip],
                  ["CPU", `${metadata.cpu_count} cores`],
                  ["Memory", displayGib(metadata.memory_bytes)],
                  ["Storage", displayGib(metadata.storage_total_bytes)],
                  [
                    "Storage in use",
                    `${displayGib(usedBytes)} of ${displayGib(metadata.storage_total_bytes)}`,
                  ],
                  ["Operating system", `macOS ${metadata.macos_version}`],
                  [
                    "Connection",
                    <StatusText
                      key="c"
                      label={node.data.connected ? "Connected" : "Offline"}
                    />,
                  ],
                ]}
              />
            )
          : (
              <p className={styles.desc}>
                Reconnect this node to report its hardware.
              </p>
            )}
        {metadata && configuration && (
          <DetailSection title="Sandbox allocation">
            <ConfigurationForm
              key={node.data.id}
              node={node.data}
              metadata={metadata}
              configuration={configuration}
            />
          </DetailSection>
        )}
      </DetailPane>
    </section>
  );
}
