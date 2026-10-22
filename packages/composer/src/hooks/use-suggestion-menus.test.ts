import { act, renderHook } from "@testing-library/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../options";
import { keepWhileLoading, useSuggestionMenus } from "./use-suggestion-menus";

const NEW_FILE: MenuItem = { command: "new-file", kind: "command" };
const OPEN: MenuItem = { command: "open", kind: "command" };

/** The props TipTap hands a renderer, reduced to what the menus read. */
const props = (
  query: string,
  items: MenuItem[],
  {
    command = () => undefined,
    loading = false,
  }: {
    readonly command?: (item: MenuItem) => void;
    readonly loading?: boolean;
  } = {}
) =>
  ({
    command,
    items,
    loading,
    query,
  }) as unknown as SuggestionProps<MenuItem, MenuItem>;

const enter = () =>
  ({
    event: new KeyboardEvent("keydown", { key: "Enter" }),
  }) as never;

describe("keepWhileLoading", () => {
  it("passes loaded lists through and keeps the last one while loading", () => {
    const seen: SuggestionProps<MenuItem, MenuItem>[] = [];
    const render = keepWhileLoading<MenuItem, MenuItem>((each) =>
      seen.push(each)
    );
    render(props("", [], { loading: true }));
    expect(seen).toHaveLength(0);
    render(props("", [NEW_FILE, OPEN]));
    render(props("n", [], { loading: true }));
    expect(seen.map((each) => [each.query, each.items])).toEqual([
      ["", [NEW_FILE, OPEN]],
      ["n", [NEW_FILE, OPEN]],
    ]);
    render.reset();
    render(props("x", [], { loading: true }));
    expect(seen).toHaveLength(2);
  });
});

describe("useSuggestionMenus", () => {
  it("chooses on Enter while the next query's items are loading", () => {
    const { result } = renderHook(() => useSuggestionMenus());
    const renderer = result.current.renderer();
    const chosen = vi.fn();

    act(() => {
      renderer.onStart(props("new-fil", [NEW_FILE]));
    });
    expect(result.current.menu?.items).toEqual([NEW_FILE]);

    // One more character: TipTap reports the query with no items first.
    act(() => {
      renderer.onUpdate(
        props("new-file", [], { command: chosen, loading: true })
      );
    });
    expect(result.current.isOpen()).toBe(true);
    expect(result.current.menu?.items).toEqual([NEW_FILE]);

    let handled = false;
    act(() => {
      handled = renderer.onKeyDown(enter());
    });
    expect(handled).toBe(true);
    // With the new range, so the whole `/new-file` is replaced.
    expect(chosen).toHaveBeenCalledWith(NEW_FILE);
  });

  it("closes when the loaded list is empty, and starts over after exit", () => {
    const { result } = renderHook(() => useSuggestionMenus());
    const renderer = result.current.renderer();
    act(() => {
      renderer.onStart(props("", [NEW_FILE, OPEN]));
      renderer.onUpdate(props("zz", []));
    });
    expect(result.current.isOpen()).toBe(false);

    act(() => {
      renderer.onExit();
      renderer.onStart(props("", [], { loading: true }));
    });
    expect(result.current.menu).toBeNull();
  });

  it("refilters the active query when the lists change, until exit", () => {
    const { result } = renderHook(() => useSuggestionMenus());
    const renderer = result.current.renderer();
    const sources = (items: readonly MenuItem[]) => (query: string) =>
      items.filter(
        (item) => item.kind === "command" && item.command.startsWith(query)
      );

    // `/op` matched nothing when it was typed, so nothing shows.
    act(() => {
      renderer.onStart(props("op", []));
    });
    expect(result.current.menu).toBeNull();

    // The host's list changes with no keystroke in between.
    act(() => {
      result.current.refresh(sources([NEW_FILE, OPEN]));
    });
    expect(result.current.menu?.items).toEqual([OPEN]);

    // A later loading update still keeps the refreshed list.
    act(() => {
      renderer.onUpdate(props("ope", [], { loading: true }));
    });
    expect(result.current.menu?.items).toEqual([OPEN]);

    act(() => {
      renderer.onExit();
      result.current.refresh(sources([NEW_FILE, OPEN]));
    });
    expect(result.current.menu).toBeNull();
  });
});
