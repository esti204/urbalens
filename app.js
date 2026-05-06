// UrbaLens — Application Core

import { FirestoreService, StorageService } from "./firebase.js";
import { initMap, renderMarkers, panToReport, setHeatmapVisible } from "./map.js";

// ─── Priority Engine ─────────────────────────────────────────────────────────

const PriorityEngine = {
  compute(report, allReports) {
    const reportCount = allReports.filter(
      (r) => r.category === report.category &&
        Math.abs(r.latitude - report.latitude) < 0.005 &&
        Math.abs(r.longitude - report.longitude) < 0.005
    ).length;

    const severity = report.severity || 1;

    const ageHours = report.timestamp
      ? (Date.now() - new Date(report.timestamp).getTime()) / 3600000
      : 0;
    const timeFactor = Math.max(0, 1 - ageHours / 168); // decay over 1 week

    return (2 * reportCount) + (3 * severity) + (1.5 * timeFactor * 10);
  },

  classify(score) {
    if (score >= 25) return "high";
    if (score >= 12) return "medium";
    return "low";
  },

  enrichReports(reports) {
    return reports.map((r) => ({
      ...r,
      priority: this.compute(r, reports)
    }));
  }
};

// ─── App State ───────────────────────────────────────────────────────────────

const State = {
  reports: [],
  filteredCategory: null,
  heatmapActive: false,
  isLoading: false,
  unsubscribe: null,

  setReports(raw) {
    this.reports = PriorityEngine.enrichReports(raw);
    this.notify();
  },

  getFiltered() {
    if (!this.filteredCategory) return this.reports;
    return this.reports.filter((r) => r.category === this.filteredCategory);
  },

  notify() {
    renderMarkers(this.getFiltered());
    Dashboard.update(this.reports);
    RecentPanel.update(this.reports);
  }
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const Dashboard = {
  update(reports) {
    const totalEl = document.getElementById("stat-total");
    const topCatEl = document.getElementById("stat-top-category");
    const topAreaEl = document.getElementById("stat-top-area");
    const highEl = document.getElementById("stat-high-count");

    if (totalEl) totalEl.textContent = reports.length;

    if (reports.length === 0) {
      if (topCatEl) topCatEl.textContent = "—";
      if (topAreaEl) topAreaEl.textContent = "—";
      if (highEl) highEl.textContent = "0";
      return;
    }

    const catCount = {};
    reports.forEach((r) => {
      catCount[r.category] = (catCount[r.category] || 0) + 1;
    });
    const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
    if (topCatEl) topCatEl.textContent = CATEGORY_LABELS[topCat?.[0]] || "—";

    const highCount = reports.filter(
      (r) => PriorityEngine.classify(r.priority) === "high"
    ).length;
    if (highEl) highEl.textContent = highCount;

    const topReport = [...reports].sort((a, b) => b.priority - a.priority)[0];
    if (topAreaEl && topReport) {
      topAreaEl.textContent = `${topReport.latitude.toFixed(3)}, ${topReport.longitude.toFixed(3)}`;
    }
  }
};

// ─── Recent Panel ────────────────────────────────────────────────────────────

const RecentPanel = {
  update(reports) {
    const list = document.getElementById("recent-list");
    if (!list) return;

    const recent = [...reports]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 8);

    if (recent.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <p>No reports yet. Be the first to report an issue.</p>
        </div>`;
      return;
    }

    list.innerHTML = recent.map((r) => {
      const level = PriorityEngine.classify(r.priority);
      const timeAgo = formatTimeAgo(r.timestamp);
      const label = CATEGORY_LABELS[r.category] || r.category;
      return `
        <div class="report-card" onclick="window.UrbaLens.focusReport('${r.id}')">
          ${r.imageUrl ? `<div class="report-thumb" style="background-image:url('${r.imageUrl}')"></div>` : `<div class="report-thumb report-thumb--placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${CATEGORY_SVG[r.category] || ""}</svg></div>`}
          <div class="report-info">
            <div class="report-header">
              <span class="report-label">${label}</span>
              <span class="priority-dot priority-dot--${level}"></span>
            </div>
            <span class="report-time">${timeAgo}</span>
          </div>
          <div class="report-score">${Math.round(r.priority)}</div>
        </div>`;
    }).join("");
  }
};

// ─── Report Form ─────────────────────────────────────────────────────────────

const ReportForm = {
  pendingFile: null,
  pendingLocation: null,
  isSubmitting: false,

  open() {
    const modal = document.getElementById("report-modal");
    if (!modal) return;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    this.detectLocation();
  },

  close() {
    const modal = document.getElementById("report-modal");
    if (!modal) return;
    modal.classList.remove("open");
    document.body.style.overflow = "";
    this.reset();
  },

  reset() {
    const form = document.getElementById("report-form");
    if (form) form.reset();
    this.pendingFile = null;
    this.pendingLocation = null;
    this.isSubmitting = false;

    const preview = document.getElementById("image-preview");
    if (preview) {
      preview.style.backgroundImage = "";
      preview.classList.remove("has-image");
    }

    const locStatus = document.getElementById("location-status");
    if (locStatus) locStatus.textContent = "Detecting location...";

    document.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".sev-btn").forEach((b) => b.classList.remove("active"));

    const catInput = document.getElementById("report-category");
    const sevInput = document.getElementById("report-severity");
    if (catInput) catInput.value = "";
    if (sevInput) sevInput.value = "3";
  },

  detectLocation() {
    const locStatus = document.getElementById("location-status");
    if (!navigator.geolocation) {
      if (locStatus) locStatus.textContent = "GPS unavailable";
      return;
    }

    if (locStatus) locStatus.textContent = "Locating...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.pendingLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        if (locStatus) locStatus.textContent = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      },
      (err) => {
        if (locStatus) locStatus.textContent = "Location unavailable — tap map to set";
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  },

  handleImageSelect(file) {
    if (!file || !file.type.startsWith("image/")) return;
    this.pendingFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById("image-preview");
      if (preview) {
        preview.style.backgroundImage = `url('${e.target.result}')`;
        preview.classList.add("has-image");
      }
    };
    reader.readAsDataURL(file);
  },

  async submit() {
    if (this.isSubmitting) return;

    const category = document.getElementById("report-category")?.value;
    const severity = parseInt(document.getElementById("report-severity")?.value || "3");
    const description = document.getElementById("report-description")?.value?.trim();

    if (!category) {
      showToast("Please select a category", "warning");
      return;
    }

    if (!this.pendingLocation) {
      showToast("Location is required. Enable GPS or wait.", "warning");
      return;
    }

    this.isSubmitting = true;
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
    }

    try {
      const reportId = `report_${Date.now()}`;
      let imageUrl = null;

      if (this.pendingFile) {
        imageUrl = await StorageService.uploadImage(this.pendingFile, reportId);
      }

      const reportData = {
        id: reportId,
        category,
        severity,
        description: description || null,
        latitude: this.pendingLocation.lat,
        longitude: this.pendingLocation.lng,
        imageUrl,
        timestamp: new Date().toISOString()
      };

      await FirestoreService.addReport(reportData);
      showToast("Report submitted successfully", "success");
      this.close();

      const fresh = await FirestoreService.getReports();
      State.setReports(fresh);

    } catch (err) {
      console.error("Submit error:", err);
      showToast("Failed to submit. Try again.", "error");
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Report";
      }
    }
  }
};

// ─── Filters ─────────────────────────────────────────────────────────────────

function setFilter(category) {
  State.filteredCategory = category;
  document.querySelectorAll(".filter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.cat === (category || "all"));
  });
  renderMarkers(State.getFiltered());
}

// ─── Share ───────────────────────────────────────────────────────────────────

function shareReport(reportId) {
  const url = `${location.origin}${location.pathname}?report=${reportId}`;
  if (navigator.share) {
    navigator.share({ title: "UrbaLens Report", url });
  } else {
    navigator.clipboard.writeText(url).then(() => showToast("Link copied to clipboard", "success"));
  }
}

function focusReport(reportId) {
  panToReport(reportId);
  const panel = document.getElementById("side-panel");
  if (panel && panel.classList.contains("open")) {
    panel.classList.remove("open");
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap() {
  const raw = await FirestoreService.getReports();
  State.setReports(raw);

  State.unsubscribe = FirestoreService.subscribeToReports((reports) => {
    State.setReports(reports);
  });

  const params = new URLSearchParams(location.search);
  const reportId = params.get("report");
  if (reportId) {
    setTimeout(() => focusReport(reportId), 2000);
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  road: "Road Damage",
  garbage: "Garbage",
  drainage: "Drainage",
  streetlight: "Streetlight"
};

const CATEGORY_SVG = {
  road: `<path d="M3 17l2-8h14l2 8M3 17h18M7 17l1-4h8l1 4"/>`,
  garbage: `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>`,
  drainage: `<path d="M12 2v20M2 12h20"/><path d="M12 6L6 12l6 6 6-6-6-6z"/>`,
  streetlight: `<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>`
};

function formatTimeAgo(ts) {
  if (!ts) return "Unknown";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Public API ────────────────────────────────────────────────────────────────

window.UrbaLens = {
  initMap,
  bootstrap,
  openReportModal: () => ReportForm.open(),
  closeReportModal: () => ReportForm.close(),
  submitReport: () => ReportForm.submit(),
  handleImageSelect: (file) => ReportForm.handleImageSelect(file),
  setFilter,
  shareReport,
  focusReport,
  toggleHeatmap() {
    State.heatmapActive = !State.heatmapActive;
    setHeatmapVisible(State.heatmapActive);
    const btn = document.getElementById("heatmap-btn");
    if (btn) btn.classList.toggle("active", State.heatmapActive);
  }
};

export { PriorityEngine, State, ReportForm, bootstrap, showToast, CATEGORY_LABELS };
