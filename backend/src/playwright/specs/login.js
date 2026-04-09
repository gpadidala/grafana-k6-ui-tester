// login.js — Verify Grafana login form, authenticate, confirm session
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Test 1: Login form renders
  const t1 = Date.now();
  try {
    await page.goto(`${grafanaUrl}/login`, { waitUntil: 'load', timeout: 30000 });
    const userInput = page.locator('input[name="user"]');
    const passInput = page.locator('input[name="password"]');
    const submitBtn = page.locator('button[type="submit"]');
    const formVisible = await userInput.isVisible({ timeout: 5000 })
      && await passInput.isVisible({ timeout: 2000 })
      && await submitBtn.isVisible({ timeout: 2000 });
    results.push({ name: 'Login form renders', status: formVisible ? 'PASS' : 'FAIL',
      detail: formVisible ? 'User, password, and submit visible' : 'Form elements missing', ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Login form renders', status: 'FAIL', detail: e.message, ms: Date.now() - t1 });
  }

  // Test 2: Login with admin/admin
  const t2 = Date.now();
  try {
    await page.fill('input[name="user"]', 'admin');
    await page.fill('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    // Skip change-password prompt if shown
    try {
      const skip = page.locator('a[href*="skip"], button:has-text("Skip")');
      if (await skip.isVisible({ timeout: 3000 })) await skip.click();
    } catch {}
    const url = page.url();
    const redirected = !url.includes('/login');
    results.push({ name: 'Login succeeds and redirects', status: redirected ? 'PASS' : 'FAIL',
      detail: `Redirected to ${url}`, ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Login succeeds and redirects', status: 'FAIL', detail: e.message, ms: Date.now() - t2 });
  }

  // Test 3: Session valid
  const t3 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/user`);
    const ok = res.ok();
    results.push({ name: 'Session is authenticated', status: ok ? 'PASS' : 'FAIL',
      detail: ok ? 'GET /api/user returned 200' : `Status ${res.status()}`, ms: Date.now() - t3 });
  } catch (e) {
    results.push({ name: 'Session is authenticated', status: 'FAIL', detail: e.message, ms: Date.now() - t3 });
  }

  return results;
};
