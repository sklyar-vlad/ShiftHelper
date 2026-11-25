import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const handlers = new Map<string, (event?: unknown) => void>();
  const markerElement = document.createElement("div");
  const location = { lat: 56, lng: 38, wrap: () => ({ lng: 38 }) };
  const map = {
    on: vi.fn((type: string, listener: (event?: unknown) => void) => {
      handlers.set(type, listener);
    }),
    once: vi.fn((type: string, listener: () => void) => {
      handlers.set(type, listener);
    }),
    addControl: vi.fn(),
    jumpTo: vi.fn(),
    getCenter: () => location,
    getContainer: (): HTMLElement => {
      throw new Error("Map container is unavailable");
    },
    remove: vi.fn(),
  };
  const marker = {
    on: map.on,
    getElement: () => markerElement,
    getLngLat: () => location,
    setDraggable: vi.fn().mockReturnThis(),
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn(() => map.getContainer().append(markerElement)),
    remove: vi.fn(() => markerElement.remove()),
  };
  return {
    Map: vi.fn(function ({ container }: { container: HTMLElement }) {
      vi.spyOn(map, "getContainer").mockReturnValue(container);
      return map;
    }),
    Marker: vi.fn(function () {
      return marker;
    }),
    NavigationControl: function () {},
    setWorkerUrl: vi.fn(),
    handlers,
    location,
    map,
    marker,
  };
});

vi.mock("maplibre-gl", () => sdk);
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({
  default: "/worker.mjs",
}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import { PlaceMap } from "./PlaceMap";

const center = { latitude: 55, longitude: 37 };

async function finishLoading() {
  await waitFor(() => expect(sdk.handlers.has("load")).toBe(true));
  act(() => sdk.handlers.get("load")?.());
}

beforeEach(() => {
  vi.stubEnv("VITE_GEOAPIFY_TILES_PUBLIC", "test-key");
  vi.clearAllMocks();
  sdk.handlers.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("PlaceMap", () => {
  it("shows coordinates without loading the SDK if the map has no key", () => {
    vi.stubEnv("VITE_GEOAPIFY_TILES_PUBLIC", "");
    render(<PlaceMap center={center} point={center} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Карта не настроена",
    );
    expect(screen.getByText(/55\.000000, 37\.000000/)).toBeTruthy();
    expect(sdk.Map).not.toHaveBeenCalled();
  });

  it("updates the marker and supports map click, drag and keyboard-friendly selection", async () => {
    const onPointChange = vi.fn();
    const { rerender, unmount } = render(
      <PlaceMap center={center} point={center} onPointChange={onPointChange} />,
    );
    await finishLoading();
    expect(sdk.Map).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [37, 55],
        cooperativeGestures: true,
        trackResize: true,
      }),
    );
    expect(sdk.marker.setLngLat).toHaveBeenCalledWith([37, 55]);
    expect(sdk.marker.setDraggable).toHaveBeenCalledWith(true);
    act(() =>
      sdk.handlers.get("click")?.({
        lngLat: sdk.location,
        originalEvent: { target: sdk.map.getContainer() },
      }),
    );
    act(() => sdk.handlers.get("dragend")?.());
    fireEvent.click(
      screen.getByRole("button", { name: "Поставить метку в центре карты" }),
    );
    expect(onPointChange.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [{ latitude: 56, longitude: 38 }]),
    );

    rerender(
      <PlaceMap center={center} point={{ latitude: 56, longitude: 38 }} />,
    );
    expect(sdk.marker.setLngLat).toHaveBeenLastCalledWith([38, 56]);
    expect(sdk.marker.setDraggable).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole("button", { name: "Поставить метку в центре карты" }),
    ).toBeNull();
    expect(sdk.Map).toHaveBeenCalledTimes(1);
    unmount();
    expect(sdk.map.remove).toHaveBeenCalledTimes(1);
    expect(sdk.marker.remove).toHaveBeenCalledTimes(1);
  });

  it("reopens a single map when expanding or closing the dialog", async () => {
    render(<PlaceMap center={center} point={center} />);
    await finishLoading();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть карту" }));
    const dialog = await screen.findByRole("dialog", { name: "Карта места" });
    await waitFor(() => expect(sdk.Map).toHaveBeenCalledTimes(2));
    expect(sdk.map.remove).toHaveBeenCalledTimes(1);
    await finishLoading();
    expect(
      within(dialog).queryByRole("button", {
        name: "Поставить метку в центре карты",
      }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть карту" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(sdk.Map).toHaveBeenCalledTimes(3));
    expect(sdk.map.remove).toHaveBeenCalledTimes(2);
  });

  it("recenters without creating another map when the original marker is restored", async () => {
    const { rerender } = render(
      <PlaceMap center={center} point={{ latitude: 56, longitude: 38 }} />,
    );
    await finishLoading();
    sdk.map.jumpTo.mockClear();
    rerender(<PlaceMap center={center} point={center} recenter={1} />);
    expect(sdk.map.jumpTo).toHaveBeenCalledWith({ center: [37, 55], zoom: 14 });
    expect(sdk.marker.setLngLat).toHaveBeenLastCalledWith([37, 55]);
    expect(sdk.Map).toHaveBeenCalledTimes(1);
  });

  it("ignores loading that finishes after unmount", async () => {
    const { unmount } = render(<PlaceMap center={center} />);
    unmount();
    await act(async () => {
      await import("maplibre-gl");
    });
    expect(sdk.Map).not.toHaveBeenCalled();
  });

  it("handles SDK errors and can retry with the loaded SDK", async () => {
    render(<PlaceMap center={center} />);
    await finishLoading();
    await act(async () => sdk.handlers.get("error")?.());
    expect(sdk.map.remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Не удалось");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    await waitFor(() => expect(sdk.Map).toHaveBeenCalledTimes(2));
    await finishLoading();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("times out and ignores late load events", async () => {
    vi.useFakeTimers();
    render(<PlaceMap center={center} />);
    await act(async () => {
      await import("maplibre-gl");
    });
    const onLoad = sdk.handlers.get("load");
    expect(onLoad).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
      onLoad?.();
    });
    expect(screen.getByRole("status").textContent).toContain("Не удалось");
    expect(sdk.map.remove).toHaveBeenCalledTimes(1);
  });
});
