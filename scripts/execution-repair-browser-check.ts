import { expect, type Browser } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { reference } from "../src/kernel/packets.ts";
import { OfflineRasterTransport } from "./execution-fixture.ts";
import { offlineVisualProviders } from "./visual-fixture.ts";
function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((r) => (release = r));
  return { promise, release };
}
export async function checkExecutionRepairs(
  browser: Browser,
  evidence: string,
) {
  const screens: string[] = [],
    errors: string[] = [];
  let offlineSubmissions = 0,
    offlineStatusCalls = 0,
    offlineCancellationCalls = 0;
  for (const scenario of [
    "cancel",
    "revoke",
    "cancel-followup",
    "late",
    "late-storage",
  ]) {
    const root = mkdtempSync(join(tmpdir(), "bve-execution-repair-")),
      transport = new OfflineRasterTransport(),
      app = await startApp(root, 0, undefined, offlineVisualProviders, {
        executionFixture: { testOnly: true, transport },
      }),
      context = await browser.newContext({
        viewport: {
          width: scenario === "revoke" || scenario === "late" ? 390 : 1440,
          height: scenario === "revoke" || scenario === "late" ? 844 : 1000,
        },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const hold = held<void>(),
      entered = held<void>();
    const send = transport.submit.bind(transport);
    const p = app.visual.create({ title: "Offline repair " + scenario }),
      u = app.visual.exploration.createWorkUnit(p.project.id, {
        version: 1,
        pageType: "homepage",
        label: "Homepage",
        source: "Fixture",
      }),
      about = app.visual.exploration.createWorkUnit(p.project.id, {
        version: 1,
        pageType: "about",
        label: "About",
        source: "Fixture",
      });
    const count = ["cancel", "revoke"].includes(scenario) ? 6 : 1;
    if (scenario !== "cancel-followup")
      transport.submit = async (input) => {
        const ack = await send(input);
        entered.release();
        await hold.promise;
        return ack;
      };
    else {
      transport.mode = "running";
      transport.cancel = async (job) => {
        transport.cancellations.push(job);
        return { confirmed: transport.cancellations.length > 1 };
      };
    }
    const idle = async () => {
      await expect(page.locator("#visual-app")).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
    };
    const rows = () => page.locator(".execution-run");
    const row = () => rows().last();
    const state = () =>
      app.visual.executions.state(p.project.id, reference(u))[0]!;
    const shot = async (name: string) => {
      await page.screenshot({
        path: join(evidence, name + ".png"),
        fullPage: true,
      });
      screens.push(name + ".png");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    };
    try {
      await page.goto(app.origin + "/visual");
      await idle();
      await page.locator("#project").selectOption(p.project.id);
      await idle();
      await page
        .locator("#prepare [name=intent]")
        .fill("Frozen offline " + scenario);
      await page.locator("#prepare [name=count]").selectOption(String(count));
      await page.locator("#prepare [name=direction]").selectOption("fresh");
      await page.locator("#prepare button.primary").click();
      await idle();
      await page.locator("#execution-panel > summary").click();
      const spec = await page
        .locator("#execution-grant [name=spec] option")
        .last()
        .getAttribute("value");
      await page.locator("#execution-grant [name=spec]").selectOption(spec!);
      for (const [name, value] of Object.entries({
        width: 64,
        height: 48,
        submissions: count,
        status: 0,
        cancels: scenario === "cancel-followup" ? 2 : 0,
        timeout: scenario.startsWith("late") ? 5 : 10000,
        expires: 3600,
      }))
        await page
          .locator(`#execution-grant [name=${name}]`)
          .fill(String(value));
      await page.locator("#execution-grant input[type=checkbox]").check();
      await page
        .getByRole("button", { name: "Grant offline execution", exact: true })
        .click();
      await idle();
      await page
        .locator("#prepare [name=intent]")
        .fill("Retain my unsaved repair draft");
      await row()
        .getByRole("button", { name: "Execute granted slots", exact: true })
        .click();
      if (scenario === "cancel-followup") {
        await expect(row()).not.toHaveAttribute(
          "data-dispatch-pending",
          "true",
        );
        await row()
          .getByRole("button", { name: "Cancel this execution", exact: true })
          .click();
        await expect
          .poll(
            () =>
              state().run.payload.state.calls.filter((c) => c.kind === "cancel")
                .length,
          )
          .toBe(1);
        await expect(row()).toContainText("confirmation unknown");
        await expect(
          row().getByRole("button", {
            name: "Cancel this execution",
            exact: true,
          }),
        ).toBeEnabled();
        await row()
          .getByRole("button", { name: "Cancel this execution", exact: true })
          .click();
        await expect
          .poll(() => state().run.payload.state.slots[0]!.cancelConfirmed)
          .toBe(true);
        expect(transport.cancellations.length).toBe(2);
        await shot("14-cancellation-followup-desktop");
      } else {
        await entered.promise;
        if (scenario === "cancel" || scenario === "revoke") {
          await expect(row()).toHaveAttribute("data-dispatch-pending", "true");
          expect(
            await page
              .locator("#visual-app")
              .evaluate((n) => (n as HTMLElement).inert),
          ).toBe(false);
          await expect(row()).toContainText("Dispatch in progress");
          await expect(
            row().getByRole("button", {
              name: "Execute granted slots",
              exact: true,
            }),
          ).toBeDisabled();
          await app.visual.executions.execute(
            p.project.id,
            reference(state().run),
          );
          expect(transport.submissions.length).toBe(1);
          // Read-only navigation and layout changes keep project/page ownership and drafts intact.
          await page.locator("#page").selectOption(about.id + ":1");
          await idle();
          await page
            .locator("#prepare [name=intent]")
            .fill("Separate About draft");
          await page.locator("#page").selectOption(u.id + ":1");
          await idle();
          await expect(page.locator("#prepare [name=intent]")).toHaveValue(
            "Retain my unsaved repair draft",
          );
          await page.locator("#layout").selectOption("film");
          if (scenario === "cancel") {
            const cancel = row().getByRole("button", {
              name: "Cancel this execution",
              exact: true,
            });
            // Complete viewport setup before measuring the original bounded input action.
            await cancel.scrollIntoViewIfNeeded();
            await expect(cancel).toBeEnabled();
            const originalControl = await cancel.elementHandle();
            // Two actual stored-progress responses must retain the control, not merely its label.
            for (let read = 0; read < 2; read++) {
              const progress = await page.waitForResponse(response => {
                const url = new URL(response.url());
                return url.pathname === "/api/v1/visual/state" && url.searchParams.get("id") === u.id && response.ok();
              });
              await progress.finished();
              await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
              expect(await originalControl!.evaluate(node => node.isConnected)).toBe(true);
            }
            await cancel.click({ timeout: 250 });
            await expect
              .poll(() => state().run.payload.state.slots[0]!.cancelRequested)
              .toBe(true);
            expect(
              state()
                .run.payload.state.slots.slice(1)
                .every((s) => s.status === "cancelled"),
            ).toBe(true);
            await shot("12-held-cancel-desktop");
          } else {
            const button = row().getByRole("button", {
              name: "Revoke grant",
              exact: true,
            });
            await button.focus();
            await page.waitForTimeout(200);
            await expect(button).toBeFocused();
            await page.keyboard.press("Enter");
            await expect
              .poll(() => state().grant.payload.state.revoked)
              .toBe(true);
            await shot("13-held-revoke-narrow");
          }
          hold.release();
          await expect(row()).not.toHaveAttribute(
            "data-dispatch-pending",
            "true",
          );
          await expect.poll(() => state().active).toBe(false);
          expect(transport.submissions.length).toBe(1);
          await expect(page.locator("#prepare [name=intent]")).toHaveValue(
            "Retain my unsaved repair draft",
          );
          if (scenario === "cancel") {
            expect(
              app.visual.state(p.project.id, reference(u)).candidates.length,
            ).toBe(0);
            await expect(row()).toContainText("Historical raster retained");
          } else
            await expect(page.locator("#visual-notice")).toContainText(
              "revoked",
            );
        } else {
          await expect(row()).not.toHaveAttribute(
            "data-dispatch-pending",
            "true",
          );
          expect(state().run.payload.state.slots[0]!.receipt).toBeNull();
          let restore: () => void = () => {};
          if (scenario === "late-storage") {
            const save = app.workspace.assets.save.bind(app.workspace.assets);
            app.workspace.assets.save = () => {
              throw new Error("Injected received-evidence storage failure");
            };
            restore = () => {
              app.workspace.assets.save = save;
            };
          }
          hold.release();
          await app.visual.executions.waitForDeliveries();
          if (scenario === "late-storage") {
            await expect(row()).toContainText("storage failure");
            expect(state().run.payload.state.slots[0]!.receipt).toBeNull();
            await shot("15-late-storage-failure-desktop");
            restore();
            await row()
              .getByRole("button", {
                name: "Retry received evidence · no transport call",
                exact: true,
              })
              .click();
            await expect
              .poll(() => !!state().run.payload.state.slots[0]!.receipt)
              .toBe(true);
          }
          await expect(row()).toContainText(
            "Historical raster retained · not adopted",
          );
          expect(
            app.visual.state(p.project.id, reference(u)).candidates.length,
          ).toBe(0);
          expect(transport.submissions.length).toBe(1);
          expect(transport.polls.length).toBe(0);
          expect(state().run.payload.state.calls.length).toBe(1);
          await shot(
            scenario === "late"
              ? "16-delivered-late-historical-narrow"
              : "17-delivered-evidence-recovered-desktop",
          );
        }
      }
      expect(transport.polls.length).toBe(0);
      expect(errors).toEqual([]);
      offlineSubmissions += transport.submissions.length;
      offlineStatusCalls += transport.polls.length;
      offlineCancellationCalls += transport.cancellations.length;
    } finally {
      hold.release();
      await context.close();
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
  const receipt = {
    check: "v03-repairs-r12",
    candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "working-tree",
    browser: browser.version(),
    platform: process.platform,
    heldCancel: true,
    heldKeyboardRevoke: true,
    duplicateExecuteBounded: true,
    navigationDraftIsolation: true,
    cancelFollowup: true,
    deliveredAfterTimeoutHistorical: true,
    storageFailureVisibleAndExplicitRetry: true,
    noAutomaticTransportPolling: true,
    offlineSubmissions,
    offlineStatusCalls,
    offlineCancellationCalls,
    errors,
    screenshots: screens,
    actualModelCalls: 0,
    actualImageProviderCalls: 0,
  };
  writeFileSync(
    join(evidence, "execution-repairs.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
}
