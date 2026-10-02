import { describe, expect, it } from "vitest";

import { fitBrowserToolbar, TOOLBAR, toolbarMinimum } from "./toolbar";

// The audit (2026-09-30) found the address bar squeezed to 16px at the 560px
// default. The toolbar now fits at every width the panel allows the ticket
// cares about: down to a 340px panel, with the address bar at 120px or more.

const narrowFile = { backToList: true, close: true, toggle: true } as const;
const wideFile = { backToList: false, close: true, toggle: true } as const;

describe("fitBrowserToolbar", () => {
  it("fits a narrow 340px panel showing an HTML file, with 120px for the address", () => {
    expect(toolbarMinimum(narrowFile)).toBeLessThanOrEqual(340);
    const fit = fitBrowserToolbar({ ...narrowFile, width: 340 });
    // Reload and Forward are in the "…" menu; the words are in the labels.
    expect(fit).toEqual({
      device: false,
      forward: false,
      reload: false,
      staticLabel: false,
      toggleLabels: false,
    });
  });

  it("keeps Back, Forward and Reload in the row at the 560px default (a 368px main area)", () => {
    const fit = fitBrowserToolbar({ ...wideFile, width: 368 });
    expect(fit.forward).toBe(true);
    expect(fit.reload).toBe(true);
    expect(fit.toggleLabels).toBe(false);
  });

  it("brings back the words as room allows, the switch's first", () => {
    const wide = fitBrowserToolbar({ ...wideFile, width: 900 });
    expect(wide).toEqual({
      device: true,
      forward: true,
      reload: true,
      staticLabel: true,
      toggleLabels: true,
    });
    const between = fitBrowserToolbar({
      ...wideFile,
      width:
        toolbarMinimum(wideFile) +
        3 * (TOOLBAR.button + TOOLBAR.gap) +
        TOOLBAR.toggleLabels,
    });
    expect(between.toggleLabels).toBe(true);
    expect(between.staticLabel).toBe(false);
  });

  it("moves Forward before Reload", () => {
    const fit = fitBrowserToolbar({
      ...wideFile,
      width: toolbarMinimum(wideFile) + TOOLBAR.button + TOOLBAR.gap,
    });
    expect(fit.reload).toBe(true);
    expect(fit.forward).toBe(false);
  });

  it("shows everything before it's measured, as on a wide panel", () => {
    expect(fitBrowserToolbar({ ...narrowFile, width: 0 }).forward).toBe(true);
  });

  it("fits the stacked browser's Maximise (097) at the narrowest stacked panel", () => {
    // Stacked from 420px: Back, the address, the menu, Maximise and Close.
    const top = {
      backToList: false,
      close: true,
      maximise: true,
      toggle: false,
    };
    expect(toolbarMinimum(top)).toBe(
      toolbarMinimum({ ...top, maximise: false }) + TOOLBAR.button + TOOLBAR.gap
    );
    expect(toolbarMinimum(top)).toBeLessThanOrEqual(420);
    expect(fitBrowserToolbar({ ...top, width: 420 }).reload).toBe(true);
  });

  // 137: the device menu comes back after Forward, before the words.
  it("brings the device menu back after Forward", () => {
    const slot = TOOLBAR.button + TOOLBAR.gap;
    const two = fitBrowserToolbar({
      ...wideFile,
      width: toolbarMinimum(wideFile) + 2 * slot,
    });
    expect(two).toMatchObject({ device: false, forward: true, reload: true });
    const three = fitBrowserToolbar({
      ...wideFile,
      width: toolbarMinimum(wideFile) + 3 * slot,
    });
    expect(three).toMatchObject({ device: true, toggleLabels: false });
  });

  it("fits the device menu in a stacked browser at the 560px default", () => {
    const top = {
      backToList: false,
      close: true,
      maximise: true,
      toggle: false,
    };
    expect(fitBrowserToolbar({ ...top, width: 560 }).device).toBe(true);
    expect(fitBrowserToolbar({ ...top, width: 420 }).device).toBe(true);
  });
});
