import { useEffect, useRef, useState } from "react";
import { GigPointAttribution } from "@/entities/gig/GigPointAttribution";
import { GigPlaceWarning } from "@/entities/gig/GigPlaceWarning";
import { searchGigPlace, type GigPoint } from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { PlaceMap } from "@/shared/ui/PlaceMap";

type Point = NonNullable<GigPoint>;

export function GigPlacePicker({
  city,
  address,
  point,
  suggestedPoint,
  onChange,
}: {
  city: string;
  address: string;
  point: GigPoint;
  suggestedPoint: GigPoint;
  onChange: (point: GigPoint) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [recenter, setRecenter] = useState(0);
  const [preview, setPreview] = useState<{
    center: Point;
    draft: Point;
  } | null>(() =>
    suggestedPoint ? { center: suggestedPoint, draft: suggestedPoint } : null,
  );
  const draft = preview?.draft ?? point;
  const center = preview?.center ?? point;
  const draftReference = draft?.addressReference;
  const confirmedReference = point?.addressReference;
  const confirmed =
    draft &&
    point &&
    draft.latitude === point.latitude &&
    draft.longitude === point.longitude &&
    draft.source === point.source &&
    draft.attribution === point.attribution &&
    draftReference?.latitude === confirmedReference?.latitude &&
    draftReference?.longitude === confirmedReference?.longitude;
  const canReset =
    center &&
    draft &&
    (center.latitude !== draft.latitude ||
      center.longitude !== draft.longitude);

  useEffect(() => () => request.current?.abort(), []);

  async function search() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const matches = await searchGigPlace(
        { city: city.trim(), address: address.trim() },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const match = matches.find(({ point }) => point)?.point;
      setPreview(match ? { center: match, draft: match } : null);
      if (match) {
        setRecenter((value) => value + 1);
      } else {
        setMessage("Подходящий адрес не найден. Проверьте адрес.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(
        error instanceof ApiError && error.status > 0 && error.status < 500
          ? error.message
          : "Поиск адреса недоступен. Можно продолжить с текстовым адресом.",
      );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section className="gig-place-picker" aria-label="Место задания на карте">
      <button
        className="button button-secondary"
        type="button"
        disabled={loading || !city.trim() || !address.trim()}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // Moving focus before the click would collapse the suggestions and move this button.
          event.currentTarget.focus();
          void search();
        }}
      >
        {loading ? "Ищем адрес…" : "Показать на карте"}
      </button>
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
      {center && draft && (
        <>
          <PlaceMap
            center={center}
            point={draft}
            recenter={recenter}
            notice={<GigPlaceWarning point={draft} />}
            onPointChange={(coords) =>
              setPreview({ center, draft: { ...draft, ...coords } })
            }
          />
          {!confirmed && (
            <>
              <p className="small muted" role="status">
                Подтвердите точку, чтобы сохранить её.
              </p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => onChange(draft)}
              >
                Подтвердить точку
              </button>
            </>
          )}
          {canReset && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setPreview({ center, draft: center });
                setRecenter((value) => value + 1);
              }}
            >
              Вернуть исходную метку
            </button>
          )}
        </>
      )}
      {point && (
        <>
          <p className="small muted" role="status">
            {confirmed
              ? "Точка подтверждена. "
              : "Прежняя точка подтверждена. "}
            {point.source === "geoapify" && (
              <GigPointAttribution point={point} />
            )}
          </p>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setPreview(null);
              onChange(null);
            }}
          >
            Убрать точку
          </button>
        </>
      )}
    </section>
  );
}
