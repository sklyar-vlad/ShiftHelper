import { useGigCategories } from "@/entities/gig/GigCategory";
import type { CategoryCode } from "@/shared/api/generated/api";

export function SpecialtyFields({
  value,
  onChange,
  error,
}: {
  value: CategoryCode[];
  onChange: (value: CategoryCode[]) => void;
  error?: string;
}) {
  const categories = useGigCategories();
  return (
    <fieldset
      className="specialty-fields"
      aria-describedby="specialty-count specialty-error"
    >
      <legend>Специализации</legend>
      <p id="specialty-count" className="small muted" role="status">
        Выбрано {value.length} из 5
      </p>
      {categories.isPending ? (
        <p role="status">Загружаем направления…</p>
      ) : categories.isError ? (
        <>
          <p role="alert">Не удалось загрузить направления.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void categories.refetch()}
          >
            Загрузить направления снова
          </button>
        </>
      ) : (
        <div className="specialty-options">
          {categories.data.map(({ code, name }) => {
            const selected = value.includes(code);
            return (
              <label key={code} className="specialty-option">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!selected && value.length >= 5}
                  onChange={() =>
                    onChange(
                      selected
                        ? value.filter((item) => item !== code)
                        : [...value, code],
                    )
                  }
                />
                {name}
              </label>
            );
          })}
        </div>
      )}
      {value.length > 0 && (
        <button
          type="button"
          className="text-link"
          onClick={() => onChange([])}
        >
          Очистить специализации
        </button>
      )}
      <p
        id="specialty-error"
        className="field-error"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
    </fieldset>
  );
}
