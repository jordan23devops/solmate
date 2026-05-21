import { useEffect, useRef, useState } from 'react'
import { setInitialCameraView, setupCameraHeightLimits } from '../cesium/camera'
import { waitForSceneReady } from '../cesium/sceneReady'
import {
  computeSunExposure,
  liftAlongNormal,
} from '../utils/shadowRaycast'
import {
  dateAtMinutes,
  getSunAltitudeAzimuth,
} from '../utils/sunCalc'

export const DEFAULT_LOCATION = {
  lat: -34.5875,
  lng: -58.393,
  cartesian: null,
}

const GOOGLE_PHOTOREALISTIC_3D_TILES = 2275207

const PIN_PATH =
  '<path d="M16 44 C16 44 2 25 2 14.5 C2 6.5 8.5 1 16 1 C23.5 1 30 6.5 30 14.5 C30 25 16 44 16 44 Z"' +
  ' stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>'

function pinDataUrl(fill) {
  return `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">' +
      PIN_PATH.replace('<path ', `<path fill="${fill}" `) +
      '</svg>',
  )}`
}
const PIN_ORANGE = pinDataUrl('#F0A500')
const PIN_YELLOW = pinDataUrl('#FFEB3B')

const SUN_RAY_LENGTH_M = 150
const SUN_RAY_COLOR_CSS = '#FFEB3B'
const RAY_ALPHA_SUN = 0.85
const RAY_ALPHA_SHADOW = 0.45

const PLACE_MARKER_PREFIX = 'solmate-place-'

const PLACE_MARKER_DEFAULT_SIZE = 28
const PLACE_MARKER_SELECTED_SIZE = 40

function placeMarkerImage(inSun, isSelected) {
  const fill = inSun === true ? '#FFEB3B' : '#888899'
  const stroke = inSun === true ? '#FFB300' : '#3d3d5c'
  if (isSelected) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">' +
      '<circle cx="20" cy="20" r="17" fill="none" stroke="#F0A500" stroke-width="3" opacity="0.95"/>' +
      `<circle cx="20" cy="20" r="11" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
      '</svg>'
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">' +
    `<circle cx="14" cy="14" r="11" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function pickGroundCoordinates(viewer, screenPosition) {
  const { Cesium } = window
  const scene = viewer.scene
  const ellipsoid = scene.globe?.ellipsoid
  if (!ellipsoid) return null

  let clickedPosition = null

  if (typeof scene.pickPosition === 'function') {
    try {
      const picked = scene.pickPosition(screenPosition)
      if (
        picked &&
        Number.isFinite(picked.x) &&
        Number.isFinite(picked.y) &&
        Number.isFinite(picked.z)
      ) {
        clickedPosition = Cesium.Cartesian3.clone(picked)
      }
    } catch {
      clickedPosition = null
    }
  }

  if (!clickedPosition) {
    clickedPosition = viewer.camera.pickEllipsoid(screenPosition, ellipsoid)
  }

  if (!clickedPosition) return null

  const carto = Cesium.Cartographic.fromCartesian(clickedPosition)
  return {
    cartesian: clickedPosition,
    lat: Cesium.Math.toDegrees(carto.latitude),
    lng: Cesium.Math.toDegrees(carto.longitude),
  }
}

function buildDefaultCartesian(viewer, lat, lng) {
  const { Cesium } = window
  const ellipsoid = viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84
  let h = 0
  try {
    const carto = Cesium.Cartographic.fromDegrees(lng, lat)
    if (typeof viewer.scene.sampleHeight === 'function') {
      const sampled = viewer.scene.sampleHeight(carto)
      if (Number.isFinite(sampled)) h = sampled
    }
  } catch {
    h = 0
  }
  return Cesium.Cartesian3.fromDegrees(lng, lat, h, ellipsoid)
}

/**
 * Build all Solmate marker entities using CallbackProperty so every visual
 * tracks the same animRef state in real time (the single source of truth).
 */
function createMarkerEntities(viewer, animRef) {
  const Cesium = window.Cesium

  const animatedTop = () => {
    const a = animRef.current
    if (!a.groundCartesian) return undefined
    return liftAlongNormal(a.groundCartesian, a.currentHeight)
  }

  const sunRayEnd = () => {
    const a = animRef.current
    if (!a.groundCartesian || !a.sunDirection) return undefined
    const start = liftAlongNormal(a.groundCartesian, a.currentHeight)
    const offset = Cesium.Cartesian3.multiplyByScalar(
      a.sunDirection,
      SUN_RAY_LENGTH_M,
      new Cesium.Cartesian3(),
    )
    return Cesium.Cartesian3.add(start, offset, new Cesium.Cartesian3())
  }

  viewer.entities.add({
    id: 'solmate-ground',
    position: new Cesium.CallbackProperty(
      () => animRef.current.groundCartesian ?? undefined,
      false,
    ),
    point: {
      pixelSize: 8,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  viewer.entities.add({
    id: 'solmate-height-line',
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const a = animRef.current
        if (!a.groundCartesian) return undefined
        return [a.groundCartesian, liftAlongNormal(a.groundCartesian, a.currentHeight)]
      }, false),
      width: 2,
      material: Cesium.Color.WHITE.withAlpha(0.7),
      arcType: Cesium.ArcType.NONE,
    },
  })

  viewer.entities.add({
    id: 'solmate-pin-glow',
    position: new Cesium.CallbackProperty(animatedTop, false),
    point: {
      pixelSize: new Cesium.CallbackProperty(() => {
        if (!animRef.current.inSun) return 0
        const t = Date.now() / 220
        return 38 + Math.sin(t) * 10
      }, false),
      color: Cesium.Color.fromCssColorString(SUN_RAY_COLOR_CSS).withAlpha(0.45),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  viewer.entities.add({
    id: 'solmate-pin',
    position: new Cesium.CallbackProperty(animatedTop, false),
    billboard: {
      image: PIN_ORANGE,
      width: 32,
      height: 44,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  viewer.entities.add({
    id: 'solmate-sun-ray',
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const a = animRef.current
        if (!a.groundCartesian || !a.sunDirection) return undefined
        return [liftAlongNormal(a.groundCartesian, a.currentHeight), sunRayEnd()]
      }, false),
      width: 4,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const alpha = animRef.current.inSun ? RAY_ALPHA_SUN : RAY_ALPHA_SHADOW
          return Cesium.Color.fromCssColorString(SUN_RAY_COLOR_CSS).withAlpha(
            alpha,
          )
        }, false),
      ),
      arcType: Cesium.ArcType.NONE,
    },
  })

  viewer.entities.add({
    id: 'solmate-sun-dot',
    position: new Cesium.CallbackProperty(sunRayEnd, false),
    point: {
      pixelSize: 18,
      color: Cesium.Color.fromCssColorString(SUN_RAY_COLOR_CSS),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })
}

export default function Map({
  selectedLocation,
  heightMeters,
  timeMinutes,
  daylightRange,
  onLocationSelect,
  onShadowUpdate,
  onStatusUpdate,
  onMapError,
  raycasterRef,
  onSceneReadyChange,
  placesWithSun,
  selectedPlaceId,
  onPlaceMarkerClick,
  onPlaceMarkerHover,
}) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const tilesetRef = useRef(null)
  const computeGenRef = useRef(0)
  const handlerRef = useRef(null)
  const cameraListenerRef = useRef(null)
  const sceneReadyRef = useRef(false)
  const sceneReadyFiredRef = useRef(false)
  // Plain object, not `new Map()` — the file's default export is named `Map`,
  // which shadows the built-in class inside this module scope.
  const placeEntitiesRef = useRef({})
  const onPlaceMarkerClickRef = useRef(onPlaceMarkerClick)
  const onPlaceMarkerHoverRef = useRef(onPlaceMarkerHover)
  const animRef = useRef({
    groundCartesian: null,
    currentHeight: heightMeters ?? 3,
    targetHeight: heightMeters ?? 3,
    inSun: false,
    sunDirection: null,
    rafId: null,
    firstSet: true,
  })
  const onLocationSelectRef = useRef(onLocationSelect)
  const onShadowUpdateRef = useRef(onShadowUpdate)
  const onStatusUpdateRef = useRef(onStatusUpdate)
  const onMapErrorRef = useRef(onMapError)
  const onSceneReadyChangeRef = useRef(onSceneReadyChange)
  const [viewerReady, setViewerReady] = useState(false)
  const [initError, setInitError] = useState(null)

  useEffect(() => {
    onLocationSelectRef.current = onLocationSelect
  }, [onLocationSelect])
  useEffect(() => {
    onShadowUpdateRef.current = onShadowUpdate
  }, [onShadowUpdate])
  useEffect(() => {
    onStatusUpdateRef.current = onStatusUpdate
  }, [onStatusUpdate])
  useEffect(() => {
    onMapErrorRef.current = onMapError
  }, [onMapError])
  useEffect(() => {
    onSceneReadyChangeRef.current = onSceneReadyChange
  }, [onSceneReadyChange])
  useEffect(() => {
    onPlaceMarkerClickRef.current = onPlaceMarkerClick
  }, [onPlaceMarkerClick])
  useEffect(() => {
    onPlaceMarkerHoverRef.current = onPlaceMarkerHover
  }, [onPlaceMarkerHover])

  useEffect(() => {
    if (!viewerReady || !raycasterRef) return
    raycasterRef.current = {
      isReady: () => sceneReadyRef.current,
      getCameraCenter: () => {
        const viewer = viewerRef.current
        if (!viewer) return null
        const Cesium = window.Cesium
        const scene = viewer.scene
        try {
          const ray = viewer.camera.getPickRay(
            new Cesium.Cartesian2(
              scene.canvas.clientWidth / 2,
              scene.canvas.clientHeight / 2,
            ),
          )
          if (ray) {
            const hit = scene.globe?.pick(ray, scene)
            if (hit) {
              const carto = Cesium.Cartographic.fromCartesian(hit)
              return {
                lat: Cesium.Math.toDegrees(carto.latitude),
                lng: Cesium.Math.toDegrees(carto.longitude),
              }
            }
          }
        } catch {
          // fall through to fallback
        }
        const cartoPos = viewer.camera.positionCartographic
        if (!cartoPos) return null
        return {
          lat: Cesium.Math.toDegrees(cartoPos.latitude),
          lng: Cesium.Math.toDegrees(cartoPos.longitude),
        }
      },
      resetView: () => {
        const viewer = viewerRef.current
        if (!viewer) return
        setInitialCameraView(viewer)
        viewer.scene.requestRender()
      },
      flyTo: (lat, lng) => {
        const viewer = viewerRef.current
        if (!viewer) return
        const Cesium = window.Cesium
        const currentCarto = viewer.camera.positionCartographic
        const altitude = currentCarto?.height ?? 1500
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
          orientation: {
            pitch: viewer.camera.pitch,
            heading: viewer.camera.heading,
          },
          duration: 1.2,
        })
      },
      raycastInSun: (lat, lng, tm) => {
        const viewer = viewerRef.current
        if (!viewer || !sceneReadyRef.current) return null
        const Cesium = window.Cesium
        const ellipsoid = viewer.scene.globe.ellipsoid
        let surfaceH = 0
        try {
          const carto = Cesium.Cartographic.fromDegrees(lng, lat)
          if (typeof viewer.scene.sampleHeight === 'function') {
            const sampled = viewer.scene.sampleHeight(carto)
            if (Number.isFinite(sampled)) surfaceH = sampled
          }
        } catch {
          surfaceH = 0
        }
        const origin = Cesium.Cartesian3.fromDegrees(
          lng,
          lat,
          surfaceH + 0.5,
          ellipsoid,
        )
        const date = dateAtMinutes(tm)
        const { altitudeDeg, azimuthDeg } = getSunAltitudeAzimuth(
          date,
          lat,
          lng,
        )
        if (!Number.isFinite(altitudeDeg) || altitudeDeg <= 0) return false
        const { inSun } = computeSunExposure(
          viewer,
          origin,
          lat,
          lng,
          altitudeDeg,
          azimuthDeg,
        )
        return inSun
      },
    }
    return () => {
      if (raycasterRef) raycasterRef.current = null
    }
  }, [viewerReady, raycasterRef])

  const startHeightTween = () => {
    if (animRef.current.rafId != null) return
    const step = () => {
      const a = animRef.current
      const diff = a.targetHeight - a.currentHeight
      if (Math.abs(diff) < 0.02) {
        a.currentHeight = a.targetHeight
        a.rafId = null
        viewerRef.current?.scene.requestRender()
        return
      }
      a.currentHeight += diff * 0.22
      viewerRef.current?.scene.requestRender()
      a.rafId = requestAnimationFrame(step)
    }
    animRef.current.rafId = requestAnimationFrame(step)
  }

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return
    if (typeof window.Cesium === 'undefined') {
      const message = 'CesiumJS failed to load from CDN.'
      setInitError(message)
      onMapErrorRef.current?.(new Error(message))
      return
    }

    let cancelled = false

    const initViewer = async () => {
      try {
        const { Cesium } = window
        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          baseLayerPicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          requestRenderMode: false,
          terrain: Cesium.Terrain.fromWorldTerrain(),
        })

        if (cancelled) {
          viewer.destroy()
          return
        }

        viewerRef.current = viewer
        viewer.scene.globe.depthTestAgainstTerrain = true
        viewer.scene.pickTranslucentDepth = true
        setInitialCameraView(viewer)
        cameraListenerRef.current = setupCameraHeightLimits(viewer)

        // Camera controls: left-drag pan (default), right-drag orbit/rotate,
        // wheel + pinch zoom. Tilt and look stay enabled with their defaults.
        const cam = viewer.scene.screenSpaceCameraController
        cam.enableRotate = true
        cam.enableTilt = true
        cam.enableLook = true
        cam.rotateEventTypes = [Cesium.CameraEventType.RIGHT_DRAG]
        cam.zoomEventTypes = [
          Cesium.CameraEventType.WHEEL,
          Cesium.CameraEventType.PINCH,
        ]

        const buildings = await Cesium.Cesium3DTileset.fromIonAssetId(
          GOOGLE_PHOTOREALISTIC_3D_TILES,
        )
        if (cancelled) {
          viewer.destroy()
          return
        }
        viewer.scene.primitives.add(buildings)
        tilesetRef.current = buildings

        createMarkerEntities(viewer, animRef)

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
        handler.setInputAction((click) => {
          const picked = viewer.scene.pick(click.position)
          const entityId = picked?.id?.id
          if (
            typeof entityId === 'string' &&
            entityId.startsWith(PLACE_MARKER_PREFIX)
          ) {
            const placeId = entityId.slice(PLACE_MARKER_PREFIX.length)
            onPlaceMarkerClickRef.current?.(placeId)
            return
          }
          const result = pickGroundCoordinates(viewer, click.position)
          if (result) {
            onLocationSelectRef.current?.(result)
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

        handler.setInputAction((movement) => {
          const picked = viewer.scene.pick(movement.endPosition)
          const entityId = picked?.id?.id
          if (
            typeof entityId === 'string' &&
            entityId.startsWith(PLACE_MARKER_PREFIX)
          ) {
            const placeId = entityId.slice(PLACE_MARKER_PREFIX.length)
            const rect = viewer.scene.canvas.getBoundingClientRect()
            onPlaceMarkerHoverRef.current?.({
              placeId,
              x: rect.left + movement.endPosition.x,
              y: rect.top + movement.endPosition.y,
            })
          } else {
            onPlaceMarkerHoverRef.current?.(null)
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

        handlerRef.current = handler

        if (!cancelled) {
          setViewerReady(true)
          setInitError(null)
        }
      } catch (error) {
        const message = error?.message ?? 'Failed to initialize Cesium viewer.'
        console.error('[Solmate] Cesium initialization failed:', error)
        if (!cancelled) {
          setInitError(message)
          onMapErrorRef.current?.(
            error instanceof Error ? error : new Error(message),
          )
        }
      }
    }

    initViewer()

    return () => {
      cancelled = true
      computeGenRef.current++
      sceneReadyRef.current = false
      if (animRef.current.rafId != null) {
        cancelAnimationFrame(animRef.current.rafId)
        animRef.current.rafId = null
      }
      setViewerReady(false)
      if (cameraListenerRef.current) {
        cameraListenerRef.current()
        cameraListenerRef.current = null
      }
      handlerRef.current?.destroy()
      handlerRef.current = null
      const viewer = viewerRef.current
      if (viewer) viewer.destroy()
      viewerRef.current = null
      tilesetRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !viewerReady || !selectedLocation) return

    const gen = ++computeGenRef.current
    const loc = selectedLocation
    const h = heightMeters ?? 3

    const updateSun = async () => {
      try {
        if (!sceneReadyRef.current) {
          onStatusUpdateRef.current?.({
            inSun: false,
            message: 'Loading map tiles…',
          })
          await waitForSceneReady(
            viewer,
            tilesetRef.current,
            () => gen !== computeGenRef.current,
          )
          if (gen !== computeGenRef.current) return
          sceneReadyRef.current = true
          if (!sceneReadyFiredRef.current) {
            sceneReadyFiredRef.current = true
            onSceneReadyChangeRef.current?.(true)
          }
        }

        const clickedPosition =
          loc.cartesian ?? buildDefaultCartesian(viewer, loc.lat, loc.lng)

        const groundChanged =
          animRef.current.groundCartesian == null ||
          !animRef.current.groundCartesian.equals?.(clickedPosition)

        animRef.current.groundCartesian = clickedPosition
        animRef.current.targetHeight = h
        if (animRef.current.firstSet || groundChanged) {
          animRef.current.currentHeight = h
          animRef.current.firstSet = false
        }
        startHeightTween()

        // Pin position and ray origin share the same Cartesian3 reference.
        const pinCartesian = liftAlongNormal(clickedPosition, h)
        const rayOrigin = pinCartesian
        console.log('pin position:', pinCartesian)
        console.log('ray origin:', rayOrigin)

        const date = dateAtMinutes(timeMinutes)
        const { altitudeDeg, azimuthDeg } = getSunAltitudeAzimuth(
          date,
          loc.lat,
          loc.lng,
        )
        const { inSun, direction } = computeSunExposure(
          viewer,
          rayOrigin,
          loc.lat,
          loc.lng,
          altitudeDeg,
          azimuthDeg,
        )

        animRef.current.sunDirection = direction
        animRef.current.inSun = inSun

        const pin = viewer.entities.getById('solmate-pin')
        if (pin) pin.billboard.image = inSun ? PIN_YELLOW : PIN_ORANGE

        onShadowUpdateRef.current?.(inSun)
        onStatusUpdateRef.current?.({
          inSun,
          message: inSun ? '☀️ Direct sun' : '🌑 In shadow',
        })
        viewer.scene.requestRender()
      } catch (error) {
        if (gen !== computeGenRef.current) return
        if (error?.message === 'cancelled') return
        console.error('[Solmate] Sun status update failed:', error)
        onMapErrorRef.current?.(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    }

    updateSun()
  }, [selectedLocation, heightMeters, timeMinutes, daylightRange, viewerReady])

  // Sync one Cesium entity per nearby place. Color reflects inSun.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !viewerReady) return
    const Cesium = window.Cesium

    const places = placesWithSun ?? []
    const seen = new Set()

    for (const place of places) {
      seen.add(place.id)
      const entityId = `${PLACE_MARKER_PREFIX}${place.id}`
      const isSelected = selectedPlaceId === place.id
      const image = placeMarkerImage(place.inSun, isSelected)
      const size = isSelected
        ? PLACE_MARKER_SELECTED_SIZE
        : PLACE_MARKER_DEFAULT_SIZE
      const ellipsoid =
        viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84
      const position = Cesium.Cartesian3.fromDegrees(
        place.lng,
        place.lat,
        0,
        ellipsoid,
      )

      const existing = placeEntitiesRef.current[place.id]
      if (existing) {
        existing.position = position
        if (existing.billboard) {
          existing.billboard.image = image
          existing.billboard.width = size
          existing.billboard.height = size
        }
        if (existing.label) existing.label.text = place.name
        continue
      }

      const entity = viewer.entities.add({
        id: entityId,
        position,
        billboard: {
          image,
          width: size,
          height: size,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: place.name,
          font: '500 11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 20),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor:
            Cesium.Color.fromCssColorString('#1a1a2e').withAlpha(0.78),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
        },
      })
      placeEntitiesRef.current[place.id] = entity
    }

    for (const id of Object.keys(placeEntitiesRef.current)) {
      if (!seen.has(id)) {
        viewer.entities.remove(placeEntitiesRef.current[id])
        delete placeEntitiesRef.current[id]
      }
    }

    viewer.scene.requestRender()
  }, [placesWithSun, viewerReady, selectedPlaceId])

  return (
    <>
      <div ref={containerRef} className="map-container cesium-container" />
      {initError && (
        <div className="map-error map-error--overlay" role="alert">
          <strong>Map unavailable</strong>
          <p>{initError}</p>
        </div>
      )}
    </>
  )
}
