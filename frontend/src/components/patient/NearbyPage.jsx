import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Button from '../ui/Button'
import Card, { CardBody } from '../ui/Card'
import api, { friendlyError } from '../../services/api'
import { getCurrentLocation, locationErrorKey, LOW_ACCURACY_METRES } from '../../lib/geolocation'

/* ─── OpenStreetMap tiles. Attribution is a condition of using them. ─── */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/* ─── Custom map icons using brand teal ─── */
const USER_ICON = new L.DivIcon({
  className: '',
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#0E7C7B;border:3px solid #fff;
    box-shadow:0 2px 8px rgba(14,124,123,.45), 0 0 0 6px rgba(14,124,123,.18);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function makeNumberIcon(n, active = false) {
  return new L.DivIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:700;color:#fff;
      background:${active ? '#C97A0C' : '#0B5F63'};
      border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.25);
      transition:all .25s ease;
      transform:${active ? 'scale(1.3)' : 'scale(1)'};
    ">${n}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  })
}

/* ─── Map helper: fly to bounds or point ─── */
function FlyController({ center, zoom, bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) {
      map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8, maxZoom: 16 })
    } else if (center) {
      map.flyTo(center, zoom || 14, { duration: 0.8 })
    }
  }, [center, zoom, bounds, map])
  return null
}

/* ─── Lets the user click/tap anywhere on the map to drop the pin there ─── */
function ClickToPlaceMarker({ onPlace }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng)
    },
  })
  return null
}

/* ─── Draggable marker for location picking (fine adjustment after placing) ─── */
function DraggableMarker({ position, onDrag }) {
  const markerRef = useRef(null)
  const handlers = useMemo(() => ({
    dragend() {
      const m = markerRef.current
      if (m) onDrag(m.getLatLng())
    },
  }), [onDrag])
  return <Marker draggable position={position} icon={USER_ICON} ref={markerRef} eventHandlers={handlers} />
}

/*
 * Nearby places come from our backend (/api/geo/nearby), which queries
 * OpenStreetMap's Overpass API with mirror fallback. This page used to call a
 * single public Overpass instance directly; when that instance was busy or
 * unreachable, the error was swallowed and the page said "Nothing found
 * nearby" — which is exactly how the deployed feature appeared broken.
 * An outage is now shown as an outage, with a retry.
 */

/* ─── OSRM walking route (only fetched on demand, not for every result) ─── */
async function fetchWalkingRoute(fromLat, fromLng, toLat, toLng) {
  const url = `https://router.project-osrm.org/route/v1/foot/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.routes?.length) return null
    const route = data.routes[0]
    return {
      coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance: route.distance, // meters
      duration: route.duration, // seconds
    }
  } finally {
    clearTimeout(timer)
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rm = mins % 60
  return rm ? `${hrs}h ${rm}m` : `${hrs}h`
}

/** Opens the phone's maps app on Android, Google Maps in a browser elsewhere. */
function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function NearbyPage() {
  const { t } = useTranslation()

  const [phase, setPhase] = useState('location')
  const [userLoc, setUserLoc] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [category, setCategory] = useState(null)
  const [places, setPlaces] = useState([])
  const [searchError, setSearchError] = useState('')
  const [partialKm, setPartialKm] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [routeCoords, setRouteCoords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [routeLoading, setRouteLoading] = useState(false)
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchingPlace, setSearchingPlace] = useState(false)
  const [mapCenter, setMapCenter] = useState(null)
  const [flyBounds, setFlyBounds] = useState(null)

  const listRef = useRef(null)
  // Switching category mid-search must not let the older response win.
  const searchSeq = useRef(0)

  /* ─── Location detection ─── */
  const detectLocation = useCallback(async () => {
    setDetectingLocation(true)
    setLocationError('')
    try {
      const loc = await getCurrentLocation()
      setUserLoc({ lat: loc.lat, lng: loc.lng })
      setAccuracy(loc.accuracy)
      setMapCenter([loc.lat, loc.lng])
    } catch (err) {
      setLocationError(t(locationErrorKey(err)))
    } finally {
      setDetectingLocation(false)
    }
  }, [t])

  /* ─── Place search (manual location path) ─── */
  const geocodeSearch = useCallback(async (q) => {
    const query = (q || '').trim()
    if (query.length < 3) return
    setSearchingPlace(true)
    setLocationError('')
    try {
      const { data } = await api.get('/geo/search', { params: { q: query }, timeout: 20000 })
      const first = data?.results?.[0]
      if (!first) {
        setLocationError(t('nearby.placeNotFound'))
        return
      }
      setUserLoc({ lat: first.lat, lng: first.lon })
      setAccuracy(null)
      setMapCenter([first.lat, first.lon])
    } catch (err) {
      setLocationError(err.response?.status === 502 ? t('nearby.placeSearchError') : friendlyError(err))
    } finally {
      setSearchingPlace(false)
    }
  }, [t])

  /* ─── User clicks/taps anywhere on the location map to drop the pin ─── */
  const placeMarkerAt = useCallback((latlng) => {
    setUserLoc({ lat: latlng.lat, lng: latlng.lng })
    setAccuracy(null)
    setMapCenter([latlng.lat, latlng.lng])
    setLocationError('')
  }, [])

  /* ─── Search for places in a category ─── */
  const doSearch = useCallback(async (cat) => {
    if (!userLoc) return
    const seq = ++searchSeq.current
    setCategory(cat)
    setSelectedIdx(null)
    setRouteCoords(null)
    setSearchError('')
    setPartialKm(null)
    setLoading(true)
    setPhase('results')
    try {
      // Generous timeout: a sleeping Render instance can take most of a minute to wake.
      const { data } = await api.get('/geo/nearby', {
        params: { category: cat, lat: userLoc.lat, lon: userLoc.lng },
        timeout: 60000
      })
      if (seq !== searchSeq.current) return
      const results = (data?.places || []).map(p => ({
        ...p,
        // Straight-line distance first; the walking route is fetched only on selection.
        walkDist: p.distanceMetres,
        walkDuration: null,
        isApprox: true,
      }))
      setPlaces(results)
      if (data?.partial && data?.radiusMetres) setPartialKm(Math.round(data.radiusMetres / 1000))

      if (results.length) {
        const allLats = [userLoc.lat, ...results.map(p => p.lat)]
        const allLngs = [userLoc.lng, ...results.map(p => p.lng)]
        setFlyBounds([
          [Math.min(...allLats) - 0.005, Math.min(...allLngs) - 0.005],
          [Math.max(...allLats) + 0.005, Math.max(...allLngs) + 0.005],
        ])
      }
    } catch (err) {
      if (seq !== searchSeq.current) return
      setPlaces([])
      setSearchError(err.response?.data?.code === 'MAP_DATA_UNAVAILABLE'
        ? t('nearby.serviceUnavailable')
        : friendlyError(err, t('nearby.searchError')))
    } finally {
      if (seq === searchSeq.current) setLoading(false)
    }
  }, [userLoc, t])

  /* ─── Select a POI (from list or map) — fetches the real walking route ─── */
  const selectPlace = useCallback(async (idx) => {
    if (!userLoc || !places[idx]) return
    setSelectedIdx(idx)
    setRouteCoords(null)
    setRouteLoading(true)
    const p = places[idx]
    try {
      const route = await fetchWalkingRoute(userLoc.lat, userLoc.lng, p.lat, p.lng)
      if (route) {
        setRouteCoords(route.coords)
        setPlaces(prev => prev.map((pl, i) =>
          i === idx ? { ...pl, walkDist: route.distance, walkDuration: route.duration, isApprox: false } : pl
        ))
        setFlyBounds([
          [Math.min(userLoc.lat, p.lat) - 0.003, Math.min(userLoc.lng, p.lng) - 0.003],
          [Math.max(userLoc.lat, p.lat) + 0.003, Math.max(userLoc.lng, p.lng) + 0.003],
        ])
      }
    } catch { /* keep the straight-line estimate if routing fails */ }
    setRouteLoading(false)

    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${idx}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [userLoc, places])

  /* ─── Back from route view ─── */
  const clearSelection = useCallback(() => {
    setSelectedIdx(null)
    setRouteCoords(null)
    if (places.length && userLoc) {
      const allLats = [userLoc.lat, ...places.map(p => p.lat)]
      const allLngs = [userLoc.lng, ...places.map(p => p.lng)]
      setFlyBounds([
        [Math.min(...allLats) - 0.005, Math.min(...allLngs) - 0.005],
        [Math.max(...allLats) + 0.005, Math.max(...allLngs) + 0.005],
      ])
    }
  }, [places, userLoc])

  const goBackToLocation = useCallback(() => {
    searchSeq.current++
    setPhase('location')
    setCategory(null)
    setPlaces([])
    setSearchError('')
    setLoading(false)
    setSelectedIdx(null)
    setRouteCoords(null)
    if (userLoc) setMapCenter([userLoc.lat, userLoc.lng])
  }, [userLoc])

  const categories = [
    { key: 'doctor',   icon: '🩺', label: t('nearby.findDoctor') },
    { key: 'pharmacy', icon: '💊', label: t('nearby.findPharmacy') },
    { key: 'hospital', icon: '🏥', label: t('nearby.findHospital') },
  ]

  const placeName = (p) => p.name || t(`nearby.unnamed.${p.category || category}`)

  /* ═══════════ PHASE: LOCATION ═══════════ */
  if (phase === 'location') {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <Card>
          <CardBody>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Button
                variant="primary"
                loading={detectingLocation}
                onClick={detectLocation}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 2v2m0 16v2M2 12h2m16 0h2" />
                  </svg>
                }
              >
                {detectingLocation ? t('nearby.detecting') : t('nearby.detectLocation')}
              </Button>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder={t('nearby.enterAddress')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && geocodeSearch(searchQuery)}
                />
                <Button variant="secondary" loading={searchingPlace} onClick={() => geocodeSearch(searchQuery)} aria-label={t('nearby.enterAddress')}>
                  {!searchingPlace && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>

            {locationError && (
              <div className="alert alert-warning mb-4" role="alert">
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.108 3.374 1.912 3.374h14.786c1.804 0 2.778-1.874 1.912-3.374L13.912 3.624c-.866-1.5-3.038-1.5-3.904 0L2.697 16.126z" />
                </svg>
                <span>{locationError} {t('nearby.manualHint')}</span>
              </div>
            )}

            {userLoc && accuracy != null && accuracy > LOW_ACCURACY_METRES && (
              <div className="alert alert-info mb-4" role="status">
                <span>{t('location.approximate', { metres: accuracy })}</span>
              </div>
            )}

            {/* isolate: Leaflet's own z-indexes would otherwise paint over the fixed bottom nav on phones. */}
            <div className="isolate rounded-card overflow-hidden border border-line" style={{ height: 340 }}>
              <MapContainer
                center={mapCenter || [20.5937, 78.9629]}
                zoom={mapCenter ? 14 : 5}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
              >
                <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                {mapCenter && <FlyController center={mapCenter} zoom={14} />}
                {/* Click anywhere on the map to drop/move the pin there */}
                <ClickToPlaceMarker onPlace={placeMarkerAt} />
                {userLoc && (
                  <DraggableMarker
                    position={[userLoc.lat, userLoc.lng]}
                    onDrag={latlng => {
                      setUserLoc({ lat: latlng.lat, lng: latlng.lng })
                      setAccuracy(null)
                      setMapCenter([latlng.lat, latlng.lng])
                    }}
                  />
                )}
              </MapContainer>
            </div>
            <p className="text-caption text-muted mt-2 text-center">
              {userLoc ? t('nearby.dragHint') : t('nearby.tapMapHint')}
            </p>
          </CardBody>
        </Card>

        {userLoc && (
          <section className="animate-rise-in">
            <h2 className="text-caption font-semibold text-muted uppercase tracking-wide mb-3">
              {t('nearby.searchPrompt')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {categories.map(cat => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => doSearch(cat.key)}
                  className="group action-tile"
                >
                  <span className="action-icon text-xl">{cat.icon}</span>
                  <span className="font-semibold text-ink flex-1">{cat.label}</span>
                  <svg className="w-4 h-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary-600"
                       fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    )
  }

  /* ═══════════ PHASE: RESULTS ═══════════ */
  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={goBackToLocation}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-control text-small text-muted hover:text-ink hover:bg-surface-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('nearby.changeLocation')}
        </button>
        <div className="flex gap-1.5 ml-auto overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat.key}
              type="button"
              onClick={() => doSearch(cat.key)}
              className={`px-3 py-1.5 rounded-full text-caption font-semibold whitespace-nowrap border transition-colors ${
                category === cat.key
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-surface-2 text-body border-line hover:border-primary-300'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {selectedIdx !== null && (
        <div className="mb-3 animate-fade-in">
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control text-small font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t('nearby.back')}
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 520 }}>
        <div className="isolate lg:w-[60%] w-full rounded-card overflow-hidden border border-line shadow-rest" style={{ minHeight: 400 }}>
          {userLoc && (
            <MapContainer
              center={[userLoc.lat, userLoc.lng]}
              zoom={13}
              style={{ height: '100%', width: '100%', minHeight: 400 }}
              zoomControl={true}
            >
              <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
              <FlyController bounds={flyBounds} />

              <Marker position={[userLoc.lat, userLoc.lng]} icon={USER_ICON}>
                <Popup><span className="text-small font-medium">{t('nearby.youAreHere')}</span></Popup>
              </Marker>

              {places.map((p, i) => (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lng]}
                  icon={makeNumberIcon(i + 1, selectedIdx === i)}
                  eventHandlers={{ click: () => selectPlace(i) }}
                >
                  <Popup>
                    <div className="text-small">
                      <p className="font-semibold text-ink">{placeName(p)}</p>
                      {p.address && <p className="text-muted mt-0.5">{p.address}</p>}
                      {p.walkDist != null && (
                        <p className="text-primary-600 font-medium mt-1">
                          {p.isApprox ? '~' : ''}{formatDistance(p.walkDist)}
                          {p.walkDuration != null ? ` · ${formatDuration(p.walkDuration)}` : ''}
                        </p>
                      )}
                      <a href={directionsUrl(p.lat, p.lng)} target="_blank" rel="noopener noreferrer"
                         className="inline-block mt-1 text-primary-600 font-medium hover:underline">
                        {t('nearby.directions')} ↗
                      </a>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {routeCoords && (
                <Polyline
                  positions={routeCoords}
                  pathOptions={{ color: '#0E7C7B', weight: 4, opacity: 0.85, dashArray: '8 6' }}
                />
              )}
            </MapContainer>
          )}
        </div>

        <div
          ref={listRef}
          className="lg:w-[40%] w-full overflow-y-auto flex flex-col gap-2"
          style={{ maxHeight: 520 }}
        >
          {loading ? (
            <Card><CardBody className="py-12 text-center">
              <div className="flex flex-col items-center gap-3" role="status">
                <svg className="animate-spin h-6 w-6 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <p className="text-small text-muted">{t('nearby.searching')}</p>
              </div>
            </CardBody></Card>
          ) : searchError ? (
            <Card><CardBody className="py-10 text-center">
              <p className="text-small text-danger-600 font-medium mb-3" role="alert">{searchError}</p>
              <Button variant="secondary" size="sm" onClick={() => doSearch(category)}>{t('nearby.retry')}</Button>
            </CardBody></Card>
          ) : places.length === 0 ? (
            <Card><CardBody className="py-12 text-center">
              <p className="text-small text-muted">{t('nearby.noResults')}</p>
            </CardBody></Card>
          ) : (
            <>
              <p className="text-caption text-muted mb-1">
                {t('nearby.results', { count: places.length })}
              </p>
              {partialKm && (
                <p className="text-caption text-warning-600 mb-1">{t('nearby.partial', { km: partialKm })}</p>
              )}
              {places.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  data-idx={i}
                  onClick={() => selectedIdx === i ? clearSelection() : selectPlace(i)}
                  className={`w-full text-left rounded-card border transition-all duration-250 ${
                    selectedIdx === i
                      ? 'bg-primary-50 border-primary-300 shadow-raised ring-1 ring-primary-200'
                      : 'bg-surface border-line hover:border-primary-200 hover:shadow-raised'
                  }`}
                >
                  <div className="flex items-start gap-3 p-4">
                    <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-caption font-bold text-white transition-colors ${
                      selectedIdx === i ? 'bg-accent-500' : 'bg-primary-700'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold truncate ${selectedIdx === i ? 'text-primary-700' : 'text-ink'}`}>
                        {placeName(p)}
                      </p>
                      {p.address && (
                        <p className="text-caption text-muted mt-0.5 truncate">{p.address}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        {p.walkDist != null && (
                          <span className="inline-flex items-center gap-1 text-caption font-medium text-primary-600">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h-2v2H9v2h2v2h2v-2h2v-2h-2V7zM12 22s-8-4.5-8-11a8 8 0 1116 0c0 6.5-8 11-8 11z" />
                            </svg>
                            {p.isApprox ? '~' : ''}{t('nearby.walkingDistance', { distance: formatDistance(p.walkDist) })}
                          </span>
                        )}
                        {p.walkDuration != null && (
                          <span className="text-caption text-muted">
                            ~{formatDuration(p.walkDuration)}
                          </span>
                        )}
                        {selectedIdx === i && routeLoading && (
                          <span className="text-caption text-muted">{t('nearby.findingRoute')}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                        {p.phone && (
                          <a
                            href={`tel:${p.phone}`}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-caption text-primary-600 hover:underline"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            {p.phone}
                          </a>
                        )}
                        <a
                          href={directionsUrl(p.lat, p.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-caption font-medium text-primary-600 hover:underline"
                        >
                          {t('nearby.directions')} ↗
                        </a>
                      </div>
                    </div>
                    <svg className={`w-4 h-4 shrink-0 text-muted transition-transform duration-200 ${selectedIdx === i ? 'rotate-90 text-primary-600' : ''}`}
                         fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {selectedIdx === i && routeCoords && (
                    <div className="px-4 pb-4 pt-1 border-t border-primary-100 animate-fade-in">
                      <div className="flex items-center gap-2 text-small text-primary-700">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                        <span className="font-semibold">{t('nearby.routeShown')}</span>
                      </div>
                    </div>
                  )}
                </button>
              ))}
              <p className="text-caption text-muted mt-1">{t('nearby.dataSource')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
