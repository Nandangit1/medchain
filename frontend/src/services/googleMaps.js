/**
 * Loads the Google Maps JavaScript API once per page and resolves with the
 * global `google.maps` namespace.
 *
 * The key comes from the backend at runtime (GET /maps/config), not from a
 * Vite variable, so adding or rotating it never needs a rebuild. Libraries are
 * fetched on demand with `google.maps.importLibrary`.
 */
let loading = null;

export const loadGoogleMaps = (apiKey) => {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const callbackName = "__medchainMapsReady";

    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    // Google calls this on an invalid, unrestricted-for-this-site or unbilled key.
    window.gm_authFailure = () =>
      reject(
        new Error(
          "Google rejected the Maps key. Check that billing is enabled and this site is allowed under the key's website restrictions."
        )
      );

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&loading=async&region=IN&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load Google Maps. Check your connection and try again."));
    };

    document.head.appendChild(script);
  });

  return loading;
};

/** Great-circle distance in kilometres. */
export const distanceKm = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** A Google Maps search URL; works with no API key at all. */
export const mapsSearchUrl = (query) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export const directionsUrl = (store) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${store.location.lat},${store.location.lng}`
  )}&destination_place_id=${encodeURIComponent(store.id)}`;
