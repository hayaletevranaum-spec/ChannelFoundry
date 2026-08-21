const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  configureElectronDataPaths,
  dataPaths,
  resolveDataRoot,
} = require("./studio-data-paths.cjs");

const projectRoot = path.resolve(__dirname, "../..");
assert.equal(resolveDataRoot({ projectRoot, environment: {} }), path.join(projectRoot, "local-data"));
assert.equal(
  resolveDataRoot({ projectRoot, environment: { BIRDESENGOR_DATA_ROOT: "workspace-data" } }),
  path.join(projectRoot, "workspace-data"),
);
assert.equal(
  dataPaths({ projectRoot, environment: { BIRDESENGOR_DATA_ROOT: "workspace-data" } }).studio,
  path.join(projectRoot, "workspace-data", "studio"),
);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "birdesengor-data-paths-"));
try {
  const configuredRoot = path.join(directory, "data");
  const calls = [];
  const fakeApp = { setPath: (name, value) => calls.push([name, value]) };
  const configured = configureElectronDataPaths(fakeApp, {
    projectRoot,
    environment: { BIRDESENGOR_DATA_ROOT: configuredRoot },
  });
  assert.deepEqual(configured, dataPaths({
    projectRoot,
    environment: { BIRDESENGOR_DATA_ROOT: configuredRoot },
  }));
  assert.deepEqual(calls, [
    ["userData", path.join(configuredRoot, "studio")],
    ["sessionData", path.join(configuredRoot, "runtime")],
  ]);
  assert.equal(fs.statSync(configured.studio).isDirectory(), true);
  assert.equal(fs.statSync(configured.runtime).isDirectory(), true);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("studio data paths verified");
