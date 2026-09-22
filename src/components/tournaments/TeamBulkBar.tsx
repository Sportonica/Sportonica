"use client";

import { Check, ListChecks, SquareMinus, Trash2, X } from "lucide-react";

export type BulkNote = { kind: "ok" | "problem"; text: string };

// Toolbar above the Registrations table: select every team, then mark the
// selected walk-in teams paid or delete the selected teams. The buttons stay
// visible (disabled until something is selected) so they can be found, and
// "Select all" plus a bulk button covers "do this to every team".
export default function TeamBulkBar({
  total, selectedCount, markableCount, allSelected, busy, progress, note,
  onToggleAll, onMarkPaid, onDelete, onDismissNote,
}: {
  total: number;
  selectedCount: number;
  /** Selected teams that are walk-ins waiting for payment. */
  markableCount: number;
  allSelected: boolean;
  busy: boolean;
  /** "Deleting 3 of 12…" while a bulk run is in progress. */
  progress: string | null;
  note: BulkNote | null;
  onToggleAll: () => void;
  onMarkPaid: () => void;
  onDelete: () => void;
  onDismissNote: () => void;
}) {
  const none = selectedCount === 0;
  return (
    <>
      <div className="tc-bulk" role="toolbar" aria-label="Bulk actions for registered teams">
        <div className="tc-bulk-l">
          <button
            type="button" className="tc-btn" style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
            disabled={busy || total === 0} onClick={onToggleAll} aria-pressed={allSelected}
          >
            {allSelected ? <SquareMinus size={14} /> : <ListChecks size={14} />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <span className="tc-bulk-count" role="status" aria-live="polite">
            {progress ?? (none ? `${total} team${total === 1 ? "" : "s"}` : `${selectedCount} of ${total} selected`)}
          </span>
        </div>
        <div className="tc-bulk-r">
          <button
            type="button" className="tc-btn" style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
            disabled={busy || markableCount === 0} onClick={onMarkPaid}
            title={
              markableCount > 0 ? "Mark the selected walk-in teams as paid"
                : none ? "Select teams first"
                : "None of the selected teams are walk-ins waiting for payment"
            }
          >
            <Check size={14} /> Mark paid{markableCount > 0 ? ` (${markableCount})` : ""}
          </button>
          <button
            type="button" className="tc-btn danger" style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
            disabled={busy || none} onClick={onDelete}
            title={none ? "Select teams first" : "Permanently delete the selected teams"}
          >
            <Trash2 size={14} /> Delete{none ? "" : ` (${selectedCount})`}
          </button>
        </div>
      </div>
      {note && (
        <div className={`tc-bulk-note ${note.kind}`} role={note.kind === "problem" ? "alert" : "status"}>
          <span>{note.text}</span>
          <button type="button" className="tc-bulk-x" aria-label="Dismiss message" onClick={onDismissNote}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
