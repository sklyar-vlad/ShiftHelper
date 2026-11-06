export function WorkPreview() {
  return (
    <div className="work-preview" aria-hidden="true">
      <span className="preview-stamp">Твоё время — твои правила ↗</span>
      <div className="preview-window">
        <div className="preview-top">
          <span>sh.</span>
          <strong>Дело найдётся.</strong>
          <i>↗</i>
        </div>
        <p className="preview-title">
          Хорошая работа.
          <br />
          Хорошее совпадение.
        </p>
        <div className="preview-line">
          <b>✓</b>
          <div>
            <strong>Понятные условия</strong>
            <small>Задача, место и оплата заранее</small>
          </div>
        </div>
        <div className="preview-line">
          <b>✓</b>
          <div>
            <strong>Подходящий график</strong>
            <small>От пары часов до нескольких недель</small>
          </div>
        </div>
        <div className="preview-line">
          <b>✓</b>
          <div>
            <strong>Общий результат</strong>
            <small>Подтвердите работу и оставьте отзыв</small>
          </div>
        </div>
        <div className="preview-bottom">
          <span>В твоём ритме</span>
          <strong>
            Можно начинать <i>↗</i>
          </strong>
        </div>
      </div>
      <svg className="preview-doodle" viewBox="0 0 100 100" fill="none">
        <path
          d="M8 64c21-4 11-43 32-40 26 3-21 53 7 47 15-3 26-21 34-27m-16 1 18-4-2 18"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
