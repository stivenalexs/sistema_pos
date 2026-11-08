"use client";

import "leaflet/dist/leaflet.css";

import type { CircleMarker, LeafletMouseEvent, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

// Map to mark the delivery point (P-010, D-045). Leaflet 1.9.4 with
// OpenStreetMap tiles (attribution required by their tile usage policy).
// Leaflet touches `window`, so it is loaded only in the browser. The marker is
// a CircleMarker: no image files to bundle. No animation (agents.md §8).

export type LatLng = { lat: number; lng: number };

type Props = {
  center: LatLng;
  value: LatLng | null;
  onChange: (value: LatLng) => void;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function AddressMap({ center, value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false })
          .setView([center.lat, center.lng], 13);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
        map.on("click", (event: LeafletMouseEvent) => {
          onChangeRef.current({ lat: round(event.latlng.lat), lng: round(event.latlng.lng) });
        });
        mapRef.current = map;
      })
      .catch(() => setLoadError(true));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [center.lat, center.lng]);

  // Keep the marker in sync with the value.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      const map = mapRef.current;
      if (cancelled || !map) return;
      if (!value) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      if (markerRef.current) {
        markerRef.current.setLatLng([value.lat, value.lng]);
      } else {
        markerRef.current = L.circleMarker([value.lat, value.lng], {
          radius: 9,
          color: "#21180f",
          weight: 3,
          fillColor: "#c4a16b",
          fillOpacity: 0.9,
        }).addTo(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: round(position.coords.latitude), lng: round(position.coords.longitude) };
        onChangeRef.current(point);
        mapRef.current?.setView([point.lat, point.lng], 17, { animate: false });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        role="application"
        aria-label="Mapa para marcar el punto de entrega"
        className="h-72 w-full overflow-hidden rounded-[4px] border border-line"
      />
      {loadError ? <p className="text-sm text-danger">No pudimos cargar el mapa. Recarga la página.</p> : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* UI helper, not an action: it only moves the marker. */}
        <button type="button" onClick={useMyLocation} className="link">
          Usar mi ubicación actual
        </button>
        <span className="text-muted">
          {value ? `Punto marcado: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "Toca el mapa para marcar el punto de entrega."}
        </span>
      </div>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
