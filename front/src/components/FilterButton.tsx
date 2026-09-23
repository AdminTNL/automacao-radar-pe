interface FilterButtonProps {
  activeCount: number
  onClick: () => void
}

export default function FilterButton({ activeCount, onClick }: FilterButtonProps) {
  return (
    <button
      type="button"
      className="filter-btn"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={activeCount > 0 ? `Filtros (${activeCount} ativos)` : 'Filtros'}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
    </button>
  )
}
