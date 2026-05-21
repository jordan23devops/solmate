/**
 * Build a unit vector pointing toward the sun in ECEF (fixed frame),
 * from SunCalc-style altitude (deg above horizon) and azimuth (deg clockwise from north).
 * Returns null if the ellipsoid is unavailable or conversion fails.
 */
export function sunDirectionECEF(lng, lat, altitudeDeg, azimuthDeg, ellipsoid) {
  try {
    const Cesium = window.Cesium
    const ellipsoidToUse = ellipsoid ?? Cesium.Ellipsoid?.WGS84
    if (!ellipsoidToUse) return null

    const origin = Cesium.Cartesian3.fromDegrees(lng, lat, 0, ellipsoidToUse)
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(
      origin,
      ellipsoidToUse,
    )

    const altRad = Cesium.Math.toRadians(altitudeDeg)
    const azRad = Cesium.Math.toRadians(azimuthDeg)

    const local = new Cesium.Cartesian3(
      Math.sin(azRad) * Math.cos(altRad),
      Math.cos(azRad) * Math.cos(altRad),
      Math.sin(altRad),
    )

    const world = Cesium.Matrix4.multiplyByPointAsVector(
      transform,
      local,
      new Cesium.Cartesian3(),
    )

    return Cesium.Cartesian3.normalize(world, world)
  } catch (error) {
    console.warn('[Solmate] sunDirectionECEF failed:', error)
    return null
  }
}

export function pointFromDegrees(lng, lat, heightMeters, ellipsoid) {
  try {
    const Cesium = window.Cesium
    const ellipsoidToUse = ellipsoid ?? Cesium.Ellipsoid?.WGS84
    if (!ellipsoidToUse) return null
    return Cesium.Cartesian3.fromDegrees(
      lng,
      lat,
      heightMeters,
      ellipsoidToUse,
    )
  } catch (error) {
    console.warn('[Solmate] pointFromDegrees failed:', error)
    return null
  }
}

export function offsetAlongDirection(origin, direction, distanceMeters) {
  try {
    const Cesium = window.Cesium
    const scaled = Cesium.Cartesian3.multiplyByScalar(
      direction,
      distanceMeters,
      new Cesium.Cartesian3(),
    )
    return Cesium.Cartesian3.add(origin, scaled, new Cesium.Cartesian3())
  } catch (error) {
    console.warn('[Solmate] offsetAlongDirection failed:', error)
    return null
  }
}
