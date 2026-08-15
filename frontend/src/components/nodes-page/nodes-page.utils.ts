import type { NodeMetadata } from "../../api";
import { displayGb } from "../ui/names";

export function memory(metadata: NodeMetadata | null) {
  return metadata === null ? "—" : displayGb(metadata.memory_bytes);
}
