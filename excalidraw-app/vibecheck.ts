/**
 * VibeCheck demo instrumentation (branch vibecheck-demo). Emits allowlisted semantic events for the
 * "share drawing" journey through the SDK's `track()` API. Nothing here reads element content.
 * Labeled demo modification: not part of upstream Excalidraw.
 *
 * The journey: a user wants an image of their drawing to send to someone. The top-right "Share"
 * button opens live collaboration (a detour), the export lives in the main menu. Detours, help
 * requests and the eventual export are reported as attempts, results, progress and completion.
 */
import type { AppState } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

type Tracker = {
  track?: (type: string, payload?: Record<string, unknown>) => void;
};
const sdk = (): Tracker | undefined =>
  (window as unknown as { VibeCheck?: Tracker }).VibeCheck;

let journeyStarted = false;
/** Element count when the last journey completed: a new journey needs a new element, not the same drawing. */
let elementsAtCompletion = 0;
let exportDialogSeen = false;
let helpSeen = false;
let menuSeen = false;
let saveDialogSeen = false;
let saveAttempt = 0;
let backgroundSeen: boolean | null = null;
let shareOpen = false;
let shareAttempt = 0;
let attempt = 0;

export function observeExcalidrawState(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
) {
  const vc = sdk();
  if (!vc?.track) {
    return;
  }
  const live = elements.filter((el) => !el.isDeleted).length;
  // After a completed journey, take the current drawing as the baseline: only a new element
  // (or a cleared canvas that is drawn on again) starts the next journey.
  if (elementsAtCompletion === -1) {
    elementsAtCompletion = live;
  }
  if (live === 0) {
    elementsAtCompletion = 0;
  }
  const drawn = live > elementsAtCompletion;
  if (drawn && !journeyStarted) {
    journeyStarted = true;
    vc.track("journey_start", {
      journey_id: "share_drawing",
      goal_source: "declared",
    });
    vc.track("progress", { progress_ref: "drawing_started" });
  }
  if (!journeyStarted) {
    return;
  }
  const dialog = appState.openDialog?.name;
  if (dialog === "imageExport" && !exportDialogSeen) {
    exportDialogSeen = true;
    attempt += 1;
    vc.track("progress", { progress_ref: "export_dialog_opened" });
    vc.track("action_attempt", {
      action_ref: "export_image",
      attempt_id: `attempt_${attempt}`,
    });
  }
  if (dialog !== "imageExport" && exportDialogSeen) {
    exportDialogSeen = false;
  }
  if (dialog === "help" && !helpSeen) {
    helpSeen = true;
    vc.track("help_request", { target_ref: "help_dialog" });
  }
  // "Save to…" writes an .excalidraw file, not an image: opening it while looking for an image is
  // a detour, reported like the share dialog (attempt, then cancelled when closed).
  if (dialog === "jsonExport" && !saveDialogSeen) {
    saveDialogSeen = true;
    saveAttempt += 1;
    vc.track("navigation", { route_template: "/dialog/save" });
    vc.track("action_attempt", {
      action_ref: "save_to_file",
      attempt_id: `save_${saveAttempt}`,
      target_ref: "save_dialog",
    });
  }
  if (dialog !== "jsonExport" && saveDialogSeen) {
    saveDialogSeen = false;
    vc.track("navigation", { route_template: "/canvas" });
    vc.track("action_result", {
      action_ref: "save_to_file",
      attempt_id: `save_${saveAttempt}`,
      result: "cancelled",
      target_ref: "save_dialog",
    });
  }
  if (dialog === "imageExport") {
    if (
      backgroundSeen !== null &&
      backgroundSeen !== appState.exportBackground
    ) {
      vc.track("progress", {
        progress_ref: appState.exportBackground
          ? "export_background_on"
          : "export_background_off",
      });
    }
    backgroundSeen = appState.exportBackground;
  } else {
    backgroundSeen = null;
  }
  if (dialog !== "help" && helpSeen) {
    helpSeen = false;
  }
  const menuOpen = appState.openMenu === "canvas";
  if (menuOpen && !menuSeen) {
    menuSeen = true;
    vc.track("navigation", { route_template: "/menu/main" });
  }
  if (!menuOpen && menuSeen) {
    menuSeen = false;
  }
}

/** The share/live-collaboration dialog: opening it is an attempt; closing without collaborating is a cancelled result. */
export function observeShareDialog(isOpen: boolean, isCollaborating: boolean) {
  const vc = sdk();
  if (!vc?.track || !journeyStarted) {
    return;
  }
  if (isOpen && !shareOpen) {
    shareOpen = true;
    shareAttempt += 1;
    vc.track("navigation", { route_template: "/dialog/share" });
    vc.track("action_attempt", {
      action_ref: "share_button",
      attempt_id: `share_${shareAttempt}`,
      target_ref: "live_collaboration_dialog",
    });
  }
  if (!isOpen && shareOpen) {
    shareOpen = false;
    vc.track("navigation", { route_template: "/canvas" });
    vc.track("action_result", {
      action_ref: "share_button",
      attempt_id: `share_${shareAttempt}`,
      result: isCollaborating ? "success" : "cancelled",
      target_ref: "live_collaboration_dialog",
    });
  }
}

export function trackExportResult(type: string) {
  const vc = sdk();
  if (!vc?.track || !journeyStarted) {
    return;
  }
  // Copying to the clipboard is a successful export action but not a file the user can send:
  // the journey completes only with a file.
  if (type === "clipboard") {
    vc.track("action_result", {
      action_ref: "export_image",
      attempt_id: `attempt_${Math.max(1, attempt)}`,
      result: "success",
      target_ref: "export_clipboard",
    });
    return;
  }
  vc.track("action_result", {
    action_ref: "export_image",
    attempt_id: `attempt_${Math.max(1, attempt)}`,
    result: "success",
    target_ref: `export_${type}`,
  });
  vc.track("completion", {
    verification: "client_observed",
    progress_ref: "image_exported",
  });
  journeyStarted = false;
  elementsAtCompletion = -1;
  shareAttempt = 0;
  attempt = 0;
}

if (typeof window !== "undefined") {
  (
    window as unknown as { vibecheckExport?: (t: string) => void }
  ).vibecheckExport = trackExportResult;
}
