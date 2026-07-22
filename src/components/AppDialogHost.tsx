import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Command, X } from "./Icon";
import { getActiveDialog, settleDialog, subscribeDialogs } from "../lib/dialogs";

export function AppDialogHost() {
  const dialog = useSyncExternalStore(subscribeDialogs, getActiveDialog, getActiveDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.inputValue ?? "");
    const frame = requestAnimationFrame(() => (dialog.kind === "input" ? inputRef.current : confirmRef.current)?.focus());
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") settleDialog(dialog.kind === "alert" ? true : null); };
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key); };
  }, [dialog?.id]);
  if (!dialog) return null;
  const submit = () => settleDialog(dialog.kind === "input" ? value : true);
  return <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && dialog.kind !== "alert") settleDialog(null); }}>
    <form className={`app-dialog ${dialog.tone}`} role={dialog.tone === "danger" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="app-dialog-title" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <header><span className="app-dialog-mark">{dialog.tone === "danger" ? <AlertTriangle/> : <Command/>}</span><div><small>CoDes</small><h2 id="app-dialog-title">{dialog.title}</h2></div>{dialog.kind !== "alert" && <button type="button" className="icon-button" aria-label="Cancel" onClick={() => settleDialog(null)}><X/></button>}</header>
      {dialog.detail && <p>{dialog.detail}</p>}
      {dialog.kind === "input" && <label><span>{dialog.inputLabel ?? "Value"}</span><input ref={inputRef} value={value} placeholder={dialog.inputPlaceholder} onChange={(event) => setValue(event.target.value)} /></label>}
      <footer>{dialog.kind !== "alert" && <button type="button" className="secondary-button" onClick={() => settleDialog(null)}>{dialog.cancelLabel}</button>}<button ref={confirmRef} type="submit" className={dialog.tone === "danger" ? "danger-button" : "primary-button"}>{dialog.confirmLabel}</button></footer>
    </form>
  </div>;
}
