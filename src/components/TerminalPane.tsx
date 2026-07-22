import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ArrowRightLeft, ChevronDown, ChevronUp, Maximize2, Minimize2, RotateCcw, Search, Square, X } from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { sessionRuntime } from "../lib/sessionRuntime";
import { appConfirm } from "../lib/dialogs";
import type { AgentSession, AppTheme } from "../types";

function terminalTheme(theme: AppTheme) { const t = theme.tokens; return { background: t.background, foreground: t.text, cursor: t.accent, selectionBackground: t.surfaceRaised, black: t.background, brightBlack: t.muted, red: t.danger, green: t.success, yellow: t.warning, blue: "#79a8d8", magenta: "#bd8dbd", cyan: "#78b8aa", white: t.text, brightWhite: "#faf7f1" }; }

export function TerminalPane({ session, theme, compact = false, maximized = false, onToggleMaximize, onContinueWithProvider }: { session: AgentSession; theme: AppTheme; compact?: boolean; maximized?: boolean; onToggleMaximize?: () => void; onContinueWithProvider?: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  const hostRef = useRef<HTMLDivElement>(null); const terminalRef = useRef<Terminal | null>(null); const searchRef = useRef<SearchAddon | null>(null); const [searching, setSearching] = useState(false); const [term, setTerm] = useState("");
  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({ convertEol: false, cursorBlink: true, cursorStyle: "bar", fontFamily: theme.tokens.mono, fontSize: compact ? 11 : 13, lineHeight: 1.35, scrollback: 10_000, theme: terminalTheme(theme), allowProposedApi: false });
    const fit = new FitAddon(); const search = new SearchAddon(); terminal.loadAddon(fit); terminal.loadAddon(search); terminal.loadAddon(new WebLinksAddon()); terminal.open(hostRef.current); fit.fit(); terminalRef.current = terminal; searchRef.current = search;
    const unsubscribe = sessionRuntime.subscribe(session, (event) => { if (event.event === "output") terminal.write(new Uint8Array(event.data.bytes)); if (event.event === "exit") terminal.writeln(`\r\n\x1b[38;2;160;160;160mProcess exited (${event.data.code ?? "signal"})\x1b[0m`); if (event.event === "error") terminal.writeln(`\r\n\x1b[31m${event.data.message}\x1b[0m`); }, { cols: terminal.cols, rows: terminal.rows });
    const input = terminal.onData((data) => void sessionRuntime.send(session.id, data));
    let frame = 0; const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { fit.fit(); void sessionRuntime.resize(session.id, terminal.cols, terminal.rows); }); }); observer.observe(hostRef.current);
    return () => { unsubscribe(); input.dispose(); observer.disconnect(); cancelAnimationFrame(frame); terminal.dispose(); terminalRef.current = null; searchRef.current = null; };
  }, [session.id, session.provider, session.cwd, compact, theme.tokens.mono]);
  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme); }, [theme]);
  const find = (previous = false) => { if (!term) return; if (previous) searchRef.current?.findPrevious(term); else searchRef.current?.findNext(term); terminalRef.current?.focus(); };
  return <section className={`terminal-pane ${searching ? "searching" : ""} ${maximized ? "maximized" : ""}`} aria-label={`${session.title} terminal`}>
    <header className="terminal-toolbar"><div><span className={`status-dot ${session.status}`} /><ProviderIcon provider={session.provider} compact/><strong>{session.title}</strong><span className="provider-pill">{session.provider}</span></div><div className="toolbar-actions">
      <button className="icon-button" aria-label="Search terminal" onClick={() => setSearching((v) => !v)}><Search size={14}/></button>
      <button className="icon-button provider-handoff-trigger" aria-label="Continue with another provider" title="Continue with another provider" onClick={onContinueWithProvider}><ArrowRightLeft size={14}/></button>
      <button className="icon-button" aria-label="Restart session" onClick={() => void appConfirm({ title: `Restart ${session.title}?`, detail: "The current process will stop and a fresh provider process will start in the same directory.", confirmLabel: "Restart session" }).then((confirmed) => { if (confirmed) return sessionRuntime.restart(session); })}><RotateCcw size={14}/></button>
      <button className="icon-button" aria-label="Stop session" onClick={() => void sessionRuntime.stop(session.id)}><Square size={13}/></button>
      <button className="icon-button" aria-label={maximized ? "Restore pane" : "Maximize pane"} onClick={onToggleMaximize}>{maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
    </div></header>
    {searching && <form className="terminal-search" onSubmit={(e) => { e.preventDefault(); find(false); }}><label htmlFor={`search-${session.id}`}>Find</label><input id={`search-${session.id}`} autoFocus placeholder="Search output" value={term} onChange={(e) => setTerm(e.target.value)}/><button type="button" aria-label="Previous result" onClick={() => find(true)}><ChevronUp size={13}/></button><button type="submit" aria-label="Next result"><ChevronDown size={13}/></button><button type="button" aria-label="Close search" onClick={() => setSearching(false)}><X size={13}/></button></form>}
    <div className="terminal-host" ref={hostRef}/>
  </section>;
}
