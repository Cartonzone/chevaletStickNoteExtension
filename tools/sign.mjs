/**
 * Sign a build through AMO. Two channels, and the difference decides who gets it.
 *
 *     node tools/sign.mjs              unlisted -- an .xpi to install by hand
 *     node tools/sign.mjs --listed     the store, for everyone, after a human review
 *
 * ## The distinction that caught us out
 *
 * Five versions -- 0.0.9 through 0.0.13 -- were signed UNLISTED and pushed to GitHub, and none
 * of them reached a single user of the store. The Developer Hub showed exactly that and it
 * took a person reading the page to notice: "Listed Version: 0.0.8", five rows marked *Self*
 * underneath. A GitHub release is a place to download a file from; it is not a distribution
 * channel, and Firefox will never update anybody from it.
 *
 * So: to give the people who installed from addons.mozilla.org a new version, it has to go
 * through `--listed`. Nothing else does, no matter how many tags exist.
 *
 * **A version number can only ever be used once, across BOTH channels.** 0.0.9 to 0.0.14 are
 * spent -- AMO will refuse them for a listed upload -- so a listed submission has to carry a
 * number none of them used.
 *
 * 0.0.14 is on that list on purpose, and it is the trade-off in one release: the ghost-notes
 * fix had to be installable the same day, which means unlisted, which spends the number. When
 * both are wanted at once, budget two.
 *
 * 0.0.15 is on it by accident, and it is why this script matters more than it looks. Fixing the
 * default here closed only ONE of the two places the channel is chosen -- the Developer Hub's
 * upload form asks again, on its own page, before the file, and "On your own" is unlisted.
 * 0.0.15 went there. This has no radio button to misclick, which is the argument for using it
 * rather than the web form.
 *
 * ## What --listed costs
 *
 * A human review, which is days rather than minutes, because the code is bundled and a
 * reviewer needs the source. Upload the source archive alongside it:
 *
 *     git archive --format=zip --prefix=chevalet-note/ -o web-ext-artifacts/source-<v>.zip v<v>
 *
 * `web-ext sign --channel listed` submits the package; the source archive still goes through
 * the Developer Hub form, because the API has no field for it. `docs/PUBLISHING.md` has the
 * rest of what that form asks for.
 *
 * ## And the original reason this file exists
 *
 * Why this exists: an unsigned add-on can only be loaded temporarily, and it disappears when
 * Firefox closes. `xpinstall.signatures.required=false` is the answer the internet gives and it
 * does not work -- Release and Beta builds ignore that pref deliberately. So the only way to a
 * permanent install in an ordinary Firefox is a signature, and AMO's *unlisted* channel signs
 * automatically in a couple of minutes without waiting for a human review.
 *
 * The listed submission is untouched by this. An add-on can carry versions in both channels;
 * this just gets a usable, permanent build into your own browser while the store listing works
 * its way through review.
 *
 * ## What you need first
 *
 * Credentials of your own, from https://addons.mozilla.org/en-US/developers/addon/api/key/
 *
 *     AMO_JWT_ISSUER=user:12345678:123
 *     AMO_JWT_SECRET=...
 *
 * Exported in the environment, or in `~/Projects/.env` (or `C:\Projects\.env` on the Windows
 * machine this started on) -- the same file the GitHub token lives in, which is already
 * gitignored. See `secret()` below; the path was hard-coded to the Windows one until 0.0.17,
 * which made both of these scripts unrunnable anywhere else.
 *
 * They are read at run time and never printed, never passed on a command line where they
 * would land in shell history, and never written anywhere else.
 *
 * ## Running it
 *
 *     node tools/sign.mjs
 *
 * It bumps nothing. Set the version yourself first -- AMO rejects a version number it has
 * already seen in either channel, so this cannot reuse the one the listed submission is using.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the AMO credentials live.
 *
 * `C:/Projects/.env` was hard-coded, here and in the other AMO script, from the Windows
 * machine this was written on. Anywhere else both failed on their first line with "does not
 * exist" -- which on the day of a hot fix is the release tooling being the broken thing. So:
 * the environment first, which is what CI and a shell export already use, then the workspace
 * file on either platform.
 *
 * Nothing here is printed, and the list is paths only -- a missing credential says which
 * places were looked in, never what was found in them.
 */
const ENV_FILES = [
  process.env.CN_ENV_FILE,
  process.env.HOME ? `${process.env.HOME}/Projects/.env` : undefined,
  'C:/Projects/.env',
].filter(Boolean);

/** Read one credential: the process environment first, then the first file that has it. */
function secret(name) {
  const fromEnv = process.env[name];
  if (fromEnv?.trim()) return fromEnv.trim();

  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at > 0 && line.slice(0, at).trim() === name) {
        const value = line.slice(at + 1).trim();
        if (value) return value;
      }
    }
  }
  throw new Error(
    `${name} is not set.\n` +
      'Create an API key at https://addons.mozilla.org/en-US/developers/addon/api/key/, then\n' +
      `either export ${name} or put it in one of:\n` +
      ENV_FILES.map((f) => `  ${f}`).join('\n'),
  );
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

if (!existsSync(join('dist', 'manifest.json'))) {
  throw new Error('dist/ is missing. Run: node --experimental-strip-types build.ts');
}
const built = JSON.parse(readFileSync(join('dist', 'manifest.json'), 'utf8')).version;
if (built !== version) {
  throw new Error(
    `dist/ holds ${built} but package.json says ${version}. Rebuild before signing, or the ` +
      'signed file will not be the version you think it is.',
  );
}

const LISTED = process.argv.includes('--listed');
const channel = LISTED ? 'listed' : 'unlisted';

console.log(`\nsigning ${pkg.name} ${version} through the ${channel} channel`);
if (LISTED) {
  console.log('This SUBMITS TO THE STORE. A human reviews it, which takes days, and when it');
  console.log('passes, everyone who installed from addons.mozilla.org is updated by Firefox.');
  console.log('Upload the source archive through the Developer Hub form as well.\n');
} else {
  console.log('this takes a couple of minutes; AMO signs unlisted builds without a human review');
  console.log('It does NOT reach anyone who installed from the store. For that: --listed\n');
}

const issuer = secret('AMO_JWT_ISSUER');
const secretKey = secret('AMO_JWT_SECRET');

try {
  execFileSync(
    'node',
    [
      join('node_modules', 'web-ext', 'bin', 'web-ext.js'),
      'sign',
      '--source-dir',
      'dist',
      '--artifacts-dir',
      'web-ext-artifacts',
      '--channel',
      channel,
      '--no-config-discovery',
    ],
    {
      stdio: 'inherit',
      // Passed as environment rather than as arguments, so neither value can appear in a
      // process listing or in shell history.
      env: {
        ...process.env,
        WEB_EXT_API_KEY: issuer,
        WEB_EXT_API_SECRET: secretKey,
      },
    },
  );
} catch {
  console.error(
    '\nSigning failed. The two usual reasons:\n' +
      `  - AMO has already seen version ${version}, in EITHER channel. Bump it, rebuild, run\n` +
      '    this again. Numbers are spent globally, not per channel.\n' +
      '  - The API key is wrong or expired. Make a fresh one at the URL above.\n' +
      'Anything else: the output above is from web-ext and says what AMO objected to.\n',
  );
  process.exit(1);
}

if (LISTED) {
  console.log(
    `\nSubmitted. ${version} went to the listed channel. Confirm it, do not assume:\n` +
      '\n  pnpm amo:status\n' +
      '\nStill owed to Mozilla -- the sign API has a field for none of it. Two commands,\n' +
      'and the second is not optional: the build is minified, so a reviewer WILL ask for\n' +
      'source if it is missing, and can disable the add-on while waiting.\n' +
      `  1. git archive --format=zip --prefix=chevalet-note/ -o web-ext-artifacts/source-${version}.zip v${version}\n` +
      '  2. pnpm amo:attach\n' +
      '\nWhen it passes, Firefox updates everyone who installed from the store, on its own.\n',
  );
} else {
  /*
   * This used to end "and it updates itself from AMO", which was false, and it is the sentence
   * that made five unlisted builds look like releases. An unlisted package carries no
   * `update_url` -- AMO rejects one on a listed add-on -- so Firefox has nowhere to look.
   */
  console.log(
    '\nDone. The signed .xpi is in web-ext-artifacts/.\n' +
      'To install it permanently: open about:addons, click the gear, "Install Add-on From\n' +
      'File", and pick that .xpi. It survives closing Firefox.\n' +
      '\nIt does NOT update itself, and installing it takes the add-on off the store copy\n' +
      'until a listed release overtakes this version number. It reaches you and nobody else.\n' +
      'For everyone else there is one route: pnpm sign:listed\n',
  );
}
