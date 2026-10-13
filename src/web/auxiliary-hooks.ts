let hook: ((phase: "before" | "after" | "draft") => void) | null = null;
export function bindAuxiliaryReconstructionHook(
  fn: (phase: "before" | "after" | "draft") => void,
) {
  hook = fn;
}
export function auxiliaryReconstructionChanged(
  phase: "before" | "after" | "draft",
) {
  hook?.(phase);
}
