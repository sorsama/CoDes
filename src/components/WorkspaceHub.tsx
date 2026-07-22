import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, ChevronDown, Copy, FolderOpen, GripVertical, Image, MoreHorizontal, Plus, Search, Trash2, Upload, X } from "./Icon";
import { chooseDirectory, deleteSessionTranscript, revealPath } from "../lib/native";
import { processWorkspaceIcon, workspaceInitials } from "../lib/workspaceIcon";
import { sessionRuntime } from "../lib/sessionRuntime";
import { appConfirm } from "../lib/dialogs";
import { useCoDesStore } from "../store";
import type { Project, Workspace } from "../types";

export function WorkspaceAvatar({ workspace, size = "medium" }: { workspace: Workspace; size?: "small" | "medium" | "large" }) {
  return <span className={`workspace-avatar ${size}`} style={{ backgroundColor: workspace.color }}>{workspace.iconDataUrl ? <img src={workspace.iconDataUrl} alt=""/> : <span>{workspaceInitials(workspace.name)}</span>}</span>;
}

function workspaceActivity(workspaceId: string) {
  const state = useCoDesStore.getState();
  const projectIds = new Set(state.projects.filter((item) => item.workspaceId === workspaceId).map((item) => item.id));
  const active = state.sessions.filter((item) => projectIds.has(item.projectId) && ["waiting", "working", "input_required"].includes(item.status)).length;
  const attention = state.alerts.filter((item) => projectIds.has(item.projectId) && !item.read).length;
  return { active, attention };
}

function WorkspaceOption({ workspace, onChoose }: { workspace: Workspace; onChoose: () => void }) {
  const state = useCoDesStore();
  const count = state.projects.filter((item) => item.workspaceId === workspace.id).length;
  const activity = workspaceActivity(workspace.id);
  return <button className={state.activeWorkspaceId === workspace.id ? "active" : ""} onClick={onChoose} role="option" aria-selected={state.activeWorkspaceId === workspace.id}>
    <WorkspaceAvatar workspace={workspace} size="small"/><span><strong>{workspace.name}</strong><small>{count} {count === 1 ? "project" : "projects"}{activity.active ? ` · ${activity.active} running` : ""}</small></span>{activity.attention > 0 ? <i className="workspace-attention">{activity.attention}</i> : activity.active > 0 ? <i className="workspace-live"/> : null}
  </button>;
}

export function WorkspaceSwitcher() {
  const state = useCoDesStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const visible = useMemo(() => state.workspaces.filter((item) => !item.archivedAt).sort((a, b) => a.position - b.position), [state.workspaces]);
  const filtered = visible.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const recent = [...visible].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 3);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && open) { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", close); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  if (!active) return null;
  const activity = workspaceActivity(active.id);
  const choose = (id: string) => { state.setActiveWorkspace(id); setOpen(false); setQuery(""); };
  const create = () => { const workspace: Workspace = { id: crypto.randomUUID(), name: `Workspace ${state.workspaces.length + 1}`, color: "#e39b4a", position: state.workspaces.length, lastOpenedAt: Date.now() }; state.addWorkspace(workspace); state.setOverlay("workspaces"); setOpen(false); };
  return <div className="workspace-switcher" ref={root}>
    {open && <div className="workspace-menu" id="workspace-menu" role="listbox" aria-label="Switch workspace" onKeyDown={(event) => { if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return; const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')]; if (!options.length) return; event.preventDefault(); const current = options.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === "ArrowDown" ? (current + 1) % options.length : (current <= 0 ? options.length : current) - 1; options[next]?.focus(); }}>
      <label className="workspace-search"><Search/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a workspace"/></label>
      <div className="workspace-menu-scroll">
        {!query && <><span className="workspace-menu-label">Recent</span>{recent.map((workspace) => <WorkspaceOption key={`recent-${workspace.id}`} workspace={workspace} onChoose={() => choose(workspace.id)}/>)}</>}
        <span className="workspace-menu-label">{query ? "Results" : "All workspaces"}</span>
        {filtered.map((workspace) => <WorkspaceOption key={workspace.id} workspace={workspace} onChoose={() => choose(workspace.id)}/>)}
        {!filtered.length && <div className="workspace-no-results">No workspace matches “{query}”.</div>}
      </div>
      <footer><button onClick={create}><Plus/>New workspace</button><button onClick={() => { state.setOverlay("workspaces"); setOpen(false); }}><MoreHorizontal/>Manage workspaces</button></footer>
    </div>}
    <button ref={triggerRef} className="workspace-trigger" aria-haspopup="listbox" aria-controls="workspace-menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <WorkspaceAvatar workspace={active}/><span><strong>{active.name}</strong><small>{state.projects.filter((item) => item.workspaceId === active.id).length} {state.projects.filter((item) => item.workspaceId === active.id).length === 1 ? "project" : "projects"}{activity.active ? ` · ${activity.active} running` : ""}</small></span>{activity.attention > 0 && <i className="workspace-attention">{activity.attention}</i>}<ChevronDown className={open ? "open" : ""}/>
    </button>
  </div>;
}

function SortableWorkspaceRow({ workspace, selected, onSelect }: { workspace: Workspace; selected: boolean; onSelect: () => void }) {
  const sortable = useSortable({ id: `workspace-${workspace.id}` });
  return <div ref={sortable.setNodeRef} className={`workspace-manager-row ${selected ? "active" : ""} ${sortable.isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button className="workspace-drag" {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${workspace.name}`}><GripVertical/></button><button className="workspace-manager-select" onClick={onSelect}><WorkspaceAvatar workspace={workspace} size="small"/><span><strong>{workspace.name}</strong><small>{workspace.archivedAt ? "Archived" : `${workspaceActivity(workspace.id).active} running`}</small></span></button>
  </div>;
}

function SortableProjectRow({ project, workspaces }: { project: Project; workspaces: Workspace[] }) {
  const state = useCoDesStore();
  const sortable = useSortable({ id: `project-${project.id}` });
  const running = state.sessions.filter((item) => item.projectId === project.id && ["waiting", "working", "input_required"].includes(item.status)).length;
  const remove = async () => { if (!await appConfirm({ title: `Remove ${project.name}?`, detail: "CoDes will forget this project. Files on disk will not be deleted.", confirmLabel: "Remove project", tone: "danger" })) return; await Promise.all(state.sessions.filter((item) => item.projectId === project.id).map(async (item) => { await sessionRuntime.stop(item.id); await deleteSessionTranscript(item.id); })); state.removeProject(project.id); };
  return <div ref={sortable.setNodeRef} className={`workspace-project-row ${sortable.isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button className="workspace-drag" {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${project.name}`}><GripVertical/></button><span className="project-swatch" style={{ background: project.color }}/><span><strong>{project.name}</strong><small>{project.path}{running ? ` · ${running} running` : ""}</small></span><select aria-label={`Move ${project.name} to workspace`} value={project.workspaceId} onChange={(event) => state.moveProject(project.id, event.target.value)}>{workspaces.filter((item) => !item.archivedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" onClick={() => void revealPath(project.path)} aria-label={`Reveal ${project.name}`}><FolderOpen/></button><button className="icon-button danger-ghost" onClick={remove} aria-label={`Remove ${project.name}`}><Trash2/></button>
  </div>;
}

export function WorkspaceManager() {
  const state = useCoDesStore();
  const [selectedId, setSelectedId] = useState(state.activeWorkspaceId);
  const [iconError, setIconError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const selected = state.workspaces.find((item) => item.id === selectedId) ?? state.workspaces[0];
  const ordered = [...state.workspaces].sort((a, b) => a.position - b.position);
  const projects = selected ? state.projects.filter((item) => item.workspaceId === selected.id).sort((a, b) => a.position - b.position) : [];
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") state.setOverlay(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [state.setOverlay]);
  if (!selected) return null;
  const create = () => { const workspace: Workspace = { id: crypto.randomUUID(), name: `Workspace ${state.workspaces.length + 1}`, color: "#e39b4a", position: state.workspaces.length, lastOpenedAt: Date.now() }; state.addWorkspace(workspace); setSelectedId(workspace.id); };
  const addProject = async () => { const path = await chooseDirectory(); if (!path) return; const duplicate = state.projects.find((item) => item.path.toLowerCase() === path.toLowerCase()); if (duplicate) { state.moveProject(duplicate.id, selected.id); state.setMessage(`${duplicate.name} moved to ${selected.name}.`); return; } const parts = path.split(/[\\/]/).filter(Boolean); state.addProject({ id: crypto.randomUUID(), workspaceId: selected.id, name: parts[parts.length - 1] ?? "Project", path, color: selected.color, position: projects.length, lastOpenedAt: Date.now() }); };
  const setIcon = async (file?: File) => { if (!file) return; try { setIconError(""); state.updateWorkspace(selected.id, { iconDataUrl: await processWorkspaceIcon(file) }); } catch (error) { setIconError(error instanceof Error ? error.message : String(error)); } };
  const archive = async () => { const live = workspaceActivity(selected.id).active; if (live && !await appConfirm({ title: `Archive ${selected.name}?`, detail: `${live} session${live === 1 ? " is" : "s are"} still running and will keep running.`, confirmLabel: "Archive workspace" })) return; if (!selected.archivedAt && state.workspaces.filter((item) => !item.archivedAt).length <= 1) { state.setMessage("Keep at least one workspace available."); return; } if (selected.archivedAt) state.unarchiveWorkspace(selected.id); else state.archiveWorkspace(selected.id); };
  const remove = async () => { if (projects.length) { state.setMessage("Move or remove every project before deleting this workspace."); return; } if (selected.id === state.activeWorkspaceId) { state.setMessage("Switch to another workspace before deleting this one."); return; } if (await appConfirm({ title: `Delete ${selected.name}?`, detail: "This permanently removes the empty workspace from CoDes.", confirmLabel: "Delete workspace", tone: "danger" })) { state.removeWorkspace(selected.id); setSelectedId(state.activeWorkspaceId); } };
  const onWorkspaceDrag = (event: DragEndEvent) => { const id = event.active.id.toString().replace("workspace-", ""); const over = event.over?.id.toString().replace("workspace-", ""); const index = ordered.findIndex((item) => item.id === over); if (index >= 0) state.moveWorkspace(id, index); };
  const onProjectDrag = (event: DragEndEvent) => { const id = event.active.id.toString().replace("project-", ""); const over = event.over?.id.toString().replace("project-", ""); const index = projects.findIndex((item) => item.id === over); if (index >= 0) state.moveProjectWithinWorkspace(id, index); };
  return <div className="overlay-backdrop workspace-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) state.setOverlay(null); }}><aside className="workspace-manager" role="dialog" aria-modal="true" aria-label="Manage workspaces">
    <header className="workspace-manager-heading"><div><span>Local organization</span><h2>Workspaces</h2></div><button className="secondary-button" onClick={create}><Plus/>New</button><button className="icon-button" onClick={() => state.setOverlay(null)} aria-label="Close workspace manager"><X/></button></header>
    <div className="workspace-manager-body"><nav className="workspace-manager-nav" aria-label="Workspace list"><DndContext sensors={sensors} onDragEnd={onWorkspaceDrag}><SortableContext items={ordered.map((item) => `workspace-${item.id}`)} strategy={verticalListSortingStrategy}>{ordered.filter((item) => !item.archivedAt).map((workspace) => <SortableWorkspaceRow key={workspace.id} workspace={workspace} selected={workspace.id === selected.id} onSelect={() => setSelectedId(workspace.id)}/>)}{ordered.some((item) => item.archivedAt) && <span className="workspace-manager-nav-label">Archived</span>}{ordered.filter((item) => item.archivedAt).map((workspace) => <SortableWorkspaceRow key={workspace.id} workspace={workspace} selected={workspace.id === selected.id} onSelect={() => setSelectedId(workspace.id)}/>)}</SortableContext></DndContext></nav>
      <section className="workspace-editor"><div className="workspace-identity"><button className="workspace-icon-editor" onClick={() => fileRef.current?.click()} aria-label="Upload workspace icon"><WorkspaceAvatar workspace={selected} size="large"/><span><Upload/>Change image</span></button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void setIcon(event.target.files?.[0])}/><div><label><span>Name</span><input value={selected.name} maxLength={60} onChange={(event) => state.updateWorkspace(selected.id, { name: event.target.value })}/></label><label className="workspace-color"><span>Color</span><input type="color" value={selected.color.startsWith("#") ? selected.color : "#e39b4a"} onChange={(event) => state.updateWorkspace(selected.id, { color: event.target.value })}/></label></div></div>{iconError && <p className="form-error">{iconError}</p>}<div className="workspace-identity-actions">{selected.iconDataUrl && <button onClick={() => state.updateWorkspace(selected.id, { iconDataUrl: undefined })}><Image/>Use initials</button>}<button onClick={() => { const id = state.duplicateWorkspace(selected.id); setSelectedId(id); }}><Copy/>Duplicate</button><button onClick={archive}><Archive/>{selected.archivedAt ? "Unarchive" : "Archive"}</button></div>
        <div className="workspace-projects-heading"><div><span>Projects</span><strong>{projects.length}</strong></div><button className="secondary-button" onClick={() => void addProject()}><Plus/>Add folder</button></div>
        <DndContext sensors={sensors} onDragEnd={onProjectDrag}><SortableContext items={projects.map((item) => `project-${item.id}`)} strategy={verticalListSortingStrategy}><div className="workspace-projects">{projects.map((project) => <SortableProjectRow key={project.id} project={project} workspaces={state.workspaces}/>)}</div></SortableContext></DndContext>
        {!projects.length && <button className="workspace-project-empty" onClick={() => void addProject()}><FolderOpen/><strong>Add the first project</strong><span>Choose a local folder to start working in this workspace.</span></button>}
        <div className="workspace-danger-zone"><div><strong>Delete workspace</strong><span>Only empty, inactive workspaces can be deleted.</span></div><button className="danger-button" onClick={remove}><Trash2/>Delete</button></div>
      </section></div>
  </aside></div>;
}
