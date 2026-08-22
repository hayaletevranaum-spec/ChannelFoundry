const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function resolveDataRoot(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? PROJECT_ROOT);
  const environment = options.environment ?? process.env;
  const configured = String(environment.CHANNEL_FOUNDRY_DATA_ROOT ?? "").trim();
  if (!configured) return path.join(projectRoot, "local-data");
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(projectRoot, configured);
}

function dataPaths(options = {}) {
  const root = resolveDataRoot(options);
  return {
    root,
    studio: path.join(root, "studio"),
    runtime: path.join(root, "runtime"),
  };
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function configureElectronDataPaths(electronApp, options = {}) {
  const paths = dataPaths({
    ...options,
    environment: options.environment ?? process.env,
  });
  ensureDirectory(paths.root);
  ensureDirectory(paths.studio);
  ensureDirectory(paths.runtime);
  electronApp.setPath("userData", paths.studio);
  electronApp.setPath("sessionData", paths.runtime);
  return paths;
}

module.exports = {
  PROJECT_ROOT,
  configureElectronDataPaths,
  dataPaths,
  resolveDataRoot,
};
