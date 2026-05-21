import { useEffect, useRef, useState } from 'react'
import { fetchLocalTextSuggestions } from '../utils/places'

const DEBOUNCE_MS = 300
const MIN_CHARS = 2
const LOCAL_RADIUS_M = 2000

function getUserLocale() {
  if (typeof navigator === 'undefined') return 'en'
  return navigator.language || 'en'
}

export default function SearchBar({
  apiKey,
  getCameraCenter,
  onSelectSuggestion,
  isResolving,
  externalError,
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [localError, setLocalError] = useState(null)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)
  const blurTimerRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = query.trim()
    if (trimmed.length < MIN_CHARS || !apiKey) {
      setSuggestions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLocalError(null)
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      const center = getCameraCenter?.()
      fetchLocalTextSuggestions({
        query: trimmed,
        apiKey,
        center,
        radiusM: LOCAL_RADIUS_M,
        languageCode: getUserLocale(),
        signal: controller.signal,
      })
        .then((items) => {
          setSuggestions(items)
          setIsOpen(items.length > 0)
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          console.warn('[Solmate] Search failed:', err)
          setLocalError(err?.message ?? 'Search failed')
          setSuggestions([])
        })
        .finally(() => setIsLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [query, apiKey, getCameraCenter])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const pickSuggestion = (suggestion) => {
    setQuery(suggestion.primaryText)
    setIsOpen(false)
    setSuggestions([])
    onSelectSuggestion?.(suggestion)
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (isResolving) return
    if (suggestions[0]) pickSuggestion(suggestions[0])
  }

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => setIsOpen(false), 150)
  }

  const handleFocus = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    if (suggestions.length > 0) setIsOpen(true)
  }

  const error = externalError ?? localError

  return (
    <div className="search-bar">
      <form className="search-bar__form" onSubmit={handleSubmit} role="search">
        <input
          type="search"
          className="search-bar__input"
          placeholder="Search a place nearby…"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={isResolving}
          aria-label="Search a nearby place"
          aria-autocomplete="list"
          aria-expanded={isOpen && suggestions.length > 0}
        />
        <button
          type="submit"
          className="search-bar__btn"
          disabled={isResolving || suggestions.length === 0}
        >
          {isResolving ? '…' : 'Go'}
        </button>
      </form>

      {isOpen && suggestions.length > 0 && (
        <ul
          className="search-bar__dropdown"
          role="listbox"
          aria-label="Suggestions"
        >
          {suggestions.map((s) => (
            <li
              key={s.placeId}
              className="search-bar__option"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => {
                event.preventDefault()
                pickSuggestion(s)
              }}
            >
              <span className="search-bar__option-primary">
                {s.primaryText}
              </span>
              {s.secondaryText && (
                <span className="search-bar__option-secondary">
                  {s.secondaryText}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isLoading && query.trim().length >= MIN_CHARS && !isOpen && (
        <p className="search-bar__hint">Searching nearby…</p>
      )}

      {error && (
        <p className="search-bar__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
