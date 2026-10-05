import { expect, test, type Page } from "@playwright/test";

type Plan = { tables: Record<string, { label: string }>; guests: Record<string, { name: string }>; assignments: Record<string, unknown> };

async function plan(page: Page): Promise<Plan> {
  return page.evaluate(() => (window as unknown as { seatplanTest: { plan(): Plan } }).seatplanTest.plan());
}

async function seatPosition(page: Page, tableLabel: string, index: number) {
  const pos = await page.evaluate(
    ([label, i]) =>
      (window as unknown as { seatplanTest: { seatClientPosition(l: string, i: number): { x: number; y: number } | null } }).seatplanTest.seatClientPosition(
        label as string,
        i as number,
      ),
    [tableLabel, index],
  );
  expect(pos).not.toBeNull();
  return pos!;
}

/** Drags a guest row from the list onto a seat with real pointer events. */
async function dragGuestToSeat(page: Page, name: string, tableLabel: string, index: number) {
  const row = page.locator(`[data-guest-name="${name}"]`);
  const box = (await row.boundingBox())!;
  const target = await seatPosition(page, tableLabel, index);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
}

async function addRoundTable(page: Page) {
  await page.getByTestId("add-table").click();
  await page.getByTestId("add-round").click();
}

async function addGuest(page: Page, name: string) {
  await page.getByTestId("quick-add").fill(name);
  await page.getByTestId("quick-add").press("Enter");
  await expect(page.locator(`[data-guest-name="${name}"]`)).toBeVisible();
}

// Every test gets fresh browser contexts, so storage starts empty.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("seatplan.lang", "en"));
});

test("solo: lay out, seat guests, survive a refresh, undo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas-hint")).toBeVisible();

  await addRoundTable(page);
  await expect(page.getByTestId("inspector")).toBeVisible();
  await expect(page.getByTestId("table-label")).toHaveValue("Table 1");

  await addGuest(page, "Μαρία Παπαδοπούλου");
  await addGuest(page, "John Smith");
  await expect(page.getByTestId("seated-count")).toHaveText("0/2");

  await dragGuestToSeat(page, "Μαρία Παπαδοπούλου", "Table 1", 0);
  await expect(page.getByTestId("seated-count")).toHaveText("1/2");

  // Dropping another guest on the occupied seat swaps: Maria goes back to Unseated.
  await dragGuestToSeat(page, "John Smith", "Table 1", 0);
  await expect(page.getByTestId("seated-count")).toHaveText("1/2");
  await page.getByTestId("filter-unseated").click();
  await expect(page.getByTestId("guest-row")).toHaveCount(1);
  await expect(page.getByTestId("guest-row")).toHaveAttribute("data-guest-name", "Μαρία Παπαδοπούλου");
  await page.getByTestId("filter-all").click();

  // Autosave: a refresh loses nothing.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId("seated-count")).toHaveText("1/2");
  expect(Object.keys((await plan(page)).tables)).toHaveLength(1);

  // Undo only works on this session's own edits; make one and undo it.
  await addGuest(page, "Temp");
  await expect(page.getByTestId("seated-count")).toHaveText("1/3");
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("seated-count")).toHaveText("1/2");
});

test("shared: two browsers edit one plan and converge; view link is read-only; stop sharing", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await a.addInitScript(() => localStorage.setItem("seatplan.lang", "en"));
  await a.goto("/");
  await addRoundTable(a);
  await addGuest(a, "Ann");

  // Share: privacy notice, nickname, create links.
  await a.getByTestId("share").click();
  await expect(a.getByTestId("privacy-notice")).toBeVisible();
  await a.getByTestId("privacy-accept").check();
  await a.getByTestId("nickname").fill("Alice");
  await a.getByTestId("create-share").click();
  const editLink = await a.getByTestId("edit-link").inputValue();
  await expect(a.getByTestId("view-link")).toBeVisible();
  const viewLink = await a.getByTestId("view-link").inputValue();
  expect(editLink).toContain("#/r/");
  expect(viewLink).toContain("/view/");
  await a.keyboard.press("Escape");

  // Second browser opens the edit link.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await b.addInitScript(() => localStorage.setItem("seatplan.lang", "en"));
  await b.goto(editLink);
  await b.getByTestId("join-nickname").fill("Bob");
  await b.getByTestId("join-nickname-save").click();
  await expect(b.locator('[data-guest-name="Ann"]')).toBeVisible();
  await expect(a.getByTestId("online-avatar")).toHaveCount(1);

  // B edits, A sees it; A seats a guest, B sees the counter change.
  await addGuest(b, "Bob's friend");
  await expect(a.locator(`[data-guest-name="Bob's friend"]`)).toBeVisible();
  await dragGuestToSeat(a, "Ann", "Table 1", 2);
  await expect(b.getByTestId("seated-count")).toHaveText("1/2");

  // View-only link: no editing controls, and the plan is visible.
  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  await c.addInitScript(() => {
    localStorage.setItem("seatplan.lang", "en");
    localStorage.setItem("seatplan.user", JSON.stringify({ name: "Venue", color: "#123456" }));
  });
  await c.goto(viewLink);
  await expect(c.getByTestId("banner-view")).toBeVisible();
  await expect(c.getByTestId("seated-count")).toHaveText("1/2");
  await expect(c.getByTestId("quick-add")).toHaveCount(0);
  await expect(c.getByTestId("add-table")).toHaveCount(0);

  // Stop sharing: the room is deleted and B is told; A keeps the local copy.
  a.on("dialog", (d) => d.accept());
  await a.getByTestId("share").click();
  await a.getByTestId("stop-share").click();
  await expect(b.getByTestId("banner-gone")).toBeVisible();
  await expect(a.getByTestId("seated-count")).toHaveText("1/2");

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
