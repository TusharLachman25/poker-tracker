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

/**
 * Money as rendered depends on the group's currency and the machine's locale
 * ("$10", "A$10", "10,00 $"), so compare the sign and digits only.
 */
const amountIs = (text, expected) => {
  const strip = (v) => (v ?? '').replace(/[^\d.,+-]/g, '').replace(/,/g, '');
  return strip(text) === strip(expected);
};

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
  check('winner net keeps its cents', amountIs(standings[0]?.net, '+13.50'), true);
  check('middle net keeps its cents', amountIs(standings[1]?.net, '-3.50'), true);
  check('loser net is correct', amountIs(standings[2]?.net, '-10'), true);

  // --- Payments: who owes who, and paying it off ------------------------
  await page.goto(`${BASE}/#/payments`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 450));

  // Suggested transfers are the rows carrying a "Record this payment" button;
  // history rows contain an arrow too, so text alone wouldn't tell them apart.
  const readTransfers = () =>
    page.$$eval('.card > div', (rows) =>
      rows
        .filter((r) =>
          [...r.querySelectorAll('button')].some((b) =>
            b.textContent?.includes('Record this payment'),
          ),
        )
        .map((r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    );

  const before = await readTransfers();
  check('two payments would clear the night', before.length, 2);
  check('Ben owes Ana $10', before.some((t) => t.includes('Ben') && t.includes('$10')), true);
  check('Cy owes Ana $3.50', before.some((t) => t.includes('Cy') && t.includes('$3.50')), true);

  // Record the first suggested payment straight from its row.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Record this payment'),
    );
    btn?.click();
  });
  await page.waitForSelector('.sheet', { visible: true });
  await new Promise((r) => setTimeout(r, 350));

  const prefilledAmount = await page.$eval('.sheet input.input-money', (el) => el.value);
  check('the payment sheet is pre-filled with the suggested amount', prefilledAmount, '10');

  await clickText('Save payment', '.sheet');
  await new Promise((r) => setTimeout(r, 500));

  const after = await readTransfers();
  check('paying leaves only the other debt outstanding', after.length, 1);
  check('and it is Cy owing $3.50', after[0]?.includes('Cy') && after[0]?.includes('$3.50'), true);

  const historyCount = await page.$$eval(
    'button[aria-label="Delete this payment"]',
    (els) => els.length,
  );
  check('the payment is listed in the history', historyCount, 1);

  // --- Settings must stick ----------------------------------------------
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));

  const changed = await page.evaluate(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent === 'GBP');
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  });
  check('the currency can be changed', changed, true);

  // Long enough for the sync debounce and a re-render to have fired.
  await new Promise((r) => setTimeout(r, 4000));
  const stuck = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('poker-tracker/ledger/v1') ?? '{}');
    const shown = [...document.querySelectorAll('select')]
      .map((s) => s.value)
      .find((v) => /^[A-Z]{3}$/.test(v));
    return { stored: stored?.settings?.currency, shown };
  });
  check('and stays changed a few seconds later', stuck.stored, 'GBP');
  check('with the dropdown still showing it', stuck.shown, 'GBP');

  // Put it back so later checks read the default currency.
  await page.evaluate(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent === 'AUD');
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  // --- Activity log: an edit has to leave a trace -----------------------
  // Say who this phone is, so the edit is attributed rather than anonymous.
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const identitySet = await page.evaluate(() => {
    // Settings has several selects (currency first); pick the one listing players.
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find((o) => o.textContent === 'Ana');
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  });
  check('this device can say which player it belongs to', identitySet, true);
  await new Promise((r) => setTimeout(r, 300));

  // Edit the session: move money between Ana and Cy, keeping the table square.
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const sessionHref = await page.$eval('a.card', (a) => a.getAttribute('href'));
  await page.goto(`${BASE}/${sessionHref}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 450));

  await page.evaluate(() => {
    // React ignores a plain `.value =`, so go through the native setter.
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const money = [...document.querySelectorAll('.card:not(.card-pad) input.input-money')];
    set(money[1], '30'); // Ana cashes out less
    set(money[5], '10'); // Cy cashes out more
  });
  await new Promise((r) => setTimeout(r, 300));
  await clickText('Save changes');
  await new Promise((r) => setTimeout(r, 600));

  await page.goto(`${BASE}/#/activity`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 450));
  const log = await page.$$eval('.card > div', (rows) =>
    rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  );

  const edit = log.find((l) => l.includes('edited a session'));
  check('the edit is recorded', Boolean(edit), true);
  // The row text begins with the avatar's initials, so match the phrase itself.
  check('and attributed to whoever made it', edit?.includes('Ana edited a session') ?? false, true);
  check('with the old and new figures', /13\.50.*→.*10/.test(edit ?? ''), true);
  check('naming the other player who moved', edit?.includes('Cy') ?? false, true);
  check('the original session log is still there', log.some((l) => l.includes('logged a session')), true);
  check('as is the payment', log.some((l) => l.includes('recorded a payment')), true);

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
