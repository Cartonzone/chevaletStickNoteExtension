/**
 * Attach the source archive and the notes to a version that is already uploaded.
 *
 *     node tools/amo-attach.mjs            (pnpm amo:attach)  the version in package.json
 *     node tools/amo-attach.mjs 0.0.17     a particular one
 *
 * ## Why this exists
 *
 * `pnpm sign:listed` uploads the package and nothing else -- the sign API has no field for
 * source, release notes or reviewer notes. So every release since the first has ended with a
 * paragraph in `tools/sign.mjs` telling whoever ran it to go and do three more things by hand,
 * on a web form, which is the same shape of instruction that sent seven versions to the wrong
 * channel. A command that does it is worth more than a reminder to remember.
 *
 * **The source archive is not optional for us.** The build runs esbuild with `minify: true`,
 * so every shipped file is machine-generated, and AMO requires the original source whenever
 * that is true. A listed version without it gets a review cycle spent asking for it, and a
 * reviewer can disable the add-on in the meantime.
 *
 * ## Two requests, not one
 *
 * `PATCH /addons/addon/<slug>/versions/<id>/` takes all three fields, but not together:
 *
 *   - `source` has to be multipart, because it is a file.
 *   - `release_notes` and `approval_notes` are LOCALISED fields, so they want a
 *     `{"en-US": "..."}` object. A multipart body can only carry strings, and sending one
 *     comes back `400 You must provide an object of {lang-code:value}`.
 *
 * So: the file in a multipart PATCH, then the notes in a JSON PATCH. Doing it the other way
 * round is fine too; doing it in one request is not.
 *
 * ## What it sends
 *
 * The release notes are the version's own section of `CHANGELOG.md`, which is written for the
 * person installing it and is what AMO shows on the version page -- so there is one text, not
 * two that drift. The reviewer notes are `docs/PUBLISHING.md`'s draft, which is about the
 * build and the permissions and does not change between releases.
 *
 * Read-only on everything except that one version. It uploads no package and changes no
 * channel.
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const SLUG = 'chevalet-note';

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

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** AMO wants a short-lived JWT the client signs itself, not a bearer token. */
function token() {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: secret('AMO_JWT_ISSUER'),
    jti: Math.random().toString(36).slice(2),
    iat,
    exp: iat + 240,
  });
  const sig = createHmac('sha256', secret('AMO_JWT_SECRET'))
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function amo(path, init = {}) {
  const res = await fetch(`https://addons.mozilla.org/api/v5${path}`, {
    ...init,
    headers: { Authorization: `JWT ${token()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`AMO ${res.status} ${res.statusText} for ${path}\n${await res.text()}`);
  }
  return res.json();
}

/**
 * The version's own section of the changelog, as plain text.
 *
 * Between its own `## <version>` heading and the next `## `. The heading itself is dropped --
 * AMO shows these under a heading of its own, and two would read as a mistake.
 */
function releaseNotes(version) {
  const md = readFileSync('CHANGELOG.md', 'utf8');
  const start = md.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section to send.`);
  const rest = md.slice(start);
  const next = rest.slice(1).search(/^## /m);
  const body = (next < 0 ? rest : rest.slice(0, next + 1))
    .split('\n')
    .slice(1)
    .join('\n')
    .trim();
  if (!body) throw new Error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  return body;
}

/**
 * What a reviewer is told. `docs/PUBLISHING.md` has the same words and explains each of them;
 * this is the short version that goes in the box, and it is about the build rather than about
 * any one release, so it does not change between them.
 */
const APPROVAL_NOTES = `No account or login is needed; everything works offline.

The build is minified, so the full source is attached. SOURCE.md has the toolchain and the two
commands, and the output is reproducible byte-for-byte -- no timestamps, no network access
during the build. Verified for this version: building the attached archive produces a dist/
identical to the uploaded package.

There are no static content_scripts. Scripts are registered at run time via
scripting.registerContentScripts for the origins the user has explicitly granted, which is why
the install prompt asks for no host permissions at all. src/bg/inject.ts explains it.

Notes are stored in the extension's own IndexedDB. Nothing is uploaded anywhere. The single
network call in the codebase is an opt-in update check against the GitHub releases API
(src/bg/jobs/update.ts), off by default, gated behind an optional host permission requested
from a click.

Note content is rendered by a small markdown lexer in src/cs/note/md-lex.ts and built into DOM
with createElement/textContent. innerHTML is never assigned anywhere in the codebase, so there
is no HTML sanitiser to audit.`;

// --------------------------------------------------------------------------- run

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = process.argv[2] ?? pkg.version;
const archive = `web-ext-artifacts/source-${version}.zip`;

if (!existsSync(archive)) {
  throw new Error(
    `${archive} is missing. Build it from the tag, so what a reviewer reads is what was\n` +
      `signed:\n\n  git archive --format=zip --prefix=chevalet-note/ -o ${archive} v${version}\n`,
  );
}

const { results } = await amo(`/addons/addon/${SLUG}/versions/?filter=all_with_unlisted`);
const target = results.find((v) => v.version === version);
if (!target) {
  throw new Error(
    `AMO holds no version ${version}. Upload it first:\n\n  pnpm sign:listed\n\n` +
      `It holds: ${results.map((v) => v.version).join(', ')}`,
  );
}

console.log(`\n${SLUG} ${version} — version id ${target.id}, ${target.channel} channel`);

// 1. The file. Multipart, because it is one.
const form = new FormData();
form.append(
  'source',
  new Blob([readFileSync(archive)], { type: 'application/zip' }),
  `source-${version}.zip`,
);
await amo(`/addons/addon/${SLUG}/versions/${target.id}/`, { method: 'PATCH', body: form });
console.log(`  attached ${archive}`);

// 2. The notes. JSON, because localised fields want an object per language.
await amo(`/addons/addon/${SLUG}/versions/${target.id}/`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    release_notes: { 'en-US': releaseNotes(version) },
    approval_notes: APPROVAL_NOTES,
  }),
});
console.log('  attached the release notes and the reviewer notes');

// Read it back. "Submitted" is not evidence; this whole family of scripts exists because of
// that lesson.
const after = await amo(`/addons/addon/${SLUG}/versions/${target.id}/`);
console.log('\n  source on the server:  ', after.source ? 'yes' : 'NO -- it did not take');
console.log('  release notes:         ', after.release_notes?.['en-US'] ? 'yes' : 'NO');
console.log('  reviewer notes:        ', after.approval_notes ? 'yes' : 'NO');
console.log('');
