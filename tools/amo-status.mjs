/**
 * Ask AMO which channel each version actually went to.
 *
 *     node tools/amo-status.mjs        (pnpm amo:status)
 *
 * ## Why this exists
 *
 * The channel is chosen in two places and we got it wrong in both. 0.0.9 to 0.0.13 took
 * `tools/sign.mjs`'s old unlisted default. 0.0.15 was uploaded by hand and took the "On your
 * own" radio button on the Developer Hub form, which is asked on its own page BEFORE the file
 * and is easy to click past. Seven version numbers spent, none of them reaching a store user,
 * and each time the mistake was invisible until somebody read the Hub page carefully enough to
 * notice a small `Self` badge in the second table.
 *
 * A signing script that says "submitted" is not evidence. This asks the server, which is.
 *
 * ## What it reports
 *
 * Every version AMO holds, newest first, with its channel and review state, and then the one
 * line that actually matters: the newest LISTED version, which is what people who installed
 * from addons.mozilla.org are on -- or will be on once review clears.
 *
 * Read-only. It never uploads, edits or deletes anything.
 *
 * ## The credential
 *
 * The same AMO API key `tools/sign.mjs` uses, out of `C:/Projects/.env`. AMO's API wants a JWT
 * that the client signs itself: HS256 over `{iss, jti, iat, exp}`, valid for at most five
 * minutes. `web-ext` does this internally; there is no shared helper to import, so the twelve
 * lines are here.
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const ENV_FILE = 'C:/Projects/.env';
const SLUG = 'chevalet-note';

function secret(name) {
  if (!existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} does not exist.`);
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0 && line.slice(0, at).trim() === name) {
      const value = line.slice(at + 1).trim();
      if (value) return value;
    }
  }
  throw new Error(`${name} is not set in ${ENV_FILE}.`);
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

async function amo(path) {
  const res = await fetch(`https://addons.mozilla.org/api/v5${path}`, {
    headers: { Authorization: `JWT ${token()}` },
  });
  if (!res.ok) {
    throw new Error(`AMO ${res.status} ${res.statusText} for ${path}\n${await res.text()}`);
  }
  return res.json();
}

// `all_with_unlisted` is the only filter that returns both channels; the default hides
// precisely the versions this tool was written to catch.
const { results } = await amo(`/addons/addon/${SLUG}/versions/?filter=all_with_unlisted`);

const rows = results.map((v) => ({
  version: v.version,
  channel: v.channel,
  status: v.file?.status ?? 'unknown',
  created: (v.file?.created ?? v.reviewed ?? '').slice(0, 10),
}));

console.log(`\n${SLUG} — every version AMO holds\n`);
console.log('  version    channel     status              created');
console.log('  ---------  ----------  ------------------  ----------');
for (const r of rows) {
  const mark = r.channel === 'listed' ? ' <- reaches store users' : '';
  console.log(
    `  ${r.version.padEnd(9)}  ${r.channel.padEnd(10)}  ${r.status.padEnd(18)}  ${r.created}${mark}`,
  );
}

const listed = rows.filter((r) => r.channel === 'listed');
const newest = listed[0];

console.log('');
if (!newest) {
  console.log('  NO LISTED VERSION AT ALL. Nothing here has ever reached a store user.');
} else {
  console.log(`  Newest listed version: ${newest.version} (${newest.status})`);
  const unlisted = rows.filter((r) => r.channel !== 'listed').length;
  console.log(`  ${listed.length} listed, ${unlisted} unlisted.`);
  if (newest.status !== 'public') {
    console.log('\n  It is not public yet, so store users are still on the previous listed');
    console.log('  version. That is expected while a human review is in the queue.');
  }
}
console.log('');
