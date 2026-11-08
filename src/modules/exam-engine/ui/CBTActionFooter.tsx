interface CBTActionFooterProps {
  onSaveAndNext: () => void
  onSaveAndMarkForReview: () => void
  onClearResponse: () => void
  onMarkForReviewAndNext: () => void
  onPrevious: () => void
  onNext: () => void
  onSubmit: () => void
  hasPrevious: boolean
  hasNext: boolean
  busy: boolean
}

export function CBTActionFooter({
  onSaveAndNext,
  onSaveAndMarkForReview,
  onClearResponse,
  onMarkForReviewAndNext,
  onPrevious,
  onNext,
  onSubmit,
  hasPrevious,
  hasNext,
  busy,
}: CBTActionFooterProps) {
  return (
    <footer className="cbt-action-footer">
      <div className="cbt-footer-left">
        <button
          type="button"
          className="button button-primary cbt-btn-save-next"
          onClick={onSaveAndNext}
          disabled={busy}
        >
          Save & Next
        </button>

        <button
          type="button"
          className="button button-secondary cbt-btn-save-review"
          onClick={onSaveAndMarkForReview}
          disabled={busy}
        >
          Save & Mark for Review
        </button>

        <button
          type="button"
          className="button button-secondary cbt-btn-clear"
          onClick={onClearResponse}
          disabled={busy}
        >
          Clear Response
        </button>

        <button
          type="button"
          className="button button-secondary cbt-btn-review-next"
          onClick={onMarkForReviewAndNext}
          disabled={busy}
        >
          Mark for Review & Next
        </button>
      </div>

      <div className="cbt-footer-right">
        <button
          type="button"
          className="button button-secondary cbt-nav-btn"
          onClick={onPrevious}
          disabled={!hasPrevious || busy}
        >
          &lt;&lt; Previous
        </button>

        <button
          type="button"
          className="button button-secondary cbt-nav-btn"
          onClick={onNext}
          disabled={!hasNext || busy}
        >
          Next &gt;&gt;
        </button>

        <button
          type="button"
          className="button button-primary cbt-submit-btn"
          onClick={onSubmit}
          disabled={busy}
        >
          Submit Test
        </button>
      </div>
    </footer>
  )
}
