# CorePlanet easy installer for winter-catlien

This installation adapts Astra's `Emolien_CorePlanet_Interactive.zip` for the
**philipainsaar/winter-catlien** repository instead of overwriting its
`components/CosmicVoyage.jsx` with the older `emolien-cat` version.

## Steps (VS Code on Windows)

1. Extract the downloaded `CorePlanet_WinterCatlien_Installer.zip` anywhere.
2. Open **winter-catlien** in VS Code, then **Terminal > New Terminal**.
3. Optional preflight (replace path with location of extracted installer):
   `node "C:\\Users\\phili\\Downloads\\CorePlanet_WinterCatlien_Installer\\install-coreplanet.mjs" --check`
4. Install:
   `node "C:\\Users\\phili\\Downloads\\CorePlanet_WinterCatlien_Installer\\install-coreplanet.mjs"`
5. Start your site: `npm run dev`. Test both translation dialogs and the collections screen.

Alternatively, drop the extracted installer folder *inside* winter-catlien and run:

```
node .\CorePlanet_WinterCatlien_Installer\install-coreplanet.mjs --check
node .\CorePlanet_WinterCatlien_Installer\install-coreplanet.mjs
npm run dev
```

If you place the installer folder in the repo, do not commit that whole folder.

## Result

- Both intro and main translation dialogs show the draggable CorePlanet.
- The collections screen shows a full-viewport CorePlanet that opens
  https://shop.almostmadeinjapan.com/collections/ on a click, but not a drag.
- The existing runner game button and page styling are left in place.
- The five supporting files and PNG/GLB assets are copied into the correct paths.
- Original `CosmicVoyage.jsx` is backed up as
  `components/CosmicVoyage.jsx.before-coreplanet.bak`.

## Notes

- The installer does not directly modify GitHub or deploy anything.
- Changes are intentionally surgical: the original translation renderer effects
  remain in the source but no longer run because their canvas refs are removed.
  This preserves other work in that large component; these unused effects may
  be cleaned up later.
- To uninstall before committing, restore CosmicVoyage.jsx from the .bak and
  remove the five new files (if they weren't present before).
- Verify the current site in a browser. The original Astra zip reports a
  passing build in `emolien-cat`, but this adapted install has not been
  validated in a running winter-catlien browser.
