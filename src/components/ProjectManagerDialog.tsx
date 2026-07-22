import { useEffect, useRef, useState } from "react";
import { Command, ExternalLink, Palette, Trash2, X } from "./Icon";
import { appConfirm } from "../lib/dialogs";
import { deleteSessionTranscript, revealPath } from "../lib/native";
import { sessionRuntime } from "../lib/sessionRuntime";
import { useCoDesStore } from "../store";

interface ProjectManagerDialogProps {
  projectId: string;
  onClose: () => void;
}

export function ProjectManagerDialog({ projectId, onClose }: ProjectManagerDialogProps) {
  const state = useCoDesStore();
  const project = state.projects.find((item) => item.id === projectId);
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? "");
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => nameRef.current?.select());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!project) return null;

  function save() {
    const nextName = name.trim();
    const nextColor = color.trim();
    if (!nextName) {
      setError("Project name cannot be empty.");
      nameRef.current?.focus();
      return;
    }
    if (!nextColor || !CSS.supports("color", nextColor)) {
      setError("Enter a valid CSS color, such as #e39b4a.");
      return;
    }
    state.updateProject(projectId, { name: nextName, color: nextColor });
    onClose();
  }

  async function remove() {
    const confirmed = await appConfirm({
      title: `Remove ${project!.name}?`,
      detail: "CoDes will forget this project. Files on disk will not be deleted.",
      confirmLabel: "Remove project",
      tone: "danger",
    });
    if (!confirmed) return;
    await Promise.all(
      state.sessions
        .filter((session) => session.projectId === projectId)
        .map(async (session) => { await sessionRuntime.stop(session.id); await deleteSessionTranscript(session.id); }),
    );
    state.removeProject(projectId);
    onClose();
  }

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="app-dialog project-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-manager-title"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <header>
          <span className="app-dialog-mark"><Command /></span>
          <div><small>CoDes</small><h2 id="project-manager-title">Manage project</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X /></button>
        </header>
        <div className="project-manager-fields">
          <label>
            <span>Project name</span>
            <input ref={nameRef} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
          </label>
          <label>
            <span>Project color</span>
            <div className="project-color-field">
              <i style={{ background: CSS.supports("color", color) ? color : "transparent" }}><Palette /></i>
              <input value={color} onChange={(event) => { setColor(event.target.value); setError(""); }} placeholder="#e39b4a" />
            </div>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="button" className="project-reveal-button" onClick={() => void revealPath(project.path)}>
            <ExternalLink />
            <span><strong>Reveal in File Explorer</strong><small>{project.path}</small></span>
          </button>
        </div>
        <footer>
          <button type="button" className="danger-button project-remove-button" onClick={() => void remove()}><Trash2 />Remove</button>
          <span />
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button">Save changes</button>
        </footer>
      </form>
    </div>
  );
}
