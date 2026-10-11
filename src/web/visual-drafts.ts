/** Session-only user intent. This is never canonical project storage. */
export interface NoteDraft { note: string; intent: string }
export interface RequestDraft { entryId: string | null; selectionId: string; values: Record<string, string> }
export interface PageDraft {
  intent: string; count: string; direction: string; brand: string; operation: string;
  scope: string; notes: Record<string, NoteDraft>; requests: Record<string, RequestDraft>;
  open: Record<string, boolean>;
}
export const emptyDraft = (): PageDraft => ({ intent: "", count: "", direction: "", brand: "", operation: "refine", scope: "", notes: {}, requests: {}, open: {} });
export class VisualDrafts {
  private readonly pages = new Map<string, PageDraft>();
  page(project: string, unit: string) {
    const key = JSON.stringify([project, unit]);
    if (!this.pages.has(key)) this.pages.set(key, emptyDraft());
    return this.pages.get(key)!;
  }
  discard(project: string, unit: string) { this.pages.delete(JSON.stringify([project, unit])); }
}
