var __dsRecorderId = "dsh-ai-recorder";
try {
  var __dsUrls = [];
  if (typeof document !== "undefined") {
    if (document.currentScript && document.currentScript.src) __dsUrls.push(document.currentScript.src);
    var __dsTags = document.querySelectorAll("script[src]");
    for (var __i = 0; __i < __dsTags.length; __i++) __dsUrls.push(__dsTags[__i].src);
  }
  var __dsRe = new RegExp("(dsh-ai-recorder[^\\/,.?&]*)/client\\.js");
  for (var __j = 0; __j < __dsUrls.length; __j++) {
    var __m = __dsRe.exec(__dsUrls[__j] || "");
    if (__m && __m[1]) { __dsRecorderId = __m[1]; break; }
  }
} catch (__e) { /* 反推失败就用构建时的 id */ }
window.__ModuleLoader__.load({ id: __dsRecorderId, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/api.ts
var API = "/api/recorder";
var startScan = (opts) => post("/ble/scan", { action: "start", ...opts });
var stopScan = () => post("/ble/scan", { action: "stop" });
var knownDevices = () => get("/ble/known");
function fmtRssi(rssi) {
  if (rssi >= -60) return "\u4FE1\u53F7\u5F88\u597D";
  if (rssi >= -75) return "\u4FE1\u53F7\u826F\u597D";
  if (rssi >= -85) return "\u4FE1\u53F7\u504F\u5F31";
  return "\u4FE1\u53F7\u5F88\u5F31";
}
function fmtAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1e3));
  if (s < 60) return "\u521A\u521A";
  if (s < 3600) return `${Math.floor(s / 60)} \u5206\u949F\u524D`;
  if (s < 86400) return `${Math.floor(s / 3600)} \u5C0F\u65F6\u524D`;
  return `${Math.floor(s / 86400)} \u5929\u524D`;
}
async function api(path, init) {
  const r = await fetch(API + path, {
    headers: { "content-type": "application/json" },
    ...init
  });
  const text = await r.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { ok: false, error: text.slice(0, 300) };
  }
  if (!r.ok || json.ok === false) {
    throw new Error(json?.error ?? `HTTP ${r.status}`);
  }
  return json;
}
var get = (path) => api(path);
var post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
var audioUrl = (sessionId) => `${API}/session/${encodeURIComponent(sessionId)}/audio`;
var markdownUrl = (sessionId) => `${API}/session/${encodeURIComponent(sessionId)}/markdown`;
var eventsUrl = (sessionId) => `${API}/session/${encodeURIComponent(sessionId)}/events`;
var setTitle = (sessionId, title, source = "user") => post("/title", { sessionId, title, source });
function downloadName(rec, ext) {
  const base = (rec.title ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base || rec.id}${ext}`;
}
function extOf(file) {
  const i = file.lastIndexOf(".");
  return i > 0 ? file.slice(i) : "";
}
var deleteSession = (sessionId) => api(`/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
var deleteSessions = (ids) => post("/sessions/delete", { ids });
function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = /* @__PURE__ */ new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const p = (n) => String(n).padStart(2, "0");
  if (sameDay) return `\u4ECA\u5929 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "\u2014";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
var SOURCE_LABEL = {
  realtime: "\u5B9E\u65F6",
  file: "\u8BBE\u5907",
  upload: "\u4E0A\u4F20"
};
function fmtBattery(v) {
  if (v === null || v === void 0) return "\u2014";
  if (v === 110) return "\u5145\u7535\u4E2D";
  return `${v}%`;
}

// src/client/RecorderLibrary.tsx
var React3 = __toESM(require("react"), 1);

// src/client/AudioPlayer.tsx
var React2 = __toESM(require("react"), 1);

// src/client/ui.tsx
var React = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var C = {
  bg1: "var(--dsw-alias-bg-layer-1, #ffffff)",
  bg2: "var(--dsw-alias-bg-layer-2, #f7f7f8)",
  bg3: "var(--dsw-alias-bg-layer-3, #f0f0f2)",
  ink: "var(--dsw-alias-label-primary, var(--dsw-alias-text-primary, #1a1a1a))",
  ink2: "var(--dsw-alias-label-secondary, var(--dsw-alias-text-secondary, #555555))",
  ink3: "var(--dsw-alias-label-tertiary, var(--dsw-alias-text-tertiary, #8a8a8a))",
  border: "var(--dsw-alias-border-l2, #e4e4e4)",
  border3: "var(--dsw-alias-border-l3, #d0d0d0)",
  brand: "var(--dsw-alias-brand-primary, #4a7cff)",
  ok: "var(--dsw-alias-state-success-primary, #1a8a4a)",
  warn: "var(--dsw-alias-state-warn-label, #b06a00)",
  danger: "var(--dsw-alias-state-error-primary, #c0392b)",
  hoverDanger: "var(--dsw-alias-interactive-bg-hover-danger, #fdecea)"
};
var mono = "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)";
function Btn(props) {
  const [hover, setHover] = React.useState(false);
  const base = {
    border: `1px solid ${props.primary ? "transparent" : C.border3}`,
    background: props.primary ? C.brand : props.danger && hover ? C.hoverDanger : C.bg3,
    color: props.primary ? "#fff" : props.danger && hover ? C.danger : C.ink,
    borderRadius: 6,
    padding: props.small ? "2px 8px" : "5px 12px",
    fontSize: props.small ? 12 : 13,
    lineHeight: 1.5,
    cursor: props.disabled ? "not-allowed" : "pointer",
    opacity: props.disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
    transition: "background 120ms, border-color 120ms",
    ...props.style
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      title: props.title,
      disabled: props.disabled,
      onClick: props.onClick,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: base,
      children: props.children
    }
  );
}
function Chip(props) {
  const color = props.tone === "ok" ? C.ok : props.tone === "warn" ? C.warn : props.tone === "brand" ? C.brand : C.ink3;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      title: props.title,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        lineHeight: 1.7,
        border: `1px solid ${C.border}`,
        color,
        whiteSpace: "nowrap"
      },
      children: props.children
    }
  );
}
function Panel(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      style: {
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.bg2,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...props.style
      },
      children: [
        props.title !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "header",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "9px 14px",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 13,
              fontWeight: 600,
              color: C.ink,
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: props.title }),
              props.extra
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: 14, minHeight: 0, ...props.bodyStyle }, children: props.children })
      ]
    }
  );
}
function Field(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: C.ink2 }, children: props.label }),
    props.children,
    props.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: C.ink3 }, children: props.hint })
  ] });
}
function Select(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "select",
    {
      value: props.value,
      onChange: (e) => props.onChange(e.target.value),
      style: {
        border: `1px solid ${C.border3}`,
        background: C.bg1,
        color: C.ink,
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        width: props.width
      },
      children: props.options.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: o.value, children: o.label }, o.value))
    }
  );
}
function NumberInput(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "input",
    {
      type: "number",
      value: props.value,
      min: props.min,
      max: props.max,
      step: props.step,
      onChange: (e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) props.onChange(n);
      },
      style: {
        border: `1px solid ${C.border3}`,
        background: C.bg1,
        color: C.ink,
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        width: props.width ?? 96
      }
    }
  );
}
function Switch(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": props.on,
      title: props.title,
      onClick: () => props.onChange(!props.on),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        border: `1px solid ${props.on ? C.border3 : C.border}`,
        background: props.on ? C.bg3 : "transparent",
        color: props.on ? C.ink : C.ink3,
        borderRadius: 999,
        padding: "3px 10px 3px 4px",
        fontSize: 12,
        cursor: "pointer"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            "aria-hidden": true,
            style: {
              width: 26,
              height: 15,
              borderRadius: 999,
              background: props.on ? C.brand : C.border3,
              position: "relative",
              flexShrink: 0,
              transition: "background 140ms"
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "span",
              {
                style: {
                  position: "absolute",
                  top: 2,
                  left: props.on ? 13 : 2,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 140ms"
                }
              }
            )
          }
        ),
        props.label
      ]
    }
  );
}
function Row(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...props.style }, children: props.children });
}
function Grid(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: props.cols,
        gap: props.gap ?? 10,
        alignItems: "center",
        ...props.style
      },
      children: props.children
    }
  );
}
function Muted(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: C.ink3, lineHeight: 1.7, ...props.style }, children: props.children });
}
function Empty(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 120,
        color: C.ink3,
        fontSize: 13,
        textAlign: "center",
        padding: 20,
        lineHeight: 1.9
      },
      children: props.children
    }
  );
}
function ErrorBar(props) {
  if (!props.text) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        border: `1px solid ${C.danger}`,
        background: C.hoverDanger,
        color: C.danger,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        lineHeight: 1.7,
        wordBreak: "break-word"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: props.text }),
        props.onClose && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: props.onClose,
            style: { border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 14, lineHeight: 1 },
            children: "\xD7"
          }
        )
      ]
    }
  );
}
function Loading(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, color: C.ink3, fontSize: 13, padding: 20 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "span",
      {
        style: {
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `2px solid ${C.border3}`,
          borderTopColor: C.brand,
          animation: "dsh-rec-spin 700ms linear infinite"
        }
      }
    ),
    props.text ?? "\u52A0\u8F7D\u4E2D\u2026",
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: "@keyframes dsh-rec-spin{to{transform:rotate(360deg)}}" })
  ] });
}

// src/client/AudioPlayer.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var RATES = [0.75, 1, 1.25, 1.5, 2];
function AudioPlayer(props) {
  const ref = React2.useRef(null);
  const trackRef = React2.useRef(null);
  const [playing, setPlaying] = React2.useState(false);
  const [ready, setReady] = React2.useState(false);
  const [failed, setFailed] = React2.useState(null);
  const [mediaDuration, setMediaDuration] = React2.useState(0);
  const [current, setCurrent] = React2.useState(0);
  const [buffered, setBuffered] = React2.useState(0);
  const [rate, setRate] = React2.useState(1);
  const [drag, setDrag] = React2.useState(null);
  const [hoverRatio, setHoverRatio] = React2.useState(null);
  const fallbackSec = Math.max(0, (props.fallbackDurationMs ?? 0) / 1e3);
  const duration = mediaDuration > 0 ? mediaDuration : fallbackSec;
  const shown = drag !== null ? drag * duration : current;
  React2.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        setCurrent(el.currentTime);
        try {
          if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1));
        } catch {
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  React2.useEffect(() => {
    setPlaying(false);
    setReady(false);
    setFailed(null);
    setMediaDuration(0);
    setCurrent(0);
    setBuffered(0);
    setDrag(null);
  }, [props.src]);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch((e) => {
        setFailed(e instanceof Error ? e.message : String(e));
      });
    } else {
      el.pause();
    }
  };
  const seekTo = (sec) => {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(sec, duration > 0 ? duration : sec));
    try {
      el.currentTime = clamped;
    } catch {
    }
    setCurrent(clamped);
  };
  const ratioFromEvent = (clientX) => {
    const track = trackRef.current;
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  React2.useEffect(() => {
    if (!props.seekRef) return;
    props.seekRef.current = (sec) => {
      seekTo(sec);
      const el = ref.current;
      if (el && el.paused) void el.play().catch(() => void 0);
    };
    return () => {
      if (props.seekRef) props.seekRef.current = null;
    };
  }, [props.seekRef, duration]);
  React2.useEffect(() => {
    if (drag === null) return;
    const move = (e) => setDrag(ratioFromEvent(e.clientX));
    const up = (e) => {
      const ratio = ratioFromEvent(e.clientX);
      setDrag(null);
      seekTo(ratio * duration);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, duration]);
  const pct = (v) => `${duration > 0 ? Math.min(100, v / duration * 100) : 0}%`;
  const barPct = drag !== null ? `${drag * 100}%` : pct(shown);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.bg1
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "audio",
          {
            ref,
            src: props.src,
            preload: "metadata",
            onLoadedMetadata: (e) => {
              const el = e.currentTarget;
              setReady(true);
              setFailed(null);
              if (Number.isFinite(el.duration) && el.duration > 0) setMediaDuration(el.duration);
            },
            onDurationChange: (e) => {
              const el = e.currentTarget;
              if (Number.isFinite(el.duration) && el.duration > 0) setMediaDuration(el.duration);
            },
            onTimeUpdate: (e) => {
              if (drag === null) setCurrent(e.currentTarget.currentTime);
            },
            onPlay: () => setPlaying(true),
            onPause: () => setPlaying(false),
            onEnded: () => {
              setPlaying(false);
              setCurrent(0);
            },
            onError: () => setFailed("\u6D4F\u89C8\u5668\u65E0\u6CD5\u89E3\u7801\u8FD9\u6BB5\u97F3\u9891\uFF08\u53EF\u80FD\u662F\u4E0D\u53D7\u652F\u6301\u7684\u7F16\u7801\uFF09"),
            style: { display: "none" }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              onClick: toggle,
              disabled: !!failed,
              title: playing ? "\u6682\u505C" : "\u64AD\u653E",
              style: {
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: "50%",
                border: "none",
                background: failed ? C.border3 : C.brand,
                color: "#fff",
                cursor: failed ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 100ms"
              },
              children: playing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "13", height: "13", viewBox: "0 0 12 12", "aria-hidden": true, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "1.5", y: "1", width: "3", height: "10", rx: "1", fill: "currentColor" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "7.5", y: "1", width: "3", height: "10", rx: "1", fill: "currentColor" })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { width: "13", height: "13", viewBox: "0 0 12 12", "aria-hidden": true, style: { marginLeft: 2 }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M2 1.2 10.4 6 2 10.8Z", fill: "currentColor" }) })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontFamily: mono, fontSize: 12, color: C.ink2, minWidth: 46, textAlign: "right" }, children: fmtClock(shown * 1e3) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "div",
            {
              ref: trackRef,
              role: "slider",
              "aria-label": "\u64AD\u653E\u8FDB\u5EA6",
              "aria-valuemin": 0,
              "aria-valuemax": Math.round(duration),
              "aria-valuenow": Math.round(shown),
              tabIndex: 0,
              onPointerDown: (e) => {
                e.preventDefault();
                setDrag(ratioFromEvent(e.clientX));
              },
              onPointerMove: (e) => {
                if (drag === null) setHoverRatio(ratioFromEvent(e.clientX));
              },
              onPointerLeave: () => setHoverRatio(null),
              onKeyDown: (e) => {
                if (e.key === "ArrowLeft") seekTo(shown - 5);
                else if (e.key === "ArrowRight") seekTo(shown + 5);
                else if (e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              },
              style: {
                position: "relative",
                flex: 1,
                height: 20,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                touchAction: "none",
                outline: "none"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { position: "absolute", inset: "8px 0", borderRadius: 999, background: C.bg3 } }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      top: 8,
                      bottom: 8,
                      left: 0,
                      width: pct(buffered),
                      borderRadius: 999,
                      background: C.border3,
                      opacity: 0.7
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      top: 8,
                      bottom: 8,
                      left: 0,
                      width: barPct,
                      borderRadius: 999,
                      background: C.brand,
                      transition: drag === null ? "width 80ms linear" : "none"
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      left: barPct,
                      width: 12,
                      height: 12,
                      marginLeft: -6,
                      borderRadius: "50%",
                      background: "#fff",
                      border: `2px solid ${C.brand}`,
                      boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                      transform: drag !== null ? "scale(1.15)" : "scale(1)",
                      transition: "transform 100ms"
                    }
                  }
                ),
                hoverRatio !== null && drag === null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      left: `${hoverRatio * 100}%`,
                      bottom: 22,
                      transform: "translateX(-50%)",
                      background: C.ink,
                      color: C.bg1,
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 11,
                      fontFamily: mono,
                      pointerEvents: "none",
                      whiteSpace: "nowrap"
                    },
                    children: fmtClock(hoverRatio * duration * 1e3)
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontFamily: mono, fontSize: 12, color: C.ink3, minWidth: 46 }, children: duration > 0 ? fmtClock(duration * 1e3) : "--:--" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "select",
            {
              value: String(rate),
              onChange: (e) => {
                const v = Number(e.target.value);
                setRate(v);
                if (ref.current) ref.current.playbackRate = v;
              },
              title: "\u64AD\u653E\u901F\u5EA6",
              style: {
                border: `1px solid ${C.border3}`,
                background: C.bg2,
                color: C.ink2,
                borderRadius: 6,
                padding: "3px 6px",
                fontSize: 11
              },
              children: RATES.map((r) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: String(r), children: [
                r,
                "\xD7"
              ] }, r))
            }
          )
        ] }),
        failed && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, color: C.danger, lineHeight: 1.7 }, children: [
          failed,
          " \xB7 ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: props.src, download: props.downloadName, style: { color: C.brand }, children: "\u4E0B\u8F7D\u540E\u7528\u672C\u5730\u64AD\u653E\u5668\u6253\u5F00" })
        ] }),
        !failed && !ready && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11, color: C.ink3 }, children: "\u6B63\u5728\u8BFB\u53D6\u97F3\u9891\u5143\u6570\u636E\u2026" })
      ]
    }
  );
}

// src/client/RecorderLibrary.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function RecorderLibrary() {
  const [rows, setRows] = React3.useState(null);
  const [selected, setSelected] = React3.useState(null);
  const [deliverTemplates, setDeliverTemplates] = React3.useState([]);
  const [deliverTemplateId, setDeliverTemplateId] = React3.useState("");
  const [deliverFormat, setDeliverFormat] = React3.useState("transcript");
  const [delivering, setDelivering] = React3.useState(false);
  const [deliverMsg, setDeliverMsg] = React3.useState(null);
  const [openSession, setOpenSession] = React3.useState({
    sessionId: null,
    title: null
  });
  React3.useEffect(() => {
    const load = async () => {
      try {
        const r = await get("/open-session");
        setOpenSession({ sessionId: r.sessionId, title: r.title });
      } catch {
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 3e3);
    return () => window.clearInterval(t);
  }, []);
  React3.useEffect(() => {
    void (async () => {
      try {
        const r = await get(
          "/post-process"
        );
        setDeliverTemplates(r.templates ?? []);
        setDeliverTemplateId((cur) => cur || r.config?.templateId || r.templates?.[0]?.id || "");
      } catch {
      }
    })();
  }, []);
  const [detail, setDetail] = React3.useState(null);
  const [detailLoading, setDetailLoading] = React3.useState(false);
  const [err, setErr] = React3.useState(null);
  const [filter, setFilter] = React3.useState("");
  const [pendingDelete, setPendingDelete] = React3.useState(null);
  const [deleting, setDeleting] = React3.useState(false);
  const [selectMode, setSelectMode] = React3.useState(false);
  const [picked, setPicked] = React3.useState(() => /* @__PURE__ */ new Set());
  const [confirmBatch, setConfirmBatch] = React3.useState(false);
  const seekRef = React3.useRef(null);
  const loadList = React3.useCallback(async (keepSelection = true) => {
    try {
      const r = await get("/sessions");
      setRows(r.items ?? []);
      setErr(null);
      setSelected((prev) => {
        if (keepSelection && prev && (r.items ?? []).some((x) => x.id === prev)) return prev;
        return r.items?.[0]?.id ?? null;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  React3.useEffect(() => {
    void loadList(false);
  }, [loadList]);
  React3.useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    void (async () => {
      try {
        const r = await get(`/session/${encodeURIComponent(selected)}`);
        if (alive) {
          setDetail(r);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);
  const shown = React3.useMemo(() => {
    const list = rows ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) => (r.title ?? "").toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || fmtDateTime(r.createdAt).includes(q) || (SOURCE_LABEL[r.source] ?? r.source).includes(q)
    );
  }, [rows, filter]);
  const doDelete = React3.useCallback(
    async (id) => {
      setDeleting(true);
      setErr(null);
      try {
        await deleteSession(id);
        const idx = shown.findIndex((r) => r.id === id);
        const neighbour = shown[idx + 1]?.id ?? shown[idx - 1]?.id ?? null;
        setPendingDelete(null);
        if (selected === id) setDetail(null);
        await loadList();
        if (neighbour) setSelected(neighbour);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setDeleting(false);
      }
    },
    [shown, selected, loadList]
  );
  const pickedRows = React3.useMemo(() => shown.filter((r) => picked.has(r.id)), [shown, picked]);
  const pickedBytes = pickedRows.reduce((n, r) => n + (r.bytes || 0), 0);
  const pickedWithSummary = pickedRows.filter((r) => r.hasSummary).length;
  const doBatchDelete = React3.useCallback(async () => {
    const ids = pickedRows.map((r) => r.id);
    if (ids.length === 0) return;
    setDeleting(true);
    setErr(null);
    try {
      const r = await deleteSessions(ids);
      if (r.failed.length > 0) {
        setErr(
          `${r.deleted.length} \u6761\u5DF2\u5220\u9664\uFF0C${r.failed.length} \u6761\u5931\u8D25\uFF1A` + r.failed.slice(0, 3).map((f) => `${f.id}\uFF08${f.error}\uFF09`).join("\uFF1B")
        );
      }
      if (selected && ids.includes(selected)) setDetail(null);
      setPicked(/* @__PURE__ */ new Set());
      setConfirmBatch(false);
      await loadList();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [pickedRows, selected, loadList]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", height: "100%", minHeight: 0, background: C.bg1, color: C.ink }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "aside",
      {
        style: {
          width: 292,
          flexShrink: 0,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: C.bg2
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "10px 12px", borderBottom: `1px solid ${C.border}` }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  value: filter,
                  onChange: (e) => setFilter(e.target.value),
                  placeholder: "\u641C\u7D22\u5F55\u97F3\u2026",
                  style: {
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${C.border3}`,
                    background: C.bg1,
                    color: C.ink,
                    borderRadius: 6,
                    padding: "5px 9px",
                    fontSize: 12,
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, onClick: () => void loadList(), title: "\u5237\u65B0\u5217\u8868", children: "\u5237\u65B0" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                Btn,
                {
                  small: true,
                  primary: selectMode,
                  title: "\u591A\u9009\u5220\u9664",
                  onClick: () => {
                    setSelectMode((v) => !v);
                    setPicked(/* @__PURE__ */ new Set());
                    setConfirmBatch(false);
                    setPendingDelete(null);
                  },
                  children: selectMode ? "\u9000\u51FA\u591A\u9009" : "\u591A\u9009"
                }
              )
            ] }),
            selectMode && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    const all = shown.length > 0 && shown.every((r) => picked.has(r.id));
                    setPicked(all ? /* @__PURE__ */ new Set() : new Set(shown.map((r) => r.id)));
                  },
                  style: {
                    border: `1px solid ${C.border3}`,
                    background: C.bg1,
                    color: C.ink2,
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 11,
                    cursor: "pointer"
                  },
                  children: shown.length > 0 && shown.every((r) => picked.has(r.id)) ? "\u53D6\u6D88\u5168\u9009" : "\u5168\u9009"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { fontSize: 11, color: C.ink3 }, children: [
                "\u5DF2\u9009 ",
                picked.size,
                " \u6761",
                picked.size > 0 ? ` \xB7 ${fmtBytes(pickedBytes)}` : ""
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                Btn,
                {
                  small: true,
                  danger: true,
                  disabled: picked.size === 0 || deleting,
                  style: { marginLeft: "auto" },
                  onClick: () => setConfirmBatch(true),
                  children: "\u5220\u9664\u9009\u4E2D"
                }
              )
            ] }),
            selectMode && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: {
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: `1px solid ${C.border}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 11, color: C.ink3, lineHeight: 1.5 }, children: [
                    "\u6295\u653E\u76EE\u6807\uFF1A",
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: C.ink, fontWeight: 600 }, children: openSession.title ?? openSession.sessionId ?? "\uFF08\u5C1A\u672A\u8BC6\u522B\u5230\u5F53\u524D\u5BF9\u8BDD\uFF09" }),
                    openSession.sessionId && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: C.ink3 }, children: " \xB7 \u5F53\u524D\u6253\u5F00\u7684\u90A3\u4E2A\u5BF9\u8BDD" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 11, color: C.ink3, flexShrink: 0 }, children: "\u6295\u653E\u5185\u5BB9" }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                      "select",
                      {
                        value: deliverFormat,
                        onChange: (e) => setDeliverFormat(e.target.value),
                        style: {
                          flex: 1,
                          minWidth: 0,
                          border: `1px solid ${C.border3}`,
                          background: C.bg1,
                          color: C.ink,
                          borderRadius: 6,
                          padding: "3px 6px",
                          fontSize: 11
                        },
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "transcript", children: "\u8F6C\u5199\u539F\u6587" }),
                          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "markdown", children: "Markdown \u6587\u6863" }),
                          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "notes", children: "\u7EAA\u8981" })
                        ]
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 11, color: C.ink3, flexShrink: 0 }, children: "\u63D0\u793A\u8BCD" }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                      "select",
                      {
                        value: deliverTemplateId,
                        onChange: (e) => setDeliverTemplateId(e.target.value),
                        style: {
                          flex: 1,
                          minWidth: 0,
                          border: `1px solid ${C.border3}`,
                          background: C.bg1,
                          color: C.ink,
                          borderRadius: 6,
                          padding: "3px 6px",
                          fontSize: 11
                        },
                        children: deliverTemplates.map((t) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: t.id, children: t.name }, t.id))
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    Btn,
                    {
                      small: true,
                      primary: true,
                      disabled: picked.size === 0 || delivering || !deliverTemplateId,
                      onClick: () => void (async () => {
                        setDelivering(true);
                        setDeliverMsg(null);
                        try {
                          const r = await post("/deliver", {
                            sessionIds: [...picked],
                            format: deliverFormat,
                            templateId: deliverTemplateId
                          });
                          setDeliverMsg(
                            `\u5DF2\u6295\u653E ${r.sent} \u6761 \u2192 \u4F1A\u8BDD ${r.sessionId.slice(0, 18)}\u2026` + (r.skipped.length > 0 ? `\uFF08\u8DF3\u8FC7 ${r.skipped.length} \u6761\uFF09` : "")
                          );
                          setPicked(/* @__PURE__ */ new Set());
                          await loadList();
                        } catch (e) {
                          setDeliverMsg(`\u6295\u653E\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
                        } finally {
                          setDelivering(false);
                        }
                      })(),
                      children: delivering ? "\u6295\u653E\u4E2D\u2026" : "\u6295\u653E\u7ED9 Agent" + (picked.size > 0 ? " (" + String(picked.size) + ")" : "")
                    }
                  ),
                  deliverMsg && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 11, color: C.ink3 }, children: deliverMsg })
                ]
              }
            )
          ] }),
          confirmBatch && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "div",
            {
              style: {
                padding: "9px 12px",
                background: C.hoverDanger,
                borderBottom: `1px solid ${C.danger}`,
                fontSize: 12,
                color: C.danger,
                lineHeight: 1.75
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginBottom: 7 }, children: [
                  "\u5220\u9664\u9009\u4E2D\u7684 ",
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: picked.size }),
                  " \u6761\u5F55\u97F3\uFF08\u5171 ",
                  fmtBytes(pickedBytes),
                  "\uFF09\uFF1F \u97F3\u9891\u4E0E\u8F6C\u5199\u6587\u6863\u4F1A\u4E00\u5E76\u5220\u6389\uFF0C",
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u4E0D\u53EF\u6062\u590D" }),
                  "\u3002",
                  pickedWithSummary > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: 3 }, children: [
                    "\u5176\u4E2D ",
                    pickedWithSummary,
                    " \u6761\u5DF2\u6709 LLM \u603B\u7ED3\uFF0C\u603B\u7ED3\u4F1A\u5148\u5F52\u6863\u5230 summaries/ \u518D\u5220\uFF0C\u4E0D\u4F1A\u4E22\u3002"
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, danger: true, disabled: deleting, onClick: () => void doBatchDelete(), children: deleting ? "\u5220\u9664\u4E2D\u2026" : "\u786E\u8BA4\u5220\u9664" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, disabled: deleting, onClick: () => setConfirmBatch(false), children: "\u53D6\u6D88" })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { flex: 1, overflowY: "auto", minHeight: 0 }, children: rows === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Loading, {}) : shown.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            "\u8FD8\u6CA1\u6709\u5F55\u97F3\u3002",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
            "\u5230\u300C\u5F55\u97F3\u5361\u540E\u7AEF\u300D\u9875\u8FDE\u4E0A\u8BBE\u5907\u540C\u6B65\uFF0C\u6216\u4E0A\u4F20\u97F3\u9891\u3002"
          ] }) : "\u6CA1\u6709\u5339\u914D\u7684\u5F55\u97F3" }) : shown.map((r) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            SessionItem,
            {
              row: r,
              active: r.id === selected,
              confirming: pendingDelete === r.id,
              busy: deleting,
              selectMode,
              picked: picked.has(r.id),
              onTogglePick: () => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(r.id)) next.delete(r.id);
                else next.add(r.id);
                return next;
              }),
              onClick: () => {
                if (selectMode) {
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  });
                  return;
                }
                setPendingDelete(null);
                setSelected(r.id);
              },
              onAskDelete: () => setPendingDelete(r.id),
              onCancelDelete: () => setPendingDelete(null),
              onConfirmDelete: () => void doDelete(r.id)
            },
            r.id
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.ink3 }, children: [
            "\u5171 ",
            rows?.length ?? 0,
            " \u6761\u5F55\u97F3"
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("main", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }, children: [
      err && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: 12 }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorBar, { text: err, onClose: () => setErr(null) }) }),
      !selected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { children: "\u4ECE\u5DE6\u4FA7\u9009\u4E00\u6761\u5F55\u97F3\u67E5\u770B\u5185\u5BB9" }) : detailLoading && !detail ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Loading, { text: "\u6B63\u5728\u8BFB\u53D6\u5F55\u97F3\u2026" }) : !detail ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { children: "\u8BFB\u53D6\u5931\u8D25" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        SessionDetail,
        {
          detail,
          seekRef,
          confirmingDelete: pendingDelete === detail.session.id,
          deleting,
          onAskDelete: () => setPendingDelete(detail.session.id),
          onCancelDelete: () => setPendingDelete(null),
          onConfirmDelete: () => void doDelete(detail.session.id),
          onRenamed: (session) => {
            setDetail((prev) => prev ? { ...prev, session } : prev);
            void loadList();
          }
        }
      )
    ] })
  ] });
}
function SessionItem(props) {
  const { row, active, confirming, selectMode, picked } = props;
  const [hover, setHover] = React3.useState(false);
  const highlight = confirming || selectMode && picked;
  return (
    // 用 div 而不是 button：行内还要放删除按钮与勾选框，button 不能嵌套 button
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        role: "button",
        tabIndex: 0,
        onClick: props.onClick,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onClick();
          }
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          width: "100%",
          textAlign: "left",
          borderLeft: `3px solid ${active && !selectMode ? C.brand : "transparent"}`,
          background: highlight ? C.hoverDanger : active && !selectMode ? C.bg3 : hover ? C.bg1 : "transparent",
          padding: "9px 12px 9px 9px",
          cursor: "pointer",
          borderBottom: `1px solid ${C.border}`,
          boxSizing: "border-box",
          outline: "none"
        },
        children: [
          selectMode && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "span",
            {
              "aria-hidden": true,
              style: {
                flexShrink: 0,
                marginTop: 2,
                width: 15,
                height: 15,
                borderRadius: 4,
                border: `1px solid ${picked ? C.brand : C.border3}`,
                background: picked ? C.brand : C.bg1,
                color: "#fff",
                fontSize: 11,
                lineHeight: "13px",
                textAlign: "center"
              },
              children: picked ? "\u2713" : ""
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "span",
                {
                  title: row.title || row.id,
                  style: {
                    fontSize: 13,
                    fontWeight: active && !selectMode ? 600 : 500,
                    color: C.ink,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0
                  },
                  children: row.title || row.id
                }
              ),
              confirming ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontFamily: mono, fontSize: 11, color: C.ink3, flexShrink: 0 }, children: fmtClock(row.durationMs) })
            ] }),
            confirming ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: { display: "flex", alignItems: "center", gap: 6, marginTop: 7 },
                onClick: (e) => e.stopPropagation(),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 11, color: C.danger, flex: 1 }, children: row.hasSummary ? "\u5220\u9664\uFF1FLLM \u603B\u7ED3\u4F1A\u5148\u5F52\u6863" : "\u5220\u9664\u8FD9\u6761\u5F55\u97F3\uFF1F\u4E0D\u53EF\u6062\u590D" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, danger: true, disabled: props.busy, onClick: props.onConfirmDelete, children: props.busy ? "\u5220\u9664\u4E2D\u2026" : "\u5220\u9664" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, disabled: props.busy, onClick: props.onCancelDelete, children: "\u53D6\u6D88" })
                ]
              }
            ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 5,
                  fontSize: 11,
                  color: C.ink3,
                  flexWrap: "wrap"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontFamily: mono }, children: fmtDay(row.createdAt) }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "span",
                    {
                      style: {
                        padding: "0 6px",
                        borderRadius: 4,
                        background: C.bg3,
                        color: C.ink2,
                        lineHeight: "16px"
                      },
                      children: SOURCE_LABEL[row.source] ?? row.source
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                    row.segments,
                    " \u6BB5"
                  ] }),
                  row.titleSource === "user" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: "\u624B\u52A8\u547D\u540D", children: "\u270E" }),
                  row.titleSource === "llm" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: "LLM \u547D\u540D", children: "\u2728" }),
                  row.hasSummary && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: "\u5DF2\u6709 LLM \u603B\u7ED3\uFF08\u5220\u9664\u65F6\u4F1A\u5F52\u6863\u4FDD\u7559\uFF09", children: "\u{1F9E0}" }),
                  row.hasAudio && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: "\u6709\u97F3\u9891", children: "\u266A" }),
                  row.hasMarkdown && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: "\u6709\u6587\u6863", children: "\u{1F4C4}" }),
                  row.status === "open" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { tone: "brand", children: "\u8FDB\u884C\u4E2D" }),
                  !selectMode && (hover || active) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "button",
                    {
                      type: "button",
                      title: "\u5220\u9664\u8FD9\u6761\u5F55\u97F3",
                      onClick: (e) => {
                        e.stopPropagation();
                        props.onAskDelete();
                      },
                      style: {
                        marginLeft: "auto",
                        border: "none",
                        background: "transparent",
                        color: C.ink3,
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1,
                        padding: "2px 4px"
                      },
                      children: "\u2715"
                    }
                  )
                ]
              }
            ),
            row.transcriptLength === 0 && !confirming && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 11, color: C.warn, marginTop: 4 }, children: "\u65E0\u8F6C\u5199\u6587\u672C" })
          ] })
        ]
      }
    )
  );
}
function SessionDetail(props) {
  const rec = props.detail.session;
  const arts = props.detail.artifacts;
  const [docTab, setDocTab] = React3.useState("transcript");
  const [notes, setNotes] = React3.useState([]);
  const [openNote, setOpenNote] = React3.useState(null);
  React3.useEffect(() => {
    let alive = true;
    setOpenNote(null);
    void (async () => {
      try {
        const r = await get(`/notes-for?sessionId=${encodeURIComponent(rec.id)}`);
        if (alive) setNotes(r.docs ?? []);
      } catch {
        if (alive) setNotes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rec.id]);
  const loadNote = React3.useCallback(async (path) => {
    try {
      const r = await get(`/note?path=${encodeURIComponent(path)}`);
      setOpenNote({ path, text: r.text });
    } catch (e) {
      setOpenNote({ path, text: `\u8BFB\u53D6\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}` });
    }
  }, []);
  const [editing, setEditing] = React3.useState(false);
  const [draft, setDraft] = React3.useState(rec.title ?? "");
  const [saving, setSaving] = React3.useState(false);
  const [titleErr, setTitleErr] = React3.useState(null);
  React3.useEffect(() => {
    setEditing(false);
    setDraft(rec.title ?? "");
    setTitleErr(null);
  }, [rec.id, rec.title]);
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === rec.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setTitleErr(null);
    try {
      const r = await setTitle(rec.id, next, "user");
      props.onRenamed(r.session);
      setEditing(false);
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const grouped = React3.useMemo(() => groupBySpeaker(rec), [rec]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "header",
      {
        style: {
          padding: "12px 18px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          flexShrink: 0
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { minWidth: 0, flex: 1 }, children: [
            editing ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  autoFocus: true,
                  value: draft,
                  onChange: (e) => setDraft(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter") void commit();
                    else if (e.key === "Escape") {
                      setEditing(false);
                      setDraft(rec.title ?? "");
                    }
                  },
                  style: {
                    flex: 1,
                    minWidth: 0,
                    maxWidth: 420,
                    border: `1px solid ${C.brand}`,
                    background: C.bg1,
                    color: C.ink,
                    borderRadius: 6,
                    padding: "4px 9px",
                    fontSize: 15,
                    fontWeight: 600,
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, primary: true, disabled: saving, onClick: () => void commit(), children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                Btn,
                {
                  small: true,
                  disabled: saving,
                  onClick: () => {
                    setEditing(false);
                    setDraft(rec.title ?? "");
                  },
                  children: "\u53D6\u6D88"
                }
              )
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "span",
                {
                  title: rec.title ?? rec.id,
                  style: {
                    fontSize: 15,
                    fontWeight: 600,
                    color: C.ink,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  },
                  children: rec.title || rec.id
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  title: "\u91CD\u547D\u540D\uFF08\u540C\u65F6\u6539\u78C1\u76D8\u4E0A\u7684\u97F3\u9891\u4E0E Markdown \u6587\u4EF6\u540D\uFF09",
                  onClick: () => {
                    setDraft(rec.title ?? "");
                    setEditing(true);
                  },
                  style: {
                    border: "none",
                    background: "transparent",
                    color: C.ink3,
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "2px 4px",
                    flexShrink: 0
                  },
                  children: "\u270E"
                }
              ),
              rec.titleSource === "llm" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { tone: "brand", children: "LLM \u547D\u540D" }),
              rec.titleSource === "auto" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: "\u81EA\u52A8\u547D\u540D" })
            ] }),
            titleErr && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 11, color: C.danger, marginTop: 4 }, children: titleErr }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: fmtDateTime(rec.createdAt) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: SOURCE_LABEL[rec.source] ?? rec.source }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: fmtClock(rec.durationMs) }),
              rec.model && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: rec.model }),
              rec.device_ && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { children: rec.device_ }),
              typeof rec.speakerCount === "number" && rec.speakerCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Chip, { children: [
                rec.speakerCount,
                " \u4F4D\u8BF4\u8BDD\u4EBA"
              ] }),
              rec.deviceFile && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { title: rec.deviceFile, children: "\u8BBE\u5907\u6587\u4EF6" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { tone: arts.audio.present ? "ok" : "warn", children: arts.audio.present ? `\u97F3\u9891 ${fmtBytes(arts.audio.bytes ?? 0)}` : "\u65E0\u97F3\u9891" }),
              (props.detail.flows?.length ?? 0) > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                Chip,
                {
                  tone: "brand",
                  title: (props.detail.flows ?? []).map((f) => {
                    const kind = f.kind === "summary" ? "\u603B\u7ED3" : f.kind === "auto" ? "\u81EA\u52A8\u6D41\u8F6C" : "\u6295\u653E";
                    const batch = (f.batchSize ?? 1) > 1 ? `\uFF08\u540C\u6279 ${f.batchSize} \u6761\uFF09` : "";
                    return `${kind}${batch} \u2192 ${f.targetSessionId.slice(0, 20)}\u2026  ${new Date(f.at).toLocaleString()}`;
                  }).join("\n"),
                  children: [
                    "\u5DF2\u6D41\u8F6C\u7ED9 LLM",
                    (props.detail.flows?.length ?? 0) > 1 ? ` \xD7${props.detail.flows?.length}` : ""
                  ]
                }
              ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chip, { title: "\u8FD8\u6CA1\u6709\u4EA4\u7ED9\u8FC7 Agent\uFF08\u603B\u7ED3\u6216\u6295\u653E\uFF09", children: "\u672A\u6D41\u8F6C" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
            arts.markdown.present && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "a",
              {
                href: markdownUrl(rec.id),
                target: "_blank",
                rel: "noreferrer",
                style: {
                  fontSize: 12,
                  color: C.brand,
                  textDecoration: "none",
                  border: `1px solid ${C.border3}`,
                  borderRadius: 6,
                  padding: "4px 10px"
                },
                children: "\u6253\u5F00 Markdown"
              }
            ),
            arts.audio.present && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "a",
              {
                href: audioUrl(rec.id),
                download: downloadName(rec, extOf(rec.audio?.file ?? "audio.ogg")),
                style: {
                  fontSize: 12,
                  color: C.brand,
                  textDecoration: "none",
                  border: `1px solid ${C.border3}`,
                  borderRadius: 6,
                  padding: "4px 10px"
                },
                children: "\u4E0B\u8F7D\u97F3\u9891"
              }
            ),
            !props.confirmingDelete && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, danger: true, onClick: props.onAskDelete, title: "\u5220\u9664\u8FD9\u6761\u5F55\u97F3\uFF08\u8FDE\u540C\u97F3\u9891\u4E0E\u6587\u6863\uFF09", children: "\u5220\u9664" })
          ] })
        ]
      }
    ),
    props.confirmingDelete && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 18px",
          background: C.hoverDanger,
          borderBottom: `1px solid ${C.danger}`,
          flexShrink: 0,
          flexWrap: "wrap"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { fontSize: 12.5, color: C.danger, flex: 1, minWidth: 200, lineHeight: 1.7 }, children: [
            "\u5220\u9664\u300C",
            rec.title || rec.id,
            "\u300D\uFF1F\u4F1A\u8FDE\u540C\u78C1\u76D8\u4E0A\u7684",
            arts.audio.present ? `\u97F3\u9891\uFF08${fmtBytes(arts.audio.bytes ?? 0)}\uFF09` : "\u97F3\u9891",
            arts.markdown.present ? "\u4E0E Markdown \u6587\u6863" : "",
            "\u4E00\u8D77\u5220\u6389\uFF0C",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u4E0D\u53EF\u6062\u590D" }),
            "\u3002"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, danger: true, disabled: props.deleting, onClick: props.onConfirmDelete, children: props.deleting ? "\u5220\u9664\u4E2D\u2026" : "\u786E\u8BA4\u5220\u9664" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, disabled: props.deleting, onClick: props.onCancelDelete, children: "\u53D6\u6D88" })
        ]
      }
    ),
    rec.error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: "10px 18px 0" }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorBar, { text: `\u8BE5\u5F55\u97F3\u5904\u7406\u5931\u8D25\uFF1A${rec.error}` }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: "14px 18px 0", flexShrink: 0 }, children: arts.audio.present ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      AudioPlayer,
      {
        src: audioUrl(rec.id),
        fallbackDurationMs: rec.durationMs,
        downloadName: downloadName(rec, extOf(rec.audio?.file ?? "audio.ogg")),
        seekRef: props.seekRef
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        style: {
          border: `1px dashed ${C.border3}`,
          borderRadius: 10,
          padding: 16,
          textAlign: "center",
          color: C.ink3,
          fontSize: 12
        },
        children: "\u8FD9\u6761\u5F55\u97F3\u6CA1\u6709\u4FDD\u7559\u97F3\u9891\uFF08\u914D\u7F6E\u91CC\u300C\u5F52\u6863\u97F3\u9891\u300D\u5DF2\u5173\u95ED\uFF0C\u6216\u97F3\u9891\u672A\u843D\u76D8\uFF09"
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 18px 16px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 4, marginBottom: 10, flexShrink: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TabButton, { active: docTab === "transcript", onClick: () => setDocTab("transcript"), children: "\u8F6C\u5199\u539F\u6587" }),
        arts.markdown.present && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TabButton, { active: docTab === "markdown", onClick: () => setDocTab("markdown"), children: "Markdown \u6587\u6863" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(TabButton, { active: docTab === "notes", onClick: () => setDocTab("notes"), children: [
          "\u7EAA\u8981\u67E5\u770B",
          notes.length > 0 ? ` (${notes.length})` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { marginLeft: "auto", fontSize: 11, color: C.ink3 }, children: rec.segments.length > 0 ? `${rec.segments.length} \u4E2A\u5206\u6BB5` : "" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "div",
        {
          style: {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: C.bg2,
            padding: "6px 4px"
          },
          children: docTab === "transcript" ? rec.segments.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { children: rec.transcript.trim() ? rec.transcript : rec.error ? "\u8BC6\u522B\u5931\u8D25\uFF0C\u6CA1\u6709\u8F6C\u5199\u6587\u672C" : "\u8FD8\u6CA1\u6709\u8F6C\u5199\u6587\u672C" }) : grouped.map((block, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "8px 14px" }, children: [
            block.speaker !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: {
                  fontSize: 11,
                  color: C.ink3,
                  marginBottom: 3,
                  display: "flex",
                  alignItems: "center",
                  gap: 6
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "span",
                    {
                      style: {
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: speakerColor(block.speaker)
                      }
                    }
                  ),
                  "\u8BF4\u8BDD\u4EBA ",
                  block.speaker + 1
                ]
              }
            ),
            block.items.map((seg, j) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: {
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "2px 0"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: () => props.seekRef.current?.(seg.start / 1e3),
                      title: "\u8DF3\u5230\u8FD9\u4E00\u6BB5",
                      disabled: !arts.audio.present,
                      style: {
                        flexShrink: 0,
                        border: "none",
                        background: "transparent",
                        color: C.brand,
                        fontFamily: mono,
                        fontSize: 11,
                        cursor: arts.audio.present ? "pointer" : "default",
                        padding: "1px 0",
                        opacity: arts.audio.present ? 1 : 0.5,
                        minWidth: 42,
                        textAlign: "left"
                      },
                      children: fmtClock(seg.start)
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 13.5, lineHeight: 1.85, color: C.ink, flex: 1 }, children: seg.text })
                ]
              },
              j
            ))
          ] }, i)) : docTab === "markdown" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MarkdownView, { sessionId: rec.id }) : (
            /* 纪要查看 */
            notes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { children: "\u8FD8\u6CA1\u6709\u7EAA\u8981\u3002\u7528\u300C\u7EAA\u8981\u6574\u7406\u300D\u6A21\u677F\u628A\u8FD9\u6761\u5F55\u97F3\u4EA4\u7ED9 Agent \u540E\uFF0CAgent \u4F1A\u628A\u6574\u7406\u597D\u7684\u6587\u6863\u5173\u8054\u5230\u8FD9\u91CC\u3002" }) : openNote === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: "6px 10px" }, children: notes.map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "button",
              {
                type: "button",
                onClick: () => void loadNote(n.path),
                style: {
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  marginBottom: 6,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.bg1,
                  color: C.ink,
                  cursor: "pointer",
                  font: "inherit"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: n.title }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 11, color: C.ink3, marginTop: 2 }, children: [
                    fmtBytes(n.bytes),
                    " \xB7 ",
                    new Date(n.updatedAt).toLocaleString()
                  ] })
                ]
              },
              n.path
            )) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "10px 14px" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Btn, { small: true, onClick: () => setOpenNote(null), children: "\u8FD4\u56DE\u5217\u8868" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 12, color: C.ink3 }, children: notes.find((n) => n.path === openNote.path)?.title ?? "" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "pre",
                {
                  style: {
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 13,
                    lineHeight: 1.75,
                    font: "inherit"
                  },
                  children: openNote.text
                }
              )
            ] })
          )
        }
      )
    ] })
  ] });
}
function TabButton(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "button",
    {
      type: "button",
      onClick: props.onClick,
      style: {
        border: "none",
        background: "transparent",
        color: props.active ? C.ink : C.ink3,
        fontSize: 13,
        fontWeight: props.active ? 600 : 400,
        padding: "4px 10px",
        cursor: "pointer",
        borderBottom: `2px solid ${props.active ? C.brand : "transparent"}`
      },
      children: props.children
    }
  );
}
function MarkdownView(props) {
  const [text, setText] = React3.useState(null);
  const [error, setError] = React3.useState(null);
  React3.useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    void fetch(markdownUrl(props.sessionId)).then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))).then((t) => {
      if (alive) setText(t);
    }).catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [props.sessionId]);
  if (error) return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Empty, { children: [
    "\u8BFB\u53D6\u5931\u8D25\uFF1A",
    error
  ] });
  if (text === null) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Loading, {});
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "pre",
    {
      style: {
        margin: 0,
        padding: "10px 14px",
        fontFamily: mono,
        fontSize: 12,
        lineHeight: 1.8,
        color: C.ink2,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      },
      children: text
    }
  );
}
function groupBySpeaker(rec) {
  const blocks = [];
  for (const seg of rec.segments) {
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.items.push({ start: seg.start, end: seg.end, text });
    } else {
      blocks.push({ speaker: seg.speaker, items: [{ start: seg.start, end: seg.end, text }] });
    }
  }
  return blocks;
}
var SPEAKER_COLORS = ["#4a7cff", "#e8491d", "#1a8a4a", "#8a4aff", "#b06a00", "#0aa3a3"];
function speakerColor(n) {
  return SPEAKER_COLORS[n % SPEAKER_COLORS.length];
}

// src/client/RecorderSettings.tsx
var React4 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
var mono2 = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
var FEATURE_LABEL = {
  vad: "VAD \u65AD\u53E5",
  punc: "\u6807\u70B9\u6062\u590D",
  spk: "\u8BF4\u8BDD\u4EBA\u5206\u79BB",
  language: "\u8BED\u79CD\u9009\u62E9",
  realtime: "\u5B9E\u65F6\u8F6C\u5199",
  hotword: "\u70ED\u8BCD\u8868",
  timestamps: "\u65F6\u95F4\u6233"
};
function RecorderSettings() {
  const [status, setStatus] = React4.useState(null);
  const [pp, setPp] = React4.useState(null);
  const [dshSessions, setDshSessions] = React4.useState([]);
  const [tplEdit, setTplEdit] = React4.useState(null);
  const [tplDraft, setTplDraft] = React4.useState(null);
  const [presets, setPresets] = React4.useState(null);
  const refreshPresets = React4.useCallback(async () => {
    try {
      setPresets(await get("/presets"));
    } catch {
    }
  }, []);
  const uninstallEnv = React4.useCallback(
    async (key) => {
      await run(`uninstall-${key}`, async () => {
        const r = await post("/env/uninstall", { key });
        setMsg(r.result.message);
        await refreshPresets();
        await refreshStatus(true);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshPresets]
  );
  const [qwen, setQwen] = React4.useState(void 0);
  const [cfg, setCfg] = React4.useState(null);
  const [ble, setBle] = React4.useState(null);
  const [knownList, setKnownList] = React4.useState([]);
  const [files, setFiles] = React4.useState([]);
  const [filesQueried, setFilesQueried] = React4.useState(false);
  const [busy, setBusy] = React4.useState(null);
  const [msg, setMsg] = React4.useState(null);
  const [err, setErr] = React4.useState(null);
  const [partial, setPartial] = React4.useState("");
  const [liveSession, setLiveSession] = React4.useState(null);
  const esRef = React4.useRef(null);
  const run = React4.useCallback(async (tag, fn) => {
    setBusy(tag);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);
  const refreshStatus = React4.useCallback(async (probe = false) => {
    const r = await get(
      probe ? "/asr/status?probe=1" : "/asr/status"
    );
    setStatus(r.status);
    if (r.qwen !== void 0) setQwen(r.qwen);
  }, []);
  const activePreset = presets?.presets.find((p) => p.id === presets.active);
  const feat = (k) => {
    if (!activePreset) return true;
    return activePreset.features.includes(k);
  };
  const unsupported = activePreset ? Object.entries(activePreset.limits ?? {}).filter(([k]) => !activePreset.features.includes(k)) : [];
  const hasUnknown = presets !== null && presets.envs.some((e) => e.installed === null && presets.needed.includes(e.key));
  React4.useEffect(() => {
    if (!hasUnknown) return;
    const t = window.setTimeout(() => void refreshPresets(), 4e3);
    return () => window.clearTimeout(t);
  }, [hasUnknown, refreshPresets]);
  const refreshConfig = React4.useCallback(async () => {
    const r = await get("/config");
    setCfg(r.config);
  }, []);
  const uninstallPresetAction = React4.useCallback(
    async (presetId) => {
      await run(`uninstall-preset-${presetId}`, async () => {
        const r = await post("/env/uninstall-preset", { presetId });
        setMsg(r.result.message);
        await refreshPresets();
        await refreshConfig();
        await refreshStatus(true);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshPresets, refreshConfig]
  );
  const refreshPostProcess = React4.useCallback(async () => {
    try {
      setPp(await get("/post-process"));
    } catch {
    }
  }, []);
  const ppNeedsPoll = pp?.config.enabled === true && pp.config.mode === "confirm";
  React4.useEffect(() => {
    if (!ppNeedsPoll) return;
    const t = window.setInterval(() => void refreshPostProcess(), 3e3);
    return () => window.clearInterval(t);
  }, [ppNeedsPoll, refreshPostProcess]);
  const refreshDshSessions = React4.useCallback(async () => {
    try {
      const r = await get("/dsh/sessions");
      setDshSessions(
        (r.items ?? []).map((x) => ({
          sessionId: x.sessionId,
          title: x.projections?.values?.title ?? "",
          running: x.running === true,
          updatedAt: x.updatedAt ?? 0
        }))
      );
    } catch {
    }
  }, []);
  const patchPostProcess = React4.useCallback(
    async (next) => {
      await post("/config", { postProcess: next });
      setPp((cur) => cur ? { ...cur, config: { ...cur.config, ...next } } : cur);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pp]
  );
  const refreshBle = React4.useCallback(async () => {
    setBle(await get("/ble/status"));
  }, []);
  const scan = ble?.scan;
  const scanned = scan?.devices ?? [];
  const scanMsg = scan?.message ?? null;
  React4.useEffect(() => {
    let alive = true;
    const tick = () => {
      void refreshBle().catch(() => void 0);
      if (!alive) return;
    };
    const ms = scan?.running ? 800 : 1200;
    const t = window.setInterval(tick, ms);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [scan?.running, refreshBle]);
  const wasConnected = React4.useRef(false);
  React4.useEffect(() => {
    const now = ble?.connected === true;
    if (now && !wasConnected.current) {
      setMsg(`\u5DF2\u8FDE\u63A5 ${ble?.address ?? ""}${ble?.battery != null ? ` \xB7 \u7535\u91CF ${fmtBattery(ble.battery)}` : ""}`);
    }
    wasConnected.current = now;
  }, [ble?.connected, ble?.address, ble?.battery]);
  React4.useEffect(() => {
    void knownDevices().then((r) => setKnownList(r.items ?? [])).catch(() => void 0);
  }, [scan?.running, ble?.connected]);
  React4.useEffect(() => {
    void run("init", async () => {
      await Promise.all([
        refreshStatus(),
        refreshConfig(),
        refreshPresets(),
        refreshPostProcess(),
        refreshDshSessions()
      ]);
      void post("/ble/setup", {}).then(() => refreshBle()).catch(() => void 0);
      await refreshBle().catch(() => void 0);
    });
  }, [run, refreshStatus, refreshConfig, refreshBle]);
  React4.useEffect(() => {
    if (!liveSession) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(eventsUrl(liveSession));
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "partial") setPartial(data.partial ?? "");
        else if (data.type === "segment") setPartial(data.transcript ?? "");
        else if (data.type === "hello") setPartial(data.partial || data.transcript || "");
        else if (data.type === "closed") setPartial(data.record?.transcript ?? "");
      } catch {
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [liveSession]);
  const patch = (p) => run("cfg", async () => {
    const r = await post("/config", p);
    setCfg(r.config);
  });
  if (!cfg && !status) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Loading, { text: "\u6B63\u5728\u68C0\u6D4B\u8BC6\u522B\u73AF\u5883\u2026" });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { height: "100%", overflowY: "auto", background: C.bg1, color: C.ink }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { maxWidth: 900, margin: "0 auto", padding: "18px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ErrorBar, { text: err, onClose: () => setErr(null) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      Panel,
      {
        title: "\u8BC6\u522B\u73AF\u5883\uFF08FunASR\uFF09",
        extra: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: status?.ready ? "ok" : "warn", children: status?.ready ? "\u5C31\u7EEA" : "\u672A\u5C31\u7EEA" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: status?.cudaAvailable ? "ok" : "neutral", children: status?.cudaAvailable ? `CUDA \xB7 ${status.cudaDeviceName ?? ""}` : "CPU" })
        ] }),
        children: !status ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Loading, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
            "Python ",
            status.pythonVersion ?? "?",
            " \xB7 funasr ",
            status.funasrVersion ?? "\u672A\u88C5",
            " \xB7 torch",
            " ",
            status.torchVersion ?? "\u672A\u88C5"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { style: { wordBreak: "break-all", marginTop: 2 }, children: [
            "\u6A21\u578B\u76EE\u5F55\uFF1A",
            status.modelDir
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }, children: status.models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
            Chip,
            {
              tone: m.ready ? "ok" : "warn",
              title: m.partial ? `${m.path}
\u76EE\u5F55\u5B58\u5728\u4F46\u91CC\u9762\u6CA1\u6709\u6743\u91CD\u6587\u4EF6\u2014\u2014\u4E0B\u8F7D\u53EF\u80FD\u88AB\u6253\u65AD\uFF0C\u8BF7\u91CD\u65B0\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D` : m.path,
              children: [
                m.label,
                m.partial ? "\uFF08\u4E0D\u5B8C\u6574\uFF09" : ""
              ]
            },
            m.key
          )) }),
          status.deps && Object.values(status.deps).some((d) => !d.ok) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { fontSize: 12, color: C.danger, lineHeight: 1.8, marginBottom: 6 }, children: [
            "\u26A0 \u4F9D\u8D56\u5BFC\u5165\u5931\u8D25\uFF08\u8BC6\u522B\u4F1A\u4E0D\u53EF\u7528\uFF09\uFF1A",
            Object.entries(status.deps).filter(([, d]) => !d.ok).map(([k, d]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { paddingLeft: 10, wordBreak: "break-all" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { children: k }),
              "\uFF1A",
              d.error
            ] }, k)),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { paddingLeft: 10 }, children: "\u6267\u884C\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D\u53EF\u4FEE\u590D\uFF08\u4F1A\u4E00\u5E76\u5347\u7EA7 modelscope-hub\u2014\u2014\u90A3\u662F\u5E38\u89C1\u7684\u7248\u672C\u9519\u914D\u6765\u6E90\uFF09\u3002" })
          ] }),
          presets && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { margin: "10px 0", borderTop: `1px solid ${C.border}`, paddingTop: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { style: { fontSize: 12 }, children: "\u8BC6\u522B\u73AF\u5883" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
                "\u300C",
                presets.presets.find((p) => p.id === presets.active)?.label ?? presets.active,
                "\u300D\u9700\u8981",
                " ",
                presets.needed.length,
                " \u4E2A\u7EC4\u4EF6"
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }, children: presets.envs.filter((x) => presets.needed.includes(x.key)).map((x) => {
              const busyKey = `uninstall-${x.key}`;
              const tone = x.installed === null ? C.brand : x.installed ? C.ok : C.ink3;
              const short = x.label.replace(/（[^）]*）/g, "").trim();
              return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                "div",
                {
                  title: `${x.label}
${x.detail}${x.installed === true && !x.canUninstall ? `

${x.message}` : ""}`,
                  style: {
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: "4px 8px",
                    background: C.bg2,
                    fontSize: 11,
                    maxWidth: 210,
                    lineHeight: 1.5
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { color: tone, fontSize: 10 }, children: "\u25CF" }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                        "span",
                        {
                          style: {
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          },
                          children: short
                        }
                      ),
                      x.bytes !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { marginLeft: "auto", color: C.ink3, flexShrink: 0 }, children: fmtBytes(x.bytes) })
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 5, color: C.ink3 }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: x.installed === null ? "\u68C0\u6D4B\u4E2D\u2026" : x.installed ? x.canUninstall ? "\u5DF2\u5B89\u88C5" : "\u4F7F\u7528\u4E2D" : "\u672A\u5B89\u88C5" }),
                      x.installed === true && x.canUninstall && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                        Btn,
                        {
                          disabled: busy !== null,
                          onClick: () => void uninstallEnv(x.key),
                          title: x.message,
                          children: busy === busyKey ? "\u2026" : "\u5378\u8F7D"
                        }
                      )
                    ] })
                  ]
                },
                x.key
              );
            }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                primary: true,
                disabled: busy !== null,
                onClick: () => void run("install", async () => {
                  setMsg("\u5B89\u88C5\u4E2D\uFF08\u9996\u6B21\u53EF\u80FD\u9700\u8981\u51E0\u5206\u949F\u5230\u5341\u51E0\u5206\u949F\uFF09\u2026");
                  try {
                    const r = await post("/asr/install", {});
                    if (r.qwen !== void 0) setQwen(r.qwen);
                    if (r.status) setStatus(r.status);
                    await refreshStatus(true);
                    const failedSteps = (r.steps ?? []).filter((s) => !s.ok);
                    setMsg(
                      failedSteps.length ? `\u5B89\u88C5\u7ED3\u675F\uFF0C\u4F46\u6709\u6B65\u9AA4\u5931\u8D25\uFF1A${failedSteps.map((s) => s.message).join("\uFF1B")}` : "\u5B89\u88C5 / \u4FEE\u590D\u5B8C\u6210\uFF0C\u73AF\u5883\u5DF2\u5C31\u7EEA"
                    );
                  } catch (e) {
                    setMsg(`\u5B89\u88C5\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
                    throw e;
                  }
                }),
                children: busy === "install" ? "\u5B89\u88C5\u4E2D\u2026" : "\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                danger: true,
                disabled: busy !== null || !presets,
                title: presets?.uninstallPlans.find((x) => x.presetId === presets.active)?.summary ?? "\u5378\u8F7D\u5F53\u524D\u9884\u8BBE\u53CA\u5176\u72EC\u5360\u7684\u73AF\u5883\u7EC4\u4EF6",
                onClick: () => {
                  const plan = presets?.uninstallPlans.find((x) => x.presetId === presets.active);
                  if (plan) void uninstallPresetAction(plan.presetId);
                },
                children: busy?.startsWith("uninstall-preset-") ? "\u5378\u8F7D\u4E2D\u2026" : "\u5B8C\u5168\u5378\u8F7D\u6B64\u9884\u8BBE"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                disabled: busy !== null,
                onClick: () => void run("recheck", async () => {
                  await refreshStatus(true);
                  await refreshPresets();
                }),
                children: "\u91CD\u65B0\u68C0\u6D4B"
              }
            ),
            msg && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { children: msg })
          ] })
        ] })
      }
    ),
    cfg && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Panel, { title: "\u8FD0\u884C\u914D\u7F6E", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Grid, { cols: "auto 1fr auto 1fr", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u8BC6\u522B\u6A21\u578B", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Select,
          {
            value: cfg.asrModel,
            onChange: (v) => {
              patch({ asrModel: v });
              void refreshPresets();
            },
            options: [
              { value: "paraformer-zh", label: "Paraformer-large\uFF08\u4E2D\u6587\u9AD8\u7CBE\u5EA6\uFF09" },
              { value: "sensevoice", label: "SenseVoiceSmall\uFF08\u591A\u8BED\u79CD\xB7\u5FEB\u901F\uFF09" },
              { value: "qwen3-asr", label: "Qwen3-ASR\uFF08\u6700\u5F3A\xB7\u9700\u4E0B\u8F7D\uFF09" }
            ]
          }
        ) }),
        cfg.asrModel === "qwen3-asr" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { gridColumn: "1 / -1" }, children: "Qwen3-ASR \u7528\u4E8E\u79BB\u7EBF\u8BC6\u522B\uFF08\u4E2D\u82F1\u6587\u90FD\u5F3A\uFF09\uFF1B\u8BF4\u8BDD\u4EBA\u5206\u79BB\u4ECD\u7531 FunASR \u7684 cam++ \u63D0\u4F9B\u2014\u2014 \u6309\u8BF4\u8BDD\u4EBA\u5207\u6BB5\u540E\u518D\u9010\u6BB5\u8BC6\u522B\uFF0C\u56E0\u6B64\u4E0D\u9700\u8981\u5F3A\u5236\u5BF9\u9F50\u3002\u5B9E\u65F6\u8F6C\u5199\u4ECD\u8D70 Paraformer \u6D41\u5F0F \uFF08Qwen3 \u7684\u6D41\u5F0F\u4EC5 vLLM \u652F\u6301\uFF0CWindows \u539F\u751F\u8DD1\u4E0D\u4E86\uFF09\u3002\u9996\u6B21\u4F7F\u7528\u9700\u70B9\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D \u521B\u5EFA qwen venv \u5E76\u4E0B\u8F7D\u6743\u91CD\uFF08\u7EA6 3.4GB\uFF0C\u8D70 hf-mirror\uFF09\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u8BC6\u522B\u8BED\u79CD", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Select,
          {
            value: cfg.language,
            onChange: (v) => patch({ language: v }),
            options: [
              { value: "auto", label: "\u81EA\u52A8\u5224\u65AD\uFF08\u63A8\u8350\uFF09" },
              { value: "zh", label: "\u4E2D\u6587" },
              { value: "en", label: "\u82F1\u8BED" },
              { value: "yue", label: "\u7CA4\u8BED" },
              { value: "ja", label: "\u65E5\u8BED" },
              { value: "ko", label: "\u97E9\u8BED" }
            ]
          }
        ) }),
        cfg.asrModel === "paraformer-zh" && cfg.language !== "zh" && cfg.language !== "auto" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { gridColumn: "1 / -1", color: C.warn }, children: "\u26A0 Paraformer-large \u662F\u4E2D\u6587\u4E13\u7528\u6A21\u578B\uFF0C\u9009\u8FD9\u4E00\u9879\u4E0D\u4F1A\u751F\u6548\u2014\u2014\u8981\u8BC6\u522B\u82F1\u8BED/\u7CA4\u8BED/\u65E5\u8BED/\u97E9\u8BED\uFF0C \u8BF7\u628A\u300C\u8BC6\u522B\u6A21\u578B\u300D\u5207\u6210 SenseVoiceSmall\u3002" }),
        cfg.asrModel === "sensevoice" && cfg.language === "zh" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { gridColumn: "1 / -1", color: C.warn }, children: "\u26A0 \u5DF2\u9501\u5B9A\u4E2D\u6587\uFF1ASenseVoiceSmall \u652F\u6301\u4E2D/\u7CA4/\u82F1/\u65E5/\u97E9\uFF0C\u8BED\u79CD\u8BBE\u4E3A\u300C\u81EA\u52A8\u5224\u65AD\u300D\u624D\u80FD\u8BC6\u522B\u5916\u8BED\u5F55\u97F3\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u63A8\u7406\u8BBE\u5907", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Select,
          {
            value: cfg.asrDevice,
            onChange: (v) => patch({ asrDevice: v }),
            options: [
              { value: "auto", label: "\u81EA\u52A8\uFF08\u6709 CUDA \u5C31\u7528\uFF09" },
              { value: "cuda", label: "\u5F3A\u5236 CUDA" },
              { value: "cpu", label: "\u5F3A\u5236 CPU" }
            ]
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u8BED\u8A00", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Select,
          {
            value: cfg.language,
            onChange: (v) => patch({ language: v }),
            options: [
              { value: "auto", label: "\u81EA\u52A8\u5224\u65AD\uFF08\u63A8\u8350\uFF09" },
              { value: "zh", label: "\u4E2D\u6587" },
              { value: "en", label: "\u82F1\u8BED" },
              { value: "ja", label: "\u65E5\u8BED" },
              { value: "ko", label: "\u97E9\u8BED" },
              { value: "yue", label: "\u7CA4\u8BED" }
            ]
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u6D41\u5F0F\u7A97\u53E3\uFF08\u6BEB\u79D2 / chunk\uFF09", hint: "\u8D8A\u5C0F\u8D8A\u5B9E\u65F6\uFF0C\u8D8A\u5403\u7B97\u529B", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          NumberInput,
          {
            value: cfg.streamChunkMs,
            min: 60,
            max: 2e3,
            step: 60,
            onChange: (v) => patch({ streamChunkMs: v })
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u81EA\u52A8\u6807\u9898\u53D6\u5B57\u6570", hint: "\u6807\u9898\u540C\u65F6\u7528\u4F5C\u97F3\u9891\u4E0E Markdown \u7684\u6587\u4EF6\u540D", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          NumberInput,
          {
            value: cfg.titleMaxChars,
            min: 2,
            max: 64,
            step: 1,
            onChange: (v) => patch({ titleMaxChars: v })
          }
        ) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 14 }, children: [
        feat("vad") && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "VAD \u65AD\u53E5", on: cfg.asrVad, onChange: (v) => patch({ asrVad: v }) }),
        feat("punc") && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "\u6807\u70B9\u6062\u590D", on: cfg.asrPunc, onChange: (v) => patch({ asrPunc: v }) }),
        feat("spk") && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "\u8BF4\u8BDD\u4EBA\u5206\u79BB", on: cfg.asrSpk, onChange: (v) => patch({ asrSpk: v }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Switch,
          {
            label: "\u81EA\u52A8\u547D\u540D",
            on: cfg.autoTitle,
            title: "\u6309\u8F6C\u5199\u5185\u5BB9\u5F00\u5934\u51E0\u4E2A\u5B57\u7ED9\u5F55\u97F3\u547D\u540D\uFF0C\u5E76\u628A\u78C1\u76D8\u4E0A\u7684\u97F3\u9891\u4E0E Markdown \u4E00\u8D77\u6539\u6210\u8FD9\u4E2A\u540D\u5B57",
            onChange: (v) => patch({ autoTitle: v })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Switch,
          {
            label: "\u4E0B\u8F7D\u4F18\u5148 .opus",
            on: cfg.opusPreferred,
            title: ".opus \u662F\u8BBE\u5907\u539F\u751F\u683C\u5F0F\uFF08\u22482 KB/s\uFF09\uFF1B.wav \u662F\u8BBE\u5907\u8F6C\u7801\u4EA7\u7269\uFF0832 KB/s\uFF0C\u4F53\u79EF\u7EA6 16 \u500D\uFF09",
            onChange: (v) => patch({ opusPreferred: v })
          }
        ),
        unsupported.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { marginTop: 8, fontSize: 12, color: C.ink3, lineHeight: 1.8 }, children: unsupported.map(([k, reason]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          "\xB7 \u300C",
          FEATURE_LABEL[k] ?? k,
          "\u300D\u4E0D\u53EF\u7528\uFF1A",
          reason
        ] }, k)) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "\u4EA7\u51FA Markdown", on: cfg.markdownEnabled, onChange: (v) => patch({ markdownEnabled: v }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "\u5F52\u6863\u97F3\u9891", on: cfg.keepAudio, onChange: (v) => patch({ keepAudio: v }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Switch, { label: "\u8FDE\u4E0A\u81EA\u52A8\u540C\u6B65", on: cfg.bleAutoSync, onChange: (v) => patch({ bleAutoSync: v }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          Switch,
          {
            label: "\u540C\u6B65\u540E\u5220\u5361\u4E0A\u539F\u4EF6",
            on: cfg.bleSyncDeleteAfter,
            title: "\u5F55\u97F3\u8F6C\u5230\u7535\u8111\u5E76\u843D\u76D8\u540E\uFF0C\u81EA\u52A8\u4ECE\u5F55\u97F3\u5361\u5220\u6389\u8FD9\u6761\u3002\u53EA\u6709\u672C\u5730\u97F3\u9891\u786E\u5B9E\u5B58\u5728\u4E14\u975E\u7A7A\u624D\u4F1A\u5220\uFF1B\u5220\u9664\u4E0D\u53EF\u9006\u3002",
            onChange: (v) => patch({ bleSyncDeleteAfter: v })
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { marginTop: 8 }, children: "\u9884\u8BBE\uFF1A\u5F55\u97F3\u9ED8\u8BA4\u62FF\u8F6C\u5199\u5F00\u5934\u7684\u51E0\u4E2A\u5B57\u5F53\u6807\u9898\uFF0C\u78C1\u76D8\u4E0A\u5C31\u662F\u300C\u6807\u9898.ogg / \u6807\u9898.md\u300D\uFF1B\u624B\u52A8\u6539\u8FC7\u7684\u6807\u9898\u4E0D\u4F1A\u88AB\u81EA\u52A8\u547D\u540D\u8986\u76D6\u3002 \u540C\u6B65\u5931\u8D25\u7684\u4F1A\u6309\u300C\u77AC\u65F6/\u6C38\u4E45\u300D\u533A\u5206\u2014\u2014\u65AD\u7EBF\u8FD9\u7C7B\u77AC\u65F6\u5931\u8D25\u4E0B\u6B21\u81EA\u52A8\u91CD\u8BD5\uFF08\u6700\u591A 3 \u6B21\uFF09\uFF0C\u6587\u4EF6\u672C\u8EAB\u574F\u4E86\u7684\u4E0D\u518D\u91CD\u8BD5\u3002" }),
      cfg.bleSyncDeleteAfter && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { marginTop: 4, display: "block", color: C.warn }, children: "\u26A0 \u5DF2\u5F00\u542F\u300C\u540C\u6B65\u540E\u5220\u5361\u4E0A\u539F\u4EF6\u300D\uFF1A\u6BCF\u6761\u5F55\u97F3\u8F6C\u6210\u529F\u540E\u4F1A\u4ECE\u5F55\u97F3\u5361\u5220\u9664\u3002\u5220\u9664\u4E0D\u53EF\u9006\uFF0C\u8BF7\u786E\u8BA4\u672C\u5730\u526F\u672C\u5DF2\u59A5\u5584\u4FDD\u5B58 \uFF08\u300C\u5F52\u6863\u97F3\u9891\u300D\u5173\u95ED\u65F6\u4E0D\u4F1A\u4FDD\u7559\u97F3\u9891\uFF0C\u90A3\u79CD\u60C5\u51B5\u4E0B\u672C\u63D2\u4EF6\u4F1A\u62D2\u7EDD\u5220\u9664\u5361\u4E0A\u539F\u4EF6\uFF09\u3002" })
    ] }),
    pp && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      Panel,
      {
        title: "\u540E\u5904\u7406\u9009\u62E9",
        extra: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
          pp.pending && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Chip, { tone: "warn", children: [
            "\u5F85\u786E\u8BA4 ",
            pp.pendingCount ?? 1
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: pp.config.enabled ? "ok" : "neutral", children: pp.config.enabled ? "\u5DF2\u542F\u7528" : "\u672A\u542F\u7528" })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            Switch,
            {
              label: "\u8F6C\u5199\u5B8C\u6210\u540E\u4EA4\u7ED9 Agent \u540E\u5904\u7406",
              on: pp.config.enabled,
              title: "\u628A\u8F6C\u5199\u6587\u672C\u6309\u4E0B\u9762\u7684\u63D0\u793A\u8BCD\u6A21\u677F\u53D1\u7ED9\u6307\u5B9A\u5BF9\u8BDD",
              onChange: (v) => void patchPostProcess({ enabled: v })
            }
          ),
          pp.config.enabled && pp.config.mode === "confirm" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
            "div",
            {
              style: {
                marginTop: 10,
                border: `1px solid ${pp.pending ? C.warn : C.border}`,
                borderRadius: 6,
                padding: 8,
                background: C.bg1
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { style: { fontSize: 12, color: pp.pending ? C.warn : C.ink2 }, children: "\u5F85\u786E\u8BA4\u53D1\u9001" }),
                  pp.pending ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
                    "\u6A21\u677F\u300C",
                    pp.pending.templateName,
                    "\u300D\xB7 ",
                    pp.pending.items.length,
                    " \u6761\u5F55\u97F3\u5DF2\u5408\u5E76\u6210 1 \u6761\u6D88\u606F",
                    (pp.pendingCount ?? 1) > 1 ? " \xB7 \u53E6\u6709 " + String((pp.pendingCount ?? 1) - 1) + " \u6761\u5F85\u786E\u8BA4" : ""
                  ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { children: "\u6682\u65E0 \u2014\u2014 \u540C\u6B65\u5B8C\u6210\u540E\uFF0C\u8FD9\u4E00\u8F6E\u7684\u5F55\u97F3\u4F1A\u5408\u5E76\u6210 1 \u6761\u6D88\u606F\u51FA\u73B0\u5728\u8FD9\u91CC" })
                ] }),
                pp.pending && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { display: "block", marginTop: 2 }, children: pp.pending.items.map((x) => x.title || x.name).join("\u3001") }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { style: { marginTop: 4 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("summary", { style: { cursor: "pointer", fontSize: 12, color: C.ink3 }, children: [
                      "\u5C55\u5F00\u9884\u89C8\uFF08",
                      pp.pending.text.length,
                      " \u5B57\uFF09"
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      "pre",
                      {
                        style: {
                          maxHeight: 240,
                          overflow: "auto",
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          background: C.bg2,
                          padding: 6,
                          borderRadius: 4
                        },
                        children: pp.pending.text
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      Btn,
                      {
                        primary: true,
                        disabled: busy !== null,
                        onClick: () => void run("pp-send", async () => {
                          const r = await post("/post-process/resolve", {
                            action: "send"
                          });
                          setMsg(`\u5DF2\u53D1\u9001\u5230\u4F1A\u8BDD ${r.sessionId}`);
                          await refreshPostProcess();
                          await refreshDshSessions();
                        }),
                        children: busy === "pp-send" ? "\u53D1\u9001\u4E2D\u2026" : "\u53D1\u9001"
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      Btn,
                      {
                        disabled: busy !== null,
                        onClick: () => void run("pp-discard", async () => {
                          await post("/post-process/resolve", { action: "discard" });
                          await refreshPostProcess();
                          setMsg("\u5DF2\u4E22\u5F03\u8FD9\u6761\u540E\u5904\u7406\u6D88\u606F");
                        }),
                        children: "\u4E22\u5F03"
                      }
                    )
                  ] })
                ] })
              ]
            }
          ),
          pp.config.enabled && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Grid, { cols: "1fr 1fr", style: { alignItems: "start", marginTop: 10 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { style: { fontSize: 12 }, children: "\u63D0\u793A\u8BCD\u6A21\u677F" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
                    "\u5185\u7F6E ",
                    pp.templates.filter((x) => x.builtin).length,
                    " \u5957\uFF0C\u53EF\u53E6\u5B58\u4E3A\u81EA\u5B9A\u4E49"
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 6 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    Select,
                    {
                      value: pp.config.templateId,
                      onChange: (v) => void patchPostProcess({ templateId: v }),
                      options: pp.templates.map((x) => ({
                        value: x.id,
                        label: `${x.name}${x.builtin ? "" : "\uFF08\u81EA\u5B9A\u4E49\uFF09"}`
                      }))
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    Btn,
                    {
                      onClick: () => {
                        const cur = pp.templates.find((x) => x.id === pp.config.templateId);
                        if (!cur) return;
                        setTplEdit(cur.id);
                        setTplDraft({
                          name: cur.builtin ? `${cur.name}\uFF08\u526F\u672C\uFF09` : cur.name,
                          summary: cur.summary,
                          body: cur.body
                        });
                      },
                      children: "\u67E5\u770B / \u7F16\u8F91"
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { display: "block", marginTop: 4 }, children: pp.templates.find((x) => x.id === pp.config.templateId)?.summary })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { style: { fontSize: 12 }, children: "\u8F6C\u5411\u5BF9\u8BDD" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Btn, { onClick: () => void refreshDshSessions(), children: "\u5237\u65B0\u5217\u8868" })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Row, { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                  Select,
                  {
                    value: pp.config.conversationId,
                    onChange: (v) => void patchPostProcess({ conversationId: v }),
                    options: [
                      { value: "", label: "\u65B0\u5EFA\u5BF9\u8BDD\uFF08\u6BCF\u6B21\u65B0\u5EFA\uFF09" },
                      ...dshSessions.slice(0, 100).map((s) => ({
                        value: s.sessionId,
                        label: `${s.running ? "\u25CF " : ""}${s.title || s.sessionId.slice(0, 16)}`
                      }))
                    ]
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { display: "block", marginTop: 4 }, children: pp.config.conversationId ? "\u5185\u5BB9\u4F1A\u53D1\u5230\u9009\u4E2D\u7684\u5BF9\u8BDD\uFF1B\u5B83\u4E0D\u6E05\u6670\u65F6 Agent \u53EF\u53CD\u95EE\u3002" : "\u6BCF\u6B21\u8F6C\u5199\u5B8C\u6210\u90FD\u4F1A\u65B0\u5EFA\u4E00\u4E2A\u5BF9\u8BDD\uFF0C\u4E0D\u6253\u6270\u4F60\u73B0\u6709\u7684\u4F1A\u8BDD\u3002" })
              ] })
            ] }),
            tplEdit !== null && tplDraft !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "div",
              {
                style: {
                  marginTop: 8,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: 8
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Row, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { fontSize: 12, fontWeight: 600 }, children: pp.templates.find((x) => x.id === tplEdit)?.builtin ? "\u5185\u7F6E\u6A21\u677F\uFF08\u53E6\u5B58\u4E3A\u65B0\u6A21\u677F\uFF09" : "\u7F16\u8F91\u81EA\u5B9A\u4E49\u6A21\u677F" }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u540D\u79F0", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "input",
                    {
                      value: tplDraft.name,
                      onChange: (e) => setTplDraft({ ...tplDraft, name: e.target.value }),
                      style: { width: "100%" }
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u8BF4\u660E", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "input",
                    {
                      value: tplDraft.summary,
                      onChange: (e) => setTplDraft({ ...tplDraft, summary: e.target.value }),
                      style: { width: "100%" }
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "\u63D0\u793A\u8BCD\u6B63\u6587", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "textarea",
                    {
                      value: tplDraft.body,
                      onChange: (e) => setTplDraft({ ...tplDraft, body: e.target.value }),
                      rows: 10,
                      style: { width: "100%", fontFamily: "monospace", fontSize: 12 }
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      Btn,
                      {
                        primary: true,
                        disabled: busy !== null,
                        onClick: () => void run("tpl-save", async () => {
                          const isBuiltin = pp.templates.find((x) => x.id === tplEdit)?.builtin === true;
                          const payload = { ...tplDraft };
                          if (!isBuiltin) payload.id = tplEdit;
                          const r = await post(
                            "/post-process/template",
                            { template: payload }
                          );
                          setPp((cur) => cur ? { ...cur, templates: r.templates } : cur);
                          if (isBuiltin) await patchPostProcess({ templateId: r.template.id });
                          setTplEdit(null);
                          setTplDraft(null);
                          setMsg(isBuiltin ? "\u5DF2\u53E6\u5B58\u4E3A\u81EA\u5B9A\u4E49\u6A21\u677F\u5E76\u9009\u4E2D" : "\u6A21\u677F\u5DF2\u4FDD\u5B58");
                        }),
                        children: "\u4FDD\u5B58"
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      Btn,
                      {
                        onClick: () => {
                          setTplEdit(null);
                          setTplDraft(null);
                        },
                        children: "\u53D6\u6D88"
                      }
                    ),
                    pp.templates.find((x) => x.id === tplEdit)?.builtin === false && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      Btn,
                      {
                        disabled: busy !== null,
                        onClick: () => void run("tpl-del", async () => {
                          const r = await post(
                            "/post-process/template/delete",
                            { id: tplEdit }
                          );
                          setPp((cur) => cur ? { ...cur, templates: r.templates } : cur);
                          setTplEdit(null);
                          setTplDraft(null);
                          await refreshPostProcess();
                          setMsg("\u81EA\u5B9A\u4E49\u6A21\u677F\u5DF2\u5220\u9664");
                        }),
                        children: "\u5220\u9664"
                      }
                    )
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginTop: 10 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Row, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { style: { fontSize: 12 }, children: "\u8FD0\u8F6C\u65B9\u5F0F" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Row, { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                Select,
                {
                  value: pp.config.mode,
                  onChange: (v) => void patchPostProcess({ mode: v }),
                  options: [
                    { value: "confirm", label: "\u540C\u6B65\u540E\u624B\u52A8\u786E\u8BA4\u518D\u6D41\u8F6C" },
                    { value: "auto", label: "\u5355\u6B21\u540C\u6B65\u540E\u81EA\u52A8\u6D41\u8F6C" }
                  ]
                }
              ) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { display: "block", marginTop: 4 }, children: pp.config.mode === "auto" ? "\u540C\u6B65\u4E00\u5B8C\u6210\u5C31\u81EA\u52A8\u53D1\u51FA\uFF0C\u65E0\u9700\u4F60\u5E72\u9884\u3002" : "\u540C\u6B65\u5B8C\u6210\u540E\u4F1A\u5148\u7ED9\u4F60\u770B\u5185\u5BB9\uFF0C\u4F60\u786E\u8BA4\u540E\u624D\u53D1\u51FA\u3002" })
            ] })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      Panel,
      {
        title: "\u84DD\u7259\u76F4\u8FDE",
        extra: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: ble?.connected ? "ok" : ble?.reconnecting ? "warn" : "neutral", children: ble?.connected ? "\u5DF2\u8FDE\u63A5" : ble?.reconnecting ? `\u81EA\u52A8\u91CD\u8FDE\u4E2D${ble.reconnectAttempt ? `\uFF08\u7B2C ${ble.reconnectAttempt} \u6B21\uFF09` : ""}` : "\u672A\u8FDE\u63A5" }),
          ble?.battery !== null && ble?.battery !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { children: fmtBattery(ble.battery) }),
          ble?.mtu ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
            "MTU ",
            ble.mtu
          ] }) : null
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { children: [
            "bleak ",
            ble?.bleak ?? "\u672A\u63A2\u6D4B",
            " \xB7 ",
            ble?.address ?? "\u672A\u8FDE\u63A5\u8BBE\u5907",
            ble?.sync?.running ? " \xB7 \u540C\u6B65\u4E2D" : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Row, { style: { marginTop: 12 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                primary: scan?.running,
                onClick: () => void run("scan", async () => {
                  if (scan?.running) {
                    await stopScan();
                    await refreshBle();
                    setMsg("\u5DF2\u505C\u6B62\u626B\u63CF");
                    return;
                  }
                  setMsg(null);
                  await post("/ble/setup", {});
                  await startScan({ roundMs: 3e3, autoConnect: true });
                  await refreshBle();
                }),
                children: scan?.running ? "\u505C\u6B62\u626B\u63CF" : "\u626B\u63CF\u8BBE\u5907"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                disabled: busy !== null,
                onClick: () => void run("files", async () => {
                  const r = await get("/ble/filelist");
                  const list = r.entries ?? [];
                  setFiles(list);
                  setFilesQueried(true);
                  setMsg(list.length ? `\u5F55\u97F3\u5361\u4E0A\u6709 ${list.length} \u6761\u5F55\u97F3` : "\u5F55\u97F3\u5361\u4E0A\u6CA1\u6709\u5F55\u97F3\uFF08\u7A7A\u5361\uFF09");
                }),
                children: "\u6587\u4EF6\u5217\u8868"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                disabled: busy !== null,
                onClick: () => void run("sync", async () => {
                  setMsg("\u540C\u6B65\u4E2D\u2026");
                  const r = await post(
                    "/ble/sync",
                    {}
                  );
                  setMsg(`\u540C\u6B65\u5B8C\u6210\uFF1A\u4E0B\u8F7D ${r.sync.downloaded} / \u8DF3\u8FC7 ${r.sync.skipped} / \u5931\u8D25 ${r.sync.failed}`);
                }),
                children: "\u540C\u6B65\u79BB\u7EBF\u5F55\u97F3"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                primary: true,
                disabled: busy !== null,
                onClick: () => void run("live", async () => {
                  if (liveSession) {
                    await post("/ble/realtime", { action: "stop" });
                    setLiveSession(null);
                  } else {
                    const r = await post("/ble/realtime", { action: "start" });
                    setPartial("");
                    setLiveSession(r.sessionId);
                  }
                }),
                children: liveSession ? "\u505C\u6B62\u5B9E\u65F6\u8F6C\u5199" : "\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199"
              }
            ),
            ble?.connected && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              Btn,
              {
                disabled: busy !== null,
                onClick: () => void run("disc", async () => {
                  await post("/ble/disconnect", {});
                  await refreshBle();
                }),
                children: "\u65AD\u5F00"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Btn, { small: true, disabled: busy !== null, onClick: () => void run("blefresh", refreshBle), children: "\u5237\u65B0\u72B6\u6001" })
          ] }),
          (scan?.running || scanMsg || scan?.lastError) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginTop: 10, fontSize: 12, lineHeight: 1.8 }, children: [
            scan?.running && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { color: C.brand, display: "flex", alignItems: "center", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Loading, {}),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
                "\u6B63\u5728\u626B\u63CF\u2026 \u5DF2\u53D1\u73B0 ",
                scan.devices.length,
                " \u4E2A\u8BBE\u5907",
                scan.autoConnect ? "\uFF0C\u53D1\u73B0\u8FDE\u63A5\u8FC7\u7684\u8BBE\u5907\u4F1A\u81EA\u52A8\u8FDE\u4E0A" : ""
              ] })
            ] }),
            scanMsg && !scan?.running && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: C.ink2 }, children: scanMsg }),
            scan?.lastError && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: C.danger }, children: scan.lastError })
          ] }),
          scanned.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "div",
            {
              style: {
                marginTop: 10,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                overflow: "hidden"
              },
              children: scanned.map((d) => {
                const isCurrent = ble?.connected && ble.address === d.address;
                return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderTop: `1px solid ${C.border}`,
                      flexWrap: "wrap"
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { fontWeight: 600, fontSize: 12.5, color: C.ink, minWidth: 90 }, children: d.name || "(\u672A\u547D\u540D)" }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { fontFamily: mono2, fontSize: 11, color: C.ink3 }, children: d.address }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                        "span",
                        {
                          title: fmtRssi(d.rssi),
                          style: {
                            fontSize: 11,
                            color: d.rssi >= -75 ? C.ink2 : C.warn,
                            fontFamily: mono2
                          },
                          children: [
                            d.rssi,
                            " dBm"
                          ]
                        }
                      ),
                      d.has_ae20 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: "brand", children: "\u5F55\u97F3\u5361" }),
                      d.known && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Chip, { tone: "ok", children: [
                        "\u8FDE\u8FC7",
                        d.lastConnectedAt ? ` \xB7 ${fmtAgo(d.lastConnectedAt)}` : ""
                      ] }),
                      !d.known && !d.has_ae20 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { fontSize: 11, color: C.ink3 }, children: "\u975E\u5F55\u97F3\u5361" }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { marginLeft: "auto" }, children: isCurrent ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Chip, { tone: "ok", children: "\u5DF2\u8FDE\u63A5" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                        Btn,
                        {
                          small: true,
                          primary: d.known,
                          disabled: busy !== null || scan?.running === true,
                          onClick: () => void run("connect", async () => {
                            await post("/ble/connect", { address: d.address, retries: 5 });
                            await refreshBle();
                            setMsg(`\u5DF2\u8FDE\u63A5 ${d.name || d.address}`);
                          }),
                          children: "\u8FDE\u63A5"
                        }
                      ) })
                    ]
                  },
                  d.address
                );
              })
            }
          ),
          knownList.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Muted, { style: { marginTop: 8, display: "block" }, children: [
            "\u8FDE\u8FC7\u7684\u8BBE\u5907\uFF1A",
            knownList.map((k) => `${k.name || k.address}\uFF08${fmtAgo(k.lastConnectedAt)}\uFF09`).join("\u3001")
          ] }),
          filesQueried && files.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { style: { marginTop: 8, display: "block" }, children: "\u5F55\u97F3\u5361\u4E0A\u6CA1\u6709\u5F55\u97F3\uFF08\u7A7A\u5361\uFF09\u3002\u5728\u5361\u4E0A\u5F55\u4E00\u6BB5\u540E\u6309\u300C\u540C\u6B65\u300D\u6216\u70B9\u300C\u626B\u63CF\u8BBE\u5907\u300D\u4F1A\u81EA\u52A8\u63A5\u56DE\u3002" }),
          files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { marginTop: 12, maxHeight: 260, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("tr", { style: { color: C.ink3, textAlign: "left" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { style: { padding: "6px 10px", fontWeight: 500 }, children: "\u6587\u4EF6" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { style: { padding: "6px 10px", fontWeight: 500 }, children: "\u65F6\u957F" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { style: { padding: "6px 10px", fontWeight: 500 }, children: "\u5927\u5C0F" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { style: { padding: "6px 10px", fontWeight: 500 } })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("tbody", { children: files.map((f) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("tr", { style: { borderTop: `1px solid ${C.border}` }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { style: { padding: "6px 10px", wordBreak: "break-all" }, children: f.name }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("td", { style: { padding: "6px 10px" }, children: [
                f.time,
                "s"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { style: { padding: "6px 10px" }, children: fmtBytes(f.size) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { style: { padding: "6px 10px" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                Btn,
                {
                  small: true,
                  primary: true,
                  disabled: busy !== null,
                  onClick: () => void run("dl", async () => {
                    setMsg(`\u8BC6\u522B\u4E2D\uFF1A${f.name}\uFF08opus \u4F18\u5148\uFF0C\u4F53\u79EF\u7EA6\u4E3A wav \u7684 1/16\uFF09\u2026`);
                    const r = await post("/ble/download", {
                      name: f.name
                    });
                    setMsg(`\u5B8C\u6210 ${r.sessionId}\uFF1A${(r.text ?? "").slice(0, 60)}`);
                  }),
                  children: "\u4E0B\u8F7D\u5E76\u8BC6\u522B"
                }
              ) })
            ] }, f.name)) })
          ] }) })
        ]
      }
    ),
    liveSession && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      Panel,
      {
        title: "\u5B9E\u65F6\u6587\u672C\u6D41",
        extra: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Muted, { children: liveSession }),
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "pre",
          {
            style: {
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: C.bg1,
              border: `1px solid ${C.border}`,
              fontFamily: "var(--ds-font-family-code, monospace)",
              fontSize: 13,
              lineHeight: 1.9,
              whiteSpace: "pre-wrap",
              maxHeight: 240,
              overflowY: "auto",
              color: C.ink
            },
            children: partial || "\uFF08\u7B49\u5F85\u8BED\u97F3\u2026\uFF09"
          }
        )
      }
    )
  ] }) });
}

// src/client/index.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var inject = ["slots", "sidebarRightTabs"];
var PLUGIN_KEY = "recorder";
var RB_LIBRARY = "dsh-ai-recorder/library";
var RB_BACKEND = "dsh-ai-recorder/backend";
function reportOpenSession(ctx) {
  const sessions = ctx.get("sessions");
  const store = sessions?.list;
  if (store === void 0) return;
  ctx.effect(() => {
    let last = null;
    const report = () => {
      try {
        const id = store.getSnapshot()?.current ?? null;
        if (id === null || id === last) return;
        last = id;
        void post("/session/open", { sessionId: id }).catch(() => void 0);
      } catch {
      }
    };
    report();
    return store.subscribe(report);
  });
}
function mountRightSidebar(ctx, tabs, slots) {
  const defs = [
    {
      id: RB_LIBRARY,
      // kind 必须各不相同：内核 coexists 规则里**同档位同 kind 不能共存**
      // （extension 与 builtin 可配对一次，fallback 独占），两个同 kind 会互相顶掉。
      kind: "recorder-library",
      order: 30,
      label: "\u5F55\u97F3\u5185\u5BB9",
      desc: "\u5F55\u97F3\u5217\u8868 \xB7 \u8F6C\u5199 \xB7 \u7EAA\u8981",
      body: () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RecorderLibrary, {})
    },
    {
      id: RB_BACKEND,
      kind: "recorder-backend",
      order: 31,
      label: "\u5F55\u97F3\u5361\u540E\u7AEF",
      desc: "\u8BC6\u522B\u73AF\u5883 \xB7 \u8FD0\u884C\u914D\u7F6E \xB7 \u84DD\u7259",
      body: () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RecorderSettings, {})
    }
  ];
  for (const d of defs) {
    ctx.effect(
      () => tabs.register({
        id: d.id,
        kind: d.kind,
        title: () => d.label,
        guide: [{ order: d.order, title: () => d.label, description: () => d.desc }]
      }),
      `dsh-ai-recorder: right tab ${d.id}`
    );
    ctx.effect(
      () => slots.inject(
        "sidebar.right.pane.tab",
        () => slots.register({ name: "sidebar.right.pane.tab", key: d.id }, (() => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }, children: d.body() })))
      ),
      `dsh-ai-recorder: right body ${d.id}`
    );
    ctx.effect(
      () => slots.inject(
        "sidebar.right.pane.tab.title",
        () => slots.register(
          { name: "sidebar.right.pane.tab.title", key: d.id },
          (() => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: d.label }))
        )
      ),
      `dsh-ai-recorder: right title ${d.id}`
    );
  }
}
function apply(ctx) {
  reportOpenSession(ctx);
  const c = ctx;
  const workbench = c.get("workbench");
  const tabs = c.sidebarRightTabs;
  const slots = c.slots;
  void post("/ui-surface", {
    surface: workbench !== void 0 ? "workbench" : "rightbar",
    hasWorkbench: workbench !== void 0,
    hasTabs: tabs !== void 0,
    hasSlots: slots !== void 0
  }).catch(() => void 0);
  if (workbench !== void 0) {
    ctx.effect(() => {
      return workbench.mount({
        id: `${PLUGIN_KEY}:backend`,
        title: "\u5F55\u97F3\u5361\u540E\u7AEF",
        icon: "\u{1F399}",
        plugin: PLUGIN_KEY,
        pluginTitle: "\u5F55\u97F3\u5361\u540E\u7AEF",
        render: () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RecorderSettings, {})
      });
    }, "dsh-ai-recorder: page backend");
    ctx.effect(() => {
      return workbench.mount({
        id: `${PLUGIN_KEY}:library`,
        title: "\u5F55\u97F3\u5185\u5BB9",
        icon: "\u{1F4DA}",
        plugin: PLUGIN_KEY,
        pluginTitle: "\u5F55\u97F3\u5361\u540E\u7AEF",
        render: () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RecorderLibrary, {})
      });
    }, "dsh-ai-recorder: page library");
    return;
  }
  mountRightSidebar(ctx, tabs, slots);
}
return module.exports; } });
//# sourceMappingURL=client.js.map
