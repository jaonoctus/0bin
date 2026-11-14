// Browser test for 0bin: drives a real Chrome against a running server and
// checks the whole client side flow (encryption happens in the browser, so
// there is nothing meaningful to test without one).
//
// Usage: node run.mjs <base url>     e.g. node run.mjs http://127.0.0.1:3299
// Use run.sh to start a throwaway server and run this against it.
//
// Chrome is looked up in CHROME_PATH, then in the usual macOS and Linux places.

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node run.mjs <base url>');
  process.exit(2);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  const found = candidates.find(c => c && fs.existsSync(c));
  if (!found) {
    console.error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
    process.exit(2);
  }
  return found;
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  // Hosted CI runners do not allow the Chrome sandbox
  args: process.env.CI ? ['--no-sandbox'] : []
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '0bin-e2e-'));
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
const CODE = 'function add(a, b) {\n  var x = {"k": [1,2,3]};\n  return a + b; // sum\n}\n';

let failures = 0;
const errors = [];

function ok(condition, message) {
  console.log((condition ? 'PASS ' : 'FAIL ') + message);
  if (!condition) {
    failures++;
  }
}

/** New tab that records JS errors and accepts confirm() dialogs. */
async function newPage(context = browser) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(new URL(page.url()).pathname + ': ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(new URL(page.url()).pathname + ': ' + m.text());
    }
  });
  page.on('dialog', d => d.accept());
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Wait until the paste is decrypted and displayed. */
const decrypted = page => page.waitForFunction(() => {
  const e = document.querySelector('#paste-content');
  return e && e.classList.contains('done');
}, { timeout: 30000 });

const pasteText = page => page.$eval('#paste-content', e => e.textContent.trim());

/** Click the first visible element matching the selector whose text starts with `text`. */
const clickText = (page, selector, text) => page.evaluate((selector, text) => {
  const el = [...document.querySelectorAll(selector)]
    .find(e => e.textContent.trim().startsWith(text) && e.offsetParent !== null);
  if (!el) {
    return false;
  }
  el.click();
  return true;
}, selector, text);

const submit = (page, timeout = 30000) => Promise.all([
  page.waitForNavigation({ timeout }),
  page.click('button[type=submit]')
]);

/** Build a DataTransfer holding a PNG file and dispatch `events` on the textarea. */
const sendImage = (page, events) => page.evaluate((png, events) => {
  const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], 'a.png', { type: 'image/png' }));
  const content = document.getElementById('content');
  window.__hover = [];
  events.forEach(name => {
    const init = { bubbles: true, cancelable: true };
    const event = name === 'paste' ?
      new ClipboardEvent(name, Object.assign(init, { clipboardData: transfer })) :
      new DragEvent(name, Object.assign(init, { dataTransfer: transfer }));
    content.dispatchEvent(event);
    window.__hover.push(content.classList.contains('hover'));
  });
}, PNG_BASE64, events);

try {

  // ---- home page
  let p = await newPage();
  await p.goto(base + '/');
  const vueVersion = await p.evaluate(() => Vue.version);
  ok(vueVersion.startsWith('3.'), 'Vue 3 loaded (' + vueVersion + ')');
  await sleep(300);
  ok(await p.evaluate(() => document.activeElement.id) === 'content', 'textarea focused');
  ok(await p.$eval('label.upload-file', e => e.textContent.trim().startsWith('Upload file') && !e.hasAttribute('disabled')),
    'upload label rendered, not disabled');
  ok(!(await p.content()).includes('{%'), 'no unrendered {% %} on home');
  await clickText(p, 'li.submenu > a', 'Previous');
  await sleep(200);
  ok(await p.$eval('#topmenu', e => e.textContent.includes('No paste yet')).catch(() => false),
    'previous pastes menu: empty state');

  // ---- code paste with title and tip address
  await p.type('#content', CODE);
  await p.type('input.paste-excerpt', 'my title');
  await p.type('input.paste-btc-tip-address', 'bc1qexampleaddress');
  await p.select('#expiration', '1_month');
  await submit(p);
  const url = p.url();
  await decrypted(p);
  ok(/\/paste\/[^#]+#.+/.test(url), 'redirected to the paste url with a key');
  ok((await pasteText(p)).includes('return a + b; // sum'), 'code paste decrypted');
  ok(await p.$eval('#paste-content', e => e.classList.contains('linenums') && e.querySelectorAll('li').length >= 4),
    'code colorized with line numbers');
  ok(await p.$eval('h1', e => e.textContent.trim()) === 'my title', 'title shown');
  ok(await p.$eval('.btc-tip-address', e => e.dataset.address) === 'bc1qexampleaddress', 'tip address shown');
  ok(/Expire\s+\S+/.test(await p.$eval('#expiration-tag', e => e.textContent).catch(() => '')), 'expiration tag shown');
  ok(await p.$eval('a.download-link', e => e.getAttribute('download').endsWith('.txt') &&
    e.getAttribute('href').startsWith('data:text')), 'download link bound');
  ok(!(await p.content()).includes('{%'), 'no unrendered {% %} on the paste page');

  await clickText(p, 'li.submenu > a', 'Previous');
  await sleep(200);
  ok(await p.$$eval('#topmenu li.item a', a => a.length === 1 && a[0].getAttribute('href').includes('/paste/') &&
    !a[0].getAttribute('href').includes('owner_key')), 'previous pastes menu lists the paste, without the owner key');
  ok(await p.$eval('#topmenu li.item', e => e.classList.contains('active')), 'current paste marked active');

  // ---- reader mode
  ok(!!(await p.$('a.reader-book')), 'reader mode button shown for text');
  await Promise.all([p.waitForNavigation({ timeout: 20000 }), p.click('a.reader-book')]);
  await p.waitForSelector('#readable-paste-content', { timeout: 20000 });
  ok((await p.$eval('#readable-paste-content', e => e.textContent)).includes('return a + b'), 'reader mode shows the content');
  ok(await p.$eval('#app', e => e.classList.contains('reader-mode-bg')) && !(await p.$('#paste-content')),
    'reader mode classes applied, code view removed');
  const fontSize = await p.$eval('#readable-paste-content', e => parseFloat(getComputedStyle(e).fontSize));
  await p.click('li.reader-tools.max a');
  ok(await p.$eval('#readable-paste-content', e => parseFloat(getComputedStyle(e).fontSize)) === fontSize + 5,
    'reader mode font size increases');
  await Promise.all([p.waitForNavigation({ timeout: 20000 }), p.click('a.reader-book')]);
  await decrypted(p);
  ok(!(await p.$('#readable-paste-content')), 'reader mode turns off');

  // ---- clone
  await clickText(p, 'button.btn-clone', 'Clone');
  await sleep(200);
  ok(await p.$eval('.submit-form', e => getComputedStyle(e).display !== 'none') &&
    await p.$eval('.paste-form', e => getComputedStyle(e).display === 'none'), 'clone form shown');
  ok((await p.$eval('#content', e => e.value)).includes('return a + b; // sum'), 'clone textarea filled');
  ok(await p.$eval('.submit-form input.paste-excerpt', e => e.value) === 'my title', 'clone copies the title');
  await clickText(p, 'button', 'Cancel clone');
  await sleep(200);
  ok(await p.$eval('.paste-form', e => getComputedStyle(e).display !== 'none'), 'cancel clone restores the paste view');
  await clickText(p, 'button.btn-clone', 'Clone');
  await sleep(200);
  await p.type('#content', '// cloned\n');
  await submit(p);
  await decrypted(p);
  ok(p.url() !== url && (await pasteText(p)).includes('// cloned'), 'cloned paste created');

  // ---- other readers (separate browser context: no localStorage, no owner key)
  const other = await browser.createBrowserContext();
  const q = await newPage(other);
  await q.goto(url);
  await decrypted(q);
  ok((await pasteText(q)).includes('return a + b'), 'decrypts for another reader');
  ok(!(await clickText(q, 'button', 'Delete Paste')), 'non owner has no delete button');

  const r = await newPage(other);
  await r.goto(url.replace(/#.*/, '#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
  await r.waitForSelector('p.alert-danger', { timeout: 20000 });
  ok((await r.$eval('p.alert-danger', e => e.textContent)).includes('Could not decrypt'), 'wrong key shows an error');
  await r.click('p.alert-danger a.close');
  await sleep(200);
  ok(!(await r.$('p.alert-danger')), 'message dismissed with x');

  // ---- owner delete
  await p.goto(base + '/');
  await p.goto(url);
  await decrypted(p);
  ok(await clickText(p, 'button', 'Delete Paste'), 'owner sees the delete button');
  await p.waitForNavigation({ timeout: 20000 }).catch(() => {});
  await q.reload();
  ok(!(await q.$('#paste-content')) && (await q.content()).includes('404'), 'paste gone after delete');

  // ---- prose: not colorized, then forced
  p = await newPage();
  await p.goto(base + '/');
  await p.type('#content', 'just some plain prose without any code in it at all\nsecond line of prose');
  await submit(p);
  await decrypted(p);
  const alerts = page => page.$$eval('p.alert', a => a.map(e => e.textContent).join('|'));
  ok(await p.$eval('#paste-content', e => !e.classList.contains('linenums')), 'prose not colorized');
  ok((await alerts(p)).includes('did not seem to be code'), 'not-code message shown');
  await clickText(p, 'p.alert a', 'Click here to force coloration');
  await sleep(300);
  ok(await p.$eval('#paste-content', e => e.classList.contains('linenums') && e.querySelectorAll('li').length === 2),
    'force coloration works');
  ok(!(await alerts(p)).includes('did not seem'), 'force coloration message removed');
  ok((await pasteText(p)).includes('second line of prose'), 'content intact after forced coloration');

  // ---- passphrase
  p = await newPage();
  await p.goto(base + '/');
  await p.type('#content', 'secret body');
  await p.type('input.paste-password', 'hunter2');
  await submit(p, 90000);
  const s = await newPage(other);
  await s.goto(p.url());
  await s.waitForSelector('#paste-password', { visible: true, timeout: 20000 });
  ok(await s.$eval('#paste-content', e => getComputedStyle(e).display === 'none'), 'ciphertext hidden behind the passphrase prompt');
  await sleep(200);
  ok(await s.evaluate(() => document.activeElement.id) === 'paste-password', 'passphrase input focused');
  ok(await s.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Unlock').disabled),
    'unlock disabled while empty');
  await s.type('#paste-password', 'wrong');
  await s.keyboard.press('Enter');
  await s.waitForFunction(() => {
    const e = document.querySelector('.password-prompt .alert-danger');
    return e && e.textContent.includes('Wrong passphrase');
  }, { timeout: 90000 });
  ok(true, 'wrong passphrase rejected');
  ok(await s.$eval('#paste-password', e => e.value) === '', 'passphrase input cleared');
  await s.type('#paste-password', 'hunter2');
  await clickText(s, 'button', 'Unlock');
  await decrypted(s);
  ok((await pasteText(s)) === 'secret body' && !(await s.$('#paste-password')), 'passphrase paste decrypted, prompt gone');
  ok(await s.$eval('#paste-content', e => getComputedStyle(e).display !== 'none'), 'content visible after unlock');

  // ---- burn after reading
  p = await newPage();
  await p.goto(base + '/');
  await p.type('#content', 'burn me');
  await p.select('#expiration', 'burn_after_reading');
  await submit(p);
  await decrypted(p);
  const burnUrl = p.url();
  const mainText = page => page.$eval('#main', e => e.textContent);
  ok((await pasteText(p)) === 'burn me', 'burn paste shown after create');
  ok((await mainText(p)).includes('will be deleted the next time'), 'burn notice shown');
  await p.click('#main p.alert a.close');
  await sleep(200);
  ok(!(await mainText(p)).includes('will be deleted the next time'), 'burn notice dismissed');
  // The server does not burn the paste during the 10 seconds after creation
  await sleep(10500);
  const t = await newPage(other);
  await t.goto(burnUrl);
  await decrypted(t);
  ok((await mainText(t)).includes('self-destructed') && (await pasteText(t)) === 'burn me',
    'first read after the grace window shows and burns the paste');
  const u = await newPage(other);
  await u.goto(burnUrl);
  ok((await u.content()).includes('404'), 'second read is a 404');

  // ---- image upload through the file input
  const png = path.join(tmp, 'test.png');
  fs.writeFileSync(png, Buffer.from(PNG_BASE64, 'base64'));
  p = await newPage();
  await p.goto(base + '/');
  await (await p.$('#file-upload')).uploadFile(png);
  await p.waitForSelector('.paste-wrapper img', { timeout: 20000 });
  ok(true, 'image preview after upload');
  await submit(p);
  await p.waitForSelector('.paste-wrapper img', { timeout: 30000 });
  ok(await p.$eval('.paste-wrapper img', e => e.src.startsWith('data:image/')), 'image paste displayed');
  ok(await p.$eval('a.download-link', e => /\.(jpeg|png)$/.test(e.getAttribute('download'))), 'image download link');
  ok(!(await p.$('a.reader-book')), 'no reader mode for images');

  // ---- textarea: autofit, drag and drop, image paste
  p = await newPage();
  await p.goto(base + '/');
  ok(await p.$eval('#content', e => e.style.overflowY === 'hidden' && parseFloat(e.style.height) > 0),
    'textarea autofit initialised');
  const height = await p.$eval('#content', e => e.offsetHeight);
  await p.type('#content', Array(30).fill('x').join('\n'));
  ok(await p.$eval('#content', e => e.offsetHeight) > height, 'textarea grows while typing');
  await sendImage(p, ['dragover', 'drop']);
  ok(await p.evaluate(() => window.__hover[0] === true && window.__hover[1] === false),
    'dragover highlights the textarea, drop clears it');
  await p.waitForSelector('.paste-wrapper img', { timeout: 20000 });
  ok(await p.$eval('#content', e => e.value.startsWith('data:image/png')), 'dropped image loaded');

  p = await newPage();
  await p.goto(base + '/');
  await sendImage(p, ['paste']);
  await p.waitForSelector('.paste-wrapper img', { timeout: 20000 });
  ok(true, 'pasted image loaded');

  // ---- long text shows the bottom toolbar
  p = await newPage();
  await p.goto(base + '/');
  await p.evaluate(() => {
    const c = document.getElementById('content');
    c.value = Array(60).fill('line').join('\n');
    c.dispatchEvent(new Event('input'));
    c.dispatchEvent(new Event('change'));
  });
  await sleep(300);
  ok(await p.$$eval('button[type=submit]', a => a.length) === 2, 'bottom toolbar appears for long pastes');

  // ---- faq (a page without a paste form)
  p = await newPage();
  await p.goto(base + '/faq/');
  ok((await p.content()).includes('sebsauvage') && !(await p.content()).includes('{%'), 'faq renders');

  ok(errors.length === 0, 'no JS errors on any page ' + JSON.stringify(errors));

} catch (err) {
  failures++;
  console.log('FAIL test aborted: ' + (err && err.stack || err));
  if (errors.length) {
    console.log('JS errors so far: ' + JSON.stringify(errors));
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? failures + ' check(s) failed' : 'All checks passed');
process.exit(failures ? 1 : 0);
