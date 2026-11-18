"use client";

/**
 * MapLibre map (spec 8, 21). The basemap comes from NEXT_PUBLIC_MAP_STYLE_URL,
 * which must point at a permitted or self-hosted tile service. Without it the
 * map shows points on a plain background: public OSM tile servers are not
 * assumed to support this application (ADR-0023).
 */
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  count?: number;
  href?: string;
}

const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": "#eef1f4" } }],
};

export function MapView({ points, height = 420, onSelect }: { points: MapPoint[]; height?: number; onSelect?: (point: MapPoint) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      // Same-origin ES-module worker copied to public/ by scripts/copy-maplibre-worker.mjs.
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
      const map = new maplibre.Map({
        container: container.current,
        style: styleUrl || FALLBACK_STYLE,
        center: [15, 58],
        zoom: 3,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "points",
          paint: {
            "circle-color": "#1f5eff",
            "circle-opacity": 0.75,
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1,
            "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 4, 50, 10, 500, 18],
          },
        });
        // Text labels need font glyphs, which only a real style provides.
        if (styleUrl) map.addLayer({
          id: "labels",
          type: "symbol",
          source: "points",
          layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" },
          paint: { "text-color": "#14161a", "text-halo-color": "#fff", "text-halo-width": 1 },
          minzoom: 5,
        });
        map.on("click", "points", (event: import("maplibre-gl").MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (feature) selectRef.current?.(feature.properties as unknown as MapPoint);
        });
        map.on("mouseenter", "points", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "points", () => (map.getCanvas().style.cursor = ""));
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const map = mapRef.current;
      const source = map?.getSource("points") as import("maplibre-gl").GeoJSONSource | undefined;
      if (!map || !source) return false;
      source.setData({
        type: "FeatureCollection",
        features: points.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
          properties: { ...p, count: p.count ?? 1 },
        })),
      });
      if (points.length) {
        const lons = points.map((p) => p.longitude);
        const lats = points.map((p) => p.latitude);
        map.fitBounds(
          [
            [Math.min(...lons) - 0.5, Math.min(...lats) - 0.5],
            [Math.max(...lons) + 0.5, Math.max(...lats) + 0.5],
          ],
          { padding: 30, maxZoom: 9, duration: 0 },
        );
      }
      return true;
    };
    if (!apply()) {
      const timer = setInterval(() => {
        if (apply()) clearInterval(timer);
      }, 200);
      return () => clearInterval(timer);
    }
  }, [points]);

  return <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-[10px] border border-[var(--lf-line)]" />;
}
