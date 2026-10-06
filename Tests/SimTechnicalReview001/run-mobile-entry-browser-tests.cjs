// Read-only live SIM entry regression. Requires the existing SIM access code in
// DLE_OS_SIM_PERMANENT_ACCESS_CODE; never logs it or writes business API state.
const fs = require('fs');
const assert = require('assert/strict');
const { chromium, webkit } = require(process.env.NODE_REPL_NODE_MODULE_DIRS + '/playwright');
const origin = 'https://sim-miguel.dle-os.internal.dlemfg.com:5177';
const out = 'tmp/technical-review-mobile';
const stores = ['rfq-intakes.json', 'rfq-lanes.json', 'dle-os-sim.db'];
const before = stores.map(name => fs.readFileSync('.sim-state/data/' + name));
(async () => {
  assert(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE, 'Existing SIM credential required');
  for (const engine of ['webkit', 'edge']) {
    const browser = await (engine === 'webkit' ? webkit.launch({headless:true}) : chromium.launch({channel:'msedge',headless:true}));
    try {
      for (const savedMobile of [true, false]) {
        const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
        const page = await context.newPage();
        const errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        if (process.env.SIM_ENTRY_BASELINE === '1') await page.route('**/SRC/shell/operator-header.css', r => r.fulfill({contentType:'text/css',body:fs.readFileSync(out+'/before-entry-fix-operator-header.css')}));
        if (savedMobile) await page.addInitScript(() => localStorage.setItem('DLE_OS_VIEW_MODE', 'mobile'));
        await page.goto(origin);
        if (await page.locator('#sim_access').count()) {
          await page.locator('#sim_access').fill(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE);
          await Promise.all([page.waitForURL(url => !url.pathname.includes('sim-access')), page.getByRole('button',{name:'Open local SIM'}).click()]);
        }
        await page.waitForFunction(() => !!window.DleWorkspaceShell);
        await page.route('**/api/**', route => {
          if (route.request().method() === 'GET') return route.continue();
          writes.push(route.request().url());
          return route.abort();
        });
        if (!savedMobile) await page.locator('#dleViewModeSelect').selectOption('mobile');
        await page.locator('[data-mobile-work-area="technical-review"]').click();
        await page.locator('#technicalReviewQueue').waitFor({state:'attached'});
        await page.waitForFunction(() => document.querySelector('#technicalReviewQueue')?.textContent.trim() && !document.querySelector('#technicalReviewQueue').textContent.includes('Loading Technical Review'));
        await page.waitForTimeout(1200); // Let WebKit finish layout after the initial route transition.
        const label = engine + (savedMobile ? '-saved-mobile' : '-selected-mobile');
        await page.screenshot({path:out+'/entry-'+label+'.png',fullPage:true});
        const layout = await page.evaluate(() => {
          const main = document.querySelector('body > main').getBoundingClientRect();
          const footer = document.querySelector('body > footer').getBoundingClientRect();
          const title = document.querySelector('.technical-review-header h1');
          const r = title.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {mainHeight:main.height,mainBottom:main.bottom,footerTop:footer.top,footerHeight:footer.height,titleUnobscured:title.contains(hit),fallbackHidden:document.querySelector('#dleMobileViewFallback').hidden};
        });
        assert(layout.mainHeight > 300, label+': content viewport collapsed '+JSON.stringify(layout));
        assert(layout.footerHeight < 60, label+': footer consumed content viewport');
        assert(layout.footerTop >= layout.mainBottom - 1, label+': footer overlaps content');
        assert(layout.titleUnobscured, label+': heading covered despite attached DOM');
        assert(layout.fallbackHidden);
        await page.evaluate(() => window.DleWorkspaces['technical-review'].openReview('RFQI-SIM-0036'));
        await page.locator('#technicalReviewDetailView:not([hidden])').waitFor();
        assert.match(await page.locator('#technicalReviewDetail').innerText(), /Completed|Complete/);
        assert.equal(await page.locator('[data-technical-review-action="add-document"]:enabled').count(),0);
        assert.deepEqual(errors, []);
        // All non-GET business API requests were blocked, including shell startup projections.
        console.log('PASS', label, 'Home click, visible queue, completed read-only detail;', JSON.stringify(layout));
        await context.close();
      }
    } finally { await browser.close(); }
  }
  stores.forEach((name,i) => assert(fs.readFileSync('.sim-state/data/'+name).equals(before[i]),name+' changed'));
})().catch(error => { console.error(error.message); process.exitCode=1; });
