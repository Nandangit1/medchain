import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonGroup, Form, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FiCrosshair,
  FiExternalLink,
  FiInfo,
  FiMapPin,
  FiNavigation,
  FiPhone,
  FiSearch,
  FiStar,
} from "react-icons/fi";

import { PageHeader } from "../components/common";
import useAuth from "../hooks/useAuth";
import { mapsApi } from "../services";
import { directionsUrl, distanceKm, loadGoogleMaps, mapsSearchUrl } from "../services/googleMaps";

/**
 * Nearby medical stores, split into two groups:
 *
 *   Generic medicine stores  Jan Aushadhi Kendras (PMBJP) and other generic
 *                            pharmacies. Same molecules, much lower prices.
 *   All pharmacies           every chemist Google knows about nearby.
 *
 * The search centre is the address saved on the Profile page, the browser's
 * location, or anything typed into the box. Results are drawn on a map with
 * distinct pin colours and listed nearest-first with directions and a call
 * button, so the cheaper option is the obvious one to pick.
 *
 * Without a Maps key the page still works: it falls back to Google Maps
 * search links, which need no key at all.
 */

const GENERIC_COLOUR = "#16a34a";
const PHARMACY_COLOUR = "#2563eb";
const RADII_KM = [2, 5, 10];

const GENERIC_QUERIES = [
  "Jan Aushadhi Kendra",
  "Pradhan Mantri Bhartiya Janaushadhi Kendra",
  "generic medicine store",
];

const GENERIC_NAME = /jan\s*-?\s*aush?adh|janaushadh|pmbj|generic/i;

const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "utcOffsetMinutes",
  "nationalPhoneNumber",
  "businessStatus",
];

const formatAddress = (address) =>
  address
    ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", ")
    : "";

/** Converts a Places (New) result into a plain object the UI can keep in state. */
const toStore = async (place, centre, isGenericHint) => {
  const location = { lat: place.location.lat(), lng: place.location.lng() };
  let openNow;
  try {
    openNow = await place.isOpen();
  } catch {
    openNow = undefined;
  }

  const name = place.displayName || "Medical store";

  return {
    id: place.id,
    name,
    address: place.formattedAddress,
    location,
    rating: place.rating,
    ratings: place.userRatingCount,
    phone: place.nationalPhoneNumber,
    openNow,
    distance: distanceKm(centre, location),
    isGeneric: isGenericHint || GENERIC_NAME.test(name),
    isJanAushadhi: /jan\s*-?\s*aush?adh|janaushadh|pmbj/i.test(name),
  };
};

const formatDistance = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

// --- Explainer ---------------------------------------------------------------

const GenericExplainer = () => (
  <div className="bts-card p-4 mb-3" style={{ borderLeft: `4px solid ${GENERIC_COLOUR}` }}>
    <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
      <FiInfo style={{ color: GENERIC_COLOUR }} /> What is a generic medicine store?
    </h6>
    <div className="row g-3 small">
      <div className="col-md-4">
        <div className="fw-semibold mb-1">Same medicine, lower price</div>
        A generic medicine has the same active ingredient (salt), strength and dose as the branded
        one. Only the brand name and the price differ.
      </div>
      <div className="col-md-4">
        <div className="fw-semibold mb-1">Jan Aushadhi Kendras</div>
        Government of India stores under the PMBJP scheme. Medicines there are typically{" "}
        <strong>50–90% cheaper</strong> than branded equivalents.
      </div>
      <div className="col-md-4">
        <div className="fw-semibold mb-1">How to buy</div>
        Show your prescription and ask for the generic of each medicine, e.g.{" "}
        <em>Paracetamol 500 mg</em> rather than a brand name. Ask your doctor to write salt names if
        you can.
      </div>
    </div>
  </div>
);

// --- Store card --------------------------------------------------------------

const StoreCard = ({ store, active, onSelect }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={() => onSelect(store)}
    onKeyDown={(event) => event.key === "Enter" && onSelect(store)}
    className="bts-card p-3 mb-2"
    style={{
      cursor: "pointer",
      borderLeft: `4px solid ${store.isGeneric ? GENERIC_COLOUR : PHARMACY_COLOUR}`,
      outline: active ? "2px solid var(--bts-teal)" : "none",
    }}
  >
    <div className="d-flex justify-content-between align-items-start gap-2">
      <div className="fw-semibold">{store.name}</div>
      <span className="badge bg-light text-dark border flex-shrink-0">{formatDistance(store.distance)}</span>
    </div>

    <div className="d-flex flex-wrap gap-1 my-1">
      {store.isJanAushadhi ? (
        <span className="badge" style={{ background: GENERIC_COLOUR }}>
          Jan Aushadhi · Govt generic
        </span>
      ) : store.isGeneric ? (
        <span className="badge" style={{ background: GENERIC_COLOUR }}>
          Generic medicines
        </span>
      ) : (
        <span className="badge" style={{ background: PHARMACY_COLOUR }}>
          Pharmacy
        </span>
      )}
      {store.openNow === true && <span className="badge bg-success-subtle text-success-emphasis">Open now</span>}
      {store.openNow === false && <span className="badge bg-danger-subtle text-danger-emphasis">Closed now</span>}
      {store.rating && (
        <span className="badge bg-warning-subtle text-warning-emphasis">
          <FiStar className="me-1" />
          {store.rating.toFixed(1)}
          {store.ratings ? ` (${store.ratings})` : ""}
        </span>
      )}
    </div>

    {store.address && <div className="small text-muted mb-2">{store.address}</div>}

    <div className="d-flex gap-2">
      <a
        className="btn btn-sm btn-outline-primary"
        href={directionsUrl(store)}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <FiNavigation className="me-1" /> Directions
      </a>
      {store.phone && (
        <a
          className="btn btn-sm btn-outline-secondary"
          href={`tel:${store.phone.replace(/\s/g, "")}`}
          onClick={(event) => event.stopPropagation()}
        >
          <FiPhone className="me-1" /> {store.phone}
        </a>
      )}
    </div>
  </div>
);

// --- Keyless mode: Google's public embed ---------------------------------------

/**
 * Google Maps without an API key or billing account.
 *
 * `maps.google.com/maps?q=...&output=embed` is Google's public embed: a real
 * Google map with the matching places pinned, inside an iframe. It needs no
 * key, so this mode works the moment the site is deployed. What it cannot do
 * is hand the page the store data, so there is no list or distance sort --
 * set GOOGLE_MAPS_API_KEY for that and the full view takes over.
 */
const embedUrl = (query) =>
  `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;

const NoKeyFallback = ({ address }) => {
  const [place, setPlace] = useState(address || "");
  const [near, setNear] = useState(address || "");
  const [tab, setTab] = useState("generic");
  const [locating, setLocating] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This browser cannot share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = `${position.coords.latitude.toFixed(5)},${position.coords.longitude.toFixed(5)}`;
        setNear(point);
        setPlace("My current location");
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Location permission was denied. Type your area instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const target = near || "India";
  const queries = {
    generic: `Jan Aushadhi Kendra near ${target}`,
    all: `pharmacy near ${target}`,
  };

  return (
    <>
      <GenericExplainer />

      <form
        className="bts-card p-3 mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!place.trim()) {
            toast.info("Type an area, city or PIN code, or use your location.");
            return;
          }
          setNear(place.trim());
        }}
      >
        <div className="row g-2 align-items-center">
          <div className="col-lg-7">
            <div className="input-group">
              <span className="input-group-text">
                <FiMapPin />
              </span>
              <Form.Control
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                placeholder="Area, street, city or PIN code"
                aria-label="Address to search around"
              />
              <Button type="submit">
                <FiSearch className="me-1" /> Search
              </Button>
            </div>
          </div>
          <div className="col-auto">
            <Button variant="outline-primary" onClick={useMyLocation} disabled={locating}>
              <FiCrosshair className="me-1" /> {locating ? "Locating…" : "Use my location"}
            </Button>
          </div>
        </div>
        {!address && (
          <div className="small text-muted mt-2">
            Tip: save your address on the <Link to="/profile">Profile</Link> page and this map opens
            around it automatically.
          </div>
        )}
      </form>

      {!near ? (
        <div className="bts-card p-4 text-center text-muted">
          Type your area or use your location to see stores near you.
        </div>
      ) : (
        <>
          <ButtonGroup className="w-100 mb-2">
            <Button variant={tab === "generic" ? "success" : "outline-success"} onClick={() => setTab("generic")}>
              Generic stores (Jan Aushadhi)
            </Button>
            <Button variant={tab === "all" ? "primary" : "outline-primary"} onClick={() => setTab("all")}>
              All pharmacies
            </Button>
          </ButtonGroup>

          <div
            className="bts-card p-0 overflow-hidden"
            style={{ borderTop: `4px solid ${tab === "generic" ? GENERIC_COLOUR : PHARMACY_COLOUR}` }}
          >
            <iframe
              key={queries[tab]}
              title={tab === "generic" ? "Generic medicine stores map" : "Pharmacies map"}
              src={embedUrl(queries[tab])}
              style={{ border: 0, width: "100%", height: 520, display: "block" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>

          <div className="d-flex flex-wrap gap-2 align-items-center mt-2 small">
            <span className="text-muted">
              Showing {tab === "generic" ? "Jan Aushadhi Kendras" : "pharmacies"} near{" "}
              <strong>{place || near}</strong>. Click a pin for its address, hours and reviews.
            </span>
            <a
              className="btn btn-sm btn-outline-secondary ms-auto"
              href={mapsSearchUrl(queries[tab])}
              target="_blank"
              rel="noreferrer"
            >
              <FiExternalLink className="me-1" /> Open in Google Maps for directions
            </a>
            <a className="btn btn-sm btn-outline-secondary" href="https://janaushadhi.gov.in/" target="_blank" rel="noreferrer">
              Official Jan Aushadhi site
            </a>
          </div>
        </>
      )}
    </>
  );
};

// --- Page --------------------------------------------------------------------

const MedicalStores = () => {
  const { user } = useAuth();
  const savedAddress = formatAddress(user?.address);

  const [config, setConfig] = useState(null);
  const [mapsError, setMapsError] = useState(null);
  const [query, setQuery] = useState(savedAddress);
  const [radiusKm, setRadiusKm] = useState(5);
  const [centre, setCentre] = useState(null);
  const [centreLabel, setCentreLabel] = useState("");
  const [stores, setStores] = useState([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState("generic");
  const [selectedId, setSelectedId] = useState(null);

  const mapElement = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const circle = useRef(null);
  const infoWindow = useRef(null);
  const didAutoSearch = useRef(false);

  useEffect(() => {
    mapsApi
      .config()
      .then(setConfig)
      .catch(() => setConfig({ enabled: false }));
  }, []);

  const ready = useCallback(async () => {
    const maps = await loadGoogleMaps(config.apiKey);
    return maps;
  }, [config]);

  /** Runs both searches around a point and stores the merged result. */
  const searchAround = useCallback(
    async (point, label) => {
      setSearching(true);
      setCentre(point);
      setCentreLabel(label);
      setSelectedId(null);

      try {
        const maps = await ready();
        const { Place, SearchNearbyRankPreference } = await maps.importLibrary("places");
        const radius = radiusKm * 1000;

        const [nearby, ...genericSets] = await Promise.all([
          Place.searchNearby({
            fields: PLACE_FIELDS,
            locationRestriction: { center: point, radius },
            includedPrimaryTypes: ["pharmacy", "drugstore"],
            maxResultCount: 20,
            rankPreference: SearchNearbyRankPreference.DISTANCE,
          }).catch(() => ({ places: [] })),
          ...GENERIC_QUERIES.map((textQuery) =>
            Place.searchByText({
              textQuery,
              fields: PLACE_FIELDS,
              locationBias: { center: point, radius },
              maxResultCount: 20,
            }).catch(() => ({ places: [] }))
          ),
        ]);

        const byId = new Map();

        for (const place of nearby.places || []) {
          if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;
          byId.set(place.id, { place, generic: false });
        }

        for (const set of genericSets) {
          for (const place of set.places || []) {
            if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;
            // Text search returns anything that matches the words; keep only
            // what is plausibly a generic store by its name.
            if (!GENERIC_NAME.test(place.displayName || "")) continue;
            byId.set(place.id, { place, generic: true });
          }
        }

        const all = await Promise.all(
          [...byId.values()].map(({ place, generic }) => toStore(place, point, generic))
        );

        // Text search is biased, not bounded; trim to the chosen radius.
        const within = all.filter((store) => store.distance <= radiusKm).sort((a, b) => a.distance - b.distance);

        setStores(within);
        setTab(within.some((store) => store.isGeneric) ? "generic" : "all");
      } catch (error) {
        setMapsError(error.message);
      } finally {
        setSearching(false);
      }
    },
    [radiusKm, ready]
  );

  const searchAddress = useCallback(
    async (text) => {
      if (!text.trim()) {
        toast.info("Type an address, or use your current location.");
        return;
      }

      setSearching(true);
      try {
        const maps = await ready();
        const { Geocoder } = await maps.importLibrary("geocoding");
        const { results } = await new Geocoder().geocode({ address: text, region: "IN" });

        if (!results?.length) {
          toast.error("Could not find that address. Try adding the city or PIN code.");
          setSearching(false);
          return;
        }

        const location = results[0].geometry.location;
        await searchAround({ lat: location.lat(), lng: location.lng() }, results[0].formatted_address);
      } catch (error) {
        setSearching(false);
        toast.error(error.message || "Could not look up that address.");
      }
    },
    [ready, searchAround]
  );

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This browser cannot share its location.");
      return;
    }

    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        searchAround({ lat: position.coords.latitude, lng: position.coords.longitude }, "your current location"),
      () => {
        setSearching(false);
        toast.error("Location permission was denied. Type your address instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // First visit: search around the saved address straight away.
  useEffect(() => {
    if (!config?.enabled || didAutoSearch.current || !savedAddress) return;
    didAutoSearch.current = true;
    searchAddress(savedAddress);
  }, [config, savedAddress, searchAddress]);

  // Re-run when the radius changes after a first search.
  useEffect(() => {
    if (centre) searchAround(centre, centreLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm]);

  const generic = useMemo(() => stores.filter((store) => store.isGeneric), [stores]);
  const visible = tab === "generic" ? generic : stores;

  // Draw the map and pins whenever results change.
  useEffect(() => {
    if (!centre || !config?.enabled || !mapElement.current) return;

    let cancelled = false;

    (async () => {
      const maps = await ready();
      const [{ Map: GoogleMap, InfoWindow, Circle }, { AdvancedMarkerElement, PinElement }] = await Promise.all([
        maps.importLibrary("maps"),
        maps.importLibrary("marker"),
      ]);
      if (cancelled) return;

      if (!map.current) {
        map.current = new GoogleMap(mapElement.current, {
          center: centre,
          zoom: 14,
          mapId: config.mapId,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        });
        infoWindow.current = new InfoWindow();
      }

      markers.current.forEach((marker) => {
        marker.map = null;
      });
      markers.current = [];

      const you = document.createElement("div");
      you.title = "Search centre";
      you.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#0f766e;border:3px solid #fff;box-shadow:0 0 0 2px #0f766e;";
      markers.current.push(new AdvancedMarkerElement({ map: map.current, position: centre, content: you, zIndex: 999 }));

      circle.current?.setMap(null);
      circle.current = new Circle({
        map: map.current,
        center: centre,
        radius: radiusKm * 1000,
        strokeColor: "#0f766e",
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: "#0f766e",
        fillOpacity: 0.04,
        clickable: false,
      });

      const bounds = new maps.LatLngBounds();
      bounds.extend(centre);

      visible.forEach((store) => {
        const pin = new PinElement({
          background: store.isGeneric ? GENERIC_COLOUR : PHARMACY_COLOUR,
          borderColor: "#ffffff",
          glyphColor: "#ffffff",
        });

        const marker = new AdvancedMarkerElement({
          map: map.current,
          position: store.location,
          title: store.name,
          content: pin.element,
        });

        marker.addListener("click", () => setSelectedId(store.id));
        markers.current.push(marker);
        bounds.extend(store.location);
      });

      if (visible.length) map.current.fitBounds(bounds, 48);
      else map.current.setCenter(centre);
    })().catch((error) => setMapsError(error.message));

    return () => {
      cancelled = true;
    };
  }, [centre, visible, radiusKm, config, ready]);

  // Open an info window for the selected store.
  useEffect(() => {
    const store = stores.find((item) => item.id === selectedId);
    if (!store || !map.current || !infoWindow.current) return;

    const box = document.createElement("div");
    box.style.cssText = "max-width:240px;color:#0f172a;";
    const title = document.createElement("strong");
    title.textContent = store.name;
    const meta = document.createElement("div");
    meta.style.fontSize = "12px";
    meta.textContent = `${store.isGeneric ? "Generic medicines" : "Pharmacy"} · ${formatDistance(store.distance)}`;
    const directions = document.createElement("a");
    directions.href = directionsUrl(store);
    directions.target = "_blank";
    directions.rel = "noreferrer";
    directions.textContent = "Directions →";
    directions.style.fontSize = "12px";
    box.append(title, meta, directions);

    infoWindow.current.setContent(box);
    infoWindow.current.setPosition(store.location);
    infoWindow.current.open({ map: map.current });
    map.current.panTo(store.location);
  }, [selectedId, stores]);

  if (!config) {
    return (
      <>
        <PageHeader title="Medical stores near you" />
        <Spinner animation="border" size="sm" />
      </>
    );
  }

  if (!config.enabled || mapsError) {
    return (
      <>
        <PageHeader
          title="Medical stores near you"
          subtitle="Generic (Jan Aushadhi) stores and pharmacies around your address"
        />
        {mapsError && <div className="alert alert-warning small">{mapsError}</div>}
        <NoKeyFallback address={savedAddress} />
      </>
    );
  }

  const nearestGeneric = generic[0];

  return (
    <>
      <PageHeader
        title="Medical stores near you"
        subtitle="Generic (Jan Aushadhi) stores and pharmacies around your address"
      />

      <GenericExplainer />

      <form
        className="bts-card p-3 mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          searchAddress(query);
        }}
      >
        <div className="row g-2 align-items-center">
          <div className="col-lg-6">
            <div className="input-group">
              <span className="input-group-text">
                <FiMapPin />
              </span>
              <Form.Control
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Area, street, city or PIN code"
                aria-label="Address to search around"
              />
              <Button type="submit" disabled={searching}>
                <FiSearch className="me-1" /> Search
              </Button>
            </div>
          </div>
          <div className="col-auto">
            <Button variant="outline-primary" onClick={useMyLocation} disabled={searching}>
              <FiCrosshair className="me-1" /> Use my location
            </Button>
          </div>
          <div className="col-auto d-flex align-items-center gap-2">
            <span className="small text-muted">Within</span>
            <ButtonGroup size="sm">
              {RADII_KM.map((km) => (
                <Button
                  key={km}
                  variant={radiusKm === km ? "primary" : "outline-primary"}
                  onClick={() => setRadiusKm(km)}
                >
                  {km} km
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </div>
        {!savedAddress && (
          <div className="small text-muted mt-2">
            Tip: save your address on the <Link to="/profile">Profile</Link> page and this page will
            search around it automatically.
          </div>
        )}
      </form>

      {!centre && !searching && (
        <div className="bts-card p-4 text-center text-muted">
          Search an address or use your location to see nearby stores.
        </div>
      )}

      {(centre || searching) && (
        <>
          {centre && !searching && (
            <div className="alert alert-light border small d-flex flex-wrap gap-2 align-items-center">
              <span>
                Around <strong>{centreLabel}</strong>:
              </span>
              <span className="badge" style={{ background: GENERIC_COLOUR }}>
                {generic.length} generic {generic.length === 1 ? "store" : "stores"}
              </span>
              <span className="badge" style={{ background: PHARMACY_COLOUR }}>
                {stores.length - generic.length} other pharmacies
              </span>
              {nearestGeneric && (
                <span>
                  · Nearest generic store: <strong>{nearestGeneric.name}</strong>,{" "}
                  {formatDistance(nearestGeneric.distance)} away
                </span>
              )}
            </div>
          )}

          <div className="row g-3">
            <div className="col-lg-5 order-2 order-lg-1">
              <ButtonGroup className="w-100 mb-2">
                <Button
                  variant={tab === "generic" ? "success" : "outline-success"}
                  onClick={() => setTab("generic")}
                >
                  Generic stores ({generic.length})
                </Button>
                <Button
                  variant={tab === "all" ? "primary" : "outline-primary"}
                  onClick={() => setTab("all")}
                >
                  All pharmacies ({stores.length})
                </Button>
              </ButtonGroup>

              {searching && (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" /> Searching nearby…
                </div>
              )}

              {!searching && visible.length === 0 && (
                <div className="bts-card p-3 small">
                  {tab === "generic" ? (
                    <>
                      No generic stores found within {radiusKm} km. Try a larger radius, or{" "}
                      <a href={mapsSearchUrl(`Jan Aushadhi Kendra near ${centreLabel}`)} target="_blank" rel="noreferrer">
                        search Google Maps
                      </a>
                      . Regular pharmacies also stock generics if you ask by salt name.
                    </>
                  ) : (
                    <>No pharmacies found within {radiusKm} km. Try a larger radius.</>
                  )}
                </div>
              )}

              <div style={{ maxHeight: 560, overflowY: "auto" }}>
                {!searching &&
                  visible.map((store) => (
                    <StoreCard
                      key={store.id}
                      store={store}
                      active={store.id === selectedId}
                      onSelect={(item) => setSelectedId(item.id)}
                    />
                  ))}
              </div>
            </div>

            <div className="col-lg-7 order-1 order-lg-2">
              <div className="bts-card p-0 overflow-hidden">
                <div ref={mapElement} style={{ height: 520, width: "100%" }} />
              </div>
              <div className="d-flex gap-3 small text-muted mt-2">
                <span>
                  <span className="d-inline-block rounded-circle me-1" style={{ width: 10, height: 10, background: GENERIC_COLOUR }} />
                  Generic / Jan Aushadhi
                </span>
                <span>
                  <span className="d-inline-block rounded-circle me-1" style={{ width: 10, height: 10, background: PHARMACY_COLOUR }} />
                  Other pharmacy
                </span>
                <span>
                  <span className="d-inline-block rounded-circle me-1" style={{ width: 10, height: 10, background: "#0f766e" }} />
                  Search centre
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default MedicalStores;
