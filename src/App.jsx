import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import Map, { DEFAULT_LOCATION } from './components/Map'
import PlacesPanel from './components/PlacesPanel'
import SearchBar from './components/SearchBar'
import SunCompass from './components/SunCompass'
import { fetchNearbyPlaces, mapPlace } from './utils/places'
import {
  buildSunInfo,
  clampMinutes,
  dateAtMinutes,
  formatMinutesLabel,
  getCurrentMinutesInRange,
  getDaylightRange,
} from './utils/sunCalc'
import './App.css'

const PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY ?? ''
const PLACES_PLAYBACK_THROTTLE_MIN = 30

const PLACE_CATEGORIES = {
  cafes: {
    label: 'Cafés & bars',
    icon: '☕',
    types: ['cafe', 'bar', 'coffee_shop'],
  },
  restaurants: {
    label: 'Restaurants',
    icon: '🍽️',
    types: ['restaurant'],
  },
  parks: {
    label: 'Parks & plazas',
    icon: '🌳',
    types: ['park', 'plaza', 'tourist_attraction'],
  },
}

const METERS_PER_FLOOR = 3
const HEIGHT_MIN = 0
const HEIGHT_MAX = 100

const SUN_UPDATE_INTERVAL_MS = 60_000
const PLAY_STEP_MIN = 1
const PLAY_STEP_DELAY_MS = 33
const PLAY_HOURS_REFRESH_MIN = 15

const initialDaylight = getDaylightRange(
  DEFAULT_LOCATION.lat,
  DEFAULT_LOCATION.lng,
)

class MapErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[SunSpot] Map subtree error:', error)
    console.error('[SunSpot] Component stack:', info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="map-error" role="alert">
          <strong>Map component error</strong>
          <p>{this.state.error.message}</p>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  const [location, setLocation] = useState(DEFAULT_LOCATION)
  const [daylightRange, setDaylightRange] = useState(initialDaylight)
  const [timeMinutes, setTimeMinutes] = useState(() =>
    getCurrentMinutesInRange(
      initialDaylight.sunriseMinutes,
      initialDaylight.sunsetMinutes,
    ),
  )
  const [heightMode, setHeightMode] = useState('floor')
  const [floorCount, setFloorCount] = useState(0)
  const [metersValue, setMetersValue] = useState(3)
  const [sunInfo, setSunInfo] = useState(null)
  const [inSun, setInSun] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [mapError, setMapError] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [sunHoursSoFar, setSunHoursSoFar] = useState(0)
  const [finalSunHours, setFinalSunHours] = useState(null)

  const inSunRef = useRef(false)
  const playbackRef = useRef({ active: false, paused: false, resumeResolvers: [] })

  const [rawPlaces, setRawPlaces] = useState([])
  const [placesWithSun, setPlacesWithSun] = useState([])
  const [isPlacesLoading, setIsPlacesLoading] = useState(false)
  const [placesError, setPlacesError] = useState(null)
  const [placesFilter, setPlacesFilter] = useState('all')
  const [activeCategories, setActiveCategories] = useState({
    cafes: true,
    restaurants: false,
    parks: false,
  })

  const includedPlaceTypes = useMemo(() => {
    const out = []
    for (const [key, def] of Object.entries(PLACE_CATEGORIES)) {
      if (activeCategories[key]) out.push(...def.types)
    }
    return out
  }, [activeCategories])

  const toggleCategory = useCallback((key) => {
    setActiveCategories((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])
  const [sceneReady, setSceneReady] = useState(false)
  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [hoveredPlace, setHoveredPlace] = useState(null) // { place, x, y }
  const [searchError, setSearchError] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const raycasterRef = useRef(null)
  const lastPlacesUpdateRef = useRef(-Infinity)

  const handleShadowUpdate = useCallback((value) => {
    inSunRef.current = value
    setInSun(value)
  }, [])

  const heightMeters = useMemo(
    () =>
      heightMode === 'floor'
        ? floorCount * METERS_PER_FLOOR
        : metersValue,
    [heightMode, floorCount, metersValue],
  )

  const heightInputValue =
    heightMode === 'floor' ? floorCount : metersValue
  const heightInputLabel = heightMode === 'floor' ? 'floor' : 'm'

  const handleHeightInputChange = (event) => {
    const raw = event.target.value
    if (raw === '') {
      if (heightMode === 'floor') setFloorCount(0)
      else setMetersValue(0)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    const clamped = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, parsed))
    if (heightMode === 'floor') setFloorCount(clamped)
    else setMetersValue(clamped)
  }

  useEffect(() => {
    return () => {
      playbackRef.current.active = false
      playbackRef.current.paused = false
      const resolvers = playbackRef.current.resumeResolvers ?? []
      playbackRef.current.resumeResolvers = []
      for (const r of resolvers) r()
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      const pb = playbackRef.current
      if (!pb.active) return
      if (document.visibilityState === 'visible') {
        pb.paused = false
        const resolvers = pb.resumeResolvers ?? []
        pb.resumeResolvers = []
        for (const r of resolvers) r()
      } else {
        pb.paused = true
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Fetch places from Google when the pinned location OR category set changes.
  useEffect(() => {
    if (!location) return
    if (!PLACES_API_KEY) {
      setPlacesError('Set VITE_GOOGLE_PLACES_KEY in .env to see nearby places.')
      setRawPlaces([])
      setPlacesWithSun([])
      return
    }
    if (includedPlaceTypes.length === 0) {
      setPlacesError(null)
      setRawPlaces([])
      setPlacesWithSun([])
      setIsPlacesLoading(false)
      return
    }
    setPlacesError(null)
    setIsPlacesLoading(true)
    setRawPlaces([])
    setPlacesWithSun([])
    const controller = new AbortController()
    fetchNearbyPlaces(
      location.lat,
      location.lng,
      PLACES_API_KEY,
      controller.signal,
      includedPlaceTypes,
    )
      .then((raw) => {
        const mapped = raw
          .map((p) => mapPlace(p, location.lat, location.lng))
          .filter(Boolean)
        setRawPlaces(mapped)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        console.warn('[SunSpot] Places fetch failed:', err)
        setPlacesError(err?.message ?? 'Failed to load places.')
        setRawPlaces([])
      })
      .finally(() => {
        setIsPlacesLoading(false)
      })
    return () => controller.abort()
  }, [location, includedPlaceTypes])

  // Recompute IN SUN / IN SHADOW for each place when time or scene-ready changes.
  useEffect(() => {
    if (rawPlaces.length === 0) {
      setPlacesWithSun([])
      return
    }
    if (!sceneReady || !raycasterRef.current?.isReady?.()) {
      setPlacesWithSun(rawPlaces.map((p) => ({ ...p, inSun: null })))
      return
    }
    if (
      isPlaying &&
      Math.abs(timeMinutes - lastPlacesUpdateRef.current) <
        PLACES_PLAYBACK_THROTTLE_MIN
    ) {
      return
    }
    lastPlacesUpdateRef.current = timeMinutes
    const updated = rawPlaces.map((p) => ({
      ...p,
      inSun: raycasterRef.current?.raycastInSun?.(p.lat, p.lng, timeMinutes) ?? null,
    }))
    setPlacesWithSun(updated)
  }, [sceneReady, rawPlaces, timeMinutes, isPlaying])

  const handlePlay = useCallback(async () => {
    if (!daylightRange) return
    if (playbackRef.current.active) return

    playbackRef.current.active = true
    playbackRef.current.paused = false
    playbackRef.current.resumeResolvers = []
    setIsPlaying(true)
    setFinalSunHours(null)
    setSunHoursSoFar(0)

    const waitIfPaused = () => {
      const pb = playbackRef.current
      if (!pb.paused) return Promise.resolve()
      return new Promise((resolve) => {
        pb.resumeResolvers.push(resolve)
      })
    }

    const start =
      Math.ceil(daylightRange.sunriseMinutes / PLAY_STEP_MIN) * PLAY_STEP_MIN
    const end = daylightRange.sunsetMinutes
    let sunSlots = 0

    for (let m = start; m <= end; m += PLAY_STEP_MIN) {
      if (!playbackRef.current.active) break
      await waitIfPaused()
      if (!playbackRef.current.active) break
      setTimeMinutes(m)
      // Let the Map effect run a raycast for this step before we sample inSun.
      await new Promise((resolve) => setTimeout(resolve, PLAY_STEP_DELAY_MS))
      if (!playbackRef.current.active) break
      if (inSunRef.current) {
        sunSlots += PLAY_STEP_MIN
      }
      // Throttle the running counter so we don't slam React with 30 updates/sec.
      if (m % PLAY_HOURS_REFRESH_MIN === 0 || m === end) {
        setSunHoursSoFar(sunSlots / 60)
      }
    }

    const totalHours = sunSlots / 60
    if (playbackRef.current.active) {
      setFinalSunHours(totalHours)
    }
    playbackRef.current.active = false
    playbackRef.current.paused = false
    setIsPlaying(false)
  }, [daylightRange])

  const handleStop = useCallback(() => {
    const pb = playbackRef.current
    pb.active = false
    pb.paused = false
    const resolvers = pb.resumeResolvers ?? []
    pb.resumeResolvers = []
    for (const r of resolvers) r()
  }, [])

  const handleLocationSelect = useCallback((newLocation) => {
    const pb = playbackRef.current
    if (pb.active) {
      pb.active = false
      pb.paused = false
      const resolvers = pb.resumeResolvers ?? []
      pb.resumeResolvers = []
      for (const r of resolvers) r()
      setIsPlaying(false)
      setFinalSunHours(null)
      setSunHoursSoFar(0)
      const range = getDaylightRange(newLocation.lat, newLocation.lng)
      const now = getCurrentMinutesInRange(
        range.sunriseMinutes,
        range.sunsetMinutes,
      )
      setTimeMinutes(now)
    }
    setSelectedPlaceId(null)
    setLocation(newLocation)
  }, [])

  const handleSuggestionSelect = useCallback(
    (suggestion) => {
      if (!suggestion || !Number.isFinite(suggestion.lat) || !Number.isFinite(suggestion.lng)) {
        return
      }
      setSearchError(null)
      handleLocationSelect({
        lat: suggestion.lat,
        lng: suggestion.lng,
        cartesian: null,
      })
      raycasterRef.current?.flyTo?.(suggestion.lat, suggestion.lng)
    },
    [handleLocationSelect],
  )

  const getCameraCenter = useCallback(
    () => raycasterRef.current?.getCameraCenter?.() ?? null,
    [],
  )

  const handlePlaceMarkerClick = useCallback((placeId) => {
    setSelectedPlaceId(placeId)
  }, [])

  const handleCardClick = useCallback(
    (placeId) => {
      setSelectedPlaceId((current) => {
        if (current === placeId) return null
        const place = placesWithSun.find((p) => p.id === placeId)
        if (place) {
          raycasterRef.current?.flyTo?.(place.lat, place.lng)
        }
        return placeId
      })
    },
    [placesWithSun],
  )

  const handlePlaceMarkerHover = useCallback(
    (info) => {
      if (!info) {
        setHoveredPlace(null)
        return
      }
      const place = placesWithSun.find((p) => p.id === info.placeId)
      if (!place) {
        setHoveredPlace(null)
        return
      }
      setHoveredPlace({ place, x: info.x, y: info.y })
    },
    [placesWithSun],
  )

  const handleResetView = useCallback(() => {
    raycasterRef.current?.resetView?.()
  }, [])

  const refreshSunInfo = useCallback((lat, lng, minutes) => {
    try {
      setSunInfo(buildSunInfo(lat, lng, dateAtMinutes(minutes)))
      setMapError(null)
    } catch (error) {
      console.error('[SunSpot] Sun calculation failed:', error)
      setMapError(error.message)
    }
  }, [])

  useEffect(() => {
    if (!location) return
    const range = getDaylightRange(location.lat, location.lng)
    setDaylightRange(range)
    setTimeMinutes((prev) =>
      clampMinutes(prev, range.sunriseMinutes, range.sunsetMinutes),
    )
  }, [location])

  useEffect(() => {
    if (!location) return
    refreshSunInfo(location.lat, location.lng, timeMinutes)
  }, [location, timeMinutes, refreshSunInfo])

  useEffect(() => {
    if (!location) return

    const tick = () => {
      const range = getDaylightRange(location.lat, location.lng)
      const minutes = getCurrentMinutesInRange(
        range.sunriseMinutes,
        range.sunsetMinutes,
      )
      setDaylightRange(range)
      setTimeMinutes(minutes)
      refreshSunInfo(location.lat, location.lng, minutes)
    }

    const intervalId = setInterval(tick, SUN_UPDATE_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [location, refreshSunInfo])

  const clampedTime = Math.min(
    daylightRange.sunsetMinutes,
    Math.max(daylightRange.sunriseMinutes, timeMinutes),
  )

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1>SunSpot</h1>
          <p>Solar exposure mapping — click the map to pick a spot</p>
        </header>

        <div className="app-content">
          <aside className="sun-panel" aria-label="Sun information">
            <SearchBar
              apiKey={PLACES_API_KEY}
              getCameraCenter={getCameraCenter}
              onSelectSuggestion={handleSuggestionSelect}
              isResolving={isSearching}
              externalError={searchError}
            />
            {mapError && (
              <div className="map-error map-error--inline" role="alert">
                <strong>Warning</strong>
                <p>{mapError}</p>
              </div>
            )}
            {sunInfo && (
              <>
                <div
                  className={`sun-status ${inSun ? 'sun-status--sun' : 'sun-status--shadow'}`}
                  aria-live="polite"
                >
                  <span className="sun-status__icon" aria-hidden="true">
                    {inSun ? '☀️' : '🌑'}
                  </span>
                  <div className="sun-status__text">
                    <span className="sun-status__label">
                      {inSun ? 'IN SUN' : 'IN SHADOW'}
                    </span>
                    {statusMessage && (
                      <span className="sun-status__detail">{statusMessage}</span>
                    )}
                  </div>
                </div>

                <dl className="sun-panel__grid">
                <div className="sun-panel__row">
                  <dt>Location</dt>
                  <dd>
                    {sunInfo.lat}, {sunInfo.lng}
                  </dd>
                </div>
                <div className="sun-panel__row">
                  <dt>Height</dt>
                  <dd className="height-value">
                    <div className="height-input">
                      <input
                        type="number"
                        className="height-input__field"
                        min={HEIGHT_MIN}
                        max={HEIGHT_MAX}
                        step={heightMode === 'floor' ? 1 : 0.5}
                        value={heightInputValue}
                        onChange={handleHeightInputChange}
                        aria-label={`Height in ${heightInputLabel}`}
                      />
                      <span className="height-input__label">
                        {heightInputLabel}
                      </span>
                    </div>
                    {heightMode === 'floor' && (
                      <span className="height-input__hint">
                        (= {heightMeters}m)
                      </span>
                    )}
                  </dd>
                </div>
                <div className="sun-panel__row">
                  <dt>Sunrise</dt>
                  <dd>{sunInfo.sunrise}</dd>
                </div>
                <div className="sun-panel__row">
                  <dt>Sunset</dt>
                  <dd>{sunInfo.sunset}</dd>
                </div>
                <div className="sun-panel__row">
                  <dt>Altitude</dt>
                  <dd>{sunInfo.altitude}°</dd>
                </div>
                <div className="sun-panel__row">
                  <dt>Azimuth</dt>
                  <dd>{sunInfo.azimuth}°</dd>
                </div>
              </dl>

              <div className="height-selector" role="group" aria-label="Height unit">
                <button
                  type="button"
                  className={`height-selector__btn ${heightMode === 'floor' ? 'height-selector__btn--active' : ''}`}
                  onClick={() => setHeightMode('floor')}
                >
                  Floor
                </button>
                <button
                  type="button"
                  className={`height-selector__btn ${heightMode === 'meters' ? 'height-selector__btn--active' : ''}`}
                  onClick={() => setHeightMode('meters')}
                >
                  Meters
                </button>
              </div>

              <div className="time-slider">
                <p className="time-slider__label" aria-live="polite">
                  {formatMinutesLabel(clampedTime)}
                </p>
                <input
                  type="range"
                  className="time-slider__input"
                  min={daylightRange.sunriseMinutes}
                  max={daylightRange.sunsetMinutes}
                  step={1}
                  value={clampedTime}
                  disabled={isPlaying}
                  onChange={(e) => setTimeMinutes(Number(e.target.value))}
                  aria-label="Time of day"
                  aria-valuetext={formatMinutesLabel(clampedTime)}
                />
                <div className="time-slider__range-labels">
                  <span>{daylightRange.sunriseLabel}</span>
                  <span>{daylightRange.sunsetLabel}</span>
                </div>
                <div className="time-slider__controls">
                  <button
                    type="button"
                    className={`time-slider__play ${isPlaying ? 'time-slider__play--stop' : ''}`}
                    onClick={isPlaying ? handleStop : handlePlay}
                  >
                    {isPlaying ? '■ Stop' : '▶ Play'}
                  </button>
                  {isPlaying && (
                    <span className="time-slider__hours" aria-live="polite">
                      ☀️ {sunHoursSoFar.toFixed(2)} hrs so far…
                    </span>
                  )}
                </div>
                {finalSunHours !== null && !isPlaying && (
                  <p className="time-slider__final" aria-live="polite">
                    ☀️ {finalSunHours.toFixed(1)} hours of direct sun today
                  </p>
                )}
              </div>

                <PlacesPanel
                  places={placesWithSun}
                  isLoading={isPlacesLoading}
                  error={placesError}
                  filter={placesFilter}
                  onFilterChange={setPlacesFilter}
                  apiKey={PLACES_API_KEY}
                  selectedPlaceId={selectedPlaceId}
                  onCardClick={handleCardClick}
                  categories={PLACE_CATEGORIES}
                  activeCategories={activeCategories}
                  onToggleCategory={toggleCategory}
                />
              </>
            )}
          </aside>

          <main className="app-main">
            <MapErrorBoundary>
              <Map
                selectedLocation={location}
                heightMeters={heightMeters}
                timeMinutes={clampedTime}
                daylightRange={daylightRange}
                onLocationSelect={handleLocationSelect}
                onShadowUpdate={handleShadowUpdate}
                onStatusUpdate={({ message }) => setStatusMessage(message)}
                onMapError={(error) => setMapError(error.message)}
                raycasterRef={raycasterRef}
                onSceneReadyChange={setSceneReady}
                placesWithSun={placesWithSun}
                selectedPlaceId={selectedPlaceId}
                onPlaceMarkerClick={handlePlaceMarkerClick}
                onPlaceMarkerHover={handlePlaceMarkerHover}
              />
            </MapErrorBoundary>

            <button
              type="button"
              className="reset-view-btn"
              onClick={handleResetView}
              title="Reset view"
              aria-label="Reset view"
            >
              ⟲ Reset view
            </button>

            {hoveredPlace && (
              <div
                className="map-tooltip"
                role="tooltip"
                style={{ left: hoveredPlace.x + 14, top: hoveredPlace.y + 14 }}
              >
                <p className="map-tooltip__name">{hoveredPlace.place.name}</p>
                {hoveredPlace.place.todaysHours && (
                  <p className="map-tooltip__hours">
                    {hoveredPlace.place.todaysHours}
                  </p>
                )}
                {hoveredPlace.place.isOpenNow !== null && (
                  <p
                    className={
                      hoveredPlace.place.isOpenNow
                        ? 'map-tooltip__status map-tooltip__status--open'
                        : 'map-tooltip__status map-tooltip__status--closed'
                    }
                  >
                    {hoveredPlace.place.isOpenNow ? 'Open now' : 'Closed'}
                  </p>
                )}
              </div>
            )}

            {sunInfo && (
              <SunCompass azimuthDeg={sunInfo.azimuthDeg} />
            )}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
