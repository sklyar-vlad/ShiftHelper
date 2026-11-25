import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { LngLat, Map as MapInstance, Marker } from "maplibre-gl";
import { Button } from "react-aria-components/Button";
import { Dialog, DialogTrigger } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import "./place-map.css";

type Coordinates = { latitude: number; longitude: number };

type PlaceMapProps = {
  center: Coordinates;
  point?: Coordinates | null;
  zoom?: number;
  recenter?: number;
  onPointChange?: (point: Coordinates) => void;
};

async function loadMapLibre() {
  const [sdk, worker] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  sdk.setWorkerUrl(worker.default);
  return sdk;
}

let mapLibre: ReturnType<typeof loadMapLibre> | undefined;
const timeoutMs = 12_000;

function coordinates(location: LngLat): Coordinates {
  return {
    latitude: Math.max(-90, Math.min(90, location.lat)),
    longitude: location.wrap().lng,
  };
}

export function PlaceMap(props: PlaceMapProps) {
  const [expanded, setExpanded] = useState(false);
  const apiKey = import.meta.env.VITE_GEOAPIFY_TILES_PUBLIC?.trim();
  return (
    <section className="place-map" aria-label="Карта места">
      {expanded ? (
        <div className="place-map-frame" aria-hidden="true" />
      ) : (
        <PlaceMapView {...props} apiKey={apiKey} />
      )}
      {apiKey && (
        <DialogTrigger isOpen={expanded} onOpenChange={setExpanded}>
          <Button className="text-button">Развернуть карту</Button>
          <ModalOverlay className="place-map-overlay" isDismissable>
            <Modal className="place-map-modal">
              <Dialog className="place-map place-map-dialog">
                <header className="place-map-dialog-header">
                  <Heading level={2} slot="title">
                    Карта места
                  </Heading>
                  <Button
                    slot="close"
                    className="button button-secondary"
                    autoFocus
                  >
                    Закрыть карту
                  </Button>
                </header>
                <PlaceMapView {...props} apiKey={apiKey} />
                {props.onPointChange && (
                  <p className="small muted">
                    Закройте карту, чтобы подтвердить точку в форме.
                  </p>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </DialogTrigger>
      )}
    </section>
  );
}

function PlaceMapView({
  apiKey,
  center,
  point,
  zoom = 14,
  recenter = 0,
  onPointChange,
}: PlaceMapProps & { apiKey?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<{ map: MapInstance; marker: Marker }>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  const latitude = center.latitude;
  const longitude = center.longitude;
  const pointLatitude = point?.latitude;
  const pointLongitude = point?.longitude;
  const editable = !!onPointChange;

  const createOptions = useEffectEvent(() => ({
    center: [longitude, latitude] as [number, number],
    zoom,
  }));
  const choosePoint = useEffectEvent((location: LngLat) => {
    onPointChange?.(coordinates(location));
  });

  useEffect(() => {
    const element = container.current;
    if (!apiKey || !element) return;

    let active = true;
    let disposed = false;
    let release: (() => void) | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      active = false;
      window.clearTimeout(timer);
      instance.current = null;
      release?.();
    };
    const fail = () => {
      if (!active) return;
      active = false;
      setStatus("failed");
      // Let MapLibre finish dispatching the error before removing the map.
      queueMicrotask(dispose);
    };
    const timer = window.setTimeout(fail, timeoutMs);
    mapLibre ??= loadMapLibre().catch((error: unknown) => {
      mapLibre = undefined;
      throw error;
    });
    void mapLibre
      .then(({ Map, Marker, NavigationControl }) => {
        if (!active) return;
        const map = new Map({
          ...createOptions(),
          container: element,
          style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${encodeURIComponent(apiKey)}`,
          attributionControl: { compact: false },
          trackResize: true,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          renderWorldCopies: false,
          locale: {
            "CooperativeGesturesHandler.WindowsHelpText":
              "Удерживайте Ctrl, чтобы изменить масштаб",
            "CooperativeGesturesHandler.MacHelpText":
              "Удерживайте ⌘, чтобы изменить масштаб",
            "CooperativeGesturesHandler.MobileHelpText":
              "Двигайте карту двумя пальцами",
            "NavigationControl.ZoomIn": "Приблизить",
            "NavigationControl.ZoomOut": "Отдалить",
          },
        });
        release = () => map.remove();
        const marker = new Marker({ color: "#007c54" });
        release = () => {
          marker.remove();
          map.remove();
        };
        map.on("error", fail);
        map.on("webglcontextlost", fail);
        map.once("load", () => {
          if (!active) return;
          window.clearTimeout(timer);
          instance.current = { map, marker };
          setStatus("ready");
        });
        map.on("click", ({ lngLat, originalEvent }) => {
          if (
            active &&
            instance.current &&
            !(
              originalEvent.target instanceof Node &&
              marker.getElement().contains(originalEvent.target)
            )
          ) {
            choosePoint(lngLat);
          }
        });
        marker.on("dragend", () => {
          if (active) choosePoint(marker.getLngLat());
        });
        map.addControl(new NavigationControl({ showCompass: false }));
      })
      .catch(fail);

    return dispose;
  }, [apiKey, attempt]);

  useEffect(() => {
    instance.current?.map.jumpTo({ center: [longitude, latitude], zoom });
  }, [latitude, longitude, recenter, status, zoom]);

  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    const { map, marker } = current;
    if (pointLatitude === undefined || pointLongitude === undefined) {
      marker.remove();
      return;
    }
    marker.setDraggable(editable).setLngLat([pointLongitude, pointLatitude]);
    if (!map.getContainer().contains(marker.getElement())) marker.addTo(map);
    marker
      .getElement()
      .setAttribute(
        "aria-label",
        editable ? "Метка места, перемещается стрелками" : "Метка места",
      );
  }, [editable, pointLatitude, pointLongitude, status]);

  return (
    <>
      <div className="place-map-frame">
        <div
          ref={container}
          className="place-map-canvas"
          inert={!apiKey || status !== "ready"}
        />
        {(!apiKey || status !== "ready") && (
          <div className="place-map-status">
            <p role="status">
              {!apiKey
                ? "Карта не настроена. Можно использовать текстовый адрес."
                : status === "loading"
                  ? "Загружаем карту…"
                  : "Не удалось загрузить карту. Можно использовать текстовый адрес."}
            </p>
            {apiKey && status === "failed" && (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setStatus("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                Повторить загрузку
              </button>
            )}
          </div>
        )}
      </div>
      {editable && apiKey && status === "ready" && (
        <>
          <p className="small muted">Переместите метку к нужному месту.</p>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              const map = instance.current?.map;
              if (map) onPointChange(coordinates(map.getCenter()));
            }}
          >
            Поставить метку в центре карты
          </button>
        </>
      )}
      {point && (
        <p className="small muted">
          Координаты: {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
        </p>
      )}
    </>
  );
}
