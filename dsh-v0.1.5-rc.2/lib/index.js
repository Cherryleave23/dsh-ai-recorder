// src/index.ts
import { appendFileSync, createReadStream, existsSync as existsSync9, mkdirSync as mkdirSync5, readFileSync as readFileSync6, statSync as statSync5, writeFileSync as writeFileSync5 } from "node:fs";
import { execFile as execFile2, execFileSync as execFileSync4 } from "node:child_process";

// src/presets.ts
var ENV_COMPONENTS = {
  "funasr-py": {
    key: "funasr-py",
    label: "FunASR \u8FD0\u884C\u73AF\u5883\uFF08Python \u5305\uFF09",
    detail: "\u7CFB\u7EDF Python \u4E2D\u7684 funasr / modelscope / modelscope-hub / torch / torchaudio / torchcodec / soundfile",
    shared: true
  },
  "model-paraformer": {
    key: "model-paraformer",
    label: "Paraformer-large \u6743\u91CD",
    detail: "\u4E2D\u6587\u79BB\u7EBF\u8BC6\u522B\u4E3B\u6A21\u578B\uFF08\u7EA6 850MB\uFF09",
    shared: false,
    match: "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
  },
  "model-paraformer-online": {
    key: "model-paraformer-online",
    label: "Paraformer \u6D41\u5F0F\u6743\u91CD",
    detail: "\u5B9E\u65F6\u8F6C\u5199\u7528\u7684\u6D41\u5F0F\u6A21\u578B\uFF08\u7EA6 850MB\uFF09",
    shared: true,
    match: "vocab8404-online"
  },
  "model-sensevoice": {
    key: "model-sensevoice",
    label: "SenseVoiceSmall \u6743\u91CD",
    detail: "\u591A\u8BED\u79CD\u5FEB\u901F\u8BC6\u522B\u6A21\u578B\uFF08\u7EA6 900MB\uFF09\uFF0C\u4E0E\u53C2\u8003\u9879\u76EE NextProto \u540C\u6B3E",
    shared: false,
    match: "SenseVoiceSmall"
  },
  "model-vad": {
    key: "model-vad",
    label: "VAD \u65AD\u53E5\u6743\u91CD",
    detail: "fsmn-vad\uFF0C\u8D1F\u8D23\u5207\u5206\u8BED\u97F3\u6BB5\uFF08\u7EA6 4MB\uFF09",
    shared: true,
    match: "speech_fsmn_vad"
  },
  "model-punc": {
    key: "model-punc",
    label: "\u6807\u70B9\u6062\u590D\u6743\u91CD",
    detail: "ct-punc \u4E2D\u82F1\u6807\u70B9\u6A21\u578B\uFF08\u7EA6 1.1GB\uFF0C\u662F\u6700\u5927\u7684\u4E00\u5757\uFF09",
    shared: true,
    match: "punc_ct-transformer"
  },
  "model-spk": {
    key: "model-spk",
    label: "\u8BF4\u8BDD\u4EBA\u5206\u79BB\u6743\u91CD\uFF08cam++\uFF09",
    detail: "cam++ \u8BF4\u8BDD\u4EBA\u805A\u7C7B\uFF08\u7EA6 28MB\uFF09\u2014\u2014**Qwen3-ASR \u4E5F\u4F9D\u8D56\u5B83**\uFF0CQwen \u81EA\u5DF1\u6CA1\u6709\u8BF4\u8BDD\u4EBA\u5206\u79BB",
    shared: true,
    match: "campplus"
  },
  "qwen-venv": {
    key: "qwen-venv",
    label: "Qwen3-ASR \u72EC\u7ACB\u73AF\u5883\uFF08venv\uFF09",
    detail: "\u72EC\u7ACB\u865A\u62DF\u73AF\u5883\u4E2D\u7684 qwen-asr \u53CA\u5176\u4F9D\u8D56\uFF08\u7EA6 5.3GB\uFF09",
    shared: false
  },
  "qwen-models": {
    key: "qwen-models",
    label: "Qwen3-ASR \u6A21\u578B\u6743\u91CD",
    detail: "Qwen3-ASR-1.7B \u6743\u91CD\uFF08\u7EA6 4.5GB\uFF09",
    shared: false
  }
};
var ASR_PRESETS = [
  {
    id: "paraformer-zh",
    label: "FunASR Paraformer-large",
    summary: "\u4E2D\u6587\u9AD8\u7CBE\u5EA6\uFF0C\u7EAF\u4E2D\u6587\u573A\u666F\u6700\u7A33",
    needs: ["funasr-py", "model-paraformer", "model-paraformer-online", "model-vad", "model-punc", "model-spk"],
    provides: ["model-paraformer"],
    features: ["vad", "punc", "spk", "language", "realtime", "hotword", "timestamps"],
    languages: ["zh"],
    limits: {
      language: "Paraformer-large \u53EA\u9488\u5BF9\u4E2D\u6587\u8BAD\u7EC3\uFF0C\u8BC6\u522B\u5176\u4ED6\u8BED\u79CD\u8BF7\u6539\u7528 SenseVoiceSmall \u6216 Qwen3-ASR\u3002"
    }
  },
  {
    id: "sensevoice",
    label: "FunASR SenseVoiceSmall",
    summary: "\u591A\u8BED\u79CD\xB7\u5FEB\u901F\xB7CPU \u53EF\u8DD1 \u2014\u2014 \u4E0E\u53C2\u8003\u9879\u76EE NextProto \u540C\u6B3E",
    needs: ["funasr-py", "model-sensevoice", "model-paraformer-online", "model-vad", "model-punc", "model-spk"],
    provides: ["model-sensevoice"],
    features: ["vad", "punc", "spk", "language", "realtime", "timestamps"],
    languages: ["auto", "zh", "yue", "en", "ja", "ko"],
    limits: {
      hotword: "SenseVoiceSmall \u4E0D\u652F\u6301\u70ED\u8BCD\u8868\u3002"
    },
    reference: true
  },
  {
    id: "qwen3-asr",
    label: "Qwen3-ASR",
    summary: "\u4E2D\u82F1\u6587\u6700\u5F3A\uFF1B\u9700\u8981\u72EC\u7ACB\u73AF\u5883\u4E0E\u7EA6 3.4GB \u6743\u91CD",
    // cam++ 来自 funasr-models，跑在 funasr-py 上 —— 这就是公用键
    needs: ["funasr-py", "model-vad", "model-spk", "qwen-venv", "qwen-models"],
    provides: ["qwen-venv", "qwen-models"],
    features: ["vad", "spk", "language", "timestamps"],
    languages: ["auto", "zh", "en", "yue", "ja", "ko"],
    limits: {
      realtime: "Qwen3-ASR \u7684\u6D41\u5F0F\u4EC5 vLLM \u540E\u7AEF\u652F\u6301\uFF0C\u800C vLLM \u5728 Windows \u539F\u751F\u8DD1\u4E0D\u901A\uFF0C\u6545\u4E0D\u652F\u6301\u5B9E\u65F6\u8F6C\u5199\u3002",
      punc: "Qwen3-ASR \u81EA\u5E26\u6807\u70B9\uFF0C\u65E0\u9700\u5916\u6302\u6807\u70B9\u6A21\u578B\u3002",
      hotword: "Qwen3-ASR \u4E0D\u652F\u6301\u70ED\u8BCD\u8868\u3002"
    }
  }
];
var presetById = (id) => ASR_PRESETS.find((p) => p.id === id);
function presetsNeeding(key, only) {
  return ASR_PRESETS.filter((p) => (only ? only.includes(p.id) : true) && p.needs.includes(key));
}
function planUninstall(key, keepPresetIds) {
  const comp = ENV_COMPONENTS[key];
  const keep = keepPresetIds ?? ASR_PRESETS.map((p) => p.id);
  const others = presetsNeeding(key, keep);
  const allowed = others.length === 0;
  return {
    key,
    allowed,
    stillNeededBy: others,
    shared: comp.shared,
    message: allowed ? comp.shared ? `\u5C06\u5378\u8F7D\u300C${comp.label}\u300D\u3002\u5B83\u662F\u5171\u4EAB\u7EC4\u4EF6\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u4EFB\u4F55\u4FDD\u7559\u4E2D\u7684\u9884\u8BBE\u9700\u8981\u5B83\u3002` : `\u5C06\u5378\u8F7D\u300C${comp.label}\u300D\u3002` : `\u4E0D\u80FD\u5378\u8F7D\u300C${comp.label}\u300D\uFF1A${others.map((p) => p.label).join("\u3001")} \u4ECD\u5728\u4F7F\u7528\u5B83\u3002` + (key === "funasr-py" || key === "model-spk" || key === "model-vad" ? "\uFF08Qwen3-ASR \u7684\u8BF4\u8BDD\u4EBA\u5206\u79BB\u4F9D\u8D56 FunASR \u7684 cam++\uFF0C\u6240\u4EE5\u5B83\u4E5F\u7B97\u4F7F\u7528\u8005\uFF09" : "")
  };
}
function planPresetUninstall(presetId, enabled) {
  const preset = presetById(presetId);
  if (preset === void 0) {
    return { presetId, label: presetId, enabledAfter: enabled, remove: [], keep: [], summary: `\u672A\u77E5\u9884\u8BBE: ${presetId}` };
  }
  const enabledAfter = enabled.filter((id) => id !== presetId);
  const remove = [];
  const keep = [];
  for (const key of preset.needs) {
    const others = presetsNeeding(key, enabledAfter);
    if (others.length === 0) remove.push(key);
    else keep.push({ key, stillNeededBy: others.map((p) => p.id) });
  }
  const labelOf = (id) => presetById(id)?.label ?? id;
  const parts = [];
  if (remove.length) parts.push(`\u5C06\u5220\u9664 ${remove.map((k) => ENV_COMPONENTS[k].label).join("\u3001")}`);
  if (keep.length)
    parts.push(
      keep.map(
        (k) => `\u4FDD\u7559 ${ENV_COMPONENTS[k.key].label}\uFF08${k.stillNeededBy.map(labelOf).join("\u3001")} \u4ECD\u5728\u4F7F\u7528\uFF09`
      ).join("\uFF1B")
    );
  return {
    presetId,
    label: preset.label,
    enabledAfter,
    remove,
    keep,
    summary: parts.length ? `${parts.join("\uFF1B")}\u3002` : "\u8BE5\u9884\u8BBE\u6CA1\u6709\u72EC\u5360\u7684\u73AF\u5883\u7EC4\u4EF6\u3002"
  };
}
function normalizeEnabledPresets(enabled, active) {
  const list = Array.isArray(enabled) ? enabled.filter((x) => typeof x === "string") : [];
  const valid = [];
  for (const id of list) {
    if (presetById(id) === void 0) continue;
    if (!valid.includes(id)) valid.push(id);
  }
  if (presetById(active) && !valid.includes(active)) valid.push(active);
  return valid;
}

// src/env-manage.ts
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
var sizeCache = /* @__PURE__ */ new Map();
function invalidateSizeCache() {
  sizeCache.clear();
}
function dirSize(p, cap = 2e5) {
  const hit = sizeCache.get(p);
  const now = Date.now();
  if (hit && now - hit.at < 6e5) return hit.bytes;
  const bytes = dirSizeUncached(p, cap);
  sizeCache.set(p, { at: now, bytes });
  return bytes;
}
function dirSizeUncached(p, cap = 2e5) {
  try {
    if (!existsSync(p)) return null;
    let total = 0;
    let seen = 0;
    const walk = (d) => {
      if (seen++ > cap) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        try {
          if (e.isDirectory()) walk(f);
          else total += statSync(f).size;
        } catch {
        }
      }
    };
    walk(p);
    return total;
  } catch {
    return null;
  }
}
function findModelDir(p, match) {
  try {
    const root = join(p.funasrModelDir, "models");
    const base = existsSync(root) ? root : p.funasrModelDir;
    for (const name2 of readdirSync(base)) {
      if (name2.includes(match)) return join(base, name2);
    }
  } catch {
  }
  return null;
}
function componentPaths(key, p) {
  if (key === "funasr-py") return [];
  if (key === "qwen-venv") return [p.qwenVenvDir];
  if (key === "qwen-models") return [join(p.qwenModelDir, p.qwenModelName)];
  const match = ENV_COMPONENTS[key].match;
  if (match === void 0) return [];
  const dir = findModelDir(p, match);
  return dir === null ? [] : [dir];
}
function componentInstalled(key, p, funasrPkgOk) {
  switch (key) {
    case "funasr-py":
      return funasrPkgOk;
    case "model-paraformer":
    case "model-paraformer-online":
    case "model-sensevoice":
    case "model-vad":
    case "model-punc":
    case "model-spk": {
      const match = ENV_COMPONENTS[key].match;
      return match !== void 0 && findModelDir(p, match) !== null;
    }
    case "qwen-venv":
      return existsSync(join(p.qwenVenvDir, "Scripts", "python.exe")) || existsSync(join(p.qwenVenvDir, "bin", "python"));
    case "qwen-models":
      return existsSync(join(p.qwenModelDir, p.qwenModelName, "config.json"));
  }
}
function envStatus(p, enabled, funasrPkgOk) {
  const keep = enabled;
  return Object.keys(ENV_COMPONENTS).map((key) => {
    const comp = ENV_COMPONENTS[key];
    const plan = planUninstall(key, keep);
    const paths = componentPaths(key, p);
    return {
      key,
      label: comp.label,
      detail: comp.detail,
      shared: comp.shared,
      installed: componentInstalled(key, p, funasrPkgOk),
      bytes: paths.length ? dirSize(paths[0]) : null,
      paths,
      canUninstall: plan.allowed,
      blockedBy: plan.stillNeededBy.map((x) => x.id),
      message: plan.message
    };
  });
}
var FUNASR_PIP_PACKAGES = ["funasr", "modelscope", "modelscope-hub", "funasr-onnx"];
async function uninstallEnv(opts) {
  const { key, paths, activePresetId, funasrPkgOk, run: run2, log } = opts;
  const comp = ENV_COMPONENTS[key];
  const plan = planUninstall(key, [activePresetId]);
  if (!plan.allowed) {
    return { ok: false, key, removed: [], message: plan.message, error: plan.message };
  }
  if (!componentInstalled(key, paths, funasrPkgOk)) {
    return { ok: false, key, removed: [], message: `\u300C${comp.label}\u300D\u672C\u6765\u5C31\u6CA1\u6709\u5B89\u88C5\uFF0C\u65E0\u9700\u5378\u8F7D\u3002`, error: "not-installed" };
  }
  const removed = [];
  try {
    if (key === "funasr-py") {
      const py = paths.basePython || "python";
      log("\u5378\u8F7D FunASR Python \u5305:", FUNASR_PIP_PACKAGES.join(" "));
      const r = await run2(py, ["-m", "pip", "uninstall", "-y", ...FUNASR_PIP_PACKAGES], 6e5);
      if (r.code !== 0) {
        return {
          ok: false,
          key,
          removed,
          message: `pip \u5378\u8F7D\u5931\u8D25\uFF08exit ${r.code}\uFF09`,
          error: r.out.slice(-600)
        };
      }
      return {
        ok: true,
        key,
        removed,
        pipRemoved: FUNASR_PIP_PACKAGES,
        message: `\u5DF2\u5378\u8F7D FunASR \u8FD0\u884C\u73AF\u5883\uFF08${FUNASR_PIP_PACKAGES.join("\u3001")}\uFF09\u3002\u6CE8\u610F\uFF1A\u8FD9\u4F1A\u8BA9\u6240\u6709 FunASR \u7CFB\u9884\u8BBE\u4EE5\u53CA Qwen3 \u7684\u8BF4\u8BDD\u4EBA\u5206\u79BB\u5931\u6548\u3002`
      };
    }
    for (const target of componentPaths(key, paths)) {
      if (!existsSync(target)) continue;
      const guard = target.replace(/[\\/]+$/, "");
      if (guard.length < 8 || /^[A-Za-z]:$/.test(guard)) {
        return { ok: false, key, removed, message: `\u62D2\u7EDD\u5220\u9664\u53EF\u7591\u8DEF\u5F84\uFF1A${target}`, error: "unsafe-path" };
      }
      rmSync(target, { recursive: true, force: true });
      removed.push(target);
      log("\u5DF2\u5220\u9664:", target);
    }
    const detail = key === "qwen-venv" ? "\u4E0B\u6B21\u4F7F\u7528 Qwen3-ASR \u65F6\u9700\u91CD\u65B0\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D" : "\u4E0B\u6B21\u4F7F\u7528\u8BE5\u9884\u8BBE\u65F6\u9700\u91CD\u65B0\u4E0B\u8F7D";
    return {
      ok: true,
      key,
      removed,
      message: `\u5DF2\u5378\u8F7D\u300C${comp.label}\u300D${removed.length ? `\uFF08${removed.join("\u3001")}\uFF09` : ""}\u3002${detail}\u3002`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("\u5378\u8F7D\u5931\u8D25:", key, msg);
    return {
      ok: false,
      key,
      removed,
      message: `\u5378\u8F7D\u300C${comp.label}\u300D\u5931\u8D25\uFF1A${msg}${removed.length ? `\uFF08\u5DF2\u5220\u9664 ${removed.join("\u3001")}\uFF0C\u73AF\u5883\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF09` : ""}`,
      error: msg
    };
  }
}
async function uninstallPreset(opts) {
  const { presetId, enabled, paths, funasrPkgOk, run: run2, log } = opts;
  const plan = planPresetUninstall(presetId, enabled);
  if (presetById(presetId) === void 0) {
    return {
      ok: false,
      presetId,
      removedComponents: [],
      keptComponents: [],
      enabledAfter: enabled,
      message: `\u672A\u77E5\u9884\u8BBE: ${presetId}`,
      error: "unknown-preset"
    };
  }
  const removedComponents = [];
  const failures = [];
  for (const key of plan.remove) {
    const r = await uninstallEnv({
      key,
      paths,
      // 这里传「卸载后仍保留的预设」：uninstallEnv 内部还会再判一次，
      // 传空数组表示「就这一个组件，没有别的预设需要它」——但真正的安全判据
      // 是 planPresetUninstall 已经算过的 remove 列表，不会误删共用组件。
      activePresetId: plan.enabledAfter[0] ?? "",
      funasrPkgOk,
      run: run2,
      log
    });
    if (r.ok) removedComponents.push(key);
    else if (r.error === "not-installed") {
      log("\u7EC4\u4EF6\u672C\u6765\u5C31\u6CA1\u5B89\u88C5\uFF0C\u8DF3\u8FC7:", key);
    } else {
      failures.push(`${ENV_COMPONENTS[key].label}\uFF1A${r.error ?? r.message}`);
    }
  }
  const parts = [`\u5DF2\u5378\u8F7D\u9884\u8BBE\u300C${plan.label}\u300D`];
  if (removedComponents.length) {
    parts.push(`\u5E76\u5220\u9664\u4E86 ${removedComponents.map((k) => ENV_COMPONENTS[k].label).join("\u3001")}`);
  } else {
    parts.push("\u6CA1\u6709\u53EF\u56DE\u6536\u7684\u73AF\u5883\u7EC4\u4EF6");
  }
  for (const k of plan.keep) {
    parts.push(
      `\u4FDD\u7559\u4E86 ${ENV_COMPONENTS[k.key].label}\uFF08${k.stillNeededBy.map((id) => presetById(id)?.label ?? id).join("\u3001")} \u4ECD\u5728\u4F7F\u7528\uFF09`
    );
  }
  if (failures.length) parts.push(`\u5931\u8D25\uFF1A${failures.join("\uFF1B")}`);
  return {
    ok: failures.length === 0,
    presetId,
    removedComponents,
    keptComponents: plan.keep,
    enabledAfter: plan.enabledAfter,
    message: parts.join("\uFF1B") + "\u3002",
    error: failures.length ? failures.join("\uFF1B") : void 0
  };
}

// src/py-worker.ts
import { spawn } from "node:child_process";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var here = dirname(fileURLToPath(import.meta.url));
var PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
];
function spawnEnv(extra, proxyUrl) {
  const env = { ...process.env };
  for (const k of PROXY_KEYS) delete env[k];
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
  }
  return { ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...extra ?? {} };
}
function scriptPath(name2) {
  return join2(here, "..", "scripts", name2);
}
var PyWorker = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  proc = null;
  seq = 0;
  buf = "";
  pending = /* @__PURE__ */ new Map();
  disposed = false;
  starting = null;
  restarts = 0;
  /** 最近一次就绪事件携带的信息（如 worker 自报的设备/模型状态） */
  readyPayload = null;
  readyError = null;
  /** 上次非零退出码 */
  lastExit = null;
  get running() {
    return this.proc !== null;
  }
  get pid() {
    return this.proc?.pid ?? null;
  }
  /** 启动并等待 ready 事件；幂等。 */
  async ensureStarted() {
    if (this.proc) return;
    if (this.disposed) throw new Error("PyWorker \u5DF2\u968F\u63D2\u4EF6\u5378\u8F7D");
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  start() {
    const { python, script, args = [], readyTimeoutMs = 12e4, log } = this.opts;
    return new Promise((resolve3, reject) => {
      const proc = spawn(python, ["-u", script, ...args], {
        // 剔除继承来的坏代理（见 PyWorkerOptions.proxyUrl 的说明）
        env: spawnEnv(this.opts.env, this.opts.proxyUrl),
        windowsHide: true
      });
      this.proc = proc;
      this.buf = "";
      this.readyPayload = null;
      this.readyError = null;
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (c) => this.onStdout(c));
      proc.stderr.on("data", (c) => {
        const t = c.trim();
        if (t) log("[py stderr]", t);
      });
      proc.on("error", (e) => {
        log("PyWorker \u542F\u52A8\u9519\u8BEF:", String(e));
        this.failAll(new Error(`PyWorker \u542F\u52A8\u5931\u8D25: ${String(e)}`));
        reject(e);
      });
      proc.on("exit", (code, signal) => {
        const wasCurrent = this.proc === proc;
        if (wasCurrent) this.proc = null;
        this.lastExit = { code, signal };
        this.failAll(new Error(`PyWorker \u5DF2\u9000\u51FA\uFF08code=${code ?? "null"} signal=${signal ?? "null"}\uFF09`));
        if (!this.disposed && wasCurrent && code !== 0) this.scheduleRestart();
      });
      const deadline = Date.now() + readyTimeoutMs;
      const timer = setInterval(() => {
        if (this.readyPayload) {
          clearInterval(timer);
          if (this.readyError) reject(new Error(this.readyError));
          else resolve3();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`PyWorker \u542F\u52A8\u8D85\u65F6\uFF08${Math.round(readyTimeoutMs / 1e3)}s \u5185\u672A\u5C31\u7EEA\uFF09`));
        }
      }, 150);
    });
  }
  scheduleRestart() {
    const max = this.opts.maxRestarts ?? 3;
    if (this.restarts >= max) {
      this.opts.log(`PyWorker \u8FDE\u7EED\u5F02\u5E38\u9000\u51FA ${this.restarts} \u6B21\uFF0C\u653E\u5F03\u91CD\u542F`);
      return;
    }
    this.restarts += 1;
    const delay = Math.min(3e4, 2e3 * this.restarts);
    this.opts.log(`PyWorker \u5C06\u5728 ${delay}ms \u540E\u91CD\u542F\uFF08\u7B2C ${this.restarts}/${max} \u6B21\uFF09`);
    const t = setTimeout(() => {
      if (this.disposed) return;
      this.ensureStarted().catch((e) => this.opts.log("PyWorker \u91CD\u542F\u5931\u8D25:", String(e)));
    }, delay);
    t.unref?.();
  }
  onStdout(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        this.opts.log("PyWorker \u975E JSON \u8F93\u51FA\uFF08\u5FFD\u7565\uFF09:", line.slice(0, 200));
        continue;
      }
      this.dispatch(obj);
    }
  }
  dispatch(obj) {
    if (typeof obj.id === "number") {
      const p = this.pending.get(obj.id);
      if (!p) return;
      this.pending.delete(obj.id);
      clearTimeout(p.timer);
      if (obj.ok === false) p.reject(new Error(String(obj.error ?? "\u672A\u77E5\u9519\u8BEF")));
      else p.resolve(obj);
      return;
    }
    if (obj.event === "ready") {
      this.readyPayload = obj;
      if (typeof obj.error === "string" && obj.error) this.readyError = obj.error;
      else this.restarts = 0;
      return;
    }
    this.opts.onEvent?.(obj);
  }
  failAll(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
  /** 发送一条命令并等待响应。 */
  async request(cmd, params = {}, timeoutMs) {
    await this.ensureStarted();
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) throw new Error("PyWorker \u672A\u8FD0\u884C");
    const id = ++this.seq;
    const limit = timeoutMs ?? this.opts.commandTimeoutMs ?? 12e4;
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PyWorker \u547D\u4EE4\u8D85\u65F6\uFF08${cmd}, ${Math.round(limit / 1e3)}s\uFF09`));
      }, limit);
      this.pending.set(id, { resolve: resolve3, reject, timer });
      try {
        proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + "\n");
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  /** 停止进程（幂等）。 */
  async dispose() {
    this.disposed = true;
    const proc = this.proc;
    this.proc = null;
    this.failAll(new Error("PyWorker \u5DF2\u505C\u6B62"));
    if (!proc) return;
    try {
      proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
    } catch {
    }
    const t = setTimeout(() => {
      try {
        proc.kill();
      } catch {
      }
    }, 1500);
    t.unref?.();
  }
};

// src/index.ts
import { join as join11 } from "node:path";
import { homedir } from "node:os";

// src/config.ts
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  pythonPath: z.string().default(""),
  bleAutoSync: z.boolean().default(true),
  // 同步成功后从卡上删掉该条。默认开——用户要的就是「转到电脑上后卡里别留了」。
  // 安全性由 isSafelyOnDisk() 兜底：只有本地音频确实落盘且非空才删。
  bleSyncDeleteAfter: z.boolean().default(true),
  opusPreferred: z.boolean().default(true),
  captureSkipScanMax: z.number().min(0).max(65536).default(65536),
  realtimeWindowMs: z.number().min(200).max(3e4).default(1e3),
  targetSampleRate: z.number().default(16e3),
  targetChannels: z.number().default(1),
  targetBits: z.number().default(16),
  asrModel: z.union(["paraformer-zh", "sensevoice", "qwen3-asr"]).default("paraformer-zh"),
  enabledPresets: z.array(z.string()).default([]),
  postProcess: z.object({
    enabled: z.boolean().default(false),
    templateId: z.string().default("meeting-notes"),
    conversationId: z.string().default(""),
    mode: z.union(["auto", "confirm"]).default("confirm")
  }).default({ enabled: false, templateId: "meeting-notes", conversationId: "", mode: "confirm" }),
  asrDevice: z.union(["auto", "cpu", "cuda"]).default("auto"),
  asrVad: z.boolean().default(true),
  asrPunc: z.boolean().default(true),
  asrSpk: z.boolean().default(true),
  /**
   * 识别语种。`auto` = 交给模型判语种。
   *
   * 默认必须是 `auto` 而不是 `zh`：paraformer-zh 是中文专用，写死 zh 无所谓；
   * 但一旦切换到 SenseVoiceSmall（多语种），写死 zh 会让英文录音**照样按中文识别**，
   * 白白浪费了多语种能力——这正是「换了模型英文还是乱码」的根因。
   */
  language: z.union(["auto", "zh", "en", "yue", "ja", "ko"]).default("auto"),
  funasrPythonPath: z.string().default(""),
  funasrModelDir: z.string().default(""),
  /**
   * Qwen3-ASR 模型目录（留空=outDir/qwen）。venv 固定建在 outDir/qwen-venv。
   *
   * 独立 venv 是必须的：`qwen-asr` 会和 `funasr` 在同环境里打架
   * （官方 issue #3042：单独升 funasr 会报 'Qwen3ASRConfig' object has no attribute 'thinker_config'）。
   */
  qwenModelDir: z.string().default(""),
  /** Qwen3-ASR 权重目录名（在 qwenModelDir 下）。0.6B 更省显存、1.7B 更准 */
  qwenModelName: z.string().default("Qwen3-ASR-1.7B"),
  /** Qwen3-ASR 专用 venv 的 python（留空=outDir/qwen-venv） */
  qwenPythonPath: z.string().default(""),
  /**
   * 子进程代理地址；**留空 = 不使用代理**（推荐）。
   *
   * 模型与依赖都走国内源（modelscope / 清华 pypi / hf-mirror），直连即可。
   * 若系统环境里配了代理，本插件会**主动剔除**而不是继承——本机环境里的
   * HTTP_PROXY 指向已死端口 10809（活的 v2ray 在 10808），继承下去会让下载全失败。
   * 确实需要走代理时填 `http://127.0.0.1:10808`。
   */
  proxyUrl: z.string().default(""),
  streamChunkMs: z.number().min(60).max(2e3).default(600),
  streamEncoderLookBack: z.number().min(0).max(32).default(4),
  streamDecoderLookBack: z.number().min(0).max(32).default(1),
  outDir: z.string().default(""),
  markdownEnabled: z.boolean().default(true),
  keepAudio: z.boolean().default(true),
  historyLimit: z.number().min(1).max(1e4).default(1e3),
  autoTitle: z.boolean().default(true),
  titleMaxChars: z.number().min(2).max(64).default(12),
  token: z.string().default("")
});

// src/host-self-cleanup.ts
import { existsSync as existsSync2, readFileSync, readdirSync as readdirSync2, rmSync as rmSync2 } from "node:fs";
import { join as join3 } from "node:path";
var PACKAGE_NAME = "dsh-ai-recorder";
var POLL_INTERVAL_MS = 5e3;
var GRACE_CHECKS = 12;
var OWNED_DIRS = [];
var OWNED_FILES = ["runtime-config.json", "sync-index.json", "plugin.log"];
function stillInstalled(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join3(profileDir, "package.json"), "utf8"));
    const dependencies = manifest.dependencies ?? {};
    const bundles = manifest.dsh?.profile?.bundles ?? [];
    return Object.prototype.hasOwnProperty.call(dependencies, PACKAGE_NAME) || bundles.includes(PACKAGE_NAME);
  } catch {
    return true;
  }
}
function removeOwnedData(dataDir) {
  if (!existsSync2(dataDir)) return;
  for (const name2 of readdirSync2(dataDir)) {
    if (OWNED_DIRS.includes(name2)) {
      rmSync2(join3(dataDir, name2), { recursive: true, force: true });
    } else if (OWNED_FILES.includes(name2)) {
      rmSync2(join3(dataDir, name2), { force: true });
    }
  }
  if (readdirSync2(dataDir).length === 0) rmSync2(dataDir, { recursive: true, force: true });
}
function installSelfCleanup(ctx, dataDir, stopResources) {
  const profiles = ctx.get("desktopProfiles");
  const profileDir = profiles?.current?.dir;
  if (typeof profileDir !== "string" || profileDir === "") return () => void 0;
  const log = ctx.logger(PACKAGE_NAME);
  let timer;
  let absentChecks = 0;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== void 0) clearInterval(timer);
    log.info("plugin removed from profile \u2014 stopping resources and removing self-owned state");
    void stopResources().finally(() => {
      try {
        removeOwnedData(dataDir);
      } catch (error) {
        log.warn("self-owned data cleanup failed: %s", String(error));
      }
    });
  };
  const check = () => {
    if (cleaned) return;
    if (stillInstalled(profileDir)) {
      absentChecks = 0;
      return;
    }
    absentChecks += 1;
    if (absentChecks >= GRACE_CHECKS) cleanup();
  };
  timer = setInterval(check, POLL_INTERVAL_MS);
  timer.unref?.();
  return () => {
    if (timer !== void 0) clearInterval(timer);
    if (absentChecks >= GRACE_CHECKS) cleanup();
  };
}

// src/layers/01-capture/ble.ts
import { execFileSync as execFileSync2, spawn as spawn2 } from "node:child_process";
import { dirname as dirname2, join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var here2 = dirname2(fileURLToPath2(import.meta.url));
var BLE_SCRIPT = join4(here2, "..", "scripts", "ble_central.py");
function deviceFileTime(name2) {
  const m = /(?:^|\D)(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(name2 ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d) || dt.getHours() !== Number(h) || dt.getMinutes() !== Number(mi) || dt.getSeconds() !== Number(s)) {
    return null;
  }
  return dt;
}
var BleCentral = class {
  constructor(log, onEvent) {
    this.log = log;
    this.onEvent = onEvent;
  }
  log;
  onEvent;
  proc = null;
  seq = 0;
  pending = /* @__PURE__ */ new Map();
  buf = "";
  disposed = false;
  restartTimer = null;
  stopping = false;
  python = null;
  bleakVersion = null;
  lastError = null;
  connected = false;
  reconnecting = false;
  /** 已尝试的自动重连次数（界面显示「第 N 次」，让用户看得出在进展而不是卡死） */
  reconnectAttempt = 0;
  address = null;
  mtu = null;
  battery = null;
  realtimeActive = false;
  /** 距上次成功命令的时间（面板显示最后活跃） */
  lastActivity = null;
  // ─────────── 环境探测 / 安装 ───────────
  /** 探测可用的 python + bleak；缺失时自动 pip 安装 bleak（幂等）。 */
  prepare(pythonCandidates) {
    for (const py of pythonCandidates) {
      try {
        execFileSync2(py, ["--version"], { stdio: "ignore", timeout: 8e3 });
      } catch {
        continue;
      }
      const check = () => {
        try {
          return execFileSync2(py, ["-c", 'from importlib.metadata import version; print(version("bleak"))'], { encoding: "utf8", timeout: 2e4 }).trim();
        } catch {
          return null;
        }
      };
      let ver = check();
      if (ver) {
        this.python = py;
        this.bleakVersion = ver;
        return { ok: true, python: py };
      }
      try {
        this.log("BLE: \u672A\u68C0\u6D4B\u5230 bleak\uFF0C\u81EA\u52A8 pip \u5B89\u88C5 ...");
        execFileSync2(py, ["-m", "pip", "install", "--disable-pip-version-check", "--quiet", "bleak"], { stdio: "ignore", timeout: 24e4 });
        ver = check();
        if (ver) {
          this.python = py;
          this.bleakVersion = ver;
          this.log("BLE: bleak \u5B89\u88C5\u6210\u529F", ver);
          return { ok: true, python: py };
        }
      } catch (e) {
        this.lastError = String(e);
      }
      return { ok: false, error: `${py} \u7684 bleak \u5B89\u88C5\u5931\u8D25: ${this.lastError}` };
    }
    return { ok: false, error: "\u672A\u627E\u5230\u53EF\u7528\u7684 Python \u89E3\u91CA\u5668\uFF08BLE \u6536\u7AEF\u4F9D\u8D56 Python 3.9+\uFF09" };
  }
  // ─────────── 进程生命周期 ───────────
  get running() {
    return this.proc !== null;
  }
  /** 确保守护进程已启动并就绪。 */
  async ensureStarted() {
    if (this.proc) return;
    if (this.disposed) throw new Error("BLE \u5DF2\u968F\u63D2\u4EF6\u5378\u8F7D");
    if (!this.python) throw new Error("BLE: python \u672A\u5C31\u7EEA\uFF0C\u5148\u8C03\u7528 prepare()");
    await new Promise((resolve3, reject) => {
      const proc = spawn2(this.python, ["-u", BLE_SCRIPT], {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true
      });
      this.proc = proc;
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (c) => this.onStdout(c));
      proc.stderr.on("data", (c) => this.log("BLE daemon stderr:", c.trim()));
      proc.on("error", (e) => {
        this.log("BLE daemon \u542F\u52A8\u9519\u8BEF:", String(e));
        this.proc = null;
        this.lastError = String(e);
        reject(e);
      });
      proc.on("exit", (code, signal) => this.onExit(code, signal));
      const deadline = Date.now() + 15e3;
      const timer = setInterval(() => {
        if (this.readySeen) {
          clearInterval(timer);
          resolve3();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          this.lastError = "BLE \u5B88\u62A4\u8FDB\u7A0B\u542F\u52A8\u8D85\u65F6";
          this.log("BLE \u5B88\u62A4\u8FDB\u7A0B\u542F\u52A8\u8D85\u65F6");
          reject(new Error(this.lastError));
        }
      }, 100);
      this.readySeen = false;
    });
  }
  readySeen = false;
  onExit(code, signal) {
    const wasRunning = this.proc !== null;
    this.proc = null;
    this.readySeen = false;
    this.connected = false;
    this.realtimeActive = false;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`BLE \u5B88\u62A4\u8FDB\u7A0B\u9000\u51FA\uFF08code=${code} signal=${signal}\uFF09`));
    }
    this.pending.clear();
    if (!this.disposed && !this.stopping) {
      this.log("BLE \u5B88\u62A4\u8FDB\u7A0B\u9000\u51FA\uFF0C2s \u540E\u81EA\u52A8\u91CD\u542F");
      this.lastError = `\u5B88\u62A4\u8FDB\u7A0B\u9000\u51FA code=${code}`;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.ensureStarted().catch((e) => this.log("BLE \u91CD\u542F\u5931\u8D25:", String(e)));
      }, 2e3);
    }
  }
  onStdout(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        this.handleMessage(obj);
      } catch {
        this.log("BLE daemon \u975E JSON \u8F93\u51FA:", line.slice(0, 200));
      }
    }
  }
  handleMessage(obj) {
    const id = typeof obj.id === "number" ? obj.id : void 0;
    if (id !== void 0) {
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (obj.ok === false) {
          p.reject(new Error(String(obj.error ?? "BLE \u547D\u4EE4\u5931\u8D25")));
        } else {
          p.resolve(obj);
        }
        return;
      }
      return;
    }
    if (obj.event === "ready") {
      this.readySeen = true;
      if (typeof obj.error === "string") this.lastError = obj.error;
      return;
    }
    if (obj.event === "battery" && typeof obj.level === "number") {
      this.battery = obj.level;
    } else if (obj.event === "stream") {
      if (obj.kind === "started") this.realtimeActive = true;
      if (obj.kind === "stopped") this.realtimeActive = false;
    } else if (obj.event === "disconnected") {
      this.connected = false;
      this.realtimeActive = false;
      this.reconnecting = false;
    } else if (obj.event === "connected") {
      this.connected = true;
      this.reconnecting = false;
      if (typeof obj.address === "string") this.address = obj.address;
      if (typeof obj.mtu === "number") this.mtu = obj.mtu;
      if (typeof obj.battery === "number") this.battery = obj.battery;
    } else if (obj.event === "reconnecting") {
      this.reconnecting = true;
      this.reconnectAttempt = typeof obj.attempt === "number" ? obj.attempt : this.reconnectAttempt + 1;
      this.lastError = `\u8FDE\u63A5\u65AD\u5F00\uFF0C\u81EA\u52A8\u91CD\u8FDE\u4E2D\uFF08\u7B2C ${this.reconnectAttempt} \u6B21\uFF09`;
    } else if (obj.event === "reconnect_failed") {
      this.lastError = `\u81EA\u52A8\u91CD\u8FDE\u5931\u8D25\uFF08\u7B2C ${String(obj.attempt ?? "?")} \u6B21\uFF09: ${String(obj.error ?? "")}`;
    } else if (obj.event === "device_address_changed") {
      this.address = typeof obj.new === "string" ? obj.new : this.address;
    }
    this.onEvent?.(obj);
  }
  /** 发送请求并等待响应（默认 40s 超时；connect/download 用更长）。 */
  request(cmd, params = {}, timeoutMs = 4e4) {
    return new Promise((resolve3, reject) => {
      const proc = this.proc;
      if (!proc) {
        reject(new Error("BLE \u5B88\u62A4\u8FDB\u7A0B\u672A\u542F\u52A8"));
        return;
      }
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BLE \u547D\u4EE4\u8D85\u65F6: ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve3, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + "\n");
    });
  }
  // ─────────── 业务命令 ───────────
  async status() {
    const r = await this.request("status", {}, 1e4);
    this.lastActivity = Date.now();
    return r;
  }
  async scan(timeout = 8) {
    const r = await this.request("scan", { timeout }, timeout * 1e3 + 15e3);
    this.lastActivity = Date.now();
    return r.devices ?? [];
  }
  async connect(address, retries = 5) {
    const r = await this.request("connect", { address, retries }, 24e4);
    this.connected = true;
    this.address = String(r.address ?? address);
    if (typeof r.mtu === "number") this.mtu = r.mtu;
    if (typeof r.battery === "number") this.battery = r.battery;
    this.lastActivity = Date.now();
    return r;
  }
  async disconnect() {
    try {
      await this.request("disconnect", {}, 15e3);
    } finally {
      this.connected = false;
      this.realtimeActive = false;
    }
  }
  async queryBattery() {
    const r = await this.request("battery", {}, 2e4);
    this.battery = r.level;
    return r.level;
  }
  async timesync() {
    await this.request("timesync", {}, 15e3);
  }
  async filelist() {
    const r = await this.request("filelist", {}, 3e4);
    return r.entries ?? [];
  }
  async download(name2, opts = {}) {
    const params = { name: name2 };
    if (opts.chunkBytes) params.chunk_bytes = opts.chunkBytes;
    if (opts.chunkTime) params.chunk_time = opts.chunkTime;
    params.prefer = opts.prefer ?? "opus";
    const r = await this.request("download", params, 18e5);
    return r;
  }
  async deleteFile(name2, time, size, raw) {
    const params = { name: name2, time, size };
    if (raw) params.raw = raw;
    return await this.request("delete", params, 6e4);
  }
  async realtime(action, opts = {}) {
    const params = { action };
    if (action === "start") {
      if (opts.windowMs) params.window_ms = opts.windowMs;
      if (opts.minBytes) params.min_bytes = opts.minBytes;
      if (opts.maxBytes) params.max_bytes = opts.maxBytes;
    }
    const r = await this.request("realtime", params, 15e3);
    if (action === "start") this.realtimeActive = Boolean(r.active);
    if (action === "stop") this.realtimeActive = false;
  }
  // ─────────── 清理 ───────────
  dispose() {
    this.disposed = true;
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try {
        proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
      } catch {
      }
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
        }
      }, 1500).unref?.();
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("BLE \u5DF2\u968F\u63D2\u4EF6\u5378\u8F7D"));
    }
    this.pending.clear();
  }
};

// src/layers/01-capture/known-devices.ts
import { mkdirSync, readFileSync as readFileSync2, writeFileSync, renameSync } from "node:fs";
import { dirname as dirname3 } from "node:path";
var KnownDeviceStore = class {
  file;
  cache = null;
  constructor(file) {
    this.file = file;
  }
  list() {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(readFileSync2(this.file, "utf8"));
      this.cache = Array.isArray(raw?.devices) ? raw.devices.filter((d) => d && d.address) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }
  find(address) {
    const key = (address ?? "").toLowerCase();
    return this.list().find((d) => d.address.toLowerCase() === key);
  }
  /** 同名的另一张卡（设备换随机地址时靠名字兜底）。 */
  findByName(name2) {
    const key = (name2 ?? "").trim().toLowerCase();
    if (!key) return void 0;
    return this.list().find((d) => (d.name ?? "").trim().toLowerCase() === key);
  }
  /** 连接成功后记住它。address 变了但名字对得上时，视为同一张卡（迁移计数）。 */
  remember(dev) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const list = this.list();
    let hit = list.find((d) => d.address.toLowerCase() === dev.address.toLowerCase());
    if (!hit && dev.name) hit = list.find((d) => (d.name ?? "").toLowerCase() === dev.name.toLowerCase());
    if (hit) {
      if (hit.address.toLowerCase() !== dev.address.toLowerCase()) {
        hit.address = dev.address;
      }
      if (dev.name) hit.name = dev.name;
      hit.lastConnectedAt = now;
      hit.connectCount += 1;
      if (typeof dev.rssi === "number") hit.lastRssi = dev.rssi;
    } else {
      hit = {
        address: dev.address,
        name: dev.name ?? "",
        lastConnectedAt: now,
        connectCount: 1,
        lastRssi: dev.rssi
      };
      list.push(hit);
    }
    this.save();
    return hit;
  }
  forget(address) {
    const key = (address ?? "").toLowerCase();
    const list = this.list();
    const i = list.findIndex((d) => d.address.toLowerCase() === key);
    if (i < 0) return false;
    list.splice(i, 1);
    this.save();
    return true;
  }
  save() {
    try {
      mkdirSync(dirname3(this.file), { recursive: true });
      const body = { updatedAt: (/* @__PURE__ */ new Date()).toISOString(), devices: this.list() };
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
      renameSync(tmp, this.file);
    } catch {
    }
  }
};
function matchKnown(store, dev) {
  return store.find(dev.address) ?? (dev.name ? store.findByName(dev.name) : void 0);
}

// src/layers/02-preprocess/opus.ts
var OPUS_PACKET_BYTES = 40;
var OPUS_PACKET_MS = 20;
var OPUS_GRANULE_PER_PACKET = 960;
var OGG_SERIAL = 1364407864;
var PAGE_PACKETS = 50;
function oggCrc(data) {
  let crc = 0;
  for (const b of data) {
    crc ^= b << 24;
    for (let i = 0; i < 8; i++) {
      crc = crc & 2147483648 ? (crc << 1 ^ 79764919) >>> 0 : crc << 1 >>> 0;
    }
  }
  return crc >>> 0;
}
function writeU32LE(v) {
  return new Uint8Array([v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255]);
}
function writeU64LE(v) {
  const lo = v >>> 0;
  const hi = Math.floor(v / 4294967296) >>> 0;
  return new Uint8Array([
    lo & 255,
    lo >> 8 & 255,
    lo >> 16 & 255,
    lo >> 24 & 255,
    hi & 255,
    hi >> 8 & 255,
    hi >> 16 & 255,
    hi >> 24 & 255
  ]);
}
function makePage(payloads, granule, serial, seq, flags) {
  const body = new Uint8Array(payloads.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of payloads) {
    body.set(p, o);
    o += p.length;
  }
  const laces = [];
  for (const p of payloads) {
    let r = p.length;
    while (r >= 255) {
      laces.push(255);
      r -= 255;
    }
    laces.push(r);
  }
  const header = new Uint8Array(27 + laces.length);
  header.set([79, 103, 103, 83], 0);
  header[4] = 0;
  header[5] = flags;
  header.set(writeU64LE(granule), 6);
  header.set(writeU32LE(serial), 14);
  header.set(writeU32LE(seq), 18);
  header.set(writeU32LE(0), 22);
  header[26] = laces.length;
  header.set(laces, 27);
  const page = new Uint8Array(header.length + body.length);
  page.set(header, 0);
  page.set(body, header.length);
  const crc = oggCrc(page);
  page[22] = crc & 255;
  page[23] = crc >> 8 & 255;
  page[24] = crc >> 16 & 255;
  page[25] = crc >> 24 & 255;
  return page;
}
function wrapRawOpusPackets(raw, sampleRate = 16e3, allowTrailing = true) {
  if (raw.length === 0) throw new Error("\u88F8 Opus \u5305\u6D41\u4E3A\u7A7A");
  const usable = raw.length - raw.length % OPUS_PACKET_BYTES;
  const trailingBytes = raw.length - usable;
  if (usable === 0) {
    throw new Error(`\u88F8 Opus \u5305\u6D41\u4E0D\u8DB3\u4E00\u6574\u5305\uFF08${raw.length}B < ${OPUS_PACKET_BYTES}B\uFF09`);
  }
  if (trailingBytes !== 0 && !allowTrailing) {
    throw new Error(`\u88F8 Opus \u5305\u6D41\u957F\u5EA6\u4E0D\u662F ${OPUS_PACKET_BYTES}B \u7684\u6574\u6570\u500D\uFF08\u4F59 ${trailingBytes}B\uFF09`);
  }
  const packets = [];
  for (let i = 0; i < usable; i += OPUS_PACKET_BYTES) {
    packets.push(raw.slice(i, i + OPUS_PACKET_BYTES));
  }
  const pages = [];
  let seq = 0;
  const head = new Uint8Array([
    79,
    112,
    117,
    115,
    72,
    101,
    97,
    100,
    // 'OpusHead'
    1,
    1,
    // version, channels
    312 & 255,
    312 >> 8 & 255,
    // pre-skip
    ...writeU32LE(sampleRate),
    0,
    0,
    // output gain
    0
    // channel mapping family
  ]);
  const tagsName = [81, 83, 54, 54, 56];
  const tags = new Uint8Array([
    79,
    112,
    117,
    115,
    84,
    97,
    103,
    115,
    // 'OpusTags'
    tagsName.length & 255,
    0,
    0,
    0,
    ...tagsName,
    0,
    0,
    0,
    0
  ]);
  pages.push(makePage([head], 0, OGG_SERIAL, seq++, 2));
  pages.push(makePage([tags], 0, OGG_SERIAL, seq++, 0));
  let granule = 0;
  for (let start = 0; start < packets.length; start += PAGE_PACKETS) {
    const group = packets.slice(start, start + PAGE_PACKETS);
    granule += OPUS_GRANULE_PER_PACKET * group.length;
    const flags = start + PAGE_PACKETS >= packets.length ? 4 : 0;
    pages.push(makePage(group, granule, OGG_SERIAL, seq++, flags));
  }
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of pages) {
    out.set(p, o);
    o += p.length;
  }
  return {
    bytes: out,
    packetCount: packets.length,
    durationMs: packets.length * OPUS_PACKET_MS,
    trailingBytes
  };
}
function isOgg(bytes) {
  return bytes.length >= 4 && bytes[0] === 79 && bytes[1] === 103 && bytes[2] === 103 && bytes[3] === 83;
}
function isWav(bytes) {
  return bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && // RIFF
  bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69;
}
function wavInfo(bytes) {
  if (!isWav(bytes) || bytes.length < 44) return { ok: false };
  const declared = ((bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24) >>> 0) + 8;
  const channels = bytes[22] | bytes[23] << 8;
  const sampleRate = (bytes[24] | bytes[25] << 8 | bytes[26] << 16 | bytes[27] << 24) >>> 0;
  const bitsPerSample = bytes[34] | bytes[35] << 8;
  return { ok: declared === bytes.length, declared, actual: bytes.length, channels, sampleRate, bitsPerSample, dataBytes: bytes.length - 44 };
}

// src/layers/02-preprocess/normalize.ts
var AudioFormatError = class extends Error {
};
function containAudio(raw, hint, strict = false) {
  if (raw.length === 0) throw new AudioFormatError("\u97F3\u9891\u6570\u636E\u4E3A\u7A7A");
  if (isWav(raw)) {
    const info = wavInfo(raw);
    if (!info.ok && strict) {
      throw new AudioFormatError(`WAV \u957F\u5EA6\u4E0D\u81EA\u6D3D\uFF1A\u58F0\u660E ${info.declared}B \u5B9E\u9645 ${info.actual}B`);
    }
    const durationMs = info.sampleRate && info.channels && info.bitsPerSample && info.dataBytes !== void 0 ? Math.round(info.dataBytes / (info.sampleRate * info.channels * (info.bitsPerSample / 8)) * 1e3) : void 0;
    return { bytes: raw, ext: "wav", origin: "native", durationMs };
  }
  if (isOgg(raw)) {
    return { bytes: raw, ext: "ogg", origin: "native" };
  }
  if (hint === "wav") {
    throw new AudioFormatError("\u8F93\u5165\u6807\u6CE8\u4E3A wav\uFF0C\u4F46 RIFF/WAVE \u5934\u4E0D\u5408\u6CD5");
  }
  const wrapped = wrapRawOpusPackets(raw, 16e3, !strict);
  return {
    bytes: wrapped.bytes,
    ext: "ogg",
    origin: "raw-opus",
    packetCount: wrapped.packetCount,
    durationMs: wrapped.durationMs,
    trailingBytes: wrapped.trailingBytes
  };
}
function expectedMsForRawOpus(byteLength) {
  return Math.floor(byteLength / 40) * OPUS_PACKET_MS;
}

// src/layers/02-preprocess/decode.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";
async function makeTmpDir(tag) {
  return mkdtemp(join5(tmpdir(), `rec-${tag}-`));
}
async function disposeTmp(dir) {
  await rm(dir, { recursive: true, force: true }).catch(() => void 0);
}
async function writeTmp(dir, name2, bytes) {
  const p = join5(dir, name2);
  await writeFile(p, bytes);
  return p;
}
async function decodeToUnified(worker, archive, target, dir, basename = "archive") {
  const inputPath = await writeTmp(dir, `${basename}.${archive.ext}`, archive.bytes);
  const outputPath = join5(dir, `${basename}.16k.wav`);
  const r = await worker.request(
    "decode",
    {
      inputPath,
      outputPath,
      sampleRate: target.sampleRate,
      channels: target.channels,
      bits: target.bits
    },
    10 * 60 * 1e3
  );
  return {
    path: String(r.outputPath ?? outputPath),
    durationMs: Number(r.durationMs ?? 0),
    sampleRate: Number(r.sampleRate ?? target.sampleRate),
    channels: Number(r.channels ?? target.channels),
    bits: Number(r.bits ?? target.bits),
    bytes: Number(r.bytes ?? 0)
  };
}
async function probeOpusPackets(worker, rawOpus, expectedMs, dir, opts = {}) {
  const maxSkip = opts.maxSkip ?? 65536;
  const step = opts.step ?? 40;
  const minRatio = opts.minRatio ?? 0.9;
  const inputPath = await writeTmp(dir, `${opts.basename ?? "probe"}.opus`, rawOpus);
  const r = await worker.request(
    "opus_probe",
    { inputPath, expectedMs, maxSkip, step, minRatio },
    10 * 60 * 1e3
  );
  const decodedMs = Number(r.decodedMs ?? 0);
  const exp = Number(r.expectedMs ?? expectedMs);
  const ratio = exp > 0 ? decodedMs / exp : 0;
  const skipBytes = Number(r.skipBytes ?? 0);
  return { skipBytes, decodedMs, expectedMs: exp, ratio, ok: ratio >= minRatio || skipBytes === 0 && decodedMs > 0 };
}
function applySkip(archive, rawOpus, skipBytes) {
  if (skipBytes <= 0 || archive.origin !== "raw-opus") return archive;
  const trimmed = rawOpus.subarray(skipBytes);
  const wrapped = wrapRawOpusPackets(trimmed, 16e3, true);
  return {
    bytes: wrapped.bytes,
    ext: "ogg",
    origin: "raw-opus",
    packetCount: wrapped.packetCount,
    durationMs: wrapped.durationMs,
    trailingBytes: wrapped.trailingBytes
  };
}

// src/layers/03-recognition/funasr.ts
var FunasrEngine = class {
  constructor(worker, getOptions, log) {
    this.worker = worker;
    this.getOptions = getOptions;
    this.log = log;
  }
  worker;
  getOptions;
  log;
  /** 离线识别：完整音频文件 → VAD 断句 + ASR + 标点 + 说话人。 */
  async recognizeFile(wavPath) {
    const o = this.getOptions();
    const r = await this.worker.request(
      "offline",
      {
        inputPath: wavPath,
        model: o.model,
        device: o.device,
        language: o.language,
        vad: o.vad,
        punc: o.punc,
        spk: o.spk,
        modelDir: o.modelDir
      },
      30 * 60 * 1e3
    );
    return {
      text: String(r.text ?? ""),
      segments: Array.isArray(r.segments) ? r.segments : [],
      durationMs: Number(r.durationMs ?? 0),
      model: String(r.model ?? o.model),
      device: String(r.device ?? o.device),
      speakerApplied: r.speakerApplied === true
    };
  }
  // ═══════════════ 实时流（增量 chunk 解码 → 逐字输出） ═══════════════
  /** 打开一条流式识别会话（worker 侧持有 online 模型的 cache）。 */
  async openStream(streamId) {
    const o = this.getOptions();
    await this.worker.request(
      "stream_open",
      {
        streamId,
        model: o.model,
        device: o.device,
        language: o.language,
        modelDir: o.modelDir,
        chunkMs: o.streamChunkMs,
        encoderLookBack: o.encoderLookBack,
        decoderLookBack: o.decoderLookBack,
        punc: o.punc
      },
      5 * 60 * 1e3
    );
    this.log("\u6D41\u5F0F\u8BC6\u522B\u5DF2\u6253\u5F00:", streamId);
  }
  /**
   * 喂一段裸 Opus 包流（设备推来的 40B/20ms），取回增量文本。
   * 解码在 worker 内完成，避免每段都落临时文件。
   */
  async feedStream(streamId, rawOpus) {
    const r = await this.worker.request(
      "stream_feed",
      { streamId, opusB64: Buffer.from(rawOpus).toString("base64") },
      2 * 60 * 1e3
    );
    return {
      partial: String(r.partial ?? ""),
      segments: Array.isArray(r.segments) ? r.segments : []
    };
  }
  /** 结束流式识别，取回终稿。 */
  async closeStream(streamId) {
    const r = await this.worker.request("stream_close", { streamId }, 5 * 60 * 1e3);
    this.log("\u6D41\u5F0F\u8BC6\u522B\u5DF2\u5173\u95ED:", streamId);
    return {
      text: String(r.text ?? ""),
      segments: Array.isArray(r.segments) ? r.segments : [],
      durationMs: Number(r.durationMs ?? 0),
      model: String(r.model ?? this.getOptions().model),
      device: String(r.device ?? this.getOptions().device),
      speakerApplied: r.speakerApplied === true
    };
  }
};

// src/layers/03-recognition/qwen.ts
var QwenEngine = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  /**
   * 离线识别：FunASR 出说话人时间段 → Qwen3 逐段识别 → 合并。
   *
   * 任何一个环节拿不到说话人时间段，都退回「整段喂 Qwen3」——
   * 宁可丢掉说话人标签，也不能因为分离失败就整条录音转不出来。
   */
  async recognizeFile(wavPath) {
    const o = this.deps.getOptions();
    let spans = [];
    let diarizeFailed = null;
    try {
      const d = await this.deps.diarizer.recognizeFile(wavPath);
      spans = d.segments;
      this.deps.log(`Qwen3: \u5206\u79BB\u5F97\u5230 ${spans.length} \u4E2A\u8BF4\u8BDD\u4EBA\u65F6\u6BB5\uFF08FunASR \u6587\u672C\u5DF2\u4E22\u5F03\uFF09`);
    } catch (e) {
      diarizeFailed = e instanceof Error ? e.message : String(e);
      this.deps.log("Qwen3: \u8BF4\u8BDD\u4EBA\u5206\u79BB\u5931\u8D25\uFF0C\u9000\u5316\u4E3A\u6574\u6BB5\u8BC6\u522B:", diarizeFailed);
    }
    const r = await this.deps.worker.request(
      "transcribe",
      {
        file: wavPath,
        language: o.language,
        // 只有分离成功且确实带说话人时才传 segments
        segments: spans.length && spans.some((s) => s.speaker !== void 0) ? spans.map((s) => ({ start: Math.round(s.start), end: Math.round(s.end), speaker: s.speaker })) : void 0
      },
      // 1.7B 在 16GB 卡上转 20 分钟音频约 3–8 分钟；给足余量
      30 * 60 * 1e3
    );
    const segs = Array.isArray(r.segments) ? r.segments.map((s) => ({
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
      text: String(s.text ?? ""),
      speaker: typeof s.speaker === "number" ? s.speaker : void 0
    })) : [];
    const text = String(r.text ?? "");
    const speakerApplied = o.spk && segs.some((s) => s.speaker !== void 0);
    return {
      text,
      segments: segs,
      durationMs: Number(r.durationMs ?? 0),
      model: "qwen3-asr",
      device: String(r.device ?? "auto"),
      speakerApplied
    };
  }
};

// src/layers/03-recognition/qwen-install.ts
import { execFile, execFileSync as execFileSync3 } from "node:child_process";
import { existsSync as existsSync4, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join6 } from "node:path";
function qwenVenvDir(outDir) {
  return join6(outDir, "qwen-venv");
}
function qwenVenvPythonPath(outDir) {
  const win = process.platform === "win32";
  return join6(qwenVenvDir(outDir), win ? "Scripts" : "bin", win ? "python.exe" : "python");
}
function run(bin, args, timeoutMs, env, proxyUrl) {
  return new Promise((resolve3) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: childEnv(env, proxyUrl),
        windowsHide: true
      },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
        const code = err ? err.code ?? 1 : 0;
        resolve3({ code: typeof code === "number" ? code : 1, out });
      }
    );
  });
}
var PROXY_KEYS2 = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
];
function childEnv(extra, proxyUrl) {
  const env = { ...process.env };
  for (const k of PROXY_KEYS2) delete env[k];
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
  }
  return { ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...extra ?? {} };
}
var QWEN_REQUIRED_MODULES = [
  "torch",
  "torchaudio",
  "torchvision",
  "transformers",
  "qwen_asr",
  "qwen_omni_utils",
  "soundfile",
  "librosa",
  "audioread"
];
function qwenImportCheck(outDir) {
  const py = qwenVenvPythonPath(outDir);
  if (!existsSync4(py)) return { ok: false, failed: [{ mod: "(venv)", error: "venv \u4E0D\u5B58\u5728" }] };
  const code = `import importlib,json
mods=${JSON.stringify(QWEN_REQUIRED_MODULES)}
bad=[]
for m in mods:
    try: importlib.import_module(m)
    except Exception as e: bad.append({"mod":m,"error":f"{type(e).__name__}: {e}"[:200]})
print(json.dumps(bad))
`;
  try {
    const out = execFileSync3(py, ["-c", code], { encoding: "utf8", timeout: 18e4 });
    const failed = JSON.parse(out.trim().split("\n").pop() || "[]");
    return { ok: failed.length === 0, failed };
  } catch (e) {
    return { ok: false, failed: [{ mod: "(\u63A2\u6D4B\u5931\u8D25)", error: e instanceof Error ? e.message : String(e) }] };
  }
}
function qwenEnvReady(outDir) {
  const py = qwenVenvPythonPath(outDir);
  if (!existsSync4(py)) return false;
  return qwenImportCheck(outDir).ok;
}
async function installQwen(opts) {
  const venvPython = qwenVenvPythonPath(opts.outDir);
  const modelPath = join6(opts.modelDir, opts.modelName);
  const steps = [];
  const note = (stage, message, ok = true) => {
    steps.push({ stage, message, ok });
    opts.onProgress?.(stage, message);
    opts.log(`[Qwen \u5B89\u88C5] ${message}`);
  };
  if (existsSync4(venvPython)) {
    note("venv", `venv \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7\u521B\u5EFA`);
  } else {
    mkdirSync2(opts.outDir, { recursive: true });
    note("venv", `\u521B\u5EFA\u865A\u62DF\u73AF\u5883 ${qwenVenvDir(opts.outDir)}`);
    const r2 = await run(opts.basePython, ["-m", "venv", qwenVenvDir(opts.outDir)], 3e5, void 0, opts.proxyUrl);
    if (r2.code !== 0 || !existsSync4(venvPython)) {
      const error = `\u521B\u5EFA venv \u5931\u8D25\uFF08exit ${r2.code}\uFF09\uFF1A${r2.out.slice(-600)}`;
      note("venv", error, false);
      return { ok: false, venvPython, modelPath, steps, error };
    }
    note("venv", "venv \u521B\u5EFA\u5B8C\u6210");
  }
  const pipBase = ["-m", "pip", "install", "--disable-pip-version-check"];
  const index = opts.pipIndex ? ["-i", opts.pipIndex] : [];
  if (qwenEnvReady(opts.outDir)) {
    note("pip", "qwen-asr \u5DF2\u53EF\u5BFC\u5165\uFF0C\u8DF3\u8FC7\u5B89\u88C5");
  } else {
    note("pip", "\u5B89\u88C5 qwen-asr\uFF08\u4F1A\u81EA\u52A8\u5E26\u4E0A torch / transformers / torchaudio\uFF09\u2026");
    await run(venvPython, [...pipBase, "-U", "pip"], 6e5, void 0, opts.proxyUrl);
    const r2 = await run(venvPython, [...pipBase, "-U", ...index, "qwen-asr"], 36e5, void 0, opts.proxyUrl);
    if (r2.code !== 0) {
      const error = `\u5B89\u88C5 qwen-asr \u5931\u8D25\uFF08exit ${r2.code}\uFF09\uFF1A${r2.out.slice(-800)}`;
      note("pip", error, false);
      return { ok: false, venvPython, modelPath, steps, error };
    }
    note("pip", "\u5B89\u88C5\u97F3\u9891\u89E3\u7801\u4F9D\u8D56 torchcodec / soundfile\u2026");
    const r22 = await run(venvPython, [...pipBase, "-U", ...index, "torchcodec", "soundfile", "audioread"], 18e5, void 0, opts.proxyUrl);
    if (r22.code !== 0) {
      note("pip", `torchcodec / soundfile \u5B89\u88C5\u5931\u8D25\uFF08\u82E5\u8BC6\u522B\u65F6\u62A5\u89E3\u7801\u9519\u8BEF\u518D\u624B\u52A8\u8865\u88C5\uFF09\uFF1A${r22.out.slice(-300)}`, false);
    }
    if (!qwenEnvReady(opts.outDir)) {
      const error = "qwen-asr \u5B89\u88C5\u540E\u4ECD\u65E0\u6CD5 import\uFF0C\u8BF7\u68C0\u67E5\u4E0A\u9762\u7684 pip \u8F93\u51FA";
      note("pip", error, false);
      return { ok: false, venvPython, modelPath, steps, error };
    }
    note("pip", "qwen-asr \u5B89\u88C5\u5B8C\u6210");
  }
  const cudaProbe = await run(
    venvPython,
    ["-c", "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"],
    12e4,
    void 0,
    opts.proxyUrl
  );
  if (cudaProbe.code === 0) {
    note("torch", "CUDA \u53EF\u7528\uFF0C\u8DF3\u8FC7 torch \u91CD\u88C5");
  } else {
    const torchProxy = opts.proxyUrl || "http://127.0.0.1:10808";
    note("torch", `\u5F53\u524D torch \u65E0 CUDA\uFF0C\u6539\u4ECE\u5B98\u65B9\u6E90\u88C5 cu128 \u7248\uFF08\u7ECF ${torchProxy}\uFF09\u2026`);
    const r2 = await run(
      venvPython,
      // 注意 pipBase 里已经含 'install'，这里不能再拼一个，否则 pip 会去找
      // 一个名叫 "install" 的包（实测报 No matching distribution found for install）
      [...pipBase, "--force-reinstall", "--index-url", "https://download.pytorch.org/whl/cu128", "torch", "torchaudio", "torchvision"],
      36e5,
      void 0,
      torchProxy
    );
    if (r2.code !== 0) {
      note("torch", `CUDA torch \u5B89\u88C5\u5931\u8D25\uFF0C\u5C06\u56DE\u9000 CPU \u63A8\u7406\uFF08\u8F83\u6162\uFF09\uFF1A${r2.out.slice(-400)}`, false);
    } else {
      const again = await run(
        venvPython,
        ["-c", "import torch,sys; print(torch.__version__); sys.exit(0 if torch.cuda.is_available() else 1)"],
        12e4,
        void 0,
        opts.proxyUrl
      );
      const ver = again.out.split(/\r?\n/).filter(Boolean).pop() ?? "";
      if (again.code === 0) note("torch", `CUDA \u5C31\u7EEA\uFF1A${ver}`);
      else note("torch", `\u88C5\u5B8C\u4ECD\u65E0 CUDA\uFF0C\u5C06\u7528 CPU \u63A8\u7406\uFF1A${ver}`, false);
    }
  }
  note("model", `\u4E0B\u8F7D ${opts.modelName} \u5230 ${modelPath}\uFF08\u4F18\u5148 modelscope \u56FD\u5185\u76F4\u8FDE\uFF0C\u7EA6 3.4GB\uFF09`);
  const r = await run(
    venvPython,
    [scriptPath("qwen_fetch_model.py"), "--repo", `Qwen/${opts.modelName}`, "--dest", modelPath],
    2 * 60 * 60 * 1e3,
    { HF_ENDPOINT: "https://hf-mirror.com" },
    opts.proxyUrl
  );
  let lastError = "";
  for (const line of r.out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t);
      if (typeof ev.message === "string") note(String(ev.stage ?? "model"), ev.message);
      if (ev.ok === false && typeof ev.error === "string") lastError = ev.error;
    } catch {
    }
  }
  const hasModel = existsSync4(join6(modelPath, "config.json"));
  if (r.code !== 0 || !hasModel) {
    const error = lastError || `\u6A21\u578B\u4E0B\u8F7D\u5931\u8D25\uFF08exit ${r.code}\uFF09\uFF1A${r.out.slice(-600)}`;
    note("model", error, false);
    return { ok: false, venvPython, modelPath, steps, error };
  }
  note("model", "\u6A21\u578B\u5C31\u7EEA");
  return { ok: true, venvPython, modelPath, steps };
}

// src/flow-log.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join7 } from "node:path";
function flowFile(outDir) {
  return join7(outDir, "flow-log.json");
}
function read(outDir) {
  try {
    const raw = JSON.parse(readFileSync3(flowFile(outDir), "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch {
  }
  return {};
}
function write(outDir, data) {
  try {
    writeFileSync2(flowFile(outDir), JSON.stringify(data, null, 2), "utf8");
  } catch {
  }
}
function markFlowed(outDir, rec) {
  if (!rec.sessionId || !rec.targetSessionId) return;
  const data = read(outDir);
  const list = data[rec.sessionId] ?? [];
  const dup = list.find(
    (x) => x.targetSessionId === rec.targetSessionId && x.templateId === rec.templateId && x.kind === rec.kind
  );
  if (dup) dup.at = rec.at;
  else list.push(rec);
  data[rec.sessionId] = list;
  write(outDir, data);
}
function flowsFor(outDir, sessionId) {
  return (read(outDir)[sessionId] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
}
function allFlows(outDir) {
  return read(outDir);
}

// src/notes-store.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync4, readdirSync as readdirSync3, statSync as statSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join8, resolve as resolve2 } from "node:path";
function isSafeId(id) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}
function slugify(title) {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || `note-${Date.now().toString(36)}`;
}
function notesRoot(outDir) {
  return join8(outDir, "notes");
}
function sessionDir(outDir, sessionId) {
  return join8(notesRoot(outDir), sessionId);
}
function saveNote(outDir, sessionId, title, markdown) {
  if (!isSafeId(sessionId)) {
    return { ok: false, error: `\u4F1A\u8BDD id \u4E0D\u5408\u6CD5\uFF1A${sessionId}` };
  }
  const slug = slugify(title);
  const dir = sessionDir(outDir, sessionId);
  try {
    mkdirSync3(dir, { recursive: true });
    const path = join8(dir, `${slug}.md`);
    if (!resolve2(path).startsWith(resolve2(notesRoot(outDir)))) {
      return { ok: false, error: "\u62D2\u7EDD\u5199\u5165 notes \u76EE\u5F55\u4E4B\u5916\u7684\u8DEF\u5F84" };
    }
    writeFileSync3(path, markdown, "utf8");
    const st = statSync2(path);
    return {
      ok: true,
      doc: { slug, title, path, bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() }
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function listNotes(outDir, sessionId) {
  if (!isSafeId(sessionId)) return [];
  const dir = sessionDir(outDir, sessionId);
  if (!existsSync6(dir)) return [];
  const out = [];
  try {
    for (const f of readdirSync3(dir)) {
      if (!f.toLowerCase().endsWith(".md")) continue;
      const path = join8(dir, f);
      try {
        const st = statSync2(path);
        out.push({
          slug: f.slice(0, -3),
          title: f.slice(0, -3),
          path,
          bytes: st.size,
          updatedAt: new Date(st.mtimeMs).toISOString()
        });
      } catch {
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function readNote(path, outDir) {
  if (!resolve2(path).startsWith(resolve2(notesRoot(outDir)))) return null;
  try {
    return readFileSync4(path, "utf8");
  } catch {
    return null;
  }
}
function listAllNotes(outDir) {
  const root = notesRoot(outDir);
  const out = {};
  if (!existsSync6(root)) return out;
  try {
    for (const d of readdirSync3(root)) {
      if (!isSafeId(d)) continue;
      const docs = listNotes(outDir, d);
      if (docs.length > 0) out[d] = docs;
    }
  } catch {
  }
  return out;
}

// src/post-process.ts
var BUILTIN_TEMPLATES = [
  {
    id: "meeting-notes",
    name: "\u7EAA\u8981\u6574\u7406",
    summary: "\u628A\u5F55\u97F3\u6574\u7406\u6210 Markdown \u7EAA\u8981\uFF1B\u4E0D\u540C\u4E3B\u9898\u5206\u522B\u4EA7\u51FA\u4E0D\u540C\u6587\u6863",
    builtin: true,
    body: `\u4F60\u6536\u5230\u7684\u662F\u4E00\u6BB5\u6765\u81EA\u5F55\u97F3\u5361\u7684\u5F55\u97F3\u8F6C\u5199\u6587\u672C\u3002\u8BF7\u628A\u5B83\u6574\u7406\u6210\u7ED3\u6784\u5316\u7684 Markdown \u7EAA\u8981\u3002

\u3010\u5173\u952E\u8981\u6C42\uFF1A\u6309\u4E3B\u9898\u62C6\u5206\u3011
\u8FD9\u6BB5\u5F55\u97F3\u91CC\u53EF\u80FD\u6DF7\u7740**\u591A\u4E2A\u4E92\u4E0D\u76F8\u5173\u7684\u4E3B\u9898**\u3002\u4F60\u5FC5\u987B\u5148\u5224\u65AD\u6709\u51E0\u4E2A\u4E3B\u9898\uFF0C\u7136\u540E**\u4E3A\u6BCF\u4E2A\u4E3B\u9898\u5355\u72EC\u4EA7\u51FA\u4E00\u4EFD Markdown \u6587\u6863**\uFF0C\u4E0D\u8981\u628A\u65E0\u5173\u5185\u5BB9\u6DF7\u5728\u4E00\u4EFD\u6587\u6863\u91CC\u3002

\u4F8B\u5982\u5F55\u97F3\u91CC\u4F9D\u6B21\u63D0\u5230\u300C\u63D2\u4EF6A\u7684\u5F00\u53D1\u8FDB\u5C55\u300D\u300C\u4ECA\u5929\u4E2D\u5348\u5403\u4EC0\u4E48\u300D\u300C\u4E00\u6B21\u4F1A\u8BAE\u5185\u5BB9\u300D\uFF0C\u90A3\u5C31\u5E94\u8BE5\u4EA7\u51FA 3 \u4EFD\u4E0D\u540C\u7684 md \u6587\u6863\uFF0C\u5404\u81EA\u72EC\u7ACB\u3001\u5404\u6709\u6807\u9898\u3002

\u3010\u5173\u4E8E\u8BC6\u522B\u8BEF\u5DEE\u3011
\u8FD9\u6BB5\u6587\u672C\u6765\u81EA\u84DD\u7259\u5F55\u97F3\u5361\uFF0816kbps Opus\u3001\u5355\u9EA6\u514B\u98CE\u3001\u94FE\u8DEF\u4FE1\u53F7\u5F31\uFF09\uFF0C**\u5B58\u5728\u8BC6\u522B\u8BEF\u5DEE\u662F\u5E38\u6001**\uFF1A\u540C\u97F3\u5B57\u3001\u4E13\u6709\u540D\u8BCD\u3001\u6570\u5B57\u3001\u4EBA\u540D\u90FD\u53EF\u80FD\u88AB\u8BC6\u522B\u9519\u3002

\u56E0\u6B64\u5728\u6574\u7406\u65F6\uFF1A
- \u5E94\u5F53\u7ED3\u5408\u4E0A\u4E0B\u6587**\u9002\u5F53\u8865\u5168**\u660E\u663E\u88AB\u622A\u65AD\u6216\u8BC6\u522B\u9519\u8BEF\u7684\u8BCD\u53E5\uFF0C\u8BA9\u6587\u610F\u901A\u987A\uFF1B
- \u4F46**\u6574\u4F53\u4E0D\u5F97\u6F02\u79FB**\uFF1A\u4E0D\u5F97\u6DFB\u52A0\u539F\u6587\u6CA1\u6709\u7684\u4E8B\u5B9E\u3001\u7ED3\u8BBA\u3001\u6570\u5B57\u6216\u4EBA\u540D\uFF1B
- \u8865\u5168\u7684\u628A\u63E1\u4E0D\u5927\u65F6\uFF0C\u4FDD\u7559\u539F\u6587\u5E76\u6807\u6CE8\u300C\uFF08\u6B64\u5904\u7591\u4F3C\u8BC6\u522B\u6709\u8BEF\uFF0C\u539F\u6587\uFF1A\u2026\uFF09\u300D\uFF0C\u4E0D\u8981\u66FF\u7528\u6237\u4E0B\u5224\u65AD\u3002

\u3010\u8F93\u51FA\u683C\u5F0F\u3011
\u6BCF\u4EFD\u6587\u6863\u7528\u4E00\u7EA7\u6807\u9898\uFF08# \u4E3B\u9898\u540D\uFF09\u5F00\u5934\uFF0C\u6B63\u6587\u6309\u5185\u5BB9\u7EC4\u7EC7\u5C0F\u6807\u9898\u4E0E\u8981\u70B9\u3002

\u3010\u5FC5\u987B\u628A\u6210\u679C\u5173\u8054\u56DE\u5F55\u97F3\u5361\u3011
\u6BCF\u4EFD\u7EAA\u8981\u6574\u7406\u597D\u540E\uFF0C**\u90FD\u8981\u8C03\u7528 recorder_attach_notes \u5DE5\u5177\u628A\u5B83\u5173\u8054\u5230\u6765\u6E90\u5F55\u97F3**\uFF08\u53C2\u6570\u540D\u4E0D\u8981\u52A0\u53CD\u5F15\u53F7\uFF0C\u76F4\u63A5\u4F20\u5B57\u7B26\u4E32\uFF09\uFF1A

- sessionId\uFF1A\u586B\u8FD9\u6BB5\u5185\u5BB9\u5BF9\u5E94\u7684\u300C\u5F55\u97F3\u4F1A\u8BDD id\u300D\uFF08\u6BCF\u6761\u5F55\u97F3\u7684\u8F6C\u5199\u6B63\u6587\u524D\u90FD\u6807\u4E86\uFF0C\u5F62\u5982 session-\u2026\uFF09
- title\uFF1A\u8FD9\u4EFD\u7EAA\u8981\u7684\u4E3B\u9898\u6807\u9898\uFF08\u548C\u6587\u6863\u4E00\u7EA7\u6807\u9898\u4E00\u81F4\uFF09
- markdown\uFF1A\u8FD9\u4EFD\u7EAA\u8981\u7684\u5B8C\u6574 Markdown \u6B63\u6587

**\u4E00\u4EFD\u4E3B\u9898\u8C03\u7528\u4E00\u6B21**\u3002\u4F8B\u5982\u62C6\u51FA 3 \u4E2A\u4E3B\u9898\uFF0C\u5C31\u8C03\u7528 3 \u6B21\u3001\u4F20 3 \u4E2A\u4E0D\u540C\u7684 title\u3002
\u53EA\u6709\u8C03\u7528\u8FC7\u5DE5\u5177\uFF0C\u8FD9\u4EFD\u7EAA\u8981\u624D\u4F1A\u51FA\u73B0\u5728\u5F55\u97F3\u5361\u9762\u677F\u7684\u300C\u7EAA\u8981\u67E5\u770B\u300D\u9875\uFF1B\u53EA\u5728\u5BF9\u8BDD\u91CC\u8F93\u51FA\u6B63\u6587\u7684\u8BDD\u7528\u6237\u770B\u4E0D\u5230\u3002

\u6700\u540E\u518D\u7528\u4E00\u4E24\u53E5\u8BDD\u544A\u8BC9\u7528\u6237\uFF1A\u62C6\u51FA\u4E86\u51E0\u4E2A\u4E3B\u9898\u3001\u5404\u81EA\u5173\u8054\u6210\u4E86\u54EA\u4EFD\u6587\u6863\u3002`
  },
  {
    id: "voice-command",
    name: "\u60F3\u6CD5\u8F93\u9001",
    summary: "\u628A\u5F55\u97F3\u5F53\u6210\u4E00\u6761\u7ED9\u4F60\u7684\u6307\u4EE4\u6765\u5904\u7406",
    builtin: true,
    body: `\u4F60\u6536\u5230\u7684\u662F\u4E00\u6BB5\u6765\u81EA\u5F55\u97F3\u5361\u7684\u8BED\u97F3\u8F6C\u5199\u6587\u672C\u3002**\u8FD9\u4E0D\u662F\u666E\u901A\u7684\u5F55\u97F3\u5185\u5BB9\uFF0C\u800C\u662F\u4E00\u6761\u53D1\u7ED9\u4F60\u7684\u6307\u4EE4**\u2014\u2014\u7528\u6237\u662F\u53E3\u8FF0\u7ED9\u4F60\u542C\u7684\uFF0C\u5E0C\u671B\u4F60\u53BB\u6267\u884C\u3002

\u3010\u5173\u4E8E\u8BC6\u522B\u8BEF\u5DEE\u3011
\u8FD9\u6BB5\u6587\u672C\u6765\u81EA\u84DD\u7259\u5F55\u97F3\u5361\uFF0816kbps Opus\u3001\u5355\u9EA6\u514B\u98CE\u3001\u94FE\u8DEF\u4FE1\u53F7\u5F31\uFF09\uFF0C**\u5B58\u5728\u8BC6\u522B\u8BEF\u5DEE\u662F\u5E38\u6001**\uFF1A\u540C\u97F3\u5B57\u3001\u4E13\u6709\u540D\u8BCD\u3001\u6570\u5B57\u3001\u8DEF\u5F84\u3001\u4EBA\u540D\u90FD\u53EF\u80FD\u88AB\u8BC6\u522B\u9519\u3002

\u56E0\u6B64\uFF1A
- \u53EF\u4EE5\u7ED3\u5408\u4E0A\u4E0B\u6587\u8865\u5168\u660E\u663E\u88AB\u8BC6\u522B\u9519\u7684\u8BCD\u53E5\uFF1B
- **\u4F46\u6D89\u53CA\u91CD\u8981\u4E8B\u9879\uFF08\u8981\u6267\u884C\u7684\u547D\u4EE4\u3001\u6587\u4EF6\u8DEF\u5F84\u3001\u53C2\u6570\u3001\u6570\u91CF\u3001\u4EBA\u540D\u3001\u65F6\u95F4\uFF09\u65F6\uFF0C\u5982\u679C\u4E0D\u6E05\u6670\u6216\u5B58\u5728\u591A\u79CD\u5408\u7406\u89E3\u8BFB\uFF0C\u5FC5\u987B\u5148\u5411\u7528\u6237\u8BE2\u95EE\u786E\u8BA4\uFF0C\u4E0D\u8981\u6309\u731C\u6D4B\u76F4\u63A5\u6267\u884C**\uFF1B
- \u4E0D\u786E\u5B9A\u7684\u5730\u65B9\u660E\u786E\u8BF4\u51FA\u6765\uFF0C\u4E0D\u8981\u9ED8\u9ED8\u66FF\u4F60\u7406\u89E3\u3002

\u3010\u5148\u590D\u8FF0\u518D\u6267\u884C\u3011
\u5728\u6267\u884C\u4EFB\u4F55\u64CD\u4F5C\u4E4B\u524D\uFF0C\u5148\u7528\u4E00\u4E24\u53E5\u8BDD\u590D\u8FF0\u4F60\u7406\u89E3\u7684\u6307\u4EE4\u662F\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u4F60\u6253\u7B97\u600E\u4E48\u505A\uFF0C\u8BA9\u7528\u6237\u6709\u673A\u4F1A\u7EA0\u6B63\u3002

\u3010\u8F93\u51FA\u3011
\u5982\u679C\u8FD9\u6761\u6307\u4EE4\u53EA\u662F\u8981\u4E00\u4E2A\u7ED3\u679C\u6216\u56DE\u7B54\uFF0C\u76F4\u63A5\u7ED9\u51FA\uFF1B\u5982\u679C\u5B83\u8981\u6C42\u4FEE\u6539\u6587\u4EF6\u3001\u6267\u884C\u547D\u4EE4\u7B49\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF0C\u5148\u8BF4\u660E\u8BA1\u5212\u5E76\u7B49\u5F85\u786E\u8BA4\u3002`
  }
];
function allTemplates(userTemplates) {
  const byId = /* @__PURE__ */ new Map();
  for (const t of BUILTIN_TEMPLATES) byId.set(t.id, t);
  for (const t of userTemplates) byId.set(t.id, { ...t, builtin: false });
  return [...byId.values()];
}
function normalizeTemplate(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw;
  const rawId = typeof o.id === "string" ? o.id.trim() : "";
  if (rawId && BUILTIN_TEMPLATES.some((t) => t.id === rawId)) return null;
  if (rawId && !/^[A-Za-z0-9_-]{1,64}$/.test(rawId)) return null;
  const name2 = typeof o.name === "string" && o.name.trim() ? o.name.trim() : null;
  const body = typeof o.body === "string" && o.body.trim() ? o.body : null;
  if (!name2 || !body) return null;
  if (name2.length > 64) return null;
  if (body.length > 2e4) return null;
  return {
    id: rawId,
    name: name2,
    summary: typeof o.summary === "string" ? o.summary.slice(0, 200) : "",
    builtin: false,
    body
  };
}
function templateIdFrom(name2) {
  const ascii = name2.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const base = ascii || "tpl";
  return `${base}-${Date.now().toString(36).slice(-5)}`;
}

// src/layers/03-recognition/install.ts
function readReadiness(payload) {
  const p = payload ?? {};
  const models = Array.isArray(p.models) ? p.models : [];
  return {
    python: typeof p.python === "string" ? p.python : null,
    pythonVersion: typeof p.pythonVersion === "string" ? p.pythonVersion : null,
    funasrInstalled: p.funasrInstalled === true,
    funasrVersion: typeof p.funasrVersion === "string" ? p.funasrVersion : null,
    torchVersion: typeof p.torchVersion === "string" ? p.torchVersion : null,
    cudaAvailable: p.cudaAvailable === true,
    cudaDeviceName: typeof p.cudaDeviceName === "string" ? p.cudaDeviceName : null,
    device: p.device === "cuda" ? "cuda" : "cpu",
    models: models.map((m) => ({
      key: String(m.key ?? ""),
      id: String(m.id ?? ""),
      label: String(m.label ?? m.key ?? ""),
      ready: m.ready === true,
      path: String(m.path ?? ""),
      // 目录在但内容是空的：下载被打断，与「完全没下」要区分开
      partial: m.partial === true
    })),
    deps: p.deps && typeof p.deps === "object" ? p.deps : {},
    missing: Array.isArray(p.missing) ? p.missing.map(String) : [],
    installHint: typeof p.installHint === "string" ? p.installHint : "",
    ready: p.ready === true
  };
}
async function probeFunasr(worker) {
  const r = await worker.request("probe", {}, 12e4);
  return readReadiness(r);
}
async function installFunasr(worker, opts, timeoutMs = 60 * 60 * 1e3) {
  const r = await worker.request("install", { device: opts.device, model: opts.model }, timeoutMs);
  return readReadiness(r);
}

// src/layers/04-output/session-store.ts
import { EventEmitter } from "node:events";
import {
  existsSync as existsSync7,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  readdirSync as readdirSync4,
  renameSync as renameSync2,
  rmSync as rmSync3,
  statSync as statSync3,
  writeFileSync as writeFileSync4
} from "node:fs";
import { join as join9 } from "node:path";
import { randomUUID } from "node:crypto";

// src/layers/04-output/markdown.ts
function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
function fmtLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
var SOURCE_LABEL = {
  realtime: "\u5B9E\u65F6\u8F6C\u5199",
  file: "\u79BB\u7EBF\u5F55\u97F3\u540C\u6B65",
  upload: "\u97F3\u9891\u4E0A\u4F20"
};
function renderTranscriptMarkdown(rec) {
  const speakers = new Set(rec.segments.map((s) => s.speaker).filter((x) => typeof x === "number"));
  const title = rec.title?.trim() || `\u5F55\u97F3\u8F6C\u5199 \xB7 ${fmtLocal(rec.createdAt)}`;
  const head = [
    "---",
    `title: ${yamlScalar(title)}`,
    `session_id: ${rec.id}`,
    `created_at: ${rec.createdAt}`,
    `source: ${rec.source}`,
    rec.titleSource ? `title_source: ${rec.titleSource}` : null,
    rec.device?.name ? `device: ${rec.device.name}` : null,
    rec.deviceFile ? `device_file: ${rec.deviceFile}` : null,
    `duration_ms: ${rec.durationMs}`,
    `duration: ${fmtDuration(rec.durationMs)}`,
    rec.model ? `model: ${rec.model}` : null,
    speakers.size > 0 ? `speakers: ${speakers.size}` : null,
    "---",
    ""
  ].filter((l) => l !== null);
  const meta = [
    `- \u65F6\u95F4\uFF1A${fmtLocal(rec.createdAt)}`,
    `- \u6765\u6E90\uFF1A${SOURCE_LABEL[rec.source]}`,
    rec.device?.name ? `- \u8BBE\u5907\uFF1A${rec.device.name}${rec.device.address ? `\uFF08${rec.device.address}\uFF09` : ""}` : null,
    `- \u65F6\u957F\uFF1A${fmtDuration(rec.durationMs)}`,
    rec.model ? `- \u8BC6\u522B\u6A21\u578B\uFF1A${rec.model}` : null,
    `- \u5206\u6BB5\u6570\uFF1A${rec.segments.length}`
  ].filter((l) => l !== null);
  const body = [];
  const segs = rec.segments;
  if (segs.length === 0) {
    body.push("_\uFF08\u65E0\u8F6C\u5199\u5185\u5BB9\uFF09_");
  } else if (speakers.size > 0) {
    let last;
    for (const s of segs) {
      const who = typeof s.speaker === "number" ? `\u8BF4\u8BDD\u4EBA ${s.speaker + 1}` : "\u8BF4\u8BDD\u4EBA \u2014";
      if (s.speaker !== last) {
        body.push("", `**${who}** \xB7 ${fmtClock(s.start)}`, "");
        last = s.speaker;
      }
      body.push(s.text);
    }
  } else {
    body.push("| \u65F6\u95F4 | \u5185\u5BB9 |", "| --- | --- |");
    for (const s of segs) {
      body.push(`| ${fmtClock(s.start)} | ${s.text.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
    }
  }
  const revision = [];
  if (rec.revision?.text) {
    revision.push("", "---", "", "## \u4FEE\u8BA2\u7A3F", "", rec.revision.text);
  }
  return [...head, `# ${title}`, "", ...meta, "", "## \u8F6C\u5199\u5185\u5BB9", ...body, ...revision, ""].join("\n");
}
function yamlScalar(v) {
  if (/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .-]*$/.test(v)) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function renderArchivedSummary(rec) {
  const title = rec.summary?.title?.trim() || rec.title?.trim() || `\u603B\u7ED3 \xB7 ${fmtLocal(rec.createdAt)}`;
  const head = [
    "---",
    `title: ${yamlScalar(title)}`,
    `session_id: ${rec.id}`,
    `recorded_at: ${rec.createdAt}`,
    `archived_at: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    `source: ${rec.source}`,
    rec.deviceFile ? `device_file: ${rec.deviceFile}` : null,
    `duration_ms: ${rec.durationMs}`,
    `duration: ${fmtDuration(rec.durationMs)}`,
    rec.model ? `model: ${rec.model}` : null,
    rec.speakerCount && rec.speakerCount > 0 ? `speakers: ${rec.speakerCount}` : null,
    `segments: ${rec.segments.length}`,
    "---",
    ""
  ].filter((l) => l !== null);
  return [
    ...head,
    `# ${title}`,
    "",
    `> \u539F\u5F55\u97F3\u4E0E\u8F6C\u5199\u6587\u6863\u5DF2\u5220\u9664\uFF0C\u672C\u6587\u4EF6\u662F\u4FDD\u7559\u4E0B\u6765\u7684 LLM \u603B\u7ED3\u3002`,
    `> \u5F55\u5236\u65F6\u95F4\uFF1A${fmtLocal(rec.createdAt)}\u3000\u65F6\u957F\uFF1A${fmtDuration(rec.durationMs)}`,
    "",
    rec.summary?.text ?? "",
    ""
  ].join("\n");
}

// src/layers/04-output/title.ts
var ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
var MAX_BASE_LEN = 64;
function sanitizeFileName(name2, fallback) {
  let s = (name2 ?? "").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[. ]+/, "").replace(/[. ]+$/, "");
  if (s.length > MAX_BASE_LEN) s = s.slice(0, MAX_BASE_LEN).replace(/[. ]+$/, "");
  if (!s) return fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}
function deriveTitle(transcript, maxChars = 12) {
  const flat = (transcript ?? "").replace(/\s+/g, " ").replace(/^[\s，。、！？；：,.!?;:）)】」』"']+/, "").trim();
  if (!flat) return "";
  const n = Number(maxChars);
  const limit = Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(64, Math.floor(n))) : 12;
  let cut = flat.slice(0, limit);
  const next = flat.charAt(limit);
  if (cut && /[A-Za-z0-9]$/.test(cut) && /[A-Za-z0-9]/.test(next)) {
    const m = /[A-Za-z0-9]+$/.exec(cut);
    if (m && cut.length - m[0].length > 0) cut = cut.slice(0, cut.length - m[0].length);
  }
  return cut.replace(/[\s，。、！？；：,.!?;:]+$/, "").trim();
}
function fallbackTitle(createdAt, kind = "\u672A\u8F6C\u5199") {
  const d = new Date(createdAt);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  if (Number.isNaN(d.getTime())) return kind;
  return `${kind} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function extOf(file) {
  const i = file.lastIndexOf(".");
  return i > 0 ? file.slice(i) : "";
}

// src/layers/04-output/session-store.ts
var ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
function isValidSessionId(id) {
  return ID_RE.test(id);
}
var SessionStore = class {
  root;
  summaryDir;
  indexFile;
  emitters = /* @__PURE__ */ new Map();
  constructor(outDir) {
    this.root = join9(outDir, "sessions");
    this.summaryDir = join9(outDir, "summaries");
    mkdirSync4(this.root, { recursive: true });
    this.indexFile = join9(outDir, "index.json");
  }
  /** session_id → 会话目录。 */
  dirOf(sessionId) {
    return join9(this.root, sessionId);
  }
  pathOf(sessionId, file) {
    return join9(this.dirOf(sessionId), file);
  }
  /**
   * 新建或复用会话。id 非法或未给则生成。
   *
   * `recordedAt` 是**录制时刻**——离线同步时从设备文件名（`note20260820-235231.opus`）
   * 解析出来，它才是 `createdAt` 的正确取值。不传才用当前时间：实时转写与上传
   * 本来就是「现在」录的。会话 id 也跟着录制时间生成，两者对得上。
   */
  open(opts) {
    const id = opts.id && ID_RE.test(opts.id) ? opts.id : newSessionId(opts.recordedAt);
    const existing = this.get(id);
    if (existing) return existing;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id,
      createdAt: opts.recordedAt ?? now,
      updatedAt: now,
      status: "open",
      source: opts.source,
      language: opts.language,
      device: opts.device,
      deviceFile: opts.deviceFile,
      durationMs: 0,
      segments: [],
      transcript: ""
    };
    mkdirSync4(this.dirOf(id), { recursive: true });
    this.persist(rec);
    this.emit(id, { type: "opened", sessionId: id });
    return rec;
  }
  get(sessionId) {
    const p = this.pathOf(sessionId, "session.json");
    if (!existsSync7(p)) return void 0;
    try {
      return JSON.parse(readFileSync5(p, "utf8"));
    } catch {
      return void 0;
    }
  }
  /** 追加一个定稿分段（流式逐字升级 / 离线结果都走这里）。 */
  appendSegment(sessionId, seg) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    const segment = { seq: rec.segments.length + 1, ...seg };
    rec.segments.push(segment);
    rec.transcript = rec.segments.map((s) => s.text).filter(Boolean).join("\n");
    rec.durationMs = Math.max(rec.durationMs, segment.end);
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist(rec);
    this.emit(sessionId, { type: "segment", sessionId, segment, transcript: rec.transcript });
    return rec;
  }
  /** 批量写入分段（离线识别一次性产出）。 */
  replaceSegments(sessionId, segs) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    rec.segments = segs.map((s, i) => ({ seq: i + 1, ...s }));
    rec.transcript = rec.segments.map((s) => s.text).filter(Boolean).join("\n");
    rec.durationMs = rec.segments.reduce((m, s) => Math.max(m, s.end), 0);
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist(rec);
    return rec;
  }
  /** 更新实时未定稿文本（逐字输出）。 */
  setPartial(sessionId, partial) {
    const rec = this.get(sessionId);
    if (!rec) return;
    rec.partial = partial;
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist(rec);
    this.emit(sessionId, { type: "partial", sessionId, partial });
  }
  /** 落一个产物（音频/Markdown），并登记进会话记录。 */
  putArtifact(sessionId, kind, file, bytes) {
    const dir = this.dirOf(sessionId);
    mkdirSync4(dir, { recursive: true });
    const target = join9(dir, file);
    const tmp = target + ".tmp";
    writeFileSync4(tmp, bytes);
    renameSync2(tmp, target);
    const ref = { file, bytes: bytes.length, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const rec = this.get(sessionId);
    if (rec) {
      const prev = kind === "audio" ? rec.audio : rec.markdown;
      if (kind === "audio") rec.audio = ref;
      else rec.markdown = ref;
      rec.updatedAt = ref.updatedAt;
      this.persist(rec);
      if (prev?.file && prev.file !== file) {
        try {
          rmSync3(join9(dir, prev.file), { force: true });
        } catch {
        }
      }
    }
    this.emit(sessionId, { type: "artifact", sessionId, kind, ref });
    return ref;
  }
  setMeta(sessionId, patch) {
    const rec = this.get(sessionId);
    if (!rec) return;
    Object.assign(rec, patch);
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist(rec);
  }
  setRevision(sessionId, text) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    rec.revision = { text, at: (/* @__PURE__ */ new Date()).toISOString() };
    rec.updatedAt = rec.revision.at;
    this.persist(rec);
    return rec;
  }
  // ─────────── 标题与文件名 ───────────
  /**
   * 设置标题，并把磁盘上的音频 / Markdown 一起改名成 `<标题>.<ext>`。
   *
   * 三件套的解析走记录里的文件名（见 L5 的 resolveArtifacts），所以改名后
   * 播放链接与文档入口都不会失效——`session_id` 始终是主键。
   */
  setTitle(sessionId, title, source) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    const clean = (title ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return rec;
    if (rec.title === clean && rec.titleSource === source) return rec;
    rec.title = clean;
    rec.titleSource = source;
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.renameArtifacts(rec, sanitizeFileName(clean, fallbackTitle(rec.createdAt)));
    this.persist(rec);
    this.emit(sessionId, { type: "titled", sessionId, title: clean, source });
    return rec;
  }
  /**
   * 按转写文本自动取名。只在该会话**还没有标题**时生效：
   * 实时转写过程中文本会不断增长，若每次都重新取头几个字，文件名会被反复改，
   * 所以自动标题一次定稿；之后 LLM 或用户仍可覆盖。
   */
  applyAutoTitle(sessionId, maxChars) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    if (rec.title) return rec;
    const derived = deriveTitle(rec.transcript, maxChars);
    return this.setTitle(sessionId, derived || fallbackTitle(rec.createdAt), "auto");
  }
  /**
   * 给历史会话补标题（老数据没有 title 字段）。
   * 只处理缺标题的，已命名的一律不动。返回处理条数。
   */
  backfillTitles(maxChars) {
    let n = 0;
    try {
      for (const id of readdirSync4(this.root)) {
        const rec = this.get(id);
        if (!rec || rec.title) continue;
        const derived = deriveTitle(rec.transcript, maxChars);
        this.setTitle(id, derived || fallbackTitle(rec.createdAt), "auto");
        n += 1;
      }
    } catch {
    }
    return n;
  }
  /**
   * 把会话目录里的产物改名到新的基名。扩展名保留，冲突时加 ` (2)` 之类的后缀。
   * 文件不在（被手工删过）时只改记录，不报错。
   */
  renameArtifacts(rec, base) {
    const dir = this.dirOf(rec.id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const slots = [rec.audio, rec.markdown];
    const taken = /* @__PURE__ */ new Set();
    for (const ref of slots) {
      if (!ref) continue;
      const ext = extOf(ref.file);
      const desired = `${base}${ext}`;
      if (desired === ref.file) {
        taken.add(desired);
        continue;
      }
      let target = desired;
      let n = 2;
      while (taken.has(target) || existsSync7(join9(dir, target)) && !existsSync7(join9(dir, ref.file))) {
        target = `${base} (${n})${ext}`;
        n += 1;
        if (n > 50) break;
      }
      const src = join9(dir, ref.file);
      if (existsSync7(src)) {
        try {
          renameSync2(src, join9(dir, target));
        } catch {
          taken.add(ref.file);
          continue;
        }
      }
      ref.file = target;
      ref.updatedAt = now;
      taken.add(target);
    }
  }
  /**
   * 标题自愈。
   *
   * 自动标题若停在「时间兜底名」而转写文本其实已经有了，说明取名发生在文本就位之前
   * （或者传进去的 `titleMaxChars` 是非法值，让 `deriveTitle` 返回了空串）。
   * 这里按文本重新取名并同步改名。
   *
   * 判定刻意收紧到「当前标题确实是兜底名」：`未转写 2026-09-15 012923` 这种
   * 绝不可能是内容派生的标题，所以重取不会误伤正常标题，也不会在实时转写
   * 文本增长过程中反复改名。用户手改的与 LLM 给的名字（titleSource 非 auto）一律不动。
   */
  refreshAutoTitle(sessionId, maxChars) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    if (rec.titleSource !== "auto") return rec;
    const cur = rec.title ?? "";
    if (cur !== fallbackTitle(rec.createdAt) && !/^(未转写|录音)\s+\d{4}-\d{2}-\d{2}/.test(cur)) return rec;
    const derived = deriveTitle(rec.transcript, maxChars);
    if (!derived || derived === cur) return rec;
    return this.setTitle(sessionId, derived, "auto");
  }
  /**
   * 修正录制时间。
   *
   * 早期版本把「同步时刻」当成了录制时刻，一卡旧录音全变成「刚刚」。
   * 这里只改 `createdAt`，**不动 id**——id 是主键，已被 sync-index、产物路径等引用，
   * 为了一次时间修正去重命名目录与全部引用不划算。
   */
  setRecordedAt(sessionId, iso) {
    const rec = this.get(sessionId);
    if (!rec || rec.createdAt === iso) return rec;
    rec.createdAt = iso;
    this.persist(rec);
    return rec;
  }
  close(sessionId) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    rec.status = "closed";
    rec.partial = void 0;
    rec.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist(rec);
    this.emit(sessionId, { type: "closed", sessionId, record: rec });
    return rec;
  }
  /**
   * 删除会话：整个目录移除（音频 + Markdown + 记录）。
   *
   * **LLM 总结必须活下来**：只要会话里有 `summary`，就先把总结抄进
   * `<outDir>/summaries/` 再删目录；**抄写失败就中止删除**并返回错误——
   * 宁可这次删不掉，也不能把 LLM 已经做出来的活儿删了。
   */
  remove(sessionId) {
    if (!ID_RE.test(sessionId)) {
      return { ok: false, freedBytes: 0, archivedSummary: null, error: "\u975E\u6CD5 session id" };
    }
    const rec = this.get(sessionId);
    const dir = this.dirOf(sessionId);
    let archived = null;
    if (rec?.summary?.text) {
      try {
        archived = this.archiveSummary(rec);
      } catch (e) {
        return {
          ok: false,
          freedBytes: 0,
          archivedSummary: null,
          error: `LLM \u603B\u7ED3\u5F52\u6863\u5931\u8D25\uFF0C\u5DF2\u4E2D\u6B62\u5220\u9664\u4EE5\u514D\u4E22\u5931\u603B\u7ED3\uFF1A${e instanceof Error ? e.message : String(e)}`
        };
      }
    }
    const freed = dirSize2(dir);
    try {
      rmSync3(dir, { recursive: true, force: true });
    } catch {
      return { ok: false, freedBytes: 0, archivedSummary: archived, error: "\u6587\u4EF6\u53EF\u80FD\u6B63\u88AB\u5360\u7528" };
    }
    this.emitters.delete(sessionId);
    try {
      this.writeIndex(this.list().filter((r) => r.id !== sessionId));
    } catch {
    }
    return { ok: !existsSync7(dir), freedBytes: freed, archivedSummary: archived };
  }
  /**
   * 把 LLM 总结抄到 `<outDir>/summaries/`，返回落地路径。
   * 文件名用「录音时间 + 标题」：总结目录按录音时间排序比按归档时间排序更好找。
   */
  archiveSummary(rec) {
    if (!rec.summary?.text) throw new Error("\u8BE5\u4F1A\u8BDD\u6CA1\u6709 LLM \u603B\u7ED3");
    mkdirSync4(this.summaryDir, { recursive: true });
    const stamp = fileStamp(rec.createdAt);
    const wanted = sanitizeFileName(rec.summary.title || rec.title || "", `\u603B\u7ED3 ${stamp}`);
    const md = renderArchivedSummary(rec);
    let file = `${stamp} ${wanted}.md`;
    let n = 2;
    while (existsSync7(join9(this.summaryDir, file))) {
      file = `${stamp} ${wanted} (${n}).md`;
      n += 1;
      if (n > 50) break;
    }
    const target = join9(this.summaryDir, file);
    const tmp = target + ".tmp";
    writeFileSync4(tmp, md, "utf8");
    renameSync2(tmp, target);
    return target;
  }
  /** 已归档的总结清单（给面板显示）。 */
  listSummaries() {
    const rows = [];
    try {
      for (const name2 of readdirSync4(this.summaryDir)) {
        if (!name2.endsWith(".md")) continue;
        try {
          const st = statSync3(join9(this.summaryDir, name2));
          rows.push({ file: name2, bytes: st.size, updatedAt: new Date(st.mtimeMs).toISOString() });
        } catch {
        }
      }
    } catch {
    }
    return rows.sort((a, b) => b.file.localeCompare(a.file));
  }
  /** 记一份 LLM 总结（汇总层回归后由它调用；现在也可手动写，便于联调）。 */
  setSummary(sessionId, text, title) {
    const rec = this.get(sessionId);
    if (!rec) return void 0;
    const clean = (text ?? "").trim();
    if (!clean) return rec;
    rec.summary = { text: clean, title: title?.trim() || void 0, at: (/* @__PURE__ */ new Date()).toISOString() };
    rec.updatedAt = rec.summary.at;
    this.persist(rec);
    if (title?.trim()) return this.setTitle(sessionId, title, "llm");
    return rec;
  }
  /** 会话目录占用体积（删除前给用户看「要删掉多少东西」）。 */
  sizeOf(sessionId) {
    return dirSize2(this.dirOf(sessionId));
  }
  list() {
    try {
      const raw = JSON.parse(readFileSync5(this.indexFile, "utf8"));
      if (Array.isArray(raw.sessions)) return raw.sessions;
    } catch {
    }
    return this.rebuildIndex();
  }
  /** 扫目录重建索引（索引损坏或缺席时的兜底）。 */
  rebuildIndex() {
    const rows = [];
    try {
      for (const name2 of readdirSync4(this.root)) {
        const rec = this.get(name2);
        if (!rec) continue;
        rows.push(toRow(rec));
      }
    } catch {
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.writeIndex(rows);
    return rows;
  }
  // ─────────── SSE 订阅 ───────────
  on(sessionId, handler) {
    let em = this.emitters.get(sessionId);
    if (!em) {
      em = new EventEmitter();
      this.emitters.set(sessionId, em);
    }
    em.on("event", handler);
    const refs = (em._refs ?? 0) + 1;
    em._refs = refs;
    return () => {
      em.off("event", handler);
      const left = (em._refs ?? 1) - 1;
      em._refs = left;
      if (left <= 0) this.emitters.delete(sessionId);
    };
  }
  emit(sessionId, ev) {
    this.emitters.get(sessionId)?.emit("event", ev);
  }
  persist(rec) {
    const dir = this.dirOf(rec.id);
    mkdirSync4(dir, { recursive: true });
    const target = join9(dir, "session.json");
    const tmp = target + ".tmp";
    writeFileSync4(tmp, JSON.stringify(rec, null, 2), "utf8");
    renameSync2(tmp, target);
    this.touchIndex(rec);
  }
  touchIndex(rec) {
    const rows = this.list().filter((r) => r.id !== rec.id);
    rows.push(toRow(rec));
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.writeIndex(rows);
  }
  writeIndex(rows) {
    try {
      const tmp = this.indexFile + ".tmp";
      writeFileSync4(tmp, JSON.stringify({ updatedAt: (/* @__PURE__ */ new Date()).toISOString(), sessions: rows }, null, 2), "utf8");
      renameSync2(tmp, this.indexFile);
    } catch {
    }
  }
};
function toRow(rec) {
  return {
    id: rec.id,
    title: rec.title ?? rec.id,
    titleSource: rec.titleSource ?? "none",
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    status: rec.status,
    source: rec.source,
    segments: rec.segments.length,
    durationMs: rec.durationMs,
    transcriptLength: rec.transcript.length,
    hasAudio: Boolean(rec.audio),
    hasMarkdown: Boolean(rec.markdown),
    hasSummary: Boolean(rec.summary?.text),
    bytes: (rec.audio?.bytes ?? 0) + (rec.markdown?.bytes ?? 0)
  };
}
function fileStamp(iso) {
  const d = new Date(iso);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  if (Number.isNaN(d.getTime())) return "00000000-000000";
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function newSessionId(at) {
  const d = at ? new Date(at) : /* @__PURE__ */ new Date();
  const t = Number.isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `rec-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${randomUUID().slice(0, 6)}`;
}
function dirSize2(path) {
  try {
    let total = 0;
    for (const f of readdirSync4(path)) {
      try {
        const st = statSync3(join9(path, f));
        if (st.isFile()) total += st.size;
      } catch {
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// src/layers/05-session-link/manifest.ts
import { existsSync as existsSync8, statSync as statSync4 } from "node:fs";
import { join as join10 } from "node:path";
var AUDIO_BASENAME = "audio";
var MARKDOWN_FILE = "transcript.md";
var RECORD_FILE = "session.json";
function layout(dir) {
  return {
    dir,
    audioOgg: join10(dir, `${AUDIO_BASENAME}.ogg`),
    audioWav: join10(dir, `${AUDIO_BASENAME}.wav`),
    markdown: join10(dir, MARKDOWN_FILE),
    record: join10(dir, RECORD_FILE)
  };
}
function slot(path) {
  if (!existsSync8(path)) return { present: false, ref: path };
  try {
    return { present: true, ref: path, bytes: statSync4(path).size };
  } catch {
    return { present: false, ref: path };
  }
}
function resolveSlot(dir, recorded, fallbacks) {
  if (recorded?.file) {
    const s = slot(join10(dir, recorded.file));
    if (s.present) return s;
  }
  for (const name2 of fallbacks) {
    const s = slot(join10(dir, name2));
    if (s.present) return s;
  }
  return { present: false, ref: join10(dir, recorded?.file ?? fallbacks[0]) };
}
function resolveArtifacts(store, sessionId, streamPathFor) {
  const rec = store.get(sessionId);
  if (!rec) return void 0;
  const dir = store.dirOf(sessionId);
  const L = layout(dir);
  const audio = resolveSlot(dir, rec.audio, [`${AUDIO_BASENAME}.ogg`, `${AUDIO_BASENAME}.wav`]);
  return {
    sessionId,
    dir,
    audio,
    markdown: resolveSlot(dir, rec.markdown, [MARKDOWN_FILE]),
    stream: { present: rec.status === "open", ref: streamPathFor(sessionId) },
    record: slot(L.record)
  };
}
function completenessOf(rec) {
  const marks = [];
  marks.push(rec.audio ? "\u97F3\u9891" : "\u2014");
  marks.push(rec.markdown ? "MD" : "\u2014");
  marks.push(rec.status === "open" ? "\u6D41\u4E2D" : "\u5DF2\u95ED");
  return marks.join(" / ");
}

// src/index.ts
var name = "dsh-ai-recorder";
var inject = ["webServer"];
var VERSION = "0.1.2-alpha.5";
var MAX_BODY = 64 * 1024 * 1024;
var STREAM_BYTES_PER_SEC = 2e3;
function apply(ctx, config) {
  const outDir = config.outDir || join11(homedir(), ".dsh", "recorder-backend");
  mkdirSync5(outDir, { recursive: true });
  const pluginLogFile = join11(outDir, "plugin.log");
  const log = (...args) => {
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${args.map(String).join(" ")}`;
    ctx.logger?.info?.("[dsh-ai-recorder]", ...args);
    try {
      appendFileSync(pluginLogFile, line + "\n", "utf8");
    } catch {
    }
  };
  const runtimeFile = join11(outDir, "runtime-config.json");
  const templatesFile = join11(outDir, "prompt-templates.json");
  let userTemplates = [];
  try {
    const raw = JSON.parse(readFileSync6(templatesFile, "utf8"));
    if (Array.isArray(raw)) userTemplates = raw.map(normalizeTemplate).filter((x) => x !== null);
  } catch {
  }
  function saveTemplates() {
    try {
      writeFileSync5(templatesFile, JSON.stringify(userTemplates, null, 2), "utf8");
    } catch (e) {
      log("\u4FDD\u5B58\u63D0\u793A\u8BCD\u6A21\u677F\u5931\u8D25:", e instanceof Error ? e.message : String(e));
    }
  }
  const defaults = {
    asrModel: config.asrModel,
    enabledPresets: config.enabledPresets,
    postProcess: config.postProcess,
    asrDevice: config.asrDevice,
    asrVad: config.asrVad,
    asrPunc: config.asrPunc,
    asrSpk: config.asrSpk,
    language: config.language,
    funasrPythonPath: config.funasrPythonPath,
    funasrModelDir: config.funasrModelDir || join11(outDir, "funasr"),
    qwenModelDir: config.qwenModelDir || join11(outDir, "qwen"),
    qwenModelName: config.qwenModelName,
    qwenPythonPath: config.qwenPythonPath,
    proxyUrl: config.proxyUrl,
    streamChunkMs: config.streamChunkMs,
    opusPreferred: config.opusPreferred,
    bleAutoSync: config.bleAutoSync,
    bleSyncDeleteAfter: config.bleSyncDeleteAfter,
    markdownEnabled: config.markdownEnabled,
    keepAudio: config.keepAudio,
    autoTitle: config.autoTitle,
    titleMaxChars: config.titleMaxChars
  };
  let runtime = defaults;
  try {
    runtime = { ...defaults, ...JSON.parse(readFileSync6(runtimeFile, "utf8")) };
  } catch {
  }
  const saveRuntime = () => {
    try {
      writeFileSync5(runtimeFile, JSON.stringify(runtime, null, 2), "utf8");
    } catch (e) {
      log("\u8FD0\u884C\u65F6\u914D\u7F6E\u5199\u5165\u5931\u8D25:", String(e));
    }
  };
  const pythonCandidates = (explicit) => {
    const list = explicit && explicit !== "python" ? [explicit] : [];
    list.push(process.env.DSH_RECORDER_PYTHON ?? "", "python", "python3", "py");
    return [...new Set(list.filter(Boolean))];
  };
  const resolvePython = (explicit) => pythonCandidates(explicit).find((p) => {
    try {
      execFileSync4(p, ["--version"], { stdio: "ignore", timeout: 8e3 });
      return true;
    } catch {
      return false;
    }
  }) ?? null;
  const blePython = resolvePython(config.pythonPath);
  const funasrPython = resolvePython(runtime.funasrPythonPath || config.pythonPath) ?? blePython;
  const sessions = new SessionStore(outDir);
  const knownDevices = new KnownDeviceStore(join11(outDir, "ble-devices.json"));
  const funasrWorker = new PyWorker({
    python: funasrPython ?? "python",
    script: scriptPath("funasr_worker.py"),
    args: ["--model-dir", runtime.funasrModelDir],
    proxyUrl: runtime.proxyUrl || void 0,
    readyTimeoutMs: 18e4,
    commandTimeoutMs: 30 * 60 * 1e3,
    log,
    onEvent: (ev) => {
      if (ev.event === "install-progress") {
        log("[\u5B89\u88C5]", String(ev.message ?? ""));
      }
    }
  });
  const engine = new FunasrEngine(funasrWorker, funasrOptions, log);
  const qwenPython = resolvePython(runtime.qwenPythonPath || config.pythonPath);
  const qwenDir = runtime.qwenModelDir || join11(outDir, "qwen");
  const qwenWorker = new PyWorker({
    python: qwenVenvPython() ?? "python",
    script: scriptPath("qwen_worker.py"),
    args: ["-m", join11(qwenDir, config.qwenModelName)],
    proxyUrl: runtime.proxyUrl || void 0,
    // 1.7B 首次加载 + 权重量化准备，给足时间
    readyTimeoutMs: 6e5,
    commandTimeoutMs: 30 * 60 * 1e3,
    log
  });
  const qwenEngine = new QwenEngine({
    diarizer: engine,
    worker: qwenWorker,
    getOptions: () => ({ language: runtime.language, spk: runtime.asrSpk }),
    log
  });
  function qwenVenvPython() {
    const p = qwenVenvPythonPath(outDir);
    return existsSync9(p) ? p : null;
  }
  let cachedQwenStatus = null;
  let qwenCheckPending = false;
  let qwenCheckCache = null;
  let qwenDeepCache = null;
  function qwenReadyCached(deep = false) {
    const venvOk = existsSync9(qwenVenvPythonPath(outDir));
    const modelOk = existsSync9(join11(qwenDir, config.qwenModelName, "config.json"));
    if (!venvOk || !modelOk) return false;
    if (!deep) return true;
    const now = Date.now();
    if (qwenDeepCache && now - qwenDeepCache.at < 6e4) return qwenDeepCache.ok;
    const ok = qwenEnvReady(outDir);
    qwenDeepCache = { at: now, ok };
    return ok;
  }
  const recognizeEngine = {
    async recognizeFile(wavPath) {
      if (runtime.asrModel === "qwen3-asr") {
        if (!qwenVenvPython()) {
          throw new Error("Qwen3-ASR \u73AF\u5883\u672A\u5C31\u7EEA\uFF1A\u5148\u5728\u9762\u677F\u6267\u884C\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D\u521B\u5EFA qwen venv \u5E76\u4E0B\u8F7D\u6A21\u578B");
        }
        return qwenEngine.recognizeFile(wavPath);
      }
      return engine.recognizeFile(wavPath);
    }
  };
  function funasrOptions() {
    return {
      // qwen3-asr 模式下 FunASR 只被当作「说话人分离前端」，它的 ASR 文本会被丢弃，
      // 所以这里退回到已下载的 paraformer-zh，避免为了分离再去拉一套模型
      model: runtime.asrModel === "sensevoice" ? "sensevoice" : "paraformer-zh",
      device: runtime.asrDevice,
      language: runtime.language,
      vad: runtime.asrVad,
      punc: runtime.asrPunc,
      spk: runtime.asrSpk,
      modelDir: runtime.funasrModelDir,
      streamChunkMs: runtime.streamChunkMs,
      encoderLookBack: config.streamEncoderLookBack,
      decoderLookBack: config.streamDecoderLookBack
    };
  }
  const ble = new BleCentral(log, (ev) => onBleEvent(ev));
  const disposeSelfCleanup = installSelfCleanup(ctx, outDir, async () => {
    ble.dispose();
    await funasrWorker.dispose();
  });
  function sendJson(res, code, obj) {
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type, x-recorder-token"
    });
    res.end(JSON.stringify(obj));
  }
  function serveFile(res, req, file, contentType) {
    let st;
    try {
      st = statSync5(file);
    } catch {
      return sendJson(res, 404, { ok: false, error: "\u6587\u4EF6\u4E0D\u5B58\u5728: " + file });
    }
    const total = st.size;
    const base = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range, accept-ranges, content-length"
    };
    const raw = req.headers.range;
    const range = typeof raw === "string" ? /^bytes=(\d*)-(\d*)$/.exec(raw.trim()) : null;
    if (!range) {
      res.writeHead(200, { ...base, "content-length": String(total) });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
      return;
    }
    const hasStart = range[1] !== "";
    const hasEnd = range[2] !== "";
    let start;
    let end;
    if (hasStart) {
      start = Number(range[1]);
      end = hasEnd ? Math.min(Number(range[2]), total - 1) : total - 1;
    } else if (hasEnd) {
      start = Math.max(0, total - Number(range[2]));
      end = total - 1;
    } else {
      start = 0;
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      res.writeHead(416, { ...base, "content-range": `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...base,
      "content-range": `bytes ${start}-${end}/${total}`,
      "content-length": String(end - start + 1)
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
  }
  function contentTypeOf(kind, file) {
    if (kind === "markdown") return "text/markdown; charset=utf-8";
    const lower = file.toLowerCase();
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".opus")) return "audio/opus";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    return "audio/ogg";
  }
  function readBody(req) {
    return new Promise((resolve3, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.destroy();
          reject(new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve3(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  const authOk = (req) => !config.token || req.headers["x-recorder-token"] === config.token;
  const b64ToBytes = (b64) => new Uint8Array(Buffer.from(String(b64 ?? "").trim(), "base64"));
  const streamPathFor = (id) => `/api/recorder/session/${id}/events`;
  async function recognize(input) {
    const tmp = await makeTmpDir("pipe");
    let openedSid = null;
    try {
      let archive = containAudio(input.bytes, input.hint, true);
      if (archive.origin === "raw-opus") {
        const expected = expectedMsForRawOpus(input.bytes.length);
        if (expected > 500) {
          try {
            const probe = await probeOpusPackets(funasrWorker, input.bytes, expected, tmp, {
              maxSkip: config.captureSkipScanMax
            });
            if (probe.skipBytes > 0) {
              log(`\u4E0B\u8F7D\u4EF6\u524D\u5BFC\u6C61\u67D3 ${probe.skipBytes}B\uFF0C\u5DF2\u88C1\u6389\uFF08\u89E3\u51FA ${Math.round(probe.decodedMs)}ms / \u5E94\u6709 ${expected}ms\uFF09`);
              archive = applySkip(archive, input.bytes, probe.skipBytes);
            } else if (!probe.ok) {
              log(`\u4E0B\u8F7D\u4EF6\u81EA\u68C0\u5F02\u5E38\uFF1A\u89E3\u51FA ${Math.round(probe.decodedMs)}ms / \u5E94\u6709 ${expected}ms\uFF08ratio ${probe.ratio.toFixed(2)}\uFF09`);
            }
          } catch (e) {
            log("\u4E0B\u8F7D\u4EF6\u81EA\u68C0\u5931\u8D25\uFF08\u7EE7\u7EED\u6309\u539F\u6837\u5904\u7406\uFF09:", String(e));
          }
        }
      }
      const rec = sessions.open({
        id: input.reuse ? input.sessionId : input.sessionId,
        source: input.source,
        language: input.language ?? runtime.language,
        device: input.device,
        deviceFile: input.deviceFile,
        recordedAt: input.recordedAt
      });
      const sid = rec.id;
      openedSid = sid;
      let audioPath = null;
      if (runtime.keepAudio) {
        const ref = sessions.putArtifact(sid, "audio", `audio.${archive.ext}`, archive.bytes);
        audioPath = sessions.pathOf(sid, ref.file);
      }
      const unified = await decodeToUnified(
        funasrWorker,
        archive,
        { sampleRate: config.targetSampleRate, channels: config.targetChannels, bits: config.targetBits },
        tmp,
        "archive"
      );
      const result = await recognizeEngine.recognizeFile(unified.path);
      sessions.replaceSegments(
        sid,
        result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          speaker: s.speaker,
          final: true
        }))
      );
      sessions.setMeta(sid, {
        model: result.model,
        durationMs: result.durationMs || unified.durationMs || archive.durationMs || 0,
        speakerCount: countSpeakers(result.segments)
      });
      const titled = runtime.autoTitle ? sessions.applyAutoTitle(sid, runtime.titleMaxChars) : sessions.get(sid);
      if (titled?.title) log(`\u6807\u9898\u300C${titled.title}\u300D\uFF08\u6765\u6E90 ${titled.titleSource}\uFF09`);
      let markdownPath = null;
      if (runtime.markdownEnabled) {
        const record = sessions.get(sid);
        if (record) {
          const md = renderTranscriptMarkdown(record);
          const ref = sessions.putArtifact(sid, "markdown", markdownFileName(record), new TextEncoder().encode(md));
          markdownPath = sessions.pathOf(sid, ref.file);
        }
      }
      sessions.close(sid);
      log(
        `\u8BC6\u522B\u5B8C\u6210 session=${sid} \u6765\u6E90=${input.source} \u65F6\u957F=${fmtDuration(result.durationMs)} \u5206\u6BB5=${result.segments.length} \u8BF4\u8BDD\u4EBA=${result.speakerApplied ? "cam++" : "\u672A\u542F\u7528"}`
      );
      return {
        sessionId: sid,
        text: result.text,
        segments: result.segments,
        durationMs: result.durationMs,
        markdownPath,
        audioPath,
        model: result.model,
        device: result.device,
        speakerApplied: result.speakerApplied
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (openedSid) {
        sessions.setMeta(openedSid, { error: msg });
        if (runtime.autoTitle) sessions.applyAutoTitle(openedSid, runtime.titleMaxChars);
        sessions.close(openedSid);
      }
      throw e;
    } finally {
      await disposeTmp(tmp);
    }
  }
  function countSpeakers(segs) {
    const set = new Set(segs.map((s) => s.speaker).filter((x) => typeof x === "number"));
    return set.size;
  }
  function markdownFileName(rec) {
    const fallback = MARKDOWN_FILE.replace(/\.md$/, "");
    return `${sanitizeFileName(rec?.title ?? "", fallback)}.md`;
  }
  function refreshMarkdown(sessionId) {
    if (!runtime.markdownEnabled) return;
    const rec = sessions.get(sessionId);
    if (!rec?.markdown) return;
    try {
      const md = renderTranscriptMarkdown(rec);
      sessions.putArtifact(sessionId, "markdown", markdownFileName(rec), new TextEncoder().encode(md));
    } catch (e) {
      log("\u91CD\u5199 Markdown \u5931\u8D25:", String(e));
    }
  }
  let live = null;
  const streamFlushBytes = () => Math.max(320, Math.round(runtime.streamChunkMs / 1e3 * STREAM_BYTES_PER_SEC));
  async function flushLive() {
    const st = live;
    if (!st || st.closed || st.feeding || st.buffered < streamFlushBytes()) return;
    st.feeding = true;
    const chunk = Buffer.concat(st.chunks.map((c) => Buffer.from(c)));
    st.chunks = [];
    st.buffered = 0;
    try {
      const r = await engine.feedStream(st.sessionId, new Uint8Array(chunk));
      st.archiveChunks.push(new Uint8Array(chunk));
      st.total += chunk.length;
      if (r.partial) sessions.setPartial(st.sessionId, r.partial);
      for (const seg of r.segments) {
        sessions.appendSegment(st.sessionId, {
          start: seg.start,
          end: seg.end,
          text: seg.text,
          speaker: seg.speaker,
          final: true
        });
      }
    } catch (e) {
      log("\u6D41\u5F0F\u8BC6\u522B\u5206\u6BB5\u5931\u8D25:", String(e));
    } finally {
      st.feeding = false;
    }
  }
  async function finalizeLive(reason) {
    const st = live;
    if (!st || st.closed) return;
    st.closed = true;
    live = null;
    try {
      if (st.buffered > 0) {
        st.feeding = false;
        const chunk = Buffer.concat(st.chunks.map((c) => new Uint8Array(c)));
        st.chunks = [];
        st.buffered = 0;
        try {
          await engine.feedStream(st.sessionId, new Uint8Array(chunk));
          st.archiveChunks.push(new Uint8Array(chunk));
          st.total += chunk.length;
        } catch (e) {
          log("\u6D41\u5F0F\u6536\u5C3E\u5582\u5305\u5931\u8D25:", String(e));
        }
      }
      const result = await engine.closeStream(st.sessionId).catch((e) => {
        log("\u6D41\u5F0F\u7EC8\u7A3F\u5931\u8D25:", String(e));
        return null;
      });
      if (result && result.segments.length > 0) {
        sessions.replaceSegments(
          st.sessionId,
          result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker, final: true }))
        );
      }
      sessions.setMeta(st.sessionId, {
        model: result?.model ?? runtime.asrModel,
        durationMs: result?.durationMs ?? Math.round(st.total / STREAM_BYTES_PER_SEC) * 1e3,
        speakerCount: result ? countSpeakers(result.segments) : 0
      });
      if (runtime.keepAudio && st.archiveChunks.length > 0) {
        try {
          const raw = Buffer.concat(st.archiveChunks.map((c) => Buffer.from(c)));
          const archive = containAudio(new Uint8Array(raw), "opus", false);
          sessions.putArtifact(st.sessionId, "audio", `audio.${archive.ext}`, archive.bytes);
        } catch (e) {
          log("\u5B9E\u65F6\u6D41\u97F3\u9891\u5F52\u6863\u5931\u8D25:", String(e));
        }
      }
      const titled = runtime.autoTitle ? sessions.applyAutoTitle(st.sessionId, runtime.titleMaxChars) : sessions.get(st.sessionId);
      if (titled?.title) log(`\u6807\u9898\u300C${titled.title}\u300D\uFF08\u6765\u6E90 ${titled.titleSource}\uFF09`);
      if (runtime.markdownEnabled) {
        const record = sessions.get(st.sessionId);
        if (record) {
          const md = renderTranscriptMarkdown(record);
          sessions.putArtifact(st.sessionId, "markdown", markdownFileName(record), new TextEncoder().encode(md));
        }
      }
      sessions.close(st.sessionId);
      log(`\u5B9E\u65F6\u6D41\u8F6C\u5199\u7ED3\u675F session=${st.sessionId}\uFF08${reason}\uFF09`);
    } catch (e) {
      log("\u5B9E\u65F6\u6D41\u6536\u5C3E\u5F02\u5E38:", String(e));
      sessions.setMeta(st.sessionId, { error: String(e) });
      sessions.close(st.sessionId);
    }
  }
  function onBleEvent(ev) {
    if (ev.event === "stream") {
      if (ev.kind === "audio" && typeof ev.data === "string" && live && !live.closed) {
        const bytes = b64ToBytes(ev.data);
        live.chunks.push(bytes);
        live.buffered += bytes.length;
        void flushLive();
      } else if (ev.kind === "stopped") {
        void finalizeLive("\u8BBE\u5907\u505C\u6B62");
      }
      return;
    }
    if (ev.event === "disconnected") {
      log("BLE \u8FDE\u63A5\u65AD\u5F00\uFF0C\u8FDB\u5165\u81EA\u52A8\u91CD\u8FDE");
      void finalizeLive("\u8FDE\u63A5\u65AD\u5F00");
      return;
    }
    if (ev.event === "connected") {
      log("BLE \u5DF2\u8FDE\u63A5:", String(ev.address ?? ""), `MTU=${String(ev.mtu ?? "?")}`);
      if (ev.phase === "link") return;
      if (runtime.bleAutoSync) {
        const at = (/* @__PURE__ */ new Date()).toISOString();
        lastAutoSync = { at, ok: false, error: "\u5DF2\u89E6\u53D1\uFF0C\u5C1A\u672A\u8FD4\u56DE" };
        void runSync().then((r) => {
          lastAutoSync = {
            at,
            ok: true,
            error: "\u4E0B\u8F7D " + String(r.downloaded) + " / \u8DF3\u8FC7 " + String(r.skipped) + " / \u5931\u8D25 " + String(r.failed)
          };
        }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          lastAutoSync = { at, ok: false, error: msg };
          log("\u8FDE\u63A5\u540E\u81EA\u52A8\u540C\u6B65\u5931\u8D25:", msg);
        });
      }
      return;
    }
    if (ev.event === "reconnecting") {
      log("BLE \u81EA\u52A8\u91CD\u8FDE\u4E2D\uFF08\u7B2C " + String(ev.attempt ?? "?") + " \u6B21\uFF09");
    }
  }
  const syncIndexFile = join11(outDir, "sync-index.json");
  const readSyncIndex = () => {
    try {
      return JSON.parse(readFileSync6(syncIndexFile, "utf8"));
    } catch {
      return {};
    }
  };
  const writeSyncIndex = (idx) => {
    try {
      writeFileSync5(syncIndexFile, JSON.stringify(idx, null, 2), "utf8");
    } catch {
    }
  };
  const syncState = { running: false, lastSyncAt: null, lastResult: null, lastError: null };
  let blePrepared = null;
  async function ensureBle() {
    if (!blePrepared) blePrepared = ble.prepare(pythonCandidates(config.pythonPath));
    if (!blePrepared.ok) return blePrepared;
    try {
      await ble.ensureStarted();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const downloadPrefer = () => runtime.opusPreferred ? "opus" : "wav";
  let scanState = {
    running: false,
    startedAt: null,
    roundMs: 3e3,
    autoConnect: true,
    devices: [],
    autoConnected: null,
    message: null,
    lastError: null
  };
  let scanToken = 0;
  function decorateScanned(devs) {
    return devs.map((d) => {
      const hit = matchKnown(knownDevices, d);
      return { ...d, known: Boolean(hit), lastConnectedAt: hit?.lastConnectedAt };
    });
  }
  async function connectAndRemember(address, retries, dev) {
    const r = await ble.connect(address, retries);
    try {
      knownDevices.remember({ address: ble.address ?? address, name: dev?.name, rssi: dev?.rssi });
    } catch {
    }
    return r;
  }
  const warmTimer = setTimeout(() => {
    void (async () => {
      try {
        cachedReadiness = await readiness(true);
        log("\u9884\u70ED\u5B8C\u6210\uFF1A\u8BC6\u522B\u73AF\u5883\u72B6\u6001\u5DF2\u5C31\u7EEA");
      } catch (e) {
        log("\u9884\u70ED\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF0C\u6253\u5F00\u9762\u677F\u65F6\u4F1A\u91CD\u8BD5\uFF09:", e instanceof Error ? e.message : String(e));
      }
      try {
        if (qwenCheckCache === null && !qwenCheckPending) {
          qwenCheckPending = true;
          qwenCheckCache = { at: Date.now(), value: qwenImportCheck(outDir) };
        }
      } catch {
      } finally {
        qwenCheckPending = false;
      }
    })();
  }, 2e3);
  ctx.effect(() => () => clearTimeout(warmTimer));
  const bleRecoverTimer = setInterval(() => {
    try {
      if (disposed) return;
      if (!runtime.bleAutoSync) return;
      if (ble.connected || scanState.running || syncState.running) return;
      if (knownDevices.list().length === 0) return;
      log("\u81EA\u6108\uFF1A\u5F53\u524D\u672A\u8FDE\u63A5\u4E14\u5B58\u5728\u8FDE\u8FC7\u7684\u8BBE\u5907\uFF0C\u53D1\u8D77\u626B\u63CF + \u81EA\u52A8\u8FDE\u63A5");
      void scanLoop({ roundMs: 3e3, autoConnect: true, timeoutMs: 18e4 });
    } catch (e) {
      log("\u81EA\u6108\u5FAA\u73AF\u5F02\u5E38:", e instanceof Error ? e.message : String(e));
    }
  }, 1e4);
  ctx.effect(() => () => clearInterval(bleRecoverTimer));
  async function scanLoop(opts) {
    const my = ++scanToken;
    const started = Date.now();
    const seen = /* @__PURE__ */ new Map();
    scanState = {
      running: true,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      roundMs: opts.roundMs,
      autoConnect: opts.autoConnect,
      devices: [],
      autoConnected: null,
      message: null,
      lastError: null
    };
    try {
      while (scanToken === my && !disposed) {
        if (ble.connected) {
          scanState.message = "\u5DF2\u8FDE\u63A5\uFF0C\u505C\u6B62\u626B\u63CF";
          break;
        }
        if (opts.timeoutMs > 0 && Date.now() - started > opts.timeoutMs) {
          scanState.message = "\u626B\u63CF\u7ED3\u675F\uFF08\u672A\u53D1\u73B0\u8FDE\u63A5\u8FC7\u7684\u8BBE\u5907\uFF09";
          break;
        }
        let round = [];
        try {
          round = await ble.scan(Math.max(1, Math.round(opts.roundMs / 1e3)));
          scanState.lastError = null;
        } catch (e) {
          scanState.lastError = e instanceof Error ? e.message : String(e);
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        for (const d of decorateScanned(round)) seen.set(d.address, d);
        scanState.devices = [...seen.values()].sort((a, b) => b.rssi - a.rssi);
        if (!opts.autoConnect) continue;
        const target = scanState.devices.filter((d) => d.known).sort(
          (a, b) => (knownDevices.find(b.address)?.connectCount ?? 0) - (knownDevices.find(a.address)?.connectCount ?? 0)
        )[0];
        if (!target) continue;
        const label = target.name || target.address;
        scanState.message = `\u53D1\u73B0\u8FDE\u63A5\u8FC7\u7684\u8BBE\u5907 ${label}\uFF0C\u6B63\u5728\u81EA\u52A8\u8FDE\u63A5\u2026`;
        try {
          await connectAndRemember(target.address, 3, target);
          scanState.autoConnected = target.address;
          scanState.message = `\u5DF2\u81EA\u52A8\u8FDE\u63A5 ${label}`;
          log(`\u626B\u63CF\u65F6\u81EA\u52A8\u8FDE\u63A5\u4E86\u8FDE\u8FC7\u7684\u8BBE\u5907 ${label}`);
          break;
        } catch (e) {
          scanState.lastError = `\u81EA\u52A8\u8FDE\u63A5 ${label} \u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`;
        }
      }
    } finally {
      if (scanToken === my) scanState.running = false;
    }
  }
  function stopScan(message) {
    scanToken += 1;
    if (scanState.running) scanState.running = false;
    if (message) scanState.message = message;
  }
  function isSafelyOnDisk(sessionId) {
    const rec = sessions.get(sessionId);
    if (!rec) return { ok: false, bytes: 0, reason: "\u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728" };
    if (!rec.audio) {
      return {
        ok: false,
        bytes: 0,
        reason: runtime.keepAudio ? "\u97F3\u9891\u672A\u5F52\u6863" : "\u914D\u7F6E\u672A\u4FDD\u7559\u97F3\u9891\uFF08keepAudio=false\uFF09"
      };
    }
    try {
      const st = statSync5(sessions.pathOf(sessionId, rec.audio.file));
      if (!st.isFile() || st.size === 0) return { ok: false, bytes: 0, reason: "\u672C\u5730\u97F3\u9891\u4E3A\u7A7A" };
      return { ok: true, bytes: st.size };
    } catch {
      return { ok: false, bytes: 0, reason: "\u672C\u5730\u97F3\u9891\u6587\u4EF6\u4E0D\u5B58\u5728" };
    }
  }
  async function deleteFromDeviceAfterTransfer(entry, sessionId) {
    const guard = isSafelyOnDisk(sessionId);
    if (!guard.ok) {
      log(`\u672A\u5220\u9664\u8BBE\u5907\u4E0A\u7684 ${entry.name}\uFF1A${guard.reason}\uFF08\u672C\u5730\u6CA1\u6709\u53EF\u9760\u526F\u672C\uFF0C\u5148\u7559\u5728\u5361\u4E0A\uFF09`);
      return "kept";
    }
    try {
      const r = await ble.deleteFile(entry.name, entry.time, entry.size, entry.raw);
      const fmt = typeof r.format === "string" ? `\uFF0Cpayload=${r.format}` : "";
      log(`\u5DF2\u4ECE\u5F55\u97F3\u5361\u5220\u9664 ${entry.name}\uFF08\u672C\u5730\u5DF2\u5B58 ${guard.bytes} \u5B57\u8282\uFF0Csession=${sessionId}${fmt}\uFF09`);
      return "deleted";
    } catch (err) {
      log(`\u5220\u9664\u8BBE\u5907\u4E0A\u7684 ${entry.name} \u5931\u8D25\uFF1A${String(err)}\uFF08\u672C\u5730\u526F\u672C\u4ECD\u5728\uFF0C\u5361\u4E0A\u4E5F\u8FD8\u5728\uFF09`);
      return "failed";
    }
  }
  function isTransientFailure(msg) {
    const m = (msg ?? "").toLowerCase();
    if (/未连接|连接失败|已断开|断开连接|扫描未发现|超时|timeout|timed out|busy|winerror|bluetooth|重置/.test(m)) {
      return true;
    }
    if (/wav 头非法|长度不符|收到 0 字节|校验失败|完整性|不支持|unsupported|invalid|解码失败|code=1/.test(m)) {
      return false;
    }
    return true;
  }
  const SYNC_MAX_ATTEMPTS = 3;
  const pendingQueue = [];
  let openSessionId = null;
  let lastUiSurface = null;
  let lastAutoSync = null;
  let lastPostProcess = null;
  const dshTitleCache = /* @__PURE__ */ new Map();
  async function dshSessionTitle(sessionId) {
    const hit = dshTitleCache.get(sessionId);
    if (hit !== void 0 && Date.now() - hit.at < 1e4) return hit.title;
    let title = null;
    try {
      const sc = ctx.get("sessionController");
      if (sc !== void 0) {
        const v = await sc.list({}, new AbortController().signal);
        const row = (v.items ?? []).find(
          (x) => x.sessionId === sessionId
        );
        const t = row?.projections?.values?.title;
        if (typeof t === "string" && t.trim()) title = t;
      }
    } catch {
    }
    dshTitleCache.set(sessionId, { title, at: Date.now() });
    return title;
  }
  function titleForEntry(sessionId, fallback) {
    return sessions.get(sessionId)?.title ?? fallback;
  }
  async function buildPostMessage(items) {
    const tpl = allTemplates(userTemplates).find((x) => x.id === runtime.postProcess.templateId);
    if (tpl === void 0) return null;
    const titleList = items.map((it) => ({
      name: it.name,
      title: titleForEntry(it.sessionId, it.name),
      // 必须带上：确认发送后要按 sessionId 记流转标记
      sessionId: it.sessionId
    }));
    const body = items.map(
      (it, i) => `## \u5F55\u97F3 ${i + 1}\uFF1A${titleList[i].title}

\u5F55\u97F3\u4F1A\u8BDD id\uFF1A${it.sessionId}

${it.text.trim()}`
    ).join("\n\n---\n\n");
    const text = `${tpl.body}

---

\u4EE5\u4E0B\u662F\u672C\u8F6E\u4ECE\u5F55\u97F3\u5361\u540C\u6B65\u5230\u7684 ${items.length} \u6761\u5F55\u97F3\u7684\u8F6C\u5199\u6587\u672C\uFF1A

${body}`;
    return { text, template: tpl, titleList };
  }
  async function resolveTargetSession() {
    const sc = ctx.get("sessionController");
    if (sc === void 0) throw new Error("\u5185\u6838\u672A\u63D0\u4F9B sessionController");
    if (runtime.postProcess.conversationId) return runtime.postProcess.conversationId;
    const v = await sc.create({});
    return v.sessionId;
  }
  async function sendPostMessage(sessionId, text) {
    const sc = ctx.get("sessionController");
    if (sc === void 0) throw new Error("\u5185\u6838\u672A\u63D0\u4F9B sessionController");
    await sc.prompt(
      {
        requestId: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        mode: "queue",
        content: [{ type: "text", text }]
      },
      new AbortController().signal
    );
  }
  async function triggerPostProcess(items) {
    const built = await buildPostMessage(items);
    if (built === null) {
      log("\u540E\u5904\u7406\u8DF3\u8FC7\uFF1A\u627E\u4E0D\u5230\u63D0\u793A\u8BCD\u6A21\u677F", runtime.postProcess.templateId);
      return;
    }
    lastPostProcess = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      ok: false,
      mode: runtime.postProcess.mode,
      count: items.length,
      target: null,
      error: null
    };
    if (runtime.postProcess.mode === "confirm") {
      pendingQueue.push({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        templateId: built.template.id,
        templateName: built.template.name,
        items: built.titleList,
        text: built.text
      });
      log(
        `\u540E\u5904\u7406\uFF1A\u5DF2\u5907\u597D ${items.length} \u6761\u5F55\u97F3\u7684\u5408\u5E76\u6D88\u606F\uFF0C\u7B49\u5F85\u4F60\u786E\u8BA4\u540E\u53D1\u9001` + (pendingQueue.length > 1 ? `\uFF08\u53E6\u6709 ${pendingQueue.length - 1} \u6761\u5F85\u786E\u8BA4\uFF09` : "")
      );
      if (lastPostProcess) lastPostProcess.error = "\u5DF2\u5907\u597D\uFF0C\u7B49\u4F60\u624B\u52A8\u786E\u8BA4";
      return;
    }
    try {
      const sid = await resolveTargetSession();
      await sendPostMessage(sid, built.text);
      if (lastPostProcess) {
        lastPostProcess.ok = true;
        lastPostProcess.target = sid;
      }
      for (const it of items) {
        markFlowed(outDir, {
          sessionId: it.sessionId,
          kind: "auto",
          targetSessionId: sid,
          at: (/* @__PURE__ */ new Date()).toISOString(),
          templateId: built.template.id,
          batchSize: items.length
        });
      }
      log(`\u540E\u5904\u7406\uFF1A\u5DF2\u628A ${items.length} \u6761\u5F55\u97F3\u7684\u5408\u5E76\u6D88\u606F\u53D1\u5230\u4F1A\u8BDD ${sid}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (lastPostProcess) lastPostProcess.error = msg;
      throw e;
    }
  }
  async function runSync(opts = {}) {
    if (syncState.running) throw new Error("\u540C\u6B65\u5DF2\u5728\u8FD0\u884C\u4E2D");
    syncState.running = true;
    syncState.lastError = null;
    try {
      const entries = await ble.filelist();
      const index = readSyncIndex();
      const alive = new Set(entries.map((e) => e.name));
      for (const k of Object.keys(index)) if (!alive.has(k)) delete index[k];
      const deleteAfter = opts.deleteAfter ?? runtime.bleSyncDeleteAfter;
      const force = opts.force ?? false;
      const result = { downloaded: 0, skipped: 0, failed: 0, retried: 0, deleted: 0, kept: 0 };
      const ordered = [...entries].sort((a, b) => a.size - b.size);
      const roundTranscripts = [];
      for (const e of ordered) {
        const prev = index[e.name];
        if (prev && !prev.failed && prev.size === e.size && prev.text) {
          result.skipped++;
          if (deleteAfter && prev.sessionId) {
            const r = await deleteFromDeviceAfterTransfer(e, prev.sessionId);
            if (r === "deleted") result.deleted++;
            else if (r === "kept") result.kept++;
          }
          continue;
        }
        if (prev?.failed && !force) {
          const attempts = prev.attempts ?? 1;
          if (prev.permanent === true || attempts >= SYNC_MAX_ATTEMPTS) {
            result.skipped++;
            continue;
          }
          result.retried++;
          log(`\u540C\u6B65: \u91CD\u8BD5 ${e.name}\uFF08\u7B2C ${attempts + 1}/${SYNC_MAX_ATTEMPTS} \u6B21\uFF0C\u4E0A\u6B21\uFF1A${prev.failed ?? ""}\uFF09`);
        }
        if (!ble.connected) {
          log(`\u540C\u6B65\u4E2D\u65AD\uFF1A\u5F55\u97F3\u5361\u5DF2\u65AD\u5F00\uFF0C\u5269\u4F59\u6587\u4EF6\u7559\u5F85\u4E0B\u6B21\uFF08\u5DF2\u5B8C\u6210 ${result.downloaded}\uFF09`);
          break;
        }
        log("\u540C\u6B65: \u5904\u7406", e.name, `${e.time}s/${e.size}B`);
        try {
          const dl = await ble.download(e.name, { prefer: downloadPrefer() });
          if (dl.chunks && dl.chunks > 1 && dl.size !== e.size) {
            throw new Error(`\u5206\u7247\u4F20\u8F93\u5B57\u8282\u6570\u4E0D\u7B26\uFF08\u8BBE\u5907 ${e.size}B\uFF0C\u6536\u5230 ${dl.size}B\uFF09\u2014\u2014\u672C\u673A\u56FA\u4EF6\u7684 offset \u7EED\u4F20\u4E0D\u53EF\u9760`);
          }
          const out = await recognize({
            bytes: b64ToBytes(dl.data),
            hint: dl.ext === "wav" ? "wav" : "opus",
            source: "file",
            deviceFile: dl.name,
            // 录制时间取自设备文件名，不是同步时刻
            recordedAt: deviceFileTime(dl.name)?.toISOString(),
            device: { address: ble.address ?? void 0 }
          });
          index[e.name] = {
            size: e.size,
            time: e.time,
            sessionId: out.sessionId,
            text: out.text.slice(0, 200),
            syncedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          result.downloaded++;
          roundTranscripts.push({ name: e.name, sessionId: out.sessionId, text: out.text });
          log("\u540C\u6B65: \u5B8C\u6210", e.name, "\u2192", out.sessionId, out.text.slice(0, 40));
          if (deleteAfter) {
            const r = await deleteFromDeviceAfterTransfer(e, out.sessionId);
            if (r === "deleted") result.deleted++;
            else if (r === "kept") result.kept++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const attempts = (prev?.attempts ?? 0) + 1;
          const permanent = !isTransientFailure(msg);
          const now = (/* @__PURE__ */ new Date()).toISOString();
          index[e.name] = {
            size: e.size,
            time: e.time,
            syncedAt: now,
            failed: msg.slice(0, 200),
            failedAt: now,
            attempts,
            permanent
          };
          result.failed++;
          log(
            `\u540C\u6B65: \u5931\u8D25 ${e.name} ${msg.slice(0, 140)}\uFF08\u7B2C ${attempts}/${SYNC_MAX_ATTEMPTS} \u6B21\uFF0C${permanent ? "\u6C38\u4E45\u5931\u8D25\uFF0C\u4E0D\u518D\u91CD\u8BD5" : "\u77AC\u65F6\u5931\u8D25\uFF0C\u4E0B\u6B21\u81EA\u52A8\u91CD\u8BD5"}\uFF09`
          );
        }
      }
      writeSyncIndex(index);
      syncState.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
      syncState.lastResult = result;
      if (result.deleted > 0) log(`\u540C\u6B65\u540E\u4ECE\u5F55\u97F3\u5361\u5220\u9664 ${result.deleted} \u6761\uFF08\u672C\u5730\u5747\u6709\u526F\u672C\uFF09`);
      if (result.kept > 0) log(`\u6709 ${result.kept} \u6761\u672A\u4ECE\u5F55\u97F3\u5361\u5220\u9664\uFF08\u672C\u5730\u65E0\u53EF\u9760\u526F\u672C\uFF0C\u4FDD\u7559\uFF09`);
      if (result.retried > 0) log(`\u672C\u6B21\u91CD\u8BD5\u4E86 ${result.retried} \u6761\u6B64\u524D\u5931\u8D25\u7684\u6587\u4EF6`);
      if (runtime.postProcess.enabled) {
        const items = roundTranscripts.filter((x) => x.text.trim().length > 0);
        if (items.length > 0) {
          await triggerPostProcess(items).catch(
            (err) => log("\u540E\u5904\u7406\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u540C\u6B65\u7ED3\u679C\uFF09:", err instanceof Error ? err.message : String(err))
          );
        }
      }
      return result;
    } catch (e) {
      syncState.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      syncState.running = false;
    }
  }
  let cachedReadiness = null;
  async function readiness(force = false) {
    if (cachedReadiness && !force) return cachedReadiness;
    try {
      await funasrWorker.ensureStarted();
      cachedReadiness = force ? await probeFunasr(funasrWorker) : readReadiness(funasrWorker.readyPayload);
    } catch (e) {
      cachedReadiness = {
        python: funasrPython,
        pythonVersion: null,
        funasrInstalled: false,
        funasrVersion: null,
        torchVersion: null,
        cudaAvailable: false,
        cudaDeviceName: null,
        device: "cpu",
        models: [],
        missing: [`FunASR worker \u542F\u52A8\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`],
        installHint: "\u68C0\u67E5 Python \u89E3\u91CA\u5668\u4E0E scripts/funasr_worker.py \u662F\u5426\u5B58\u5728\u4E8E\u63D2\u4EF6\u5B89\u88C5\u76EE\u5F55",
        ready: false
      };
    }
    return cachedReadiness;
  }
  const activeSse = /* @__PURE__ */ new Set();
  let disposed = false;
  ctx.effect(() => {
    const handler = async (req, res) => {
      if (req.method === "OPTIONS") return sendJson(res, 204, {});
      if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD" && req.method !== "DELETE") {
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }
      let pathname = "/";
      let search = new URLSearchParams();
      try {
        const u = new URL(req.url ?? "/", "http://x");
        pathname = u.pathname;
        search = u.searchParams;
      } catch {
      }
      const isRecorder = pathname.startsWith("/api/recorder");
      const isQs668 = pathname.startsWith("/api/qs668");
      if (!isRecorder && !isQs668) return sendJson(res, 404, { ok: false, error: "not found: " + pathname });
      if (!authOk(req)) return sendJson(res, 403, { ok: false, error: "invalid token" });
      try {
        if (req.method === "DELETE") {
          const m = pathname.match(/^\/api\/recorder\/session\/([^/]+)$/);
          if (isRecorder && m) {
            const sid = decodeURIComponent(m[1]);
            if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: "\u975E\u6CD5 session id" });
            const existed = sessions.get(sid) !== void 0;
            if (live && live.sessionId === sid) await finalizeLive("\u5220\u9664\u4F1A\u8BDD");
            const r = sessions.remove(sid);
            if (!r.ok) return sendJson(res, 500, { ok: false, error: r.error ?? "\u5220\u9664\u5931\u8D25" });
            log(
              `\u5DF2\u5220\u9664\u4F1A\u8BDD ${sid}\uFF08\u91CA\u653E ${r.freedBytes} \u5B57\u8282${existed ? "" : "\uFF0C\u8BB0\u5F55\u672C\u5C31\u4E0D\u5B58\u5728"}${r.archivedSummary ? `\uFF0CLLM \u603B\u7ED3\u5DF2\u5F52\u6863\u5230 ${r.archivedSummary}` : ""}\uFF09`
            );
            return sendJson(res, 200, {
              ok: true,
              sessionId: sid,
              existed,
              freedBytes: r.freedBytes,
              archivedSummary: r.archivedSummary
            });
          }
          return sendJson(res, 404, { ok: false, error: "unknown DELETE " + pathname });
        }
        if (req.method === "GET" || req.method === "HEAD") {
          if (isRecorder && pathname === "/api/recorder/health") {
            return sendJson(res, 200, { ok: true, name, version: VERSION, outDir, layers: ["capture", "preprocess", "recognition", "output", "session-link"] });
          }
          if (isRecorder && pathname === "/api/recorder/config") {
            return sendJson(res, 200, { ok: true, config: runtime, python: funasrPython });
          }
          if (isRecorder && pathname === "/api/recorder/open-session") {
            const title = openSessionId === null ? null : await dshSessionTitle(openSessionId);
            return sendJson(res, 200, { ok: true, sessionId: openSessionId, title });
          }
          if (isRecorder && pathname === "/api/recorder/flows") {
            return sendJson(res, 200, { ok: true, bySession: allFlows(outDir) });
          }
          if (isRecorder && pathname === "/api/recorder/notes") {
            return sendJson(res, 200, { ok: true, bySession: listAllNotes(outDir) });
          }
          if (isRecorder && pathname === "/api/recorder/note") {
            const p = new URL(req.url ?? "", "http://x").searchParams.get("path") ?? "";
            const text = readNote(p, outDir);
            if (text === null) {
              return sendJson(res, 404, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u7EAA\u8981\uFF08\u6216\u8DEF\u5F84\u4E0D\u5728\u7EAA\u8981\u76EE\u5F55\u5185\uFF09" });
            }
            return sendJson(res, 200, { ok: true, path: p, text });
          }
          if (isRecorder && pathname === "/api/recorder/notes-for") {
            const sid = new URL(req.url ?? "", "http://x").searchParams.get("sessionId") ?? "";
            return sendJson(res, 200, { ok: true, sessionId: sid, docs: listNotes(outDir, sid) });
          }
          if (isRecorder && pathname === "/api/recorder/post-process/pending") {
            return sendJson(res, 200, {
              ok: true,
              pending: pendingQueue[0] ?? null,
              pendingCount: pendingQueue.length
            });
          }
          if (isRecorder && pathname === "/api/recorder/dsh/sessions") {
            const sc = ctx.get("sessionController");
            if (sc === void 0) {
              return sendJson(res, 503, { ok: false, error: "\u5185\u6838\u672A\u63D0\u4F9B sessionController\uFF08\u65E0\u6CD5\u5217\u51FA\u4F1A\u8BDD\uFF09" });
            }
            try {
              const ac = new AbortController();
              const v = await sc.list({}, ac.signal);
              return sendJson(res, 200, { ok: true, items: v.items ?? [] });
            } catch (e) {
              return sendJson(res, 500, {
                ok: false,
                error: `\u5217\u51FA\u4F1A\u8BDD\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`
              });
            }
          }
          if (isRecorder && pathname === "/api/recorder/post-process") {
            return sendJson(res, 200, {
              ok: true,
              config: runtime.postProcess,
              templates: allTemplates(userTemplates),
              // 必须带上：界面靠它渲染「待确认发送」块。
              // 之前这行没生效，导致该块永远不出现（手动确认模式形同虚设）。
              pending: pendingQueue[0] ?? null,
              pendingCount: pendingQueue.length
            });
          }
          if (isRecorder && pathname === "/api/recorder/presets") {
            const active = String(runtime.asrModel ?? "paraformer-zh");
            const activePreset = presetById(active);
            if (activePreset === void 0) {
              return sendJson(res, 400, { ok: false, error: `\u672A\u77E5\u9884\u8BBE: ${active}` });
            }
            const enabled = normalizeEnabledPresets(runtime.enabledPresets, active);
            const funasrPkgOk = cachedReadiness === null ? null : cachedReadiness.funasrInstalled === true;
            const envs = envStatus(
              {
                basePython: funasrPython ?? "python",
                funasrModelDir: runtime.funasrModelDir || join11(outDir, "funasr"),
                qwenVenvDir: join11(outDir, "qwen-venv"),
                qwenModelDir: qwenDir,
                qwenModelName: config.qwenModelName
              },
              enabled,
              funasrPkgOk
            );
            return sendJson(res, 200, {
              ok: true,
              presets: ASR_PRESETS,
              active,
              components: ENV_COMPONENTS,
              envs,
              // 当前预设需要哪些组件 —— 界面「识别环境」只该显示这些
              needed: activePreset.needs,
              enabled,
              // 每个预设的卸载计划：会删什么、会保留什么（引用计数结果）
              uninstallPlans: ASR_PRESETS.map((p) => planPresetUninstall(p.id, enabled))
            });
          }
          if (isRecorder && pathname === "/api/recorder/asr/status") {
            const wantProbe = /[?&]probe=1/.test(req.url ?? "");
            const r = await readiness(wantProbe);
            const nowQ = Date.now();
            const qwenStale = qwenCheckCache === null || nowQ - qwenCheckCache.at > 6e5;
            if (qwenStale) {
              if (wantProbe) {
                qwenCheckCache = { at: nowQ, value: qwenImportCheck(outDir) };
              } else if (!qwenCheckPending) {
                qwenCheckPending = true;
                void (async () => {
                  try {
                    qwenCheckCache = { at: Date.now(), value: qwenImportCheck(outDir) };
                  } catch {
                  } finally {
                    qwenCheckPending = false;
                  }
                })();
              }
            }
            const qwenCheck = qwenCheckCache?.value ?? null;
            const qwen = {
              // 默认走文件检查（瞬时）；有体检结果就以它为准，
              // 避免「体检报缺失、就绪却是 true」的假绿
              ready: qwenReadyCached(false) && (qwenCheck === null || qwenCheck.ok),
              venv: qwenVenvPythonPath(outDir),
              modelName: config.qwenModelName,
              modelPath: join11(qwenDir, config.qwenModelName),
              modelPresent: existsSync9(join11(qwenDir, config.qwenModelName, "config.json")),
              lastInstall: cachedQwenStatus,
              // 逐模块 import 体检：缺哪个模块、什么错误，如实报给面板
              importCheck: qwenCheck,
              hint: "\u70B9\u300C\u5B89\u88C5 / \u4FEE\u590D\u73AF\u5883\u300D\u4F1A\u521B\u5EFA qwen venv\u3001\u5B89\u88C5 qwen-asr \u5E76\u4E0B\u8F7D\u6743\u91CD\uFF08\u7EA6 3.4GB\uFF0C\u8D70 hf-mirror\uFF09"
            };
            return sendJson(res, 200, { ok: true, ready: r.ready, status: r, qwen, probed: wantProbe });
          }
          if (isRecorder && pathname === "/api/recorder/sessions") {
            return sendJson(res, 200, { ok: true, items: sessions.list() });
          }
          if (isRecorder && pathname === "/api/recorder/summaries") {
            return sendJson(res, 200, { ok: true, items: sessions.listSummaries() });
          }
          if (isRecorder && pathname === "/api/recorder/ble/known") {
            return sendJson(res, 200, { ok: true, items: knownDevices.list() });
          }
          if (isRecorder && pathname === "/api/recorder/ble/status") {
            return sendJson(res, 200, {
              ok: true,
              python: ble.python,
              bleak: ble.bleakVersion,
              daemonRunning: ble.running,
              connected: ble.connected,
              reconnecting: ble.reconnecting,
              reconnectAttempt: ble.reconnectAttempt,
              address: ble.address,
              mtu: ble.mtu,
              battery: ble.battery,
              realtimeActive: ble.realtimeActive,
              live: live ? { sessionId: live.sessionId, bufferedBytes: live.buffered, totalBytes: live.total } : null,
              sync: syncState,
              scan: scanState,
              // 自动链路的可观测记录：失败原因不再只进日志
              lastAutoSync,
              lastPostProcess
            });
          }
          if (isRecorder && pathname === "/api/recorder/ble/filelist") {
            const st = await ensureBle();
            if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
            try {
              return sendJson(res, 200, { ok: true, entries: await ble.filelist(), opusPreferred: runtime.opusPreferred });
            } catch (e) {
              return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
            }
          }
          if (isRecorder && pathname === "/api/recorder/ble/sync/status") {
            return sendJson(res, 200, { ok: true, ...syncState });
          }
          const detail = pathname.match(/^\/api\/recorder\/session\/([^/]+)(?:\/(events|audio|markdown))?$/);
          if (isRecorder && detail) {
            const sid = decodeURIComponent(detail[1]);
            const sub = detail[2];
            if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: "\u975E\u6CD5 session id" });
            const rec = sessions.get(sid);
            if (!rec) return sendJson(res, 404, { ok: false, error: "session not found: " + sid });
            if (sub === "events") {
              res.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-cache",
                connection: "keep-alive",
                "access-control-allow-origin": "*"
              });
              res.write(`data: ${JSON.stringify({ type: "hello", sessionId: sid, transcript: rec.transcript, partial: rec.partial ?? "" })}

`);
              activeSse.add(res);
              const off = sessions.on(sid, (ev) => {
                try {
                  res.write(`data: ${JSON.stringify(ev)}

`);
                } catch {
                }
              });
              const cleanup = () => {
                off();
                activeSse.delete(res);
                try {
                  res.end();
                } catch {
                }
              };
              req.on("close", cleanup);
              return;
            }
            if (sub === "audio" || sub === "markdown") {
              const arts2 = resolveArtifacts(sessions, sid, streamPathFor);
              const slot2 = sub === "audio" ? arts2?.audio : arts2?.markdown;
              if (!slot2?.present) return sendJson(res, 404, { ok: false, error: `${sub} \u5C1A\u672A\u4EA7\u51FA` });
              return serveFile(res, req, slot2.ref, contentTypeOf(sub, slot2.ref));
            }
            const arts = resolveArtifacts(sessions, sid, streamPathFor);
            return sendJson(res, 200, {
              ok: true,
              session: rec,
              artifacts: arts,
              completeness: completenessOf(rec),
              // 这条录音被流转给 LLM 的历史（「录音内容」页据此显示标记）
              flows: flowsFor(outDir, sid),
              // Agent 关联进来的纪要
              notes: listNotes(outDir, sid)
            });
          }
          return sendJson(res, 404, { ok: false, error: "unknown GET " + pathname });
        }
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        if (isRecorder && pathname === "/api/recorder/config") {
          const allowed = [
            "asrModel",
            "asrDevice",
            "asrVad",
            "asrPunc",
            "asrSpk",
            "language",
            "funasrPythonPath",
            "funasrModelDir",
            "streamChunkMs",
            "opusPreferred",
            "bleAutoSync",
            "bleSyncDeleteAfter",
            "markdownEnabled",
            "keepAudio",
            "autoTitle",
            "titleMaxChars",
            "postProcess"
          ];
          const changed = [];
          const prevModel = runtime.asrModel;
          for (const k of allowed) {
            if (body[k] === void 0) continue;
            if (k === "postProcess") {
              const raw = body.postProcess ?? {};
              const clean = {};
              for (const pk of ["enabled", "templateId", "conversationId", "mode"]) {
                if (raw[pk] !== void 0) clean[pk] = raw[pk];
              }
              runtime.postProcess = {
                ...runtime.postProcess,
                ...clean
              };
            } else {
              ;
              runtime[k] = body[k];
            }
            changed.push(k);
          }
          if (changed.includes("asrModel")) {
            const before = normalizeEnabledPresets(runtime.enabledPresets, prevModel);
            runtime.enabledPresets = normalizeEnabledPresets([...before, runtime.asrModel], runtime.asrModel);
            changed.push("enabledPresets");
          }
          if (changed.length) {
            saveRuntime();
            cachedReadiness = null;
            log("\u8FD0\u884C\u65F6\u914D\u7F6E\u5DF2\u66F4\u65B0:", changed.join(","));
          }
          return sendJson(res, 200, { ok: true, config: runtime, changed });
        }
        if (isRecorder && pathname === "/api/recorder/sessions/delete") {
          const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
          if (ids.length === 0) return sendJson(res, 400, { ok: false, error: "ids \u4E3A\u7A7A" });
          if (ids.length > 500) return sendJson(res, 400, { ok: false, error: "\u4E00\u6B21\u6700\u591A\u5220 500 \u6761" });
          const deleted = [];
          const failed = [];
          const summaries = [];
          let freedBytes = 0;
          for (const id of ids) {
            if (!isValidSessionId(id)) {
              failed.push({ id, error: "\u975E\u6CD5 session id" });
              continue;
            }
            if (live && live.sessionId === id) await finalizeLive("\u6279\u91CF\u5220\u9664\u4F1A\u8BDD");
            const r = sessions.remove(id);
            if (!r.ok) {
              failed.push({ id, error: r.error ?? "\u5220\u9664\u5931\u8D25" });
              continue;
            }
            deleted.push(id);
            freedBytes += r.freedBytes;
            if (r.archivedSummary) summaries.push(r.archivedSummary);
          }
          log(
            `\u6279\u91CF\u5220\u9664\uFF1A\u6210\u529F ${deleted.length} / \u5931\u8D25 ${failed.length}\uFF0C\u91CA\u653E ${freedBytes} \u5B57\u8282${summaries.length ? `\uFF0C\u5F52\u6863 LLM \u603B\u7ED3 ${summaries.length} \u4EFD` : ""}`
          );
          return sendJson(res, 200, {
            ok: true,
            deleted,
            failed,
            freedBytes,
            archivedSummaries: summaries,
            items: sessions.list()
          });
        }
        if (isRecorder && pathname === "/api/recorder/summary") {
          const sid = String(body.sessionId ?? "");
          if (!isValidSessionId(sid)) return sendJson(res, 400, { ok: false, error: "\u975E\u6CD5 session id" });
          const rec = sessions.setSummary(sid, String(body.text ?? ""), body.title ? String(body.title) : void 0);
          if (!rec) return sendJson(res, 404, { ok: false, error: "session not found: " + sid });
          refreshMarkdown(sid);
          log(`\u5DF2\u8BB0\u5165 LLM \u603B\u7ED3 session=${sid}\uFF08${rec.summary?.text.length ?? 0} \u5B57${rec.summary?.title ? `\uFF0C\u6807\u9898\u300C${rec.summary.title}\u300D` : ""}\uFF09`);
          return sendJson(res, 200, { ok: true, session: sessions.get(sid) ?? rec });
        }
        if (isRecorder && pathname === "/api/recorder/title") {
          const sid = String(body.sessionId ?? "");
          const title = String(body.title ?? "");
          const source = body.source === "llm" || body.source === "auto" ? body.source : "user";
          if (!title.trim()) return sendJson(res, 400, { ok: false, error: "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A" });
          const rec = sessions.setTitle(sid, title, source);
          if (!rec) return sendJson(res, 404, { ok: false, error: "session not found: " + sid });
          refreshMarkdown(sid);
          const fresh = sessions.get(sid) ?? rec;
          log(`\u6807\u9898\u6539\u4E3A\u300C${fresh.title}\u300D\uFF08\u6765\u6E90 ${fresh.titleSource}\uFF09`);
          return sendJson(res, 200, {
            ok: true,
            session: fresh,
            artifacts: resolveArtifacts(sessions, sid, streamPathFor)
          });
        }
        if (isRecorder && pathname === "/api/recorder/post-process/template") {
          const tpl = normalizeTemplate(body.template ?? body);
          if (tpl === null) {
            return sendJson(res, 400, {
              ok: false,
              error: "\u6A21\u677F\u65E0\u6548\uFF1A\u9700\u8981 name \u4E0E body\uFF0C\u4E14 id \u4E0D\u80FD\u4E0E\u5185\u7F6E\u6A21\u677F\u91CD\u540D\uFF08\u53EF\u5148\u300C\u53E6\u5B58\u4E3A\u300D\uFF09"
            });
          }
          const id = tpl.id || templateIdFrom(tpl.name);
          const next = { ...tpl, id };
          const i = userTemplates.findIndex((x) => x.id === id);
          if (i >= 0) userTemplates[i] = next;
          else userTemplates.push(next);
          saveTemplates();
          log("\u63D0\u793A\u8BCD\u6A21\u677F\u5DF2\u4FDD\u5B58:", id, next.name);
          return sendJson(res, 200, { ok: true, template: next, templates: allTemplates(userTemplates) });
        }
        if (isRecorder && pathname === "/api/recorder/post-process/template/delete") {
          const id = String(body.id ?? "");
          if (userTemplates.every((x) => x.id !== id)) {
            return sendJson(res, 400, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u81EA\u5B9A\u4E49\u6A21\u677F\uFF08\u5185\u7F6E\u6A21\u677F\u4E0D\u53EF\u5220\u9664\uFF09" });
          }
          userTemplates = userTemplates.filter((x) => x.id !== id);
          saveTemplates();
          if (runtime.postProcess.templateId === id) {
            runtime.postProcess.templateId = "meeting-notes";
            saveRuntime();
          }
          return sendJson(res, 200, { ok: true, templates: allTemplates(userTemplates) });
        }
        if (isRecorder && pathname === "/api/recorder/post-process/resolve") {
          if (pendingQueue.length === 0) return sendJson(res, 400, { ok: false, error: "\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u540E\u5904\u7406\u6D88\u606F" });
          if (body.action === "discard") {
            pendingQueue.shift();
            return sendJson(res, 200, { ok: true, discarded: true });
          }
          const cur = pendingQueue[0];
          try {
            const sid = await resolveTargetSession();
            await sendPostMessage(sid, cur.text);
            for (const it of cur.items) {
              markFlowed(outDir, {
                sessionId: it.sessionId,
                kind: "summary",
                targetSessionId: sid,
                at: (/* @__PURE__ */ new Date()).toISOString(),
                templateId: cur.templateId,
                batchSize: cur.items.length
              });
            }
            pendingQueue.shift();
            log(`\u540E\u5904\u7406\uFF1A\u5DF2\u628A ${cur.items.length} \u6761\u5F55\u97F3\u7684\u5408\u5E76\u6D88\u606F\u53D1\u5230\u4F1A\u8BDD ${sid}`);
            return sendJson(res, 200, { ok: true, sessionId: sid });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        if (isRecorder && pathname === "/api/recorder/dsh/sessions/create") {
          const sc = ctx.get("sessionController");
          if (sc === void 0) return sendJson(res, 503, { ok: false, error: "\u5185\u6838\u672A\u63D0\u4F9B sessionController" });
          try {
            const v = await sc.create({ cwd: typeof body.cwd === "string" ? body.cwd : void 0 });
            return sendJson(res, 200, { ok: true, sessionId: v.sessionId });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        if (isRecorder && pathname === "/api/recorder/dsh/send") {
          const sc = ctx.get("sessionController");
          if (sc === void 0) return sendJson(res, 503, { ok: false, error: "\u5185\u6838\u672A\u63D0\u4F9B sessionController" });
          const sessionId = String(body.sessionId ?? "");
          const text = String(body.text ?? "");
          if (!sessionId || !text) return sendJson(res, 400, { ok: false, error: "sessionId \u4E0E text \u5FC5\u586B" });
          try {
            const ac = new AbortController();
            await sc.prompt(
              {
                // requestId 是幂等标识：同一个 id 重复投递不会被接受两次
                requestId: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId,
                mode: body.mode === "steer" ? "steer" : "queue",
                content: [{ type: "text", text }]
              },
              ac.signal
            );
            log("\u5DF2\u5411\u540E\u5904\u7406\u4F1A\u8BDD\u53D1\u9001\u6D88\u606F:", sessionId);
            return sendJson(res, 200, { ok: true, sessionId });
          } catch (e) {
            return sendJson(res, 500, {
              ok: false,
              error: `\u53D1\u9001\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`
            });
          }
        }
        if (isRecorder && pathname === "/api/recorder/deliver") {
          const ids = Array.isArray(body.sessionIds) ? body.sessionIds : [];
          const format = String(body.format ?? "transcript");
          if (ids.length === 0) return sendJson(res, 400, { ok: false, error: "\u6CA1\u6709\u9009\u4E2D\u4EFB\u4F55\u5F55\u97F3" });
          const tpl = allTemplates(userTemplates).find((x) => x.id === String(body.templateId ?? ""));
          if (tpl === void 0) return sendJson(res, 400, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u63D0\u793A\u8BCD\u6A21\u677F" });
          const picked = [];
          const skipped = [];
          for (const id of ids) {
            const rec = sessions.get(id);
            if (rec === void 0) {
              skipped.push(`${id}\uFF08\u627E\u4E0D\u5230\uFF09`);
              continue;
            }
            if (format === "notes") {
              const docs = listNotes(outDir, id);
              const parts = [];
              for (const doc of docs) {
                const text2 = readNote(doc.path, outDir);
                if (text2 !== null) parts.push(`### ${doc.title}

${text2}`);
              }
              if (parts.length === 0) {
                skipped.push(`${rec.title}\uFF08\u6CA1\u6709\u7EAA\u8981\uFF09`);
                continue;
              }
              picked.push({ id, title: rec.title ?? id, text: parts.join("\n\n---\n\n"), kind: "\u7EAA\u8981" });
            } else if (format === "markdown") {
              const md = readNote(join11(sessions.dirOf(id), `${rec.title}.md`), sessions.dirOf(id));
              if (md === null) {
                skipped.push(`${rec.title}\uFF08\u6CA1\u6709 Markdown \u6587\u6863\uFF09`);
                continue;
              }
              picked.push({ id, title: rec.title ?? id, text: md, kind: "Markdown \u6587\u6863" });
            } else {
              const text2 = (rec.transcript ?? "").trim();
              if (!text2) {
                skipped.push(`${rec.title}\uFF08\u6CA1\u6709\u8F6C\u5199\u539F\u6587\uFF09`);
                continue;
              }
              picked.push({ id, title: rec.title ?? id, text: text2, kind: "\u8F6C\u5199\u539F\u6587" });
            }
          }
          if (picked.length === 0) {
            return sendJson(res, 400, {
              ok: false,
              error: `\u9009\u4E2D\u7684\u5185\u5BB9\u90FD\u53D6\u4E0D\u5230\uFF1A${skipped.join("\u3001")}`
            });
          }
          const body2 = picked.map((p) => `## ${p.title}

\u5F55\u97F3\u4F1A\u8BDD id\uFF1A${p.id}

${p.text}`).join("\n\n---\n\n");
          const head = picked.length === 1 ? `\u4EE5\u4E0B\u662F\u300C${picked[0].title}\u300D\u7684${picked[0].kind}\uFF1A` : `\u4EE5\u4E0B\u662F\u4ECE\u5F55\u97F3\u5361\u9009\u51FA\u7684 ${picked.length} \u6761\u5F55\u97F3\uFF08\u5404\u81EA\u7684${picked[0].kind}\uFF09\uFF1A`;
          const text = `${tpl.body}

---

${head}

${body2}`;
          let sid = String(body.targetSessionId ?? "") || (openSessionId ?? "");
          if (!sid) {
            try {
              const sc = ctx.get("sessionController");
              if (sc !== void 0) {
                const v = await sc.list({}, new AbortController().signal);
                const rows = v.items ?? [];
                const own = rows.filter((x) => !x.parentSessionId && x.origin !== "subagent");
                const pool = own.length > 0 ? own : rows;
                const best = pool.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
                if (best) sid = best.sessionId;
              }
            } catch {
            }
          }
          if (!sid) return sendJson(res, 400, { ok: false, error: "\u65E0\u6CD5\u786E\u5B9A\u76EE\u6807\u5BF9\u8BDD" });
          try {
            await sendPostMessage(sid, text);
          } catch (e) {
            return sendJson(res, 500, {
              ok: false,
              error: `\u6295\u653E\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`
            });
          }
          for (const p of picked) {
            markFlowed(outDir, {
              sessionId: p.id,
              kind: "deliver",
              targetSessionId: sid,
              at: (/* @__PURE__ */ new Date()).toISOString(),
              templateId: tpl.id,
              batchSize: picked.length
            });
          }
          log(`\u6295\u653E\uFF1A${picked.length} \u6761\u5F55\u97F3 \u2192 \u4F1A\u8BDD ${sid}\uFF08\u6A21\u677F\u300C${tpl.name}\u300D\uFF0C\u683C\u5F0F ${format}\uFF09`);
          return sendJson(res, 200, { ok: true, sessionId: sid, sent: picked.length, skipped });
        }
        if (isRecorder && pathname === "/api/recorder/session/open") {
          const sid = String(body.sessionId ?? "");
          if (sid) {
            if (openSessionId !== sid) log("\u5F53\u524D\u6253\u5F00\u7684\u4F1A\u8BDD\u53D8\u66F4:", sid);
            openSessionId = sid;
          }
          return sendJson(res, 200, { ok: true });
        }
        if (isRecorder && pathname === "/api/recorder/ui-surface") {
          lastUiSurface = {
            at: (/* @__PURE__ */ new Date()).toISOString(),
            surface: String(body.surface ?? ""),
            hasWorkbench: body.hasWorkbench === true,
            hasTabs: body.hasTabs === true,
            hasSlots: body.hasSlots === true
          };
          log("\u524D\u7AEF\u6302\u8F7D\u8DEF\u5F84:", JSON.stringify(lastUiSurface));
          return sendJson(res, 200, { ok: true });
        }
        if (isRecorder && pathname === "/api/recorder/env/uninstall-preset") {
          const presetId = String(body.presetId ?? "");
          if (presetById(presetId) === void 0) {
            return sendJson(res, 400, { ok: false, error: `\u672A\u77E5\u9884\u8BBE: ${presetId}` });
          }
          const active = String(runtime.asrModel ?? "paraformer-zh");
          const enabled = normalizeEnabledPresets(runtime.enabledPresets, active);
          const r = await uninstallPreset({
            presetId,
            enabled,
            paths: {
              basePython: funasrPython ?? "python",
              funasrModelDir: runtime.funasrModelDir || join11(outDir, "funasr"),
              qwenVenvDir: join11(outDir, "qwen-venv"),
              qwenModelDir: qwenDir,
              qwenModelName: config.qwenModelName
            },
            funasrPkgOk: cachedReadiness === null ? false : cachedReadiness.funasrInstalled === true,
            run: (cmd, args, timeoutMs) => new Promise((resolve3) => {
              execFile2(
                cmd,
                args,
                { timeout: timeoutMs, env: spawnEnv(void 0, runtime.proxyUrl || void 0), maxBuffer: 8 << 20 },
                (err, stdout, stderr) => resolve3({ code: err ? 1 : 0, out: `${stdout ?? ""}
${stderr ?? ""}` })
              );
            }),
            log: (m, ...rest) => log(m, ...rest)
          });
          runtime.enabledPresets = r.enabledAfter;
          if (runtime.asrModel === presetId && r.enabledAfter.length > 0) {
            runtime.asrModel = r.enabledAfter[0];
          }
          saveRuntime();
          cachedReadiness = null;
          qwenCheckCache = null;
          invalidateSizeCache();
          if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error ?? r.message, result: r });
          return sendJson(res, 200, { ok: true, result: r });
        }
        if (isRecorder && pathname === "/api/recorder/env/uninstall") {
          const key = String(body.key ?? "");
          if (!(key in ENV_COMPONENTS)) {
            return sendJson(res, 400, { ok: false, error: `\u672A\u77E5\u73AF\u5883\u7EC4\u4EF6: ${key}` });
          }
          const active = String(runtime.asrModel ?? "paraformer-zh");
          const r = await uninstallEnv({
            key,
            paths: {
              basePython: funasrPython ?? "python",
              funasrModelDir: runtime.funasrModelDir || join11(outDir, "funasr"),
              qwenVenvDir: join11(outDir, "qwen-venv"),
              qwenModelDir: qwenDir,
              qwenModelName: config.qwenModelName
            },
            activePresetId: active,
            funasrPkgOk: cachedReadiness === null ? false : cachedReadiness.funasrInstalled === true,
            run: (cmd, args, timeoutMs) => new Promise((resolve3) => {
              execFile2(
                cmd,
                args,
                { timeout: timeoutMs, env: spawnEnv(void 0, runtime.proxyUrl || void 0), maxBuffer: 8 << 20 },
                (err, stdout, stderr) => {
                  resolve3({ code: err ? 1 : 0, out: `${stdout ?? ""}
${stderr ?? ""}` });
                }
              );
            }),
            log: (m, ...rest) => log(m, ...rest)
          });
          cachedReadiness = null;
          qwenCheckCache = null;
          invalidateSizeCache();
          if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error ?? r.message, result: r });
          return sendJson(res, 200, { ok: true, result: r });
        }
        if (isRecorder && pathname === "/api/recorder/asr/install") {
          const wantModel = String(body.model ?? runtime.asrModel);
          if (wantModel === "qwen3-asr" || body.withQwen === true) {
            const qr = await installQwen({
              basePython: funasrPython ?? blePython ?? "python",
              outDir,
              modelDir: qwenDir,
              modelName: config.qwenModelName,
              pipIndex: typeof body.pipIndex === "string" ? body.pipIndex : "https://pypi.tuna.tsinghua.edu.cn/simple",
              proxyUrl: runtime.proxyUrl || void 0,
              log,
              onProgress: (stage, message) => log(`[\u5B89\u88C5 ${stage}] ${message}`)
            });
            if (!qr.ok) {
              return sendJson(res, 500, { ok: false, error: qr.error, steps: qr.steps });
            }
            cachedQwenStatus = { ok: true, at: (/* @__PURE__ */ new Date()).toISOString(), modelPath: qr.modelPath };
            const qStatus = await readiness(true).catch(() => null);
            if (qStatus) cachedReadiness = qStatus;
            return sendJson(res, 200, { ok: true, status: cachedReadiness, qwen: cachedQwenStatus });
          }
          await funasrWorker.ensureStarted();
          const r = await installFunasr(funasrWorker, {
            // qwen 模式下 FunASR 只当分离前端，装它自己那套 paraformer 即可
            device: body.device ?? runtime.asrDevice,
            model: wantModel === "qwen3-asr" ? "paraformer-zh" : wantModel
          });
          cachedReadiness = r;
          return sendJson(res, 200, { ok: true, status: r, qwen: cachedQwenStatus });
        }
        if (isRecorder && pathname === "/api/recorder/session") {
          const rec = sessions.open({
            id: typeof body.sessionId === "string" ? body.sessionId : void 0,
            source: "realtime",
            language: typeof body.language === "string" ? body.language : runtime.language
          });
          return sendJson(res, 200, { ok: true, session: sessions.get(rec.id) });
        }
        if (isRecorder && (pathname === "/api/recorder/audio" || pathname === "/api/qs668/transcribe")) {
          const hintRaw = String(body.ext ?? body.codec ?? "auto").toLowerCase();
          const hint = hintRaw === "opus" || hintRaw === "ogg" || hintRaw === "wav" ? hintRaw : "auto";
          const out = await recognize({
            bytes: b64ToBytes(body.audioBase64 ?? body.audio),
            hint,
            source: "upload",
            sessionId: typeof body.sessionId === "string" ? body.sessionId : void 0,
            language: typeof body.language === "string" ? body.language : void 0
          });
          return sendJson(res, 200, {
            ok: true,
            sessionId: out.sessionId,
            text: out.text,
            segments: out.segments,
            durationMs: out.durationMs,
            model: out.model,
            device: out.device,
            markdown: out.markdownPath,
            audio: out.audioPath
          });
        }
        if (isRecorder && pathname === "/api/recorder/batch") {
          const items = Array.isArray(body.items) ? body.items : [];
          if (!items.length) return sendJson(res, 400, { ok: false, error: "items \u4E3A\u7A7A" });
          const results = [];
          for (const item of items) {
            try {
              const out = await recognize({
                bytes: b64ToBytes(item.audioBase64),
                hint: String(item.ext ?? "auto").toLowerCase() ?? "auto",
                source: "upload",
                language: typeof item.language === "string" ? item.language : void 0
              });
              results.push({ name: item.name, ok: true, sessionId: out.sessionId, text: out.text });
            } catch (e) {
              results.push({ name: item.name, ok: false, error: e instanceof Error ? e.message : String(e) });
            }
          }
          return sendJson(res, 200, { ok: true, results });
        }
        if (isRecorder && pathname === "/api/recorder/ble/setup") {
          const st = await ensureBle();
          return sendJson(res, st.ok ? 200 : 500, { ok: st.ok, error: st.error ?? null, python: ble.python, bleak: ble.bleakVersion });
        }
        if (isRecorder && pathname === "/api/recorder/ble/scan") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          const action = String(body.action ?? "start");
          if (action === "stop") {
            stopScan("\u5DF2\u505C\u6B62\u626B\u63CF");
            return sendJson(res, 200, { ok: true, scan: scanState });
          }
          if (scanState.running) return sendJson(res, 200, { ok: true, scan: scanState, note: "\u5DF2\u5728\u626B\u63CF\u4E2D" });
          const roundMs = typeof body.roundMs === "number" ? Math.max(1e3, Math.min(2e4, body.roundMs)) : 3e3;
          const timeoutMs = typeof body.timeoutMs === "number" ? Math.max(0, body.timeoutMs) : 12e4;
          const autoConnect = body.autoConnect !== false;
          void scanLoop({ roundMs, autoConnect, timeoutMs });
          log(`\u5F00\u59CB\u626B\u63CF\u8BBE\u5907\uFF08\u6BCF\u8F6E ${roundMs}ms\uFF0C\u81EA\u52A8\u8FDE\u63A5${autoConnect ? "\u5F00" : "\u5173"}\uFF09`);
          return sendJson(res, 200, { ok: true, scan: scanState });
        }
        if (isRecorder && pathname === "/api/recorder/ble/known") {
          if (body.forget) {
            const removed = knownDevices.forget(String(body.forget));
            return sendJson(res, 200, { ok: true, removed, items: knownDevices.list() });
          }
          return sendJson(res, 200, { ok: true, items: knownDevices.list() });
        }
        if (isRecorder && pathname === "/api/recorder/ble/connect") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          if (typeof body.address !== "string" || !body.address) return sendJson(res, 400, { ok: false, error: "\u7F3A\u5C11 address" });
          stopScan();
          const dev = scanState.devices.find((d) => d.address === body.address);
          return sendJson(res, 200, {
            ok: true,
            ...await connectAndRemember(body.address, typeof body.retries === "number" ? body.retries : 5, dev)
          });
        }
        if (isRecorder && pathname === "/api/recorder/ble/disconnect") {
          await ble.disconnect();
          await finalizeLive("\u624B\u52A8\u65AD\u5F00");
          return sendJson(res, 200, { ok: true });
        }
        if (isRecorder && pathname === "/api/recorder/ble/battery") {
          return sendJson(res, 200, { ok: true, level: await ble.queryBattery() });
        }
        if (isRecorder && pathname === "/api/recorder/ble/timesync") {
          await ble.timesync();
          return sendJson(res, 200, { ok: true, synced: true });
        }
        if (isRecorder && pathname === "/api/recorder/ble/delete") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          if (typeof body.name !== "string" || !body.name.trim()) {
            return sendJson(res, 400, { ok: false, error: "\u7F3A\u5C11 name" });
          }
          const r = await ble.deleteFile(
            body.name.trim(),
            typeof body.time === "number" ? body.time : 0,
            typeof body.size === "number" ? body.size : 0,
            typeof body.raw === "string" ? body.raw : void 0
          );
          log(`\u5DF2\u5220\u9664\u8BBE\u5907\u6587\u4EF6 ${body.name}\uFF08payload=${String(r.format ?? "?")}\uFF0C\u6838\u5BF9=${String(r.verified ?? "?")}\uFF09`);
          return sendJson(res, 200, { ok: true, ...r });
        }
        if (isRecorder && pathname === "/api/recorder/ble/download") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          if (typeof body.name !== "string" || !body.name.trim()) return sendJson(res, 400, { ok: false, error: "\u7F3A\u5C11 name" });
          const dl = await ble.download(body.name.trim(), {
            prefer: downloadPrefer(),
            // 分片/offset 续传参数：断点续传探测与实现都走这里
            chunkBytes: typeof body.chunkBytes === "number" ? body.chunkBytes : void 0,
            chunkTime: typeof body.chunkTime === "number" ? body.chunkTime : void 0
          });
          const out = await recognize({
            bytes: b64ToBytes(dl.data),
            hint: dl.ext === "wav" ? "wav" : "opus",
            source: "file",
            deviceFile: dl.name,
            recordedAt: deviceFileTime(dl.name)?.toISOString(),
            device: { address: ble.address ?? void 0 },
            language: typeof body.language === "string" ? body.language : void 0
          });
          return sendJson(res, 200, {
            ok: true,
            file: { name: dl.name, ext: dl.ext, size: dl.size, chunks: dl.chunks ?? 1 },
            ...out
          });
        }
        if (isRecorder && pathname === "/api/recorder/ble/realtime") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          const action = String(body.action ?? "");
          if (action === "start") {
            if (live) return sendJson(res, 409, { ok: false, error: "\u5DF2\u6709\u5B9E\u65F6\u8F6C\u5199\u5728\u8FD0\u884C: " + live.sessionId });
            const rec = sessions.open({
              id: typeof body.sessionId === "string" ? body.sessionId : void 0,
              source: "realtime",
              language: typeof body.language === "string" ? body.language : runtime.language,
              device: { address: ble.address ?? void 0 }
            });
            await engine.openStream(rec.id);
            live = { sessionId: rec.id, chunks: [], buffered: 0, total: 0, feeding: false, archiveChunks: [], closed: false };
            try {
              await ble.realtime("start", {
                windowMs: typeof body.windowMs === "number" ? body.windowMs : 1e3
              });
            } catch (e) {
              await finalizeLive("\u542F\u52A8\u5931\u8D25");
              throw e;
            }
            return sendJson(res, 200, { ok: true, live: true, sessionId: rec.id, events: streamPathFor(rec.id) });
          }
          if (action === "stop") {
            await ble.realtime("stop").catch((e) => log("\u53D1\u9001 stop \u5931\u8D25:", String(e)));
            const sid = live?.sessionId ?? null;
            await finalizeLive("\u624B\u52A8\u505C\u6B62");
            return sendJson(res, 200, { ok: true, live: false, sessionId: sid });
          }
          if (action === "pause" || action === "resume") {
            await ble.realtime(action);
            return sendJson(res, 200, { ok: true, action });
          }
          return sendJson(res, 400, { ok: false, error: "action \u9700\u4E3A start|stop|pause|resume" });
        }
        if (isRecorder && pathname === "/api/recorder/ble/sync") {
          const st = await ensureBle();
          if (!st.ok) return sendJson(res, 500, { ok: false, error: st.error });
          const result = await runSync({
            deleteAfter: typeof body.deleteAfter === "boolean" ? body.deleteAfter : void 0,
            force: typeof body.force === "boolean" ? body.force : void 0
          });
          return sendJson(res, 200, { ok: true, sync: result, lastSyncAt: syncState.lastSyncAt });
        }
        return sendJson(res, 404, { ok: false, error: "unknown POST " + pathname });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("\u8DEF\u7531\u9519\u8BEF", pathname, msg);
        return sendJson(res, 500, { ok: false, error: msg });
      }
    };
    const disposeAttachNotes = ctx.effect(() => {
      const tools = ctx.get("tools");
      if (tools === void 0) return () => {
      };
      return tools.register({
        name: "recorder_attach_notes",
        description: "\u628A\u6574\u7406\u597D\u7684\u7EAA\u8981 Markdown \u5173\u8054\u5230\u67D0\u6761\u5F55\u97F3\u5361\u7684\u5F55\u97F3\u4E0A\u3002\u8C03\u7528\u540E\u8FD9\u4EFD\u6587\u6863\u4F1A\u51FA\u73B0\u5728\u5F55\u97F3\u5361\u9762\u677F\u7684\u300C\u7EAA\u8981\u67E5\u770B\u300D\u9875\u3002\u4E00\u6761\u5F55\u97F3\u53EF\u4EE5\u5173\u8054\u591A\u4EFD\u6587\u6863\uFF08\u4F8B\u5982\u540C\u4E00\u6BB5\u5F55\u97F3\u91CC\u8BB2\u4E86\u591A\u4E2A\u4E3B\u9898\uFF0C\u5206\u522B\u4EA7\u51FA\u591A\u4EFD\u7EAA\u8981\uFF09\u3002\u6807\u9898\u76F8\u540C\u4F1A\u8986\u76D6\u4E0A\u4E00\u4EFD\u3002",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "\u5F55\u97F3\u7684\u4F1A\u8BDD id\uFF0C\u5F62\u5982 session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\u3002\u5728\u5F55\u97F3\u5185\u5BB9\u91CC\u4F1A\u7ED9\u51FA\u3002"
            },
            title: { type: "string", description: "\u8FD9\u4EFD\u7EAA\u8981\u7684\u6807\u9898\uFF0C\u540C\u65F6\u7528\u4F5C\u6587\u4EF6\u540D\u3002" },
            markdown: { type: "string", description: "\u7EAA\u8981\u6B63\u6587\uFF0CMarkdown \u683C\u5F0F\u3002" }
          },
          required: ["sessionId", "title", "markdown"],
          additionalProperties: false
        },
        output: {
          schema: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              sessionId: { type: "string" },
              title: { type: "string" },
              path: { type: "string" }
            },
            required: ["ok", "sessionId", "title", "path"]
          },
          render(_args, value) {
            const v = value;
            return [{ type: "text", text: `\u5DF2\u5173\u8054\u7EAA\u8981\u300C${v.title ?? ""}\u300D\u2192 ${v.path ?? ""}` }];
          }
        },
        async execute(args) {
          const a = args;
          if (!a.sessionId || !a.title || !a.markdown) {
            throw new Error("sessionId / title / markdown \u4E09\u4E2A\u53C2\u6570\u90FD\u5FC5\u586B");
          }
          const r = saveNote(outDir, a.sessionId, a.title, a.markdown);
          if (!r.ok) throw new Error(r.error);
          log(`\u7EAA\u8981\u5DF2\u5173\u8054\u5230\u5F55\u97F3 ${a.sessionId}\uFF1A\u300C${r.doc.title}\u300D\u2192 ${r.doc.path}`);
          return { ok: true, sessionId: a.sessionId, title: r.doc.title, path: r.doc.path };
        }
      });
    });
    const disposeRecorder = ctx.webServer.register({ kind: "prefix", path: "/api/recorder", handler });
    const disposeQs668 = ctx.webServer.register({ kind: "prefix", path: "/api/qs668", handler });
    log(`\u5DF2\u6302\u8F7D /api/recorder, /api/qs668\uFF08outDir=${outDir}\uFF0Cpython=${funasrPython ?? "\u672A\u63A2\u6D4B\u5230"}\uFF09`);
    void readiness().catch((e) => log("\u5C31\u7EEA\u63A2\u6D4B\u5931\u8D25:", String(e)));
    if (runtime.autoTitle) {
      setTimeout(() => {
        try {
          const n = sessions.backfillTitles(runtime.titleMaxChars);
          if (n > 0) {
            for (const row of sessions.list()) refreshMarkdown(row.id);
            log(`\u5386\u53F2\u4F1A\u8BDD\u8865\u6807\u9898\u5E76\u6539\u540D\uFF1A${n} \u6761\uFF08Markdown \u5DF2\u540C\u6B65\u91CD\u5199\uFF09`);
          }
        } catch (e) {
          log("\u5386\u53F2\u4F1A\u8BDD\u8865\u6807\u9898\u5931\u8D25\uFF08\u5FFD\u7565\uFF09:", String(e));
        }
      }, 1500);
    }
    setTimeout(() => {
      try {
        let fixed = 0;
        for (const row of sessions.list()) {
          const rec = sessions.get(row.id);
          if (!rec || rec.source !== "file" || !rec.deviceFile) continue;
          const t = deviceFileTime(rec.deviceFile);
          if (!t) continue;
          const prev = new Date(rec.createdAt).getTime();
          if (Number.isFinite(prev) && Math.abs(prev - t.getTime()) < 6e4) continue;
          sessions.setRecordedAt(row.id, t.toISOString());
          if (!rec.transcript && rec.titleSource === "auto") {
            sessions.setTitle(row.id, fallbackTitle(t.toISOString()), "auto");
          }
          fixed += 1;
        }
        if (fixed > 0) log(`\u4FEE\u6B63\u79BB\u7EBF\u5F55\u97F3\u7684\u5F55\u5236\u65F6\u95F4\uFF1A${fixed} \u6761\uFF08\u53D6\u81EA\u8BBE\u5907\u6587\u4EF6\u540D\uFF09`);
      } catch (e) {
        log("\u4FEE\u6B63\u5F55\u5236\u65F6\u95F4\u5931\u8D25\uFF08\u5FFD\u7565\uFF09:", String(e));
      }
    }, 1800);
    setTimeout(() => {
      try {
        let healed = 0;
        for (const row of sessions.list()) {
          const before = sessions.get(row.id)?.title;
          const after = sessions.refreshAutoTitle(row.id, runtime.titleMaxChars);
          if (after && after.title !== before) healed += 1;
        }
        if (healed > 0) log(`\u6807\u9898\u81EA\u6108\uFF1A${healed} \u6761\uFF08\u65F6\u95F4\u515C\u5E95\u540D \u2192 \u6309\u8F6C\u5199\u5185\u5BB9\u53D6\u540D\uFF09`);
      } catch (e) {
        log("\u6807\u9898\u81EA\u6108\u5931\u8D25\uFF08\u5FFD\u7565\uFF09:", String(e));
      }
    }, 2200);
    return () => {
      disposeRecorder?.();
      disposeQs668?.();
      disposed = true;
      stopScan("\u63D2\u4EF6\u5378\u8F7D\uFF0C\u626B\u63CF\u5DF2\u505C\u6B62");
      void finalizeLive("\u63D2\u4EF6\u5378\u8F7D");
      ble.dispose();
      void funasrWorker.dispose();
      disposeSelfCleanup();
      for (const r of activeSse) {
        try {
          r.end();
        } catch {
        }
      }
      activeSse.clear();
      log("\u5DF2\u5378\u8F7D");
    };
  }, "dsh-ai-recorder: api");
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
