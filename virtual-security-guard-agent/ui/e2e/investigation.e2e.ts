// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Operator flows on the scripted mock Argus + VSS. Assertions use camera
 * names and accessible roles, never clock times (they depend on the timezone).
 */

async function search(page: Page, text = "Find a person in a blue jacket") {
  await page.goto("/argus");
  await page.getByRole("textbox", { name: "Message Argus" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  const grid = page.getByRole("region", { name: "Potential matches" }).last();
  await expect(grid.getByRole("article")).toHaveCount(6);
  return grid;
}

async function confirm(grid: Locator, ...refs: string[]) {
  for (const ref of refs)
    await grid
      .getByRole("article", { name: new RegExp(`^Match ${ref} `) })
      .getByRole("button", { name: "Confirm" })
      .click();
}

/** A grid that can no longer be reviewed: no verdict buttons, no Save. */
async function expectLocked(grid: Locator) {
  await expect(grid.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
  await expect(
    grid.getByRole("button", { name: /Save|None match|Update review/ }),
  ).toHaveCount(0);
}

const caseFile = (page: Page) =>
  page.getByRole("complementary", { name: "Case file" });

test("review: confirmed sightings become the time-ordered route", async ({
  page,
}) => {
  const grid = await search(page);
  await confirm(grid, "m1", "m3");
  await grid.getByRole("button", { name: "Save 2 confirmed" }).click();

  await expect(
    page.getByText(
      "Review sent. Confirmed m1, m3. Marked m2, m4, m5, m6 as false positives.",
    ),
  ).toBeVisible();
  // A sent review is final: the grid is read-only.
  await expectLocked(grid);

  // m3 (External Lift foyer) happened before m1 (Main Entry).
  const stops = caseFile(page)
    .getByRole("list")
    .filter({ hasText: "P_Lev_4_Main_Entry_ip_54" })
    .getByRole("listitem");
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText("P_Lev_4_External_Lift_foyer_ip_70");
  await expect(stops.nth(1)).toContainText("P_Lev_4_Main_Entry_ip_54");
});

test("review: only the latest grid can be changed", async ({ page }) => {
  const first = await search(page);
  await confirm(first, "m1");
  await first.getByRole("button", { name: "Save 1 confirmed" }).click();
  await expectLocked(first);

  await page
    .getByRole("textbox", { name: "Message Argus" })
    .fill("Find a person in a blue jacket near the lifts");
  await page.getByRole("button", { name: "Send" }).click();
  const grids = page.getByRole("region", { name: "Potential matches" });
  await expect(grids).toHaveCount(2);
  const latest = grids.last();
  await expect(latest.getByRole("article")).toHaveCount(6);

  // The earlier grid is read-only and keeps what was sent.
  const earlier = grids.first();
  await expect(earlier.getByRole("button", { name: "Confirmed" })).toHaveCount(
    0,
  );
  await expect(earlier.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(earlier.getByText("Confirmed", { exact: true })).toHaveCount(1);
  await expect(
    earlier.getByRole("button", { name: /Review sent|Save/ }),
  ).toHaveCount(0);
  // The latest grid starts with the sighting already on the route.
  await expect(
    latest
      .getByRole("article", { name: /^Match m1 / })
      .getByRole("button", { name: "Confirmed" }),
  ).toBeVisible();
});

test("review: a new search locks an unsent grid (ITEP-98128)", async ({
  page,
}) => {
  const first = await search(page);
  await confirm(first, "m1");

  await page
    .getByRole("textbox", { name: "Message Argus" })
    .fill("Find a person in a blue jacket near the lifts");
  await page.getByRole("button", { name: "Send" }).click();
  // Locked as soon as the new search is sent, not when its grid arrives.
  await expectLocked(first);
  await expect(
    first.getByText("Earlier search. Only the latest results can be reviewed."),
  ).toBeVisible();

  const grids = page.getByRole("region", { name: "Potential matches" });
  await expect(grids).toHaveCount(2);
  await expect(grids.last().getByRole("article")).toHaveCount(6);
  await expectLocked(grids.first());
  // The unsent tick never reached Argus.
  await expect(page.getByText(/^Review sent\./)).toHaveCount(0);
});

test("review: none match shows a retry hint and sends nothing", async ({
  page,
}) => {
  const grid = await search(page);
  await grid.getByRole("button", { name: "None match" }).click();
  await expect(grid.getByRole("status")).toContainText("None match.");
  await grid.getByRole("button", { name: "Refine in chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Argus" }),
  ).toBeFocused();
  await expect(page.getByText(/^Review sent\./)).toHaveCount(0);
});

test("live search: a timeline of sightings, confirm one onto the route, stop, reload", async ({
  page,
}) => {
  // The mock watch adds a live sighting on every poll when random >= 0.5.
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  const grid = await search(page);
  await confirm(grid, "m1");
  await grid.getByRole("button", { name: "Save 1 confirmed" }).click();

  const live = page.getByRole("region", {
    name: "Confirmed route and live search",
  });
  await expect(live).toContainText("1 confirmed stop");
  await live.getByRole("button", { name: "Start live camera search" }).click();
  const watch = live.getByRole("group", { name: "Live camera search" });
  await expect(watch).toContainText(/Starting|Searching/);

  const timeline = live.getByRole("list", { name: "Live sightings" });
  const sighting = timeline.getByRole("listitem").first();
  await expect(sighting).toBeVisible({ timeout: 15_000 });
  await expect(sighting).toContainText("New");
  await expect(sighting).toContainText(/\d+ detections?/);
  await sighting.getByRole("button", { name: "Confirm" }).click();
  await expect(live).toContainText("2 confirmed stops");

  await live.getByRole("button", { name: "Stop live search" }).click();
  await expect(watch).toContainText(
    /Live search ended · \d+ sightings?, 1 added to route/,
  );
  await expect(
    live.getByRole("button", { name: "Search again" }),
  ).toBeVisible();
  // The timeline is kept, collapsed and read-only; the route keeps the stop.
  await expect(live).toContainText("2 confirmed stops");
  await expect(timeline).toHaveCount(0);
  await live.getByRole("button", { name: "Show timeline" }).click();
  await expect(timeline.getByText("On route")).toBeVisible();
  await expect(timeline.getByRole("button", { name: "Confirm" })).toHaveCount(
    0,
  );

  // The timeline is saved in this browser under the Hermes session id.
  const saved = await page.evaluate(
    () => localStorage.getItem("vsg.live-timeline.v1") ?? "",
  );
  expect(saved).toContain('"confirmed":true');

  // Reopening the investigation restores the timeline and its route stop.
  await page.getByRole("button", { name: "New" }).click();
  await expect(live).toHaveCount(0);
  await page.getByRole("button", { name: "History" }).click();
  await page
    .getByRole("button", { name: /^Find a person in a blue jacket/ })
    .click();
  await expect(live).toContainText(
    /Live search · \d+ sightings?, 1 added to route/,
  );
  await expect(live).toContainText("2 confirmed stops");
});

test("report: Argus drafts a report and Reports lists it for download", async ({
  page,
}) => {
  const grid = await search(page);
  await confirm(grid, "m1");
  await grid.getByRole("button", { name: "Save 1 confirmed" }).click();
  const route = page.getByRole("region", {
    name: "Confirmed route and live search",
  });
  await route.getByRole("button", { name: "Generate report" }).click();
  await page.getByRole("menuitem", { name: "Handover report" }).click();
  // The operator sees one line; the sighting list sent to Argus is collapsed.
  await expect(
    page.getByText("Write a handover report from the 1 confirmed sighting."),
  ).toBeVisible();
  await expect(page.getByText("Details")).toBeVisible();

  const draft = page.getByRole("region", { name: "Incident report draft" });
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: "Generate PDF" }).click();
  await expect(
    draft.getByRole("button", { name: "Regenerate PDF" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  // Read back from the Hermes transcript, next to the seeded past report.
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Find a person in a blue jacket" });
  await expect(row).toContainText(
    "Person in blue jacket, Level 4 walk-through",
  );
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "Download PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
});

test("resume: a past investigation restores its reviewed grid", async ({
  page,
}) => {
  await page.goto("/argus");
  await page.getByRole("button", { name: "History" }).click();
  await page
    .getByRole("button", { name: /^Person in blue jacket, Level 4/ })
    .click();

  const grid = page.getByRole("region", { name: "Potential matches" }).first();
  // Sent, so read-only: the confirm shows as text, not a toggle.
  await expect(
    grid
      .getByRole("article", { name: /^Match m1 / })
      .getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await expectLocked(grid);
  await expect(
    page.getByRole("region", { name: "Incident report draft" }),
  ).toBeVisible();
});

test("floorplan: a live camera takes its plan key as name and tag", async ({
  page,
}) => {
  await page.goto("/floorplan");
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "small.floorplan.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        cameras: {
          P_Lev_4_Main_Entry_ip_54: { x: 100, y: 100, zone: "Main Entry" },
          P_Lev_4_New_Door_ip_9: { x: 300, y: 100, zone: "Back Office" },
        },
      }),
    ),
  });
  await expect(page.getByText("11 VSS cameras not on plan")).toBeVisible();

  await page
    .getByRole("button", { name: /^P_Lev_4_New_Door_ip_9/ })
    .press("Enter");
  const panel = page.getByRole("complementary");
  await expect(panel.getByText("Back Office")).toBeVisible();
  await expect(panel.getByText("P_Lev_4_New_Door_ip_9")).toBeVisible();
  await panel.getByRole("button", { name: "Add live camera here" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name")).toHaveCount(0);
  await dialog.getByLabel("RTSP URL").fill("rtsp://10.0.0.9:8554/new-door");
  await dialog.getByRole("button", { name: "Add camera" }).click();
  await expect(page.getByText("Added P_Lev_4_New_Door_ip_9")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Add live camera here" }),
  ).toHaveCount(0);
});

test("cameras: Add camera is disabled once every plan camera is live", async ({
  page,
}) => {
  await page.goto("/cameras");
  await expect(page.getByRole("button", { name: "Add camera" })).toBeEnabled();
  await page.getByRole("link", { name: "Floorplan" }).click();
  // The only plan camera already has a mock live stream.
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "full.floorplan.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        cameras: {
          P_Lev_4_Entry_Way_ip_107: { x: 100, y: 100, zone: "Entry" },
        },
      }),
    ),
  });
  await page.getByRole("link", { name: "Live cameras" }).click();
  await expect(page.getByRole("button", { name: "Add camera" })).toBeDisabled();
});

test("reports: Open in Argus opens that investigation, not the current one", async ({
  page,
}) => {
  await search(page);
  await expect(page).toHaveURL(/session=/);
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Person in blue jacket, Level 4" })
    .filter({ hasNotText: "Find a person" })
    .getByRole("button", { name: "Open in Argus" })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Investigation transcript" })
      .getByText("Find a person in a blue jacket on Level 4"),
  ).toBeVisible();
  await expect(page).toHaveURL(/session=mock_session_past/);
});
