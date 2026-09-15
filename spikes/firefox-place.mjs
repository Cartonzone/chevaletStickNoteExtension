/**
 * Does a note stay where you put it?
 *
 * ## The report
 *
 * > when i add a sticky note and place it somewhere the place of that sticky note not saving
 * > in that page ever and with refresh note all of them come in default place
 *
 * Every released version through 0.0.16. The note is dragged, the new position IS stored --
 * `spikes/firefox-persist.mjs` reads it back out of IndexedDB and says YES -- and on the next
 * load the note is somewhere else entirely.
 *
 * That gap is the whole reason this file exists. The store was measured; the screen was not.
 * `placeFor` in `src/cs/renderer.ts` re-resolved the note's ANCHOR and preferred its answer
 * over the stored coordinates, and the anchor was captured once, when the note was made, and
 * never again. So the stored position was written faithfully and then ignored, every time.
 *
 * ## What it measures
 *
 * Where the note IS, from page script, before and after a reload -- not what is in the
 * database. `elementFromPoint` retargets through a shadow boundary, so a point covered by a
 * note comes back as the extension's host element; that is the one thing about a closed
 * shadow root a page can honestly observe, and it is exactly the question the report asks.
 *
 * Two points, always: where the note was dropped, and where it was made. A note that is at
 * neither is a different bug from a note that went home, and one assertion cannot tell them
 * apart.
 *
 *     pnpm serve
 *     pnpm build:test
 *     node spikes/firefox-place.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Builder, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const DIST = 'dist-test';
const BASE = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/spa/';

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error(`\n${DIST}/ is not built. Run: pnpm build:test\n`);
  process.exit(2);
}

const o = new Options();
if (!process.env.CN_HEADED) o.addArguments('-headless');
o.addArguments('-width', '1280', '-height', '900');
o.setAlertBehavior('accept');
/*
 * Which Firefox. The default is whatever geckodriver finds on PATH, which is the right
 * answer everywhere except a machine where Firefox is a snap: geckodriver cannot hand a
 * confined snap a profile outside the home directory, and the process exits before
 * Marionette is up. `CN_FIREFOX` points at an ordinary unpacked build instead.
 */
if (process.env.CN_FIREFOX) o.setBinary(process.env.CN_FIREFOX);

const d = await new Builder().forBrowser('firefox').setFirefoxOptions(o).build();
mkdirSync('spikes/shots', { recursive: true });

const results = [];
const check = (what, ok) => {
  results.push([what, ok]);
  console.log(`  ${ok ? 'YES' : 'NO '}  ${what}`);
};

/** Is one of our notes occupying this point? See the header of spikes/firefox-extension.mjs. */
const noteAt = async (x, y) =>
  d.executeScript(`
    const el = document.elementFromPoint(${x}, ${y});
    return el ? el.tagName.toLowerCase().startsWith('chevalet-note-root-') : false;
  `);

/*
 * The note is 240 x 200 and its top-left lands on the double-click. MADE is where it is
 * born, DROPPED is where it is dragged to, and the two probe points are chosen so that each
 * one is inside exactly one of the two rectangles -- otherwise a note that never moved would
 * satisfy both.
 */
const MADE = { x: 700, y: 430 };
const GRAB = { x: MADE.x + 30, y: MADE.y + 14 };
const DROP = { x: GRAB.x - 380, y: GRAB.y - 230 };
const NEW_CORNER = { x: MADE.x - 380, y: MADE.y - 230 };
const PROBE_NEW = { x: NEW_CORNER.x + 40, y: NEW_CORNER.y + 40 };
const PROBE_OLD = { x: MADE.x + 40, y: MADE.y + 150 };

const where = async (label) => {
  const atNew = await noteAt(PROBE_NEW.x, PROBE_NEW.y);
  const atOld = await noteAt(PROBE_OLD.x, PROBE_OLD.y);
  console.log(`       trace  ${label.padEnd(30)} dropped=${atNew}  made=${atOld}`);
};

try {
  const id = await d.installAddon(DIST, true);
  console.log(`\n${await d.executeScript('return navigator.userAgent')}`);
  console.log(`installed: ${id}\n`);
  await d.sleep(1500);

  await d.get(BASE);
  await d.sleep(1800);

  check(
    'nothing is at either point to begin with',
    (await noteAt(PROBE_NEW.x, PROBE_NEW.y)) === false &&
      (await noteAt(PROBE_OLD.x, PROBE_OLD.y)) === false,
  );

  // Alt + double-click is how a note is made.
  await d.actions().keyDown(Key.ALT).move(MADE).doubleClick().keyUp(Key.ALT).perform();
  await d.sleep(1000);
  await d.actions().sendKeys('a note that must stay where it is put').perform();
  await d.sleep(700);

  check('a note appears where it was made', await noteAt(PROBE_OLD.x, PROBE_OLD.y));
  await where('made');

  // ------------------------------------------------------------------- moved

  await d.actions().move(GRAB).press().move(DROP).release().perform();
  // The renderer debounces its writes by 250ms; give the patch time to land.
  await d.sleep(1200);

  const moved = await noteAt(PROBE_NEW.x, PROBE_NEW.y);
  if (!moved) {
    console.log('  --   the drag did not move the note; nothing after this is measured');
    await where('drag failed');
    process.exitCode = 3;
  } else {
    check('the drag moves it', moved);
    check('and it has left where it was made', (await noteAt(PROBE_OLD.x, PROBE_OLD.y)) === false);
    await where('dropped');

    // -------------------------------------------------------------- THE TEST

    await d.navigate().refresh();
    await d.sleep(2400);

    check('it is where it was dropped after a reload', await noteAt(PROBE_NEW.x, PROBE_NEW.y));
    check(
      'and it has NOT gone back to where it was made',
      (await noteAt(PROBE_OLD.x, PROBE_OLD.y)) === false,
    );
    await where('after a reload');

    // A second reload: a position that survives once but drifts every time after is a
    // different bug, and it would read as a pass above.
    await d.navigate().refresh();
    await d.sleep(2400);
    check('and after a second one', await noteAt(PROBE_NEW.x, PROBE_NEW.y));
    await where('after a second reload');

    // ------------------------------------------------- and it still FOLLOWS

    /*
     * The other half, and the one a careless fix would break: pinning notes to their stored
     * coordinates and ignoring the anchor would pass every check above and quietly delete the
     * feature. So the page grows a banner it did not have last time, and the note has to come
     * down with the paragraph it is stuck to -- by the banner's height, not by a guess.
     *
     * The banner is in the hash, which the extension's URL matching ignores, so this is the
     * same page with the same notes and not a second page that happens to look alike.
     */
    const PAD = 200;
    await d.get(`${BASE}#pad=${PAD}`);
    await d.navigate().refresh();
    await d.sleep(2400);

    check(
      'a banner pushed in above moves the note down with its content',
      await noteAt(PROBE_NEW.x, PROBE_NEW.y + PAD),
    );
    check(
      'and it is no longer where the unpadded page had it',
      (await noteAt(PROBE_NEW.x, PROBE_NEW.y)) === false,
    );
    console.log(
      `       trace  ${'after a 200px banner'.padEnd(30)} pushed=${await noteAt(
        PROBE_NEW.x,
        PROBE_NEW.y + PAD,
      )}  unpushed=${await noteAt(PROBE_NEW.x, PROBE_NEW.y)}`,
    );
  }

  writeFileSync('spikes/shots/place.png', Buffer.from(await d.takeScreenshot(), 'base64'));
  console.log('\n  spikes/shots/place.png');
  if (results.some(([, ok]) => !ok)) process.exitCode = 3;
} finally {
  await d.quit();
}
console.log('');
