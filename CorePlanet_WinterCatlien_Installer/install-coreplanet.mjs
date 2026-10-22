import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run this from the winter-catlien project root in VS Code:
// node "C:\\path\\to\\CorePlanet_WinterCatlien_Installer\\install-coreplanet.mjs"

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repo = process.cwd();
const target = path.join(repo, 'components', 'CosmicVoyage.jsx');
const support = [
  'components/CorePlanet.jsx',
  'components/CorePlanet.module.css',
  'components/corePlanetMaterials.js',
  'public/models/CorePlanet2.glb',
  'public/images/core-planet-preview.png',
];
const dryRun = process.argv.includes('--check');

function fail(reason) {
  console.error(`\nCorePlanet update NOT installed: ${reason}\n`);
  process.exit(1);
}

if (!fs.existsSync(target) || !fs.existsSync(path.join(repo, 'package.json')))
  fail('Open the winter-catlien root folder in VS Code and run the command there.');

let content = fs.readFileSync(target, 'utf8');
if (content.includes('import CorePlanet from') || content.includes('<CorePlanet'))
  fail('CorePlanet integration already exists. Skipping to avoid duplicate code.');

function replaceExactlyOnce(regex, replacer, label) {
  const matches = [...content.matchAll(regex)];
  if (matches.length !== 1) fail(`Cannot safely identify ${label} (found ${matches.length}). Your file may have changed.`);
  content = content.replace(regex, replacer);
}

// Add the shared renderer without replacing any of the existing webpage sections.
replaceExactlyOnce(
  /^import CosmicRunnerOverlay from ["']\.\/CosmicRunnerOverlay["'];?\r?$/gm,
  (original) => `${original}\nimport CorePlanet from './CorePlanet';\nimport planetStyles from './CorePlanet.module.css';`,
  'the main imports',
);

// Old translation rendering hooks remain in the file, but do not execute: their
// stage refs are no longer mounted. This deliberately avoids rewriting ~700
// lines of the live project's existing code.
replaceExactlyOnce(
  /<div ref=\{translateGlbStageRef\} className="shoppingIntroTranslateGlbStage">\s*<div className="shoppingIntroTranslateGlbLoading">\s*\{languageCopy\[translateGlbStatusKey\] \|\| languageCopy\.chooseLanguage\}\s*<\/div>\s*<\/div>/g,
  `<div className="shoppingIntroTranslateGlbStage">\n              <div className={planetStyles.translatePlanet}><CorePlanet /></div>\n              <div className="shoppingIntroTranslateGlbLoading">{languageCopy.chooseLanguage}</div>\n            </div>`,
  'the intro translation planet stage',
);
replaceExactlyOnce(
  /<div ref=\{mainTranslateGlbStageRef\} className="shoppingIntroTranslateGlbStage">\s*<div className="shoppingIntroTranslateGlbLoading">\s*\{copy\[mainTranslateGlbStatusKey\] \|\| copy\.chooseLanguage\}\s*<\/div>\s*<\/div>/g,
  `<div className="shoppingIntroTranslateGlbStage">\n              <div className={planetStyles.translatePlanet}><CorePlanet /></div>\n              <div className="shoppingIntroTranslateGlbLoading">{copy.chooseLanguage}</div>\n            </div>`,
  'the main translation planet stage',
);
replaceExactlyOnce(
  /className="missionGalleryWindow"/g,
  'className={`missionGalleryWindow ${planetStyles.viewportWindow}`}',
  'the collection screen window',
);
replaceExactlyOnce(
  /<div className="missionImageGrid">[\s\S]*?\r?\n[ \t]{12}<\/div>/g,
  `<div className={planetStyles.collectionPlanet}>\n              <CorePlanet viewport href="https://shop.almostmadeinjapan.com/collections/" />\n            </div>\n            <div className={planetStyles.interactionHint}>Drag to explore · Click to shop</div>`,
  'the existing collection tiles',
);

// The old logo orb is no longer used after the collection tiles are replaced.
content = content.replace(/^import MissionLogoOrb from ["']\.\/MissionLogoOrb["'];?\r?\n/m, '');

for (const name of support) {
  const from = path.join(sourceDirectory, 'files', name);
  const to = path.join(repo, name);
  if (!fs.existsSync(from)) fail(`Missing package file: ${name}`);
  if (fs.existsSync(to) && !fs.readFileSync(from).equals(fs.readFileSync(to)))
    fail(`A different ${name} already exists. Leaving it untouched for safety.`);
}

console.log('\nCorePlanet installation checks: OK');
if (dryRun) {
  console.log('Dry run only. No files have been changed.');
  process.exit(0);
}

const backup = `${target}.before-coreplanet.bak`;
if (fs.existsSync(backup)) fail(`Backup already exists: ${backup}. Rename it first.`);
fs.copyFileSync(target, backup);
fs.writeFileSync(target, content, 'utf8');
for (const name of support) {
  const from = path.join(sourceDirectory, 'files', name);
  const to = path.join(repo, name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to)) fs.copyFileSync(from, to);
}
console.log(`Updated: ${path.relative(repo, target)}`);
console.log(`Backup : ${path.relative(repo, backup)}`);
for (const name of support) console.log(`Added  : ${name}`);
console.log('\nDONE. Run npm run dev, preview the translation dialog and collections screen.');
console.log('Use GitHub Desktop / VS Code Source Control to review changes before committing.');
