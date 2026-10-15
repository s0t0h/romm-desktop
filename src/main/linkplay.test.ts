import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { testConfig } from "../test/config.ts";
import { coreFileName } from "./emulator/resolve.ts";
import { installedLinkCores, linkPlayScript } from "./linkplay.ts";

function coresDir(cores: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "romm-link-"));
  mkdirSync(dir, { recursive: true });
  for (const core of cores) writeFileSync(join(dir, coreFileName(core)), "");
  return dir;
}

test("a link core counts only when its file is installed", () => {
  const table = { gba: "mgba_splitscreen", gb: "tgbdual" };
  const config = testConfig({ retroarchCoresPath: coresDir(["mgba_splitscreen"]) });
  assert.deepEqual(installedLinkCores(config, table), { gba: "mgba_splitscreen" });
});

test("no cores directory means no link cores", () => {
  const config = testConfig({ retroarchCoresPath: null });
  assert.deepEqual(installedLinkCores(config), {});
});

test("the page script carries the resolved cores and nothing else decides", () => {
  const script = linkPlayScript({ gba: "mgba_splitscreen" });
  assert.match(script, /const CORES = \{"gba":"mgba_splitscreen"\}/);
  // The link core is the only candidate, so a missing core fails loudly rather
  // than falling back to a single-player core.
  assert.match(script, /cores: \[core\]/);
});
