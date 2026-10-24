/** Follow rendered ownership through slots and accessible shadow-root hosts. */
export function composedParent(node: Node): Element | null {
  if ((node instanceof Element || node instanceof Text) && node.assignedSlot) return node.assignedSlot;
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}
