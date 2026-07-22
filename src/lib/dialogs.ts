export type DialogTone = "default" | "danger";
export type DialogKind = "alert" | "confirm" | "input";

export interface AppDialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: DialogTone;
  inputLabel?: string;
  inputValue?: string;
  inputPlaceholder?: string;
  settle: (value: boolean | string | null) => void;
}

type DialogOptions = Omit<Partial<AppDialogRequest>, "id" | "kind" | "settle"> & Pick<AppDialogRequest, "title">;
type Listener = () => void;
let nextId = 1;
let active: AppDialogRequest | null = null;
const queue: AppDialogRequest[] = [];
const listeners = new Set<Listener>();

function emit() { listeners.forEach((listener) => listener()); }
function enqueue(kind: DialogKind, options: DialogOptions) {
  return new Promise<boolean | string | null>((resolve) => {
    const request: AppDialogRequest = {
      id: nextId++, kind, title: options.title, detail: options.detail,
      confirmLabel: options.confirmLabel ?? (kind === "alert" ? "Got it" : "Continue"),
      cancelLabel: options.cancelLabel ?? "Cancel", tone: options.tone ?? "default",
      inputLabel: options.inputLabel, inputValue: options.inputValue, inputPlaceholder: options.inputPlaceholder,
      settle: resolve,
    };
    if (active) queue.push(request); else active = request;
    emit();
  });
}

export function subscribeDialogs(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function getActiveDialog() { return active; }
export function settleDialog(value: boolean | string | null) { const current = active; if (!current) return; active = queue.shift() ?? null; current.settle(value); emit(); }
export async function appAlert(options: DialogOptions) { await enqueue("alert", options); }
export async function appConfirm(options: DialogOptions) { return await enqueue("confirm", options) === true; }
export async function appPrompt(options: DialogOptions) { const result = await enqueue("input", options); return typeof result === "string" ? result : null; }
