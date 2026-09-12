/**
 * End-to-end smoke test: drives the real UI the way a person would.
 *
 *   npm run build && npm run preview     # in one terminal
 *   npm run smoke                        # in another
 *
 * Adds players, logs a session, then checks the leaderboard and the settle-up
 * plan agree with the numbers that were typed in. The unit tests cover the
 * maths directly; this proves the screens are wired to it.
 *
 * Needs a local Chrome. Override the location with CHROME_PATH if it isn't
 * in one of the usual places.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH to your Chrome executable.');
  process.exit(1);
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

/**
 * Click the first button/link whose visible text contains `text`.
 * `root` scopes the search — important while a sheet is open, since the page
 * behind it often has a button whose label starts with the same word.
 */
async function clickText(text, root = '') {
  const handle = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent?.includes(t)) ?? null,
    `${root} button, ${root} a`.trim(),
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No clickable element containing "${text}"${root ? ` under ${root}` : ''}`);
  await el.click();
  await new Promise((r) => setTimeout(r, 300));
}

try {
  // Start from a clean slate so the run is repeatable.
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/#/players`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));

  // --- Add three players through the sheet ------------------------------
  await clickText('Add a player');
  await page.waitForSelector('.sheet input.input', { visible: true });
  for (const name of ['Ana', 'Ben', 'Cy']) {
    await page.type('.sheet input.input', name);
    await clickText('Add', '.sheet');
  }
  await clickText('Done', '.sheet');
  await new Promise((r) => setTimeout(r, 350));

  const playerCount = await page.$$eval('a.lb-row', (els) => els.length);
  check('three players appear in the roster', playerCount, 3);

  // --- Log a session ----------------------------------------------------
  // The real game: $10 buy-ins, 0.05/0.10 blinds, one rebuy, cents in the
  // cash-outs. Ana +13.50, Ben -10, Cy -3.50.
  await page.goto(`${BASE}/#/sessions/new`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));

  // The details card is `.card.card-pad`; the player table is a plain `.card`,
  // so this picks up the buy-in/cash-out pairs without the "hours played" field.
  const inputs = await page.$$('.card:not(.card-pad) input.input-money');
  if (inputs.length !== 6) throw new Error(`expected 6 money inputs, found ${inputs.length}`);

  const prefilled = await inputs[0].evaluate((el) => el.value);
  check('new session pre-fills the standard buy-in', prefilled, '10');

  // Ana rebuys once, via the button rather than by typing.
  await clickText('+ buy-in', '.card:not(.card-pad)');
  const afterRebuy = await inputs[0].evaluate((el) => el.value);
  check('the rebuy button adds another buy-in', afterRebuy, '20');

  await inputs[1].type('33.50'); // Ana out
  await inputs[3].type('0');     // Ben out
  await inputs[5].type('6.50');  // Cy out
  await new Promise((r) => setTimeout(r, 250));

  const balanced = await page.$$eval('.banner-ok', (els) =>
    els.some((e) => e.textContent?.includes('balances')),
  );
  check('editor reports the table balances', balanced, true);

  await clickText('Save session');
  await new Promise((r) => setTimeout(r, 500));

  // --- Leaderboard ------------------------------------------------------
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 450));

  const standings = await page.$$eval('a.lb-row', (rows) =>
    rows.map((r) => ({
      name: r.querySelector('.lb-name')?.textContent?.trim(),
      net: r.querySelector('.lb-net')?.textContent?.trim(),
    })),
  );

  check('leaderboard is ordered by profit', standings.map((s) => s.name).join(','), 'Ana,Cy,Ben');
  check('winner net keeps its cents', standings[0]?.net, '+$13.50');
  check('middle net keeps its cents', standings[1]?.net, '-$3.50');
  check('loser net is correct', standings[2]?.net, '-$10');

  // --- Settle up --------------------------------------------------------
  await clickText('Settle up');
  await page.waitForSelector('.sheet', { visible: true });
  await new Promise((r) => setTimeout(r, 400));

  const transfers = await page.$$eval('.sheet .card > div', (rows) =>
    rows
      .map((r) => r.textContent?.replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.includes('→')),
  );
  check('two payments settle the night', transfers.length, 2);
  check('Ben pays Ana $10', transfers.some((t) => t.includes('Ben→') && t.endsWith('$10')), true);
  check('Cy pays Ana $3.50', transfers.some((t) => t.includes('Cy→') && t.endsWith('$3.50')), true);

  check('no console errors', errors.length, 0);
  if (errors.length) for (const e of [...new Set(errors)]) console.log('        ', e);
} catch (e) {
  failures++;
  console.log('FAIL  threw:', e.message);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nSmoke test passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
