const EARTH_RADIUS_M = 6_371_000

/**
 * Offset a lat/lng by distance (meters) along a compass bearing (degrees from north).
 */
export function offsetCoordinates(lat, lng, bearingDeg, distanceM) {
  const bearing = (bearingDeg * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180
  const angularDistance = distanceM / EARTH_RADIUS_M

  const lat2 = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const lng2 =
    lngRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2),
    )

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  }
}

/** Eight compass samples: N, NE, E, SE, S, SW, W, NW at 60 m radius. */
export function getSurroundingSamplePoints(lat, lng, radiusM = 60) {
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
  return bearings.map((bearing) => ({
    bearing,
    ...offsetCoordinates(lat, lng, bearing, radiusM),
  }))
}
