import { isTauri, loadWorkspace, saveWorkspace } from "./native";
import { useCoDesStore, workspaceSnapshot } from "../store";

let initialized = false;
let timer: number | undefined;

export async function initializePersistence() {
  if (initialized) return;
  initialized = true;
  if (isTauri()) {
    const snapshot = await loadWorkspace();
    if (snapshot) useCoDesStore.getState().hydrate(snapshot);
    else useCoDesStore.setState({ hydrated: true });
  } else {
    useCoDesStore.setState({ hydrated: true });
  }
  useCoDesStore.subscribe((state) => {
    if (!state.hydrated || !isTauri()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveWorkspace(workspaceSnapshot(state)).catch((error) => console.error("Could not persist workspace", error)), 180);
  });
}
