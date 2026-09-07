import { createRequire } from "node:module";

// Next's route bundler selects the server navigation entry. Plain Node resolves
// the client entry instead, which needs createContext under react-server.
// Use the actual framework server entry; no auth or API handler is stubbed.
const runtimeRequire = createRequire(`${process.cwd()}/package.json`);
const navigationPath = runtimeRequire.resolve("next/navigation");
runtimeRequire.cache[navigationPath] = {
  id: navigationPath, filename: navigationPath, loaded: true,
  exports: runtimeRequire("next/dist/client/components/navigation.react-server.js"),
} as NodeJS.Module;
