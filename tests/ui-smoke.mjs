import { chromium } from 'playwright';

const baseURL = process.env.BRISCOLA_URL || 'http://127.0.0.1:4174';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

async function assertFits(page, label, { allowVerticalScroll = false } = {}) {
  const result = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('button, input, .card, .nameplate, .scoreboard, .winner')]
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      });
    const clipped = visible.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth + 1 || (!document.body.dataset.allowVerticalScroll && (r.top < -1 || r.bottom > innerHeight + 1));
    }).map((el) => ({ className: el.className, text: el.textContent?.trim().slice(0, 50), rect: el.getBoundingClientRect().toJSON() }));
    return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, clipped };
  }, allowVerticalScroll);
  if (result.horizontalOverflow || result.clipped.length) throw new Error(`${label} does not fit: ${JSON.stringify(result)}`);
}

async function playGame(page) {
  for (let move = 0; move < 20; move += 1) {
    const winner = page.locator('.winner');
    if (await winner.count()) return (await winner.innerText()).replace(/\s+/g, ' ').trim();
    const playable = page.locator('.player.bottom .card:not([disabled])').first();
    await playable.waitFor({ state: 'visible', timeout: 10000 });
    await playable.click();
    await page.waitForFunction(() => document.querySelector('.winner') || document.querySelector('.player.bottom .card:not([disabled])'), null, { timeout: 10000 });
  }
  return (await page.locator('.winner').innerText()).replace(/\s+/g, ' ').trim();
}

const results = [];
for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'landscape', width: 844, height: 390 }, { name: 'desktop', width: 1440, height: 900 }]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.evaluate((allow) => { document.body.dataset.allowVerticalScroll = allow ? 'true' : ''; }, true);
  await assertFits(page, `${viewport.name} lobby`, { allowVerticalScroll: true });
  await page.screenshot({ path: `test-results/${viewport.name}-lobby.png`, fullPage: true });
  await page.getByRole('button', { name: 'Play as Pavel against Sid AI' }).click();
  await page.evaluate(() => { document.body.dataset.allowVerticalScroll = ''; });
  await assertFits(page, `${viewport.name} game`);
  await page.screenshot({ path: `test-results/${viewport.name}-game.png`, fullPage: true });
  if (viewport.name === 'phone') {
    results.push(await playGame(page));
    await page.getByRole('button', { name: 'New game' }).click();
    results.push(await playGame(page));
  }
  await page.close();
}

console.log(JSON.stringify({ screens: ['phone', 'landscape', 'desktop'], completedGames: results }, null, 2));
await browser.close();
