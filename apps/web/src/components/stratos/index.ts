// Layout shell — local implementations (different CSS data-attrs from stratos-ui AppShell)
export { StratosAppShell, StratosAppRail, StratosTopbar } from "./shell";

// Buttons — local shims mapping tone → variant (different CSS class conventions)
export { StratosButton, StratosButtonLink, StratosIconButtonLink } from "./button";

// App registry — from @voldzi/stratos-ui
export { buildStratosTopbarApps } from "@voldzi/stratos-ui";
export type { StratosAppId, StratosAppsUrls } from "@voldzi/stratos-ui";

// CommandCenter — from @voldzi/stratos-ui (identical CSS classes)
export { CommandCenter } from "./command-center";
export type { CommandCenterAction, CommandCenterItem, CommandCenterItemType, CommandCenterLabels, CommandCenterTone } from "./command-center";

// DataTable — local implementation
export { StratosDataTable, type StratosDataTableColumn } from "./data-table";

// PDF viewer — local STRATOS-compatible implementation, intended for shared stratos-ui extraction
export { StratosPdfViewer, type StratosPdfViewerBbox, type StratosPdfViewerLabels } from "./pdf-viewer";

// GlobalTopbar — from @voldzi/stratos-ui
export { StratosGlobalTopbar } from "./global-topbar";
export type { StratosGlobalTopbarApp, StratosGlobalTopbarLabels, StratosGlobalTopbarUser } from "./global-topbar";

// SearchBox — local (onChange API differs: native event vs string callback)
export { StratosSearchBox } from "./search-box";

// Select — local (different API from UnifiedSelect)
export { StratosSelect, StratosUnifiedSelect } from "./select";

// ViewTabs — local (different CSS class naming convention)
export { StratosViewTabs, type StratosViewTab } from "./view-tabs";

// WorkspaceNav + WorkspaceSidebar — from @voldzi/stratos-ui (identical API + CSS)
export {
  StratosWorkspaceNav,
  StratosWorkspaceSidebar,
  type StratosWorkspaceNavGroup,
  type StratosWorkspaceNavItem
} from "./workspace-nav";
