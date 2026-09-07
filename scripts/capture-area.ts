import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const PORTAL_URL = "https://data.stats.gov.cn/dg/website/page.html";
const ESDATA_PATH = "/dg/website/publicrelease/web/external/stream/esData";
const DEFAULT_PROVINCE = "广东省";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function jsonValue(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const province = option("province") ?? DEFAULT_PROVINCE;
const defaultOutput = resolve(
  import.meta.dir,
  "../captures",
  `area-${province}-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
const outputPath = resolve(option("out") ?? defaultOutput);

let settleCapture: ((value: unknown) => void) | undefined;
let rejectCapture: ((reason: Error) => void) | undefined;
const capturePromise = new Promise<unknown>((resolveCapture, rejectCapturePromise) => {
  settleCapture = resolveCapture;
  rejectCapture = rejectCapturePromise;
});

const browser = await chromium.launch({
  channel: option("channel") ?? "chrome",
  headless: option("headed") !== "true",
});

try {
  const page = await browser.newPage({ locale: "zh-CN" });

  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "POST" || !request.url().includes(ESDATA_PATH)) return;

    const requestText = request.postData();
    if (!requestText?.includes(province)) return;

    try {
      const responseText = await response.text();
      settleCapture?.({
        capturedAt: new Date().toISOString(),
        pageUrl: page.url(),
        request: {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          body: jsonValue(requestText),
        },
        response: {
          status: response.status(),
          headers: response.headers(),
          body: jsonValue(responseText),
        },
      });
    } catch (error) {
      rejectCapture?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  // Some third-party page assets keep Chromium's normal load milestones open.
  // Commit is enough; the menu wait below is the real readiness signal.
  await page.goto(PORTAL_URL, { waitUntil: "commit", timeout: 60_000 });
  await page.getByRole("menuitem", { name: /地区数据/ }).waitFor({ timeout: 60_000 });

  const announcementClose = page.getByRole("button", { name: "×" });
  if (await announcementClose.isVisible().catch(() => false)) {
    await announcementClose.click({ force: true });
  }

  // The navigation entries are JavaScript handlers, not links.
  await page.getByRole("menuitem", { name: /地区数据/ }).click();
  await page.getByRole("menuitem", { name: "分省季度数据", exact: true }).click();
  await page.waitForURL(/#\/pc\/national\/fsQuarterData$/, { timeout: 30_000 });

  await page.getByRole("treeitem", { name: /指标/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("treeitem", { name: /国民经济核算/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("treeitem", { name: /地区生产总值/ }).click();
  // Let the default Beijing query settle before asking for another province.
  await page.waitForTimeout(1_500);

  // The first `请选择` input is the province picker; the second is the period.
  await page.getByPlaceholder("请选择").first().click();
  await page.getByText(province, { exact: true }).click();

  let captureTimeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    captureTimeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${province} esData response`)),
      60_000,
    );
  });
  const capture = await Promise.race([capturePromise, timeoutPromise]);
  if (captureTimeout !== undefined) clearTimeout(captureTimeout);

  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${JSON.stringify(capture, null, 2)}\n`);
  console.log(outputPath);
} finally {
  await browser.close();
}
