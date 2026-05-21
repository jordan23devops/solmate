import { useEffect, useMemo, useRef } from 'react'
import { buildPhotoUrl } from '../utils/places'

const SKELETON_COUNT = 3
const MAX_PLACES_SHOWN = 5

export default function PlacesPanel({
  places,
  isLoading,
  error,
  filter,
  onFilterChange,
  apiKey,
  selectedPlaceId,
  onCardClick,
  categories,
  activeCategories,
  onToggleCategory,
}) {
  const cardRefs = useRef(new Map())

  const visible = useMemo(() => {
    // Strict filter — ALL shows everything; SUN ONLY shows only inSun === true.
    const filtered =
      filter === 'sun' ? places.filter((p) => p.inSun === true) : places
    const sorted = [...filtered].sort((a, b) => {
      const aSun = a.inSun === true ? 0 : 1
      const bSun = b.inSun === true ? 0 : 1
      if (aSun !== bSun) return aSun - bSun
      return a.distanceM - b.distanceM
    })
    return sorted.slice(0, MAX_PLACES_SHOWN)
  }, [places, filter])

  useEffect(() => {
    if (!selectedPlaceId) return
    const node = cardRefs.current.get(selectedPlaceId)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedPlaceId, visible])

  return (
    <section className="places-panel" aria-label="Nearby places">
      <h3 className="places-panel__title">NEARBY PLACES</h3>

      {categories && activeCategories && (
        <div
          className="places-panel__categories"
          role="group"
          aria-label="Place categories"
        >
          {Object.entries(categories).map(([key, def]) => {
            const isOn = !!activeCategories[key]
            return (
              <button
                key={key}
                type="button"
                className={`category-toggle ${isOn ? 'category-toggle--on' : ''}`}
                aria-pressed={isOn}
                onClick={() => onToggleCategory?.(key)}
              >
                <span className="category-toggle__icon" aria-hidden="true">
                  {def.icon}
                </span>
                <span className="category-toggle__label">{def.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div
        className="places-panel__filters"
        role="group"
        aria-label="Filter places"
      >
        <button
          type="button"
          className={`places-filter ${filter === 'all' ? 'places-filter--active' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => onFilterChange('all')}
        >
          ALL
        </button>
        <button
          type="button"
          className={`places-filter ${filter === 'sun' ? 'places-filter--active' : ''}`}
          aria-pressed={filter === 'sun'}
          onClick={() => onFilterChange('sun')}
        >
          ☀️ SUN ONLY
        </button>
      </div>

      {error && (
        <p className="places-panel__error" role="alert">
          {error}
        </p>
      )}

      {isLoading && (
        <div className="places-panel__skeleton-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} className="place-card place-card--skeleton">
              <div className="place-card__thumb-wrap">
                <div className="place-card__thumb place-card__thumb--skeleton" />
              </div>
              <div className="place-card__body">
                <div className="place-card__skeleton-line place-card__skeleton-line--lg" />
                <div className="place-card__skeleton-line" />
                <div className="place-card__skeleton-line place-card__skeleton-line--sm" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && visible.length === 0 && (
        <p className="places-panel__empty">No matching places nearby.</p>
      )}

      {!isLoading &&
        visible.map((p) => {
          const photoUrl = buildPhotoUrl(p.photoName, apiKey)
          const isSelected = selectedPlaceId === p.id
          return (
            <article
              key={p.id}
              ref={(el) => {
                if (el) cardRefs.current.set(p.id, el)
                else cardRefs.current.delete(p.id)
              }}
              className={`place-card ${isSelected ? 'place-card--selected' : ''}`}
              onClick={() => onCardClick?.(p.id)}
            >
              <div className="place-card__thumb-wrap">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt=""
                    className="place-card__thumb"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                ) : (
                  <div className="place-card__thumb place-card__thumb--placeholder">
                    🍽️
                  </div>
                )}
                <span
                  className="place-card__sun"
                  aria-label={
                    p.inSun === true
                      ? 'In sun'
                      : p.inSun === false
                        ? 'In shadow'
                        : 'Unknown'
                  }
                >
                  {p.inSun === true ? '☀️' : p.inSun === false ? '🌑' : '·'}
                </span>
              </div>
              <div className="place-card__body">
                <p className="place-card__name">{p.name}</p>
                {p.rating !== null && (
                  <p className="place-card__rating">
                    ⭐ {p.rating.toFixed(1)} ({p.ratingCount})
                  </p>
                )}
                <p className="place-card__distance">
                  {Math.round(p.distanceM)} m
                </p>
                {p.isOpenNow !== null && (
                  <p
                    className={`place-card__open ${p.isOpenNow ? 'place-card__open--yes' : 'place-card__open--no'}`}
                  >
                    {p.isOpenNow ? 'Open now' : 'Closed'}
                  </p>
                )}
              </div>
              {(p.todaysHours || p.isOpenNow !== null) && (
                <div className="place-card__tooltip" role="tooltip">
                  {p.todaysHours && (
                    <p className="place-card__tooltip-hours">{p.todaysHours}</p>
                  )}
                  {p.isOpenNow !== null && (
                    <p
                      className={
                        p.isOpenNow
                          ? 'place-card__tooltip-status place-card__tooltip-status--open'
                          : 'place-card__tooltip-status place-card__tooltip-status--closed'
                      }
                    >
                      {p.isOpenNow ? 'Open now' : 'Closed'}
                    </p>
                  )}
                </div>
              )}
            </article>
          )
        })}
    </section>
  )
}
