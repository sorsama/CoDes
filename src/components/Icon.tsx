import type { ComponentType } from "react";

export interface MaterialIconProps {
  size?: number;
  className?: string;
  title?: string;
  filled?: boolean;
}

export type MaterialIcon = ComponentType<MaterialIconProps>;

function materialSymbol(name: string): MaterialIcon {
  return function MaterialSymbol({ size, className = "", title, filled = false }) {
    return (
      <span
        className={`material-symbol ${className}`.trim()}
        style={{
          fontSize: size,
          fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        }}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        role={title ? "img" : undefined}
      >
        {name}
      </span>
    );
  };
}

export const Activity = materialSymbol("activity_zone");
export const Archive = materialSymbol("archive");
export const ArrowRightLeft = materialSymbol("swap_horiz");
export const AlertTriangle = materialSymbol("warning");
export const Bell = materialSymbol("notifications");
export const Blocks = materialSymbol("widgets");
export const Bot = materialSymbol("smart_toy");
export const BrainCircuit = materialSymbol("neurology");
export const Check = materialSymbol("check");
export const ChevronDown = materialSymbol("keyboard_arrow_down");
export const ChevronLeft = materialSymbol("arrow_back");
export const ChevronRight = materialSymbol("arrow_forward");
export const ChevronUp = materialSymbol("keyboard_arrow_up");
export const CircleDot = materialSymbol("radio_button_checked");
export const Clipboard = materialSymbol("content_copy");
export const Columns2 = materialSymbol("view_column_2");
export const Command = materialSymbol("terminal");
export const Copy = materialSymbol("content_copy");
export const ExternalLink = materialSymbol("open_in_new");
export const FileCode2 = materialSymbol("code_blocks");
export const FileText = materialSymbol("description");
export const FolderOpen = materialSymbol("folder_open");
export const Gauge = materialSymbol("speed");
export const GitCommit = materialSymbol("commit");
export const GitPullRequest = materialSymbol("merge");
export const Grid2X2 = materialSymbol("grid_view");
export const GripVertical = materialSymbol("drag_indicator");
export const Inbox = materialSymbol("inbox");
export const Image = materialSymbol("image");
export const KanbanSquare = materialSymbol("view_kanban");
export const LayoutDashboard = materialSymbol("dashboard");
export const Maximize2 = materialSymbol("open_in_full");
export const Menu = materialSymbol("view_agenda");
export const MessageSquare = materialSymbol("chat_bubble");
export const Minimize2 = materialSymbol("close_fullscreen");
export const MonitorDot = materialSymbol("desktop_windows");
export const MoreHorizontal = materialSymbol("more_horiz");
export const Palette = materialSymbol("palette");
export const PanelLeftClose = materialSymbol("left_panel_close");
export const PanelLeftOpen = materialSymbol("left_panel_open");
export const Play = materialSymbol("play_arrow");
export const Pi = materialSymbol("function");
export const Plus = materialSymbol("add");
export const Radio = materialSymbol("sensors");
export const RefreshCw = materialSymbol("refresh");
export const Rocket = materialSymbol("rocket_launch");
export const RotateCcw = materialSymbol("restart_alt");
export const Search = materialSymbol("search");
export const Send = materialSymbol("send");
export const Settings = materialSymbol("settings");
export const Share2 = materialSymbol("share");
export const ShieldCheck = materialSymbol("verified_user");
export const Sparkles = materialSymbol("auto_awesome");
export const Square = materialSymbol("stop");
export const SquareCode = materialSymbol("code_blocks");
export const TerminalSquare = materialSymbol("terminal");
export const Trash2 = materialSymbol("delete");
export const Upload = materialSymbol("upload");
export const Users = materialSymbol("group");
export const Wand2 = materialSymbol("magic_button");
export const X = materialSymbol("close");
export const Zap = materialSymbol("bolt");
