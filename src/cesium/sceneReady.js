const TILE_LOAD_TIMEOUT_MS = 45_000

export function isGlobeEllipsoidReady(viewer) {
  const ellipsoid = viewer?.scene?.globe?.ellipsoid
  return Boolean(ellipsoid)
}

export function isSceneReadyForRaycast(viewer) {
  return Boolean(viewer?.scene?.globe && isGlobeEllipsoidReady(viewer))
}

function waitForEllipsoid(viewer, isCancelled) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (isCancelled()) {
        reject(new Error('cancelled'))
        return
      }
      if (isGlobeEllipsoidReady(viewer)) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function waitForGlobeTilesZero(viewer, isCancelled) {
  return new Promise((resolve, reject) => {
    const globe = viewer.scene.globe

    if (globe.tilesLoaded) {
      resolve()
      return
    }

    let settled = false
    let listener = null
    let timeoutId = null

    const finish = (fn) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (listener) {
        globe.tileLoadProgressEvent.removeEventListener(listener)
      }
      fn()
    }

    listener = (remaining) => {
      if (isCancelled()) {
        finish(() => reject(new Error('cancelled')))
        return
      }
      if (remaining === 0) {
        finish(resolve)
      }
    }

    globe.tileLoadProgressEvent.addEventListener(listener)
    viewer.scene.requestRender()

    timeoutId = setTimeout(() => {
      if (isCancelled()) {
        finish(() => reject(new Error('cancelled')))
        return
      }
      console.warn('[Solmate] Globe tile wait timed out; continuing.')
      finish(resolve)
    }, TILE_LOAD_TIMEOUT_MS)
  })
}

function waitForTilesetReady(tileset, isCancelled) {
  if (!tileset?.readyPromise) return Promise.resolve()
  return tileset.readyPromise.then(() => {
    if (isCancelled()) throw new Error('cancelled')
  })
}

/**
 * Wait for ellipsoid, base globe tiles, and 3D buildings tileset.
 */
export async function waitForSceneReady(viewer, tileset, isCancelled = () => false) {
  if (!viewer?.scene?.globe) {
    throw new Error('Globe is not available')
  }

  await waitForEllipsoid(viewer, isCancelled)
  await waitForGlobeTilesZero(viewer, isCancelled)
  if (tileset) {
    await waitForTilesetReady(tileset, isCancelled)
  }
  viewer.scene.requestRender()
}

/** @deprecated Use waitForSceneReady */
export function waitForGlobeTilesLoaded(viewer, isCancelled = () => false) {
  return waitForSceneReady(viewer, null, isCancelled)
}
