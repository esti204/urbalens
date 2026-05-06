// UrbaLens — Map Engine
// Replace YOUR_GOOGLE_MAPS_API_KEY in index.html with your actual key

import { PriorityEngine } from "./app.js";

const CATEGORY_ICONS = {
  road:        { symbol: "⬡", label: "Road Damage" },
  garbage:     { symbol: "⬡", label: "Garbage" },
  drainage:    { symbol: "⬡", label: "Drainage" },
  streetlight: { symbol: "⬡", label: "Streetlight" }
};

const PRIORITY_COLORS = {
  low:    { fill: "#4caf6e", stroke: "#2e7d4f" },
  medium: { fill: "#e8a838", stroke: "#b5791a" },
  high:   { fill: "#e05252", stroke: "#b02020" }
};

let mapInstance = null;
let heatmapLayer = null;
let markersMap = new Map();
let markerClusterer = null;
let activeInfoWindow = null;

// ─── Init ───────────────────────────────────────────────────────────────────

function initMap(containerId = "map") {
  const container = document.getElementById(containerId);
  if (!container || !window.google) return null;

  mapInstance = new google.maps.Map(container, {
    zoom: 13,
    center: { lat: 22.3569, lng: 91.7832 }, // Chittagong default
    mapTypeId: "roadmap",
    disableDefaultUI: true,
    zoomControl: false,
    styles: getMapStyles()
  });

  initHeatmap();
  requestUserLocation();

  return mapInstance;
}

function getMap() {
  return mapInstance;
}

// ─── User Location ──────────────────────────────────────────────────────────

function requestUserLocation() {
  if (!navigator.geolocation || !mapInstance) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const userLatLng = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };

      mapInstance.setCenter(userLatLng);
      mapInstance.setZoom(14);

      new google.maps.Marker({
        position: userLatLng,
        map: mapInstance,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#4a90d9",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3
        },
        title: "Your location",
        zIndex: 1000
      });
    },
    (err) => {
      console.warn("Geolocation unavailable:", err.message);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ─── Heatmap ────────────────────────────────────────────────────────────────

function initHeatmap() {
  if (!mapInstance || !google.maps.visualization) return;

  heatmapLayer = new google.maps.visualization.HeatmapLayer({
    data: [],
    map: null,
    radius: 40,
    opacity: 0.65,
    gradient: [
      "rgba(0,0,0,0)",
      "rgba(76,175,110,0.5)",
      "rgba(232,168,56,0.7)",
      "rgba(224,82,82,0.9)",
      "rgba(180,30,30,1)"
    ]
  });
}

function setHeatmapVisible(visible) {
  if (!heatmapLayer) return;
  heatmapLayer.setMap(visible ? mapInstance : null);
}

function updateHeatmap(reports) {
  if (!heatmapLayer || !google.maps.visualization) return;

  const heatData = reports.map((r) => ({
    location: new google.maps.LatLng(r.latitude, r.longitude),
    weight: r.priority || 1
  }));

  heatmapLayer.setData(heatData);
}

// ─── Markers ────────────────────────────────────────────────────────────────

function renderMarkers(reports) {
  if (!mapInstance) return;

  const existing = new Set(markersMap.keys());

  reports.forEach((report) => {
    if (markersMap.has(report.id)) {
      existing.delete(report.id);
      return;
    }

    const marker = createMarker(report);
    markersMap.set(report.id, marker);
    existing.delete(report.id);
  });

  existing.forEach((id) => {
    const m = markersMap.get(id);
    if (m) m.setMap(null);
    markersMap.delete(id);
  });

  updateHeatmap(reports);
}

function createMarker(report) {
  const priorityLevel = PriorityEngine.classify(report.priority || 0);
  const colors = PRIORITY_COLORS[priorityLevel];

  const marker = new google.maps.Marker({
    position: { lat: report.latitude, lng: report.longitude },
    map: mapInstance,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: colors.fill,
      fillOpacity: 0.92,
      strokeColor: colors.stroke,
      strokeWeight: 2
    },
    title: report.category,
    zIndex: Math.round(report.priority || 1)
  });

  marker.addListener("click", () => showInfoWindow(marker, report));
  return marker;
}

function showInfoWindow(marker, report) {
  if (activeInfoWindow) activeInfoWindow.close();

  const priorityLevel = PriorityEngine.classify(report.priority || 0);
  const colors = PRIORITY_COLORS[priorityLevel];
  const timeAgo = formatTimeAgo(report.timestamp);
  const categoryLabel = CATEGORY_ICONS[report.category]?.label || report.category;

  const content = `
    <div class="iw-container">
      ${report.imageUrl ? `<div class="iw-image" style="background-image:url('${report.imageUrl}')"></div>` : ""}
      <div class="iw-body">
        <span class="iw-badge" style="background:${colors.fill}20;color:${colors.stroke};border:1px solid ${colors.fill}40">
          ${priorityLevel.toUpperCase()}
        </span>
        <h4 class="iw-title">${categoryLabel}</h4>
        <p class="iw-meta">${timeAgo}</p>
        ${report.description ? `<p class="iw-desc">${report.description}</p>` : ""}
        <div class="iw-stats">
          <span>Severity: ${report.severity}/5</span>
          <span>Score: ${Math.round(report.priority || 0)}</span>
        </div>
        <button class="iw-share" onclick="window.UrbaLens.shareReport('${report.id}')">Share</button>
      </div>
    </div>
  `;

  activeInfoWindow = new google.maps.InfoWindow({
    content,
    maxWidth: 280
  });

  activeInfoWindow.open(mapInstance, marker);
}

function panToReport(reportId) {
  const marker = markersMap.get(reportId);
  if (!marker || !mapInstance) return;
  mapInstance.panTo(marker.getPosition());
  mapInstance.setZoom(16);
  google.maps.event.trigger(marker, "click");
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatTimeAgo(ts) {
  if (!ts) return "Unknown time";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Custom Map Style ────────────────────────────────────────────────────────

function getMapStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#f5f0e8" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#5c4a32" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5efe6" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#e8dfd0" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#ddd0bb" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d4c4a8" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#b8a88a" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#b8d4e8" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a7a9b" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#e4ddd0" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d4e8c8" }] },
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "simplified" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#ddd0bb" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#c8b89a" }] }
  ];
}

export { initMap, getMap, renderMarkers, panToReport, setHeatmapVisible, requestUserLocation };
