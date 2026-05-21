const PLACES_NEARBY_URL =
  'https://places.googleapis.com/v1/places:searchNearby'
const PLACES_TEXT_URL =
  'https://places.googleapis.com/v1/places:searchText'
const PLACES_AUTOCOMPLETE_URL =
  'https://places.googleapis.com/v1/places:autocomplete'
const PLACE_DETAILS_URL = (id) =>
  `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`
const PLACES_RADIUS_M = 300
const DEFAULT_PLACES_TYPES = ['cafe', 'restaurant', 'bar']
const PLACES_MAX_RESULT = 20
const PHOTO_SIZE_PX = 120

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours.openNow',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.currentOpeningHours.openNow',
  'places.photos',
].join(',')

const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat'

function todaysHoursFromDescriptions(weekdayDescriptions) {
  if (!Array.isArray(weekdayDescriptions) || weekdayDescriptions.length === 0) {
    return null
  }
  const jsDay = new Date().getDay() // 0 = Sunday
  // Google returns Monday-first; map Sun(0)→6, Mon(1)→0, … Sat(6)→5.
  const idx = (jsDay + 6) % 7
  const line = weekdayDescriptions[idx]
  if (!line) return null
  const match = line.match(/^[^:]+:\s*(.+)$/)
  return match ? match[1].trim() : line
}

export function haversineDistanceM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function fetchNearbyPlaces(
  lat,
  lng,
  apiKey,
  signal,
  includedTypes = DEFAULT_PLACES_TYPES,
) {
  if (!apiKey) throw new Error('Missing VITE_GOOGLE_PLACES_KEY')
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) return []
  const response = await fetch(PLACES_NEARBY_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: PLACES_RADIUS_M,
        },
      },
      maxResultCount: PLACES_MAX_RESULT,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Places API ${response.status}: ${text || response.statusText}`)
  }
  const data = await response.json()
  return Array.isArray(data.places) ? data.places : []
}

export function mapPlace(raw, originLat, originLng) {
  const lat = raw.location?.latitude
  const lng = raw.location?.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const isOpenNow =
    raw.currentOpeningHours?.openNow ??
    raw.regularOpeningHours?.openNow ??
    null

  return {
    id: raw.id ?? `${lat}_${lng}`,
    name: raw.displayName?.text ?? 'Unknown',
    address: raw.formattedAddress ?? '',
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    ratingCount:
      typeof raw.userRatingCount === 'number' ? raw.userRatingCount : 0,
    lat,
    lng,
    distanceM: haversineDistanceM(originLat, originLng, lat, lng),
    isOpenNow,
    todaysHours: todaysHoursFromDescriptions(
      raw.regularOpeningHours?.weekdayDescriptions,
    ),
    photoName: raw.photos?.[0]?.name ?? null,
    inSun: null,
  }
}

export function buildPhotoUrl(photoName, apiKey, size = PHOTO_SIZE_PX) {
  if (!photoName || !apiKey) return null
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${size}&maxWidthPx=${size}&key=${apiKey}`
}

export async function fetchLocalTextSuggestions({
  query,
  apiKey,
  center,
  radiusM = 2000,
  languageCode,
  signal,
}) {
  if (!apiKey) throw new Error('Missing VITE_GOOGLE_PLACES_KEY')
  const trimmed = query?.trim()
  if (!trimmed || trimmed.length < 2) return []
  if (
    !center ||
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng)
  ) {
    return []
  }

  const body = {
    textQuery: trimmed,
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: radiusM,
      },
    },
  }
  if (languageCode) body.languageCode = languageCode

  const response = await fetch(PLACES_TEXT_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Search text ${response.status}: ${text || response.statusText}`,
    )
  }
  const data = await response.json()
  return (data.places ?? [])
    .map((place) => {
      const lat = place.location?.latitude
      const lng = place.location?.longitude
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return {
        placeId: place.id,
        primaryText: place.displayName?.text ?? trimmed,
        secondaryText: place.formattedAddress ?? '',
        lat,
        lng,
      }
    })
    .filter(Boolean)
}

export async function fetchPlaceAutocomplete(query, apiKey, signal) {
  if (!apiKey) throw new Error('Missing VITE_GOOGLE_PLACES_KEY')
  const trimmed = query?.trim()
  if (!trimmed || trimmed.length < 2) return []
  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
    },
    body: JSON.stringify({ input: trimmed }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Autocomplete ${response.status}: ${text || response.statusText}`,
    )
  }
  const data = await response.json()
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 5)
    .map((p) => ({
      placeId: p.placeId,
      primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      fullText: p.text?.text ?? '',
    }))
}

export async function fetchPlaceDetails(placeId, apiKey, signal) {
  if (!apiKey) throw new Error('Missing VITE_GOOGLE_PLACES_KEY')
  if (!placeId) return null
  const response = await fetch(PLACE_DETAILS_URL(placeId), {
    signal,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
    },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Place details ${response.status}: ${text || response.statusText}`,
    )
  }
  const data = await response.json()
  const lat = data.location?.latitude
  const lng = data.location?.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    id: data.id,
    name: data.displayName?.text ?? '',
    address: data.formattedAddress ?? '',
    lat,
    lng,
  }
}

export async function searchPlaceByText(query, apiKey, signal) {
  if (!apiKey) throw new Error('Missing VITE_GOOGLE_PLACES_KEY')
  const trimmed = query?.trim()
  if (!trimmed) return null
  const response = await fetch(PLACES_TEXT_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({ textQuery: trimmed, maxResultCount: 1 }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Text search ${response.status}: ${text || response.statusText}`)
  }
  const data = await response.json()
  const place = data.places?.[0]
  const lat = place?.location?.latitude
  const lng = place?.location?.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    id: place.id,
    name: place.displayName?.text ?? trimmed,
    address: place.formattedAddress ?? '',
    lat,
    lng,
  }
}
