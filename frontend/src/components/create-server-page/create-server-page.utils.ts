import type { Node as CiderNode } from "../../api";

export function toggled<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function nodeLabel(node: CiderNode) {
  return node.metadata ? `${node.name}, ${node.metadata.chip}` : node.name;
}
