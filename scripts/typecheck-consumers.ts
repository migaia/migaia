import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(scriptDirectory, '..');
const consumerNodeModules = resolve(repositoryRoot, 'fixtures/consumers/node_modules');
const webRpcPackage = resolve(repositoryRoot, 'packages/web-rpc');
const eventSubscriberPackage = resolve(repositoryRoot, 'packages/event-subscriber');
const projects = [
  'node',
  'bun',
  'deno',
  'browser',
  'worker',
  'electron-main',
  'electron-renderer',
  'mini-program'
];

const packageChecks = [
  {
    name: '@migaia/event-subscriber',
    root: eventSubscriberPackage
  },
  {
    name: '@migaia/web-rpc',
    root: webRpcPackage
  }
];

/**
 * Runs a workspace command without allowing pnpm to mutate or purge modules while this read-only
 * consumer gate is running.
 */
function runPnpm(args) {
  execFileSync('pnpm', args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit'
  });
}

/**
 * Builds declaration files before package-export resolution is tested. Consumer typechecking must
 * exercise the same dist files shipped to users.
 */
function buildCheckedPackages() {
  runPnpm(['--filter', './packages/event-subscriber', 'run', 'build']);
  runPnpm(['--filter', './packages/web-rpc', 'run', 'build']);
}

/** Returns the absolute target of a symlink without following non-link paths. */
function getLinkTarget(link) {
  const stat = lstatSync(link);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Consumer package path is not a symlink: ${link}`);
  }
  return resolve(resolve(link, '..'), readlinkSync(link));
}

/**
 * Creates only missing package links and returns links owned by this run. Existing correct links
 * are preserved; wrong links and non-links fail early.
 */
function ensurePackageLinks() {
  const createdLinks = [];
  try {
    for (const { name, root } of packageChecks) {
      const link = resolve(consumerNodeModules, name);
      mkdirSync(resolve(link, '..'), { recursive: true });
      let linkExists = true;
      try {
        lstatSync(link);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        linkExists = false;
      }
      if (linkExists) {
        if (getLinkTarget(link) !== root) {
          throw new Error(`Unexpected ${name} consumer link target`);
        }
        continue;
      }
      symlinkSync(root, link, 'dir');
      createdLinks.push({ link, root });
    }
  } catch (error) {
    cleanupPackageLinks(createdLinks);
    throw error;
  }
  return createdLinks;
}

/**
 * Imports every public export from a temporary module in the fixture tree. Node resolves that
 * module through node_modules/package.json exports, so a TypeScript paths alias cannot make this
 * self-check pass falsely.
 */
function assertPackageExports() {
  const specifiers = [];
  for (const { name, root } of packageChecks) {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const exports = packageJson.exports;
    const subpaths = typeof exports === 'object' ? Object.keys(exports) : ['.'];
    for (const subpath of subpaths) {
      specifiers.push(subpath === '.' ? name : `${name}/${subpath.slice(2)}`);
    }
  }
  const temporaryDirectory = mkdtempSync(
    resolve(repositoryRoot, 'fixtures/consumers/.exports-check-')
  );
  const temporaryModule = resolve(temporaryDirectory, 'index.mjs');
  const importStatements = specifiers.map(
    (specifier) => `await import(${JSON.stringify(specifier)});`
  );
  writeFileSync(temporaryModule, `${importStatements.join('\n')}\n`, { flag: 'wx' });
  try {
    execFileSync(process.execPath, [temporaryModule], {
      cwd: resolve(repositoryRoot, 'fixtures/consumers'),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: 'inherit'
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Removes only links created by this invocation and never removes a path that was replaced while
 * typechecking.
 */
function cleanupPackageLinks(createdLinks) {
  for (const { link, root } of createdLinks.reverse()) {
    try {
      if (getLinkTarget(link) === root) unlinkSync(link);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * Runs every consumer typecheck with web-rpc resolved through its package exports map. The
 * temporary link is deliberately scoped to this command so `paths` cannot hide an invalid public
 * subpath and no generated fixture state is committed.
 */
function main() {
  buildCheckedPackages();
  let createdLinks = [];
  try {
    createdLinks = ensurePackageLinks();
    assertPackageExports();
    for (const project of projects) {
      runPnpm(['exec', 'tsc', '--noEmit', '-p', `fixtures/consumers/tsconfig.${project}.json`]);
    }
  } finally {
    cleanupPackageLinks(createdLinks);
  }
}

main();
