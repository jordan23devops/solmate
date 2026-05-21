import SunCalc from 'suncalc'

const FALLBACK_START = 6 * 60
const FALLBACK_END = 21 * 60

function formatTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '—'
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function getSunTimes(date, lat, lng) {
  return SunCalc.getTimes(date, lat, lng)
}

export function getSunPosition(date, lat, lng) {
  return SunCalc.getPosition(date, lat, lng)
}

export function getSunAltitudeAzimuth(date, lat, lng) {
  const { altitude, azimuth } = getSunPosition(date, lat, lng)
  return {
    altitudeDeg: (altitude * 180) / Math.PI,
    azimuthDeg: ((azimuth * 180) / Math.PI + 180) % 360,
  }
}

export function dateToMinutes(date) {
  return date.getHours() * 60 + date.getMinutes()
}

export function dateAtMinutes(minutes, baseDate = new Date()) {
  const date = new Date(baseDate)
  date.setHours(0, 0, 0, 0)
  date.setMinutes(minutes)
  return date
}

export function formatMinutesLabel(minutes) {
  const hours24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`
}

export function getDaylightRange(lat, lng, baseDate = new Date()) {
  const safeLat = toNumber(lat)
  const safeLng = toNumber(lng)

  if (safeLat === null || safeLng === null) {
    return {
      sunriseMinutes: FALLBACK_START,
      sunsetMinutes: FALLBACK_END,
      sunriseLabel: formatMinutesLabel(FALLBACK_START),
      sunsetLabel: formatMinutesLabel(FALLBACK_END),
    }
  }

  const times = getSunTimes(baseDate, safeLat, safeLng)
  const sunrise = times.sunrise
  const sunset = times.sunset

  if (
    !(sunrise instanceof Date) ||
    !(sunset instanceof Date) ||
    Number.isNaN(sunrise.getTime()) ||
    Number.isNaN(sunset.getTime()) ||
    sunset <= sunrise
  ) {
    return {
      sunriseMinutes: FALLBACK_START,
      sunsetMinutes: FALLBACK_END,
      sunriseLabel: formatMinutesLabel(FALLBACK_START),
      sunsetLabel: formatMinutesLabel(FALLBACK_END),
    }
  }

  return {
    sunriseMinutes: dateToMinutes(sunrise),
    sunsetMinutes: dateToMinutes(sunset),
    sunriseLabel: formatTime(sunrise),
    sunsetLabel: formatTime(sunset),
  }
}

export function clampMinutes(minutes, min, max) {
  return Math.min(max, Math.max(min, minutes))
}

export function getCurrentMinutesInRange(sunriseMinutes, sunsetMinutes) {
  const now = dateToMinutes(new Date())
  return clampMinutes(now, sunriseMinutes, sunsetMinutes)
}

export function buildSunInfo(lat, lng, date = new Date()) {
  const safeLat = toNumber(lat)
  const safeLng = toNumber(lng)

  if (safeLat === null || safeLng === null) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`)
  }

  const times = getSunTimes(date, safeLat, safeLng)
  const position = getSunAltitudeAzimuth(date, safeLat, safeLng)
  const altitudeDeg = position.altitudeDeg

  return {
    lat: safeLat.toFixed(4),
    lng: safeLng.toFixed(4),
    sunrise: formatTime(times.sunrise),
    sunset: formatTime(times.sunset),
    altitude: Number.isFinite(altitudeDeg) ? altitudeDeg.toFixed(1) : '—',
    azimuth: Number.isFinite(position.azimuthDeg)
      ? position.azimuthDeg.toFixed(1)
      : '—',
    altitudeDeg,
    azimuthDeg: position.azimuthDeg,
  }
}
