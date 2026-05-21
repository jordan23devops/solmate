import { offsetCoordinates } from './samplePoints'

export const GRID_SPACING_M = 20
export const TIME_INTERVAL_MIN = 15
export const MAX_GRID_POINTS = 25

export function minutesToTimeKey(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function timeKeyToDisplay(key) {
  const [hStr, mStr] = key.split(':')
  const h24 = Number(hStr)
  const m = Number(mStr)
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export function snapMinutesToInterval(minutes, interval = TIME_INTERVAL_MIN) {
  return Math.round(minutes / interval) * interval
}

export function generateTimeSlots(sunriseMinutes, sunsetMinutes) {
  const slots = []
  const start =
    Math.ceil(sunriseMinutes / TIME_INTERVAL_MIN) * TIME_INTERVAL_MIN

  for (let m = start; m <= sunsetMinutes; m += TIME_INTERVAL_MIN) {
    slots.push({
      key: minutesToTimeKey(m),
      minutes: m,
    })
  }

  return slots
}

export function offsetEastNorth(lat, lng, eastM, northM) {
  if (eastM === 0 && northM === 0) {
    return { lat, lng }
  }
  const bearing = (Math.atan2(eastM, northM) * 180) / Math.PI
  const distance = Math.hypot(eastM, northM)
  return offsetCoordinates(lat, lng, bearing, distance)
}

function buildGrid(centerLat, centerLng, radiusM, gridSpacingM) {
  const steps = Math.max(0, Math.ceil(radiusM / gridSpacingM))
  const sideLen = 2 * steps + 1
  if (!Number.isFinite(sideLen) || sideLen <= 0 || sideLen > 256) {
    return []
  }

  const points = []
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const east = i * gridSpacingM
      const north = j * gridSpacingM
      if (east * east + north * north > radiusM * radiusM) continue

      const { lat, lng } = offsetEastNorth(centerLat, centerLng, east, north)
      points.push({ lat, lng, east, north })
    }
  }
  return points
}

/**
 * Grid points within radiusM of center, capped at MAX_GRID_POINTS.
 * If the initial spacing would produce more than the cap, spacing
 * is increased automatically until the count fits.
 */
export function generateShadowGridPoints(
  centerLat,
  centerLng,
  radiusM,
  gridSpacingM = GRID_SPACING_M,
) {
  let spacing = Math.max(1, gridSpacingM)
  let points = buildGrid(centerLat, centerLng, radiusM, spacing)

  let guard = 0
  while (points.length > MAX_GRID_POINTS && guard < 20) {
    spacing = spacing * 1.5
    if (spacing > radiusM * 2) break
    points = buildGrid(centerLat, centerLng, radiusM, spacing)
    guard++
  }

  if (points.length > MAX_GRID_POINTS) {
    points = points.slice(0, MAX_GRID_POINTS)
  }

  return points
}

export function countShadowGridPoints(radiusM, gridSpacingM = GRID_SPACING_M) {
  return generateShadowGridPoints(0, 0, radiusM, gridSpacingM).length
}
