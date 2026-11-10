import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { Builder, Browser, By, Key } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import newman from "newman";

const api = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = process.env.RUN_ID;
const projectId = process.env.PROJECT_ID;
const caseIds = (process.env.TEST_CASE_IDS || "").split(",").filter(Boolean);
const source = process.env.AUTOMATION_SOURCE || "playwright";
const root = process.cwd();
if (!api || !serviceKey || !runId || !projectId || (source !== "website" && !caseIds.length)) throw new Error("Automation runner configuration is incomplete.");

async function rest(table, options = {}) {
  const { method = "GET", query = "", body, headers = {} } = options;
  const response = await fetch(`${api}/rest/v1/${table}${query}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} request failed (${response.status}): ${text.slice(0,500)}`);
  return text ? JSON.parse(text) : null;
}

async function uploadEvidence(testCase, buffer) {
  const folder = `${run.triggered_by}/${projectId}/${testCase.id}`;
  const filename = `${runId}-${Date.now()}.png`;
  const response = await fetch(`${api}/storage/v1/object/test-evidence/${folder}/${filename}`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "image/png", "x-upsert": "false" }, body: buffer,
  });
  if (!response.ok) throw new Error(`Screenshot upload failed (${response.status}): ${(await response.text()).slice(0,250)}`);
  return { path: `${folder}/${filename}`, file_name: filename, mime_type: "image/png" };
}

const resolveValue = value => String(value ?? "").replace(/\{\{env:([A-Z0-9_]+)\}\}/g, (_match,name) => {
  if (!/^E2E_[A-Z0-9_]+$/.test(name)) throw new Error(`Only E2E_ secrets can be referenced in steps (${name}).`);
  if (!process.env[name]) throw new Error(`Add the ${name} secret to the automation repository before running this test.`);
  return process.env[name];
});

async function runPlaywright(testCase, baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    for (const step of testCase.steps || []) {
      const selector = step.selector ? page.locator(step.selector) : null;
      const value = resolveValue(step.value);
      if (step.action === "goto") await page.goto(new URL(value || "/", baseUrl).href, { waitUntil: "domcontentloaded", timeout: 30000 });
      else if (step.action === "click") await selector.click({ timeout: step.timeout || 10000 });
      else if (step.action === "fill") await selector.fill(value, { timeout: step.timeout || 10000 });
      else if (step.action === "select") await selector.selectOption(value, { timeout: step.timeout || 10000 });
      else if (step.action === "check") await selector.check({ timeout: step.timeout || 10000 });
      else if (step.action === "uncheck") await selector.uncheck({ timeout: step.timeout || 10000 });
      else if (step.action === "expect_text") {
        const text = selector ? await selector.innerText({ timeout: step.timeout || 10000 }) : await page.locator("body").innerText();
        if (!text.includes(value)) throw new Error(`Expected text was not found: ${value}`);
      } else if (step.action === "expect_url") {
        const expected = new URL(value, baseUrl).pathname.replace(/\/$/, "") || "/";
        await page.waitForURL(url => (url.pathname.replace(/\/$/, "") || "/") === expected, { timeout: step.timeout || 30000 });
      } else if (step.action === "expect_visible") {
        await selector.waitFor({ state: "visible", timeout: step.timeout || 10000 });
      } else if (step.action === "wait") await page.waitForTimeout(Math.min(Number(value) || 500, 10000));
      else throw new Error(`Unsupported Playwright action: ${step.action}`);
    }
    return { passed: true, screenshot: null };
  } catch (error) {
    let screenshot = null;
    try { screenshot = await page.screenshot({ fullPage: true }); } catch { /* Keep the original execution failure. */ }
    return { passed: false, error: error.message, screenshot };
  } finally { await browser.close(); }
}

async function runSelenium(testCase, baseUrl) {
  const options = new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000");
  const driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
  try {
    for (const step of testCase.steps || []) {
      const value = resolveValue(step.value);
      const el = step.selector ? await driver.findElement(By.css(step.selector)) : null;
      if (step.action === "goto") await driver.get(new URL(value || "/", baseUrl).href);
      else if (step.action === "click") await el.click();
      else if (step.action === "fill") { await el.clear(); await el.sendKeys(value); }
      else if (step.action === "select") { await el.findElement(By.css(`option[value="${value.replaceAll('"','\\"')}"]`)).click(); }
      else if (step.action === "check") { if (!(await el.isSelected())) await el.click(); }
      else if (step.action === "uncheck") { if (await el.isSelected()) await el.click(); }
      else if (step.action === "expect_text") {
        const text = el ? await el.getText() : await (await driver.findElement(By.css("body"))).getText();
        if (!text.includes(value)) throw new Error(`Expected text was not found: ${value}`);
      } else if (step.action === "expect_url") {
        const expected = new URL(value, baseUrl).pathname.replace(/\/$/, "") || "/";
        await driver.wait(async () => {
          const actual = new URL(await driver.getCurrentUrl()).pathname.replace(/\/$/, "") || "/";
          return actual === expected;
        }, step.timeout || 30000, `Expected URL path ${expected}`);
      } else if (step.action === "expect_visible") { if (!(await el.isDisplayed())) throw new Error(`Element was not visible: ${step.selector}`); }
      else if (step.action === "wait") await new Promise(resolve => setTimeout(resolve, Math.min(Number(value)||500,10000)));
      else throw new Error(`Unsupported Selenium action: ${step.action}`);
    }
    return { passed: true, screenshot: null };
  } catch (error) {
    let screenshot=null;
    try { screenshot=Buffer.from(await driver.takeScreenshot(),"base64"); } catch { /* Keep the original execution failure. */ }
    return { passed:false,error:error.message,screenshot };
  } finally { await driver.quit(); }
}

function runNewman(testCase, baseUrl) {
  const filename = path.resolve(root, testCase.automation_file || "");
  if (!filename.startsWith(`${root}${path.sep}`) || !existsSync(filename)) throw new Error("The configured Newman collection file was not found inside this repository.");
  const collection = JSON.parse(readFileSync(filename,"utf8"));
  return new Promise(resolve => newman.run({ collection, environment: { values: [{ key: "baseUrl", value: baseUrl, enabled: true }] }, reporters: ["cli"] }, (_error, summary) => {
    if (_error) return resolve({ passed:false,error:_error.message });
    const failures=(summary?.run?.failures||[]).map(item=>item.error?.message||item.source?.name||"Assertion failed");
    resolve({passed:failures.length===0,error:failures.join("; ")||null});
  }));
}

async function scanWebsite(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const runtimeErrors = [];
  const firstPartyFailures = [];
  const thirdPartyFailures = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    const location = message.location().url;
    let sameOrigin = false;
    try { sameOrigin = !!location && new URL(location).origin === new URL(baseUrl).origin; } catch { /* Keep unattributed messages as runtime errors. */ }
    if (location && !sameOrigin) thirdPartyFailures.push(`${text} (${location})`);
    else runtimeErrors.push(text);
  });
  page.on("requestfailed", request => {
    try {
      if (new URL(request.url()).origin === new URL(baseUrl).origin) firstPartyFailures.push(`${request.url()} (${request.failure()?.errorText || "request failed"})`);
      else thirdPartyFailures.push(request.url());
    } catch { /* Ignore malformed request URLs. */ }
  });
  const checks = [];
  const add = (category, name, passed, detail, severity = "high", extra = {}) => checks.push({ category, name, passed, status: passed ? "passed" : severity === "info" ? "warning" : "failed", severity, detail, ...extra });
  try {
    const startedAt = Date.now();
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    const finalUrl = page.url();
    const origin = new URL(finalUrl).origin;
    add("Availability", "Page responds", !!response && response.status() < 400, response ? `HTTP ${response.status()} · ${finalUrl}` : "No response");

    const documentInfo = await page.evaluate(() => {
      const title = document.title.trim();
      const description = document.querySelector('meta[name="description"]')?.content?.trim() || "";
      const viewport = document.querySelector('meta[name="viewport"]')?.content || "";
      const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
      const headings = [...document.querySelectorAll("h1")].map(node => node.innerText.trim()).filter(Boolean);
      const images = [...document.images].filter(image => !image.hasAttribute("alt") || (image.alt.trim() === "" && !image.getAttribute("role")));
      const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(el => !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length;
      const links = [...new Set([...document.querySelectorAll("a[href]")].map(node => node.href))];
      const assets = [...new Set([...document.querySelectorAll("img[src],script[src],link[rel=stylesheet][href]")].map(node => node.src || node.href).filter(Boolean))];
      const nav = performance.getEntriesByType("navigation")[0];
      return { title, description, viewport, canonical, headings, missingAlt: images.length, unlabeled, links, assets, loadMs: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : 0, transferBytes: nav?.transferSize || 0 };
    });
    add("SEO", "Page has a title", !!documentInfo.title, documentInfo.title || "No page title found");
    add("SEO", "Meta description", !!documentInfo.description, documentInfo.description ? `${documentInfo.description.length} characters` : "Add a meta description", "info");
    add("SEO", "Canonical URL", !!documentInfo.canonical, documentInfo.canonical || "No canonical link found", "info");
    add("Accessibility", "Single descriptive H1", documentInfo.headings.length === 1, documentInfo.headings.length ? `${documentInfo.headings.length} H1 heading(s): ${documentInfo.headings.join(" · ")}` : "No H1 heading found", "medium");
    add("Accessibility", "Images have text alternatives", documentInfo.missingAlt === 0, documentInfo.missingAlt ? `${documentInfo.missingAlt} image(s) need an alt attribute or presentation role` : "All images have alt text or a presentation role", "medium");
    add("Accessibility", "Form controls have labels", documentInfo.unlabeled === 0, documentInfo.unlabeled ? `${documentInfo.unlabeled} form control(s) lack an accessible label` : "All detected form controls have labels", "medium");
    add("Mobile", "Mobile viewport is configured", /width\s*=\s*device-width/i.test(documentInfo.viewport), documentInfo.viewport || "No viewport meta tag found", "medium");

    const internal = documentInfo.links.filter(href => { try { return new URL(href).origin === origin; } catch { return false; } }).slice(0, 50);
    const brokenLinks = [];
    for (const href of internal) {
      try {
        let linkResponse = await page.request.get(href, { timeout: 10000, maxRedirects: 5 });
        if (linkResponse.status() === 405 || linkResponse.status() === 501) linkResponse = await page.request.get(href, { timeout: 10000, maxRedirects: 5 });
        if (linkResponse.status() >= 400) brokenLinks.push({ url: href, status: linkResponse.status() });
      } catch (error) { brokenLinks.push({ url: href, error: error.message }); }
    }
    add("Links", "Internal links respond", brokenLinks.length === 0, `Checked ${internal.length}${documentInfo.links.length > 50 ? " of " + documentInfo.links.length : ""} internal links${brokenLinks.length ? `; ${brokenLinks.length} failed` : ""}`, "high", { failures: brokenLinks.slice(0, 20) });

    const brokenAssets = [];
    for (const href of documentInfo.assets.filter(href => { try { return new URL(href).origin === origin; } catch { return false; } }).slice(0, 60)) {
      try {
        const assetResponse = await page.request.get(href, { timeout: 10000, maxRedirects: 3 });
        if (assetResponse.status() >= 400) brokenAssets.push({ url: href, status: assetResponse.status() });
      } catch (error) { brokenAssets.push({ url: href, error: error.message }); }
    }
    add("Resources", "First-party page assets load", brokenAssets.length === 0, `Checked up to 60 same-site images, scripts, and stylesheets${brokenAssets.length ? `; ${brokenAssets.length} failed` : ""}`, "medium", { failures: brokenAssets.slice(0, 20) });
    add("Runtime", "No first-party requests fail", firstPartyFailures.length === 0, firstPartyFailures.length ? firstPartyFailures.slice(0, 8).join("; ") : "No failed same-site requests detected", "medium", { failures: firstPartyFailures.slice(0, 20) });
    add("Runtime", "No browser JavaScript errors", runtimeErrors.length === 0, runtimeErrors.length ? runtimeErrors.slice(0, 8).join("; ") : "No browser errors detected", "high", { errors: runtimeErrors.slice(0, 20) });
    add("Runtime", "Third-party resource diagnostics", true, thirdPartyFailures.length ? `${thirdPartyFailures.length} third-party resource issue(s); these do not fail the site scan` : "No third-party resource errors observed", "info", { diagnostics: thirdPartyFailures.slice(0, 10) });

    const headers = response?.headers() || {};
    const securityHeaders = ["content-security-policy", "x-content-type-options", "referrer-policy"];
    const missingHeaders = securityHeaders.filter(name => !headers[name]);
    if (new URL(finalUrl).protocol === "https:" && !headers["strict-transport-security"]) missingHeaders.push("strict-transport-security");
    add("Security", "Common security headers", missingHeaders.length === 0, missingHeaders.length ? `Missing: ${missingHeaders.join(", ")}` : "CSP, content type, referrer, and HTTPS transport headers are present", "info", { headers: Object.fromEntries(securityHeaders.concat("strict-transport-security").map(name => [name, headers[name] || null])) });
    const loadMs = documentInfo.loadMs || Date.now() - startedAt;
    add("Performance", "Page load timing", loadMs < 5000, `${loadMs} ms to load event${documentInfo.transferBytes ? ` · ${(documentInfo.transferBytes / 1024).toFixed(0)} KB transferred` : ""}`, "info", { load_ms: loadMs, transfer_bytes: documentInfo.transferBytes });
  } catch (error) {
    add("Availability", "Page loads", false, error.message);
  } finally { await context.close(); await browser.close(); }
  return checks;
}

let run;
try {
  [run] = await rest("test_runs",{query:`?id=eq.${encodeURIComponent(runId)}&project_id=eq.${encodeURIComponent(projectId)}&select=*,projects(id,automation_base_url),test_results(id)`});
  if (!run) throw new Error("The selected test run is no longer available.");
  const baseUrl=run.projects?.automation_base_url;
  if (!baseUrl) throw new Error("Set the automation target URL in TestTrace workspace settings before starting a run.");
  const cases=source === "website" ? [] : await rest("test_cases",{query:`?project_id=eq.${encodeURIComponent(projectId)}&id=in.(${caseIds.map(encodeURIComponent).join(",")})&select=*`});
  if(cases.length!==caseIds.length)throw new Error("One or more selected test cases are missing.");
  await rest("test_runs",{method:"PATCH",query:`?id=eq.${encodeURIComponent(runId)}`,body:{status:"running",started_at:new Date().toISOString()},headers:{Prefer:"return=minimal"}});
  if (source === "website") {
    const checks = await scanWebsite(baseUrl);
    const passed = checks.filter(check => check.passed).length;
    const failed = checks.filter(check => !check.passed && check.severity !== "info").length;
    const warnings = checks.filter(check => !check.passed && check.severity === "info").length;
    await rest("test_results",{method:"POST",body:{run_id:runId,test_case_id:null,status:failed?"failed":"passed",error_message:failed?checks.filter(check=>!check.passed).map(check=>`${check.name}: ${check.detail}`).join(" | "):null,evidence:[]}});
    const summary={total:checks.length,passed,failed,warnings,checks};
    await rest("test_runs",{method:"PATCH",query:`?id=eq.${encodeURIComponent(runId)}`,body:{status:failed?"failed":"passed",finished_at:new Date().toISOString(),summary},headers:{Prefer:"return=minimal"}});
    if(failed)process.exitCode=1;
  } else {
  const outcomes=[];
  for(const testCase of cases){
    const started=Date.now();let outcome;
    try{
      if(testCase.automation_type!==source)throw new Error(`This case is set to ${testCase.automation_type}, not ${source}.`);
      if(source==="playwright")outcome=await runPlaywright(testCase,baseUrl);
      else if(source==="selenium")outcome=await runSelenium(testCase,baseUrl);
      else if(source==="newman")outcome=await runNewman(testCase,baseUrl);
      else throw new Error(`Unsupported automation type: ${source}`);
    }catch(error){outcome={passed:false,error:error.message,screenshot:null}}
    const evidence=outcome.screenshot?await uploadEvidence(testCase,outcome.screenshot).then(file=>[file]).catch(error=>[{upload_error:error.message}]):[];
    const result={run_id:runId,test_case_id:testCase.id,status:outcome.passed?"passed":"failed",duration_ms:Date.now()-started,error_message:outcome.error||null,evidence};
    await rest("test_results",{method:"POST",body:result});
    await rest("test_cases",{method:"PATCH",query:`?id=eq.${encodeURIComponent(testCase.id)}&project_id=eq.${encodeURIComponent(projectId)}`,body:{status:result.status},headers:{Prefer:"return=minimal"}});
    outcomes.push({id:testCase.id,status:result.status,duration_ms:result.duration_ms,error:result.error_message});
  }
  const summary={total:outcomes.length,passed:outcomes.filter(x=>x.status==="passed").length,failed:outcomes.filter(x=>x.status==="failed").length,results:outcomes};
  await rest("test_runs",{method:"PATCH",query:`?id=eq.${encodeURIComponent(runId)}`,body:{status:summary.failed?"failed":"passed",finished_at:new Date().toISOString(),summary},headers:{Prefer:"return=minimal"}});
  if(summary.failed)process.exitCode=1;
  }
}catch(error){
  console.error(error);
  if(run?.id)try{await rest("test_runs",{method:"PATCH",query:`?id=eq.${encodeURIComponent(runId)}`,body:{status:"failed",finished_at:new Date().toISOString(),summary:{error:error.message}},headers:{Prefer:"return=minimal"}})}catch(updateError){console.error("Could not store runner failure:",updateError.message)}
  process.exitCode=1;
}
