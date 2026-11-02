// A second play button for games that link two handhelds on one machine.
//
// RomM's play page offers one native launch per platform, with the core
// resolved from the platform's core map and the user's preferences. A link
// cable session is a different launch of the same game: a core that runs two
// or more linked consoles inside one RetroArch instance (mGBA Splitscreen for
// the GBA), with controller port N driving console N. Nothing in the platform
// map names such a core, and RomM's page has no place to ask for it, so the
// shell adds the button itself, next to the native one, on the pages it knows
// a linking core for.
//
// Decisions live here and reach no Electron import, so they can be tested; the
// injection itself is in window.ts. The page script is generated with the
// cores already resolved: a link core is not on the libretro buildbot, so the
// shell shows the button only when the core file is installed, and the page
// never has to ask what is on disk.

import { type DesktopConfig } from "../shared/types.ts";
import { resolveCore } from "./emulator/resolve.ts";

/** Platform slug -> the core that runs linked consoles for it. One per
 *  platform, so a page can tell what the button will start. */
export const LINK_CORES: Record<string, string> = {
  gba: "mgba_splitscreen",
};

/** The link cores that are installed, by platform slug. Empty when the cores
 *  directory is unknown, which hides the button everywhere. */
export function installedLinkCores(
  config: DesktopConfig,
  table: Record<string, string> = LINK_CORES,
): Record<string, string> {
  const installed: Record<string, string> = {};
  if (!config.retroarchCoresPath) return installed;
  for (const [slug, core] of Object.entries(table)) {
    if (resolveCore(config.retroarchCoresPath, [core])) installed[slug] = core;
  }
  return installed;
}

/**
 * Runs in the page's main world, after the preload exposed window.rommNative.
 * Idempotent: the page is a single-page app that swaps routes without a load,
 * so the script polls the location and (re)attaches its button when a play
 * page for a linkable platform appears. The launch request mirrors what RomM's
 * own native store sends, read from the same API, with the link core as the
 * only candidate: a fallback to the single-player core would start a game that
 * looks right and cannot link.
 */
export function linkPlayScript(installed: Record<string, string>): string {
  return `(() => {
  const CORES = ${JSON.stringify(installed)};
  const ID = "romm-desktop-link-play";
  if (window.__rommDesktopLinkPlay) return "already-injected";
  if (!window.rommNative || Object.keys(CORES).length === 0) return "nothing-to-add";
  window.__rommDesktopLinkPlay = true;

  let romId = null;
  let rom = null;
  let launching = false;

  const button = document.createElement("button");
  button.id = ID;
  button.type = "button";
  const label = document.createElement("span");
  label.className = "v-btn__content";
  button.append(label);

  const setLabel = (text) => { label.textContent = text; };
  const idle = () => setLabel("Play with a friend on this PC");

  window.rommNative.onLaunchState((s) => {
    if (!rom || s.romId !== rom.id) return;
    if (s.status === "downloading" || s.status === "running") {
      launching = true;
      button.disabled = true;
      setLabel(s.status === "running" ? "Running, two linked consoles" : "Starting...");
    } else if (s.status === "exited" || s.status === "failed") {
      launching = false;
      button.disabled = false;
      idle();
    }
  });

  button.addEventListener("click", async () => {
    if (!rom || launching) return;
    const core = CORES[rom.platform_slug];
    if (!core) return;
    const file = (rom.files || []).length === 1 ? rom.files[0] : null;
    const fileName = file ? file.file_name : rom.fs_name;
    launching = true;
    button.disabled = true;
    setLabel("Starting...");
    try {
      await window.rommNative.launch({
        romId: rom.id,
        downloadPath: "/api/roms/" + rom.id + "/content/" + encodeURIComponent(fileName),
        fileName: fileName,
        platformSlug: rom.platform_slug,
        cores: [core],
        name: rom.name || rom.fs_name,
        serverPath: file ? file.full_path : rom.full_path,
        fileSize: file ? file.file_size_bytes : rom.fs_size_bytes,
      });
    } catch (e) {
      launching = false;
      button.disabled = false;
      setLabel("Could not start: " + (e && e.message ? e.message : e));
      setTimeout(idle, 6000);
    }
  });

  // Dressed like the page's own secondary play button, read from it at attach
  // time so the look follows RomM's theme rather than a copy of it.
  function attach(anchor) {
    button.className = anchor.className;
    button.classList.add("romm-desktop-link-play");
    button.style.marginTop = "8px";
    anchor.insertAdjacentElement("afterend", button);
  }

  async function refresh() {
    const match = location.pathname.match(/\\/rom\\/(\\d+)/);
    if (!match) { romId = null; rom = null; button.remove(); return; }
    if (match[1] !== romId) {
      romId = match[1];
      rom = null;
      button.remove();
      try {
        const res = await fetch("/api/roms/" + romId, { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        if (String(data.id) !== romId) return;
        if (!CORES[data.platform_slug]) return;
        rom = data;
        button.disabled = false;
        idle();
      } catch (e) {
        return;
      }
    }
    if (!rom || document.getElementById(ID)) return;
    // The native button is the first .r-v2-ejs__play on a page the shell can
    // launch; the in-browser one follows it. Ours goes after the browser one so
    // the primary action keeps its place.
    const plays = document.querySelectorAll(".r-v2-ejs__play");
    if (plays.length === 0) return;
    attach(plays[plays.length - 1]);
  }

  refresh();
  setInterval(refresh, 600);
  return "injected";
})();`;
}
