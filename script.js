// =====================================================
// ESTIFY • EXCEPTIONAL ATTRIBUTES ENGINE
// Model = one sofa template
// Variant = colour + configuration
// Price = base + colour extra + config extra + exceptional correction
//
// Goal:
// 1) Keep the shared additive model as the default.
// 2) Detect rows that do not fit the additive model.
// 3) Solve those rows with an exceptional attribute matrix.
// 4) Keep validation exact to the paisa using integer cents/paise math.
// =====================================================

let material_master = [];
let price_sheet = [];

window.estifyPlans = {};
window.estifyCurrentPlan = null;

// =====================================================
// LOAD DATA
// =====================================================
async function loadData() {
  if (material_master.length && price_sheet.length) return;

  const [mRes, pRes] = await Promise.all([
    fetch("./material_master.json"),
    fetch("./price_sheet.json")
  ]);

  if (!mRes.ok) throw new Error("material_master.json failed to load");
  if (!pRes.ok) throw new Error("price_sheet.json failed to load");

  material_master = await mRes.json();
  price_sheet = await pRes.json();
}

// =====================================================
// HELPERS
// =====================================================
function normalize(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>\"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function formatValue(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))
    : "—";
}

function formatPrecise(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n)
    : "—";
}

function pickEl(...ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function showToast(message) {
  const old = document.querySelector(".estify-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = "estify-toast";
  toast.textContent = message;

  Object.assign(toast.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    padding: "14px 18px",
    background: "rgba(15,23,42,.95)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "16px",
    color: "#fff",
    zIndex: "999999",
    boxShadow: "0 20px 60px rgba(0,0,0,.45)"
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("Copied to clipboard"),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  showToast("Copied to clipboard");
}

function isRawLine(input) {
  const text = String(input || "").trim();
  return text.length > 0 && !text.includes("(") && !text.includes(")");
}

function isMaterialCode(value) {
  const v = normalize(value);
  return material_master.some(m => normalize(m.code) === v);
}

function looksLikeConfig(value) {
  const v = normalize(value);

  return (
    /^\d+(\.\d+)?(X\d+)?([A-Z]+)?$/.test(v) ||
    /^\d+X\d+([A-Z]+)?$/.test(v) ||
    /^[A-Z]?\d+(\.\d+)?S$/.test(v) ||
    /^[A-Z]?\d+(\.\d+)?SS$/.test(v) ||
    (/^[A-Z]{1,4}\d+[A-Z0-9\-_/]*$/.test(v) && !isMaterialCode(v)) ||
    v.includes("+") ||
    /^LHF$/i.test(v) ||
    /^RHF$/i.test(v) ||
    /^LF$/i.test(v) ||
    /^RF$/i.test(v) ||
    /^NS$/i.test(v) ||
    /^WB$/i.test(v) ||
    /^BF$/i.test(v) ||
    /^U$/i.test(v) ||
    /^CM$/i.test(v) ||
    /^BFU$/i.test(v) ||
    /^WBF$/i.test(v) ||
    /^RFSTB$/i.test(v)
  );
}

function chooseMostCommon(values) {
  const counts = new Map();
  const order = [];

  for (const v of values) {
    if (!counts.has(v)) order.push(v);
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  return order.sort((a, b) => {
    const diff = (counts.get(b) || 0) - (counts.get(a) || 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0];
}

function toPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromPaise(paise) {
  return paise / 100;
}

// =====================================================
// PARSER
// =====================================================
function extractCode(fabricPart) {
  const text = normalize(fabricPart);

  const sortedCodes = material_master
    .map(m => normalize(m.code))
    .sort((a, b) => b.length - a.length);

  for (const code of sortedCodes) {
    if (
      text === code ||
      text.startsWith(code + "-") ||
      text.startsWith(code + " ")
    ) {
      return code;
    }
  }

  return text.split("-")[0];
}

function parseVariant(input) {
  input = String(input || "").trim().replace(/\s+/g, " ");

  // RAW FORMAT
  if (isRawLine(input)) {
    const tokens = input.split(" ").filter(Boolean);

    if (tokens.length < 2) {
      throw new Error(`Unable to parse raw format: ${input}`);
    }

    const model = tokens.shift().trim();
    const config = tokens.join(" ").trim().toUpperCase();

    return {
      model: normalize(model),
      code: /BED/i.test(model) ? "BED" : "RAW",
      config
    };
  }

  // BRACKET FORMAT
  const brackets = input.match(/\(([^()]*)\)/g);

  if (!brackets || brackets.length < 2) {
    throw new Error(`Invalid bracket format: ${input}`);
  }

  const prefix = brackets[0].replace(/[()]/g, "").trim();
  const afterPrefix = input.split(")")[1]?.trim() || "";
  const modelName = afterPrefix.split(" ")[0];
  const model = `${prefix}-${modelName}`;

  const last = brackets[brackets.length - 1].replace(/[()]/g, "").trim();

  let fabricPart = "";
  let configPart = "";

  if (last.includes(",")) {
    const split = last.split(",");
    fabricPart = split[0]?.trim() || "";
    configPart = split[1]?.trim() || "";
  } else {
    const pieces = last.split(" ").filter(Boolean);
    if (pieces.length < 2) {
      throw new Error(`Invalid fabric/config structure: ${input}`);
    }
    fabricPart = pieces[0].trim();
    configPart = pieces.slice(1).join(" ").trim();
  }

  // Smart swap if reversed
  if (isMaterialCode(configPart) && !isMaterialCode(fabricPart)) {
    [fabricPart, configPart] = [configPart, fabricPart];
  } else if (looksLikeConfig(fabricPart) && !looksLikeConfig(configPart)) {
    [fabricPart, configPart] = [configPart, fabricPart];
  }

  const code = extractCode(fabricPart);

  return {
    model: normalize(model),
    code: normalize(code),
    config: normalize(configPart)
  };
}

// =====================================================
// GRADE
// =====================================================
function getGrade(code) {
  const safeCode = normalize(code);

  if (
    !safeCode ||
    safeCode === "DEFAULT" ||
    safeCode === "RAW" ||
    safeCode === "BED"
  ) {
    return "DEFAULT";
  }

  const item = material_master.find(m => normalize(m.code) === safeCode);

  if (!item) {
    console.warn(`Unknown material code: ${safeCode}`);
    return "DEFAULT";
  }

  return normalize(item.grade || "DEFAULT");
}

// =====================================================
// PRICE LOOKUP
// =====================================================
function getFinalPrice(model, config, grade) {
  const safeModel = normalize(model);
  const safeConfig = normalize(config);
  const safeGrade = normalize(grade || "DEFAULT");

  const findRow = (cfg) => {
    const normalizedCfg = normalize(cfg);

    let row = price_sheet.find(p =>
      normalize(p.model) === safeModel &&
      normalize(p.config) === normalizedCfg &&
      normalize(p.grade || "DEFAULT") === safeGrade
    );
    if (row) return row;

    row = price_sheet.find(p =>
      normalize(p.model) === safeModel &&
      normalize(p.config) === normalizedCfg
    );
    if (row) return row;

    return null;
  };

  if (safeConfig.includes("+")) {
    return safeConfig.split("+").reduce((sum, part) => {
      const row = findRow(part);
      if (!row) {
        throw new Error(`Missing config part price: ${part}`);
      }
      return sum + Number(row.price);
    }, 0);
  }

  const item = findRow(safeConfig);
  if (!item) {
    throw new Error(`Price not found: ${safeModel} | ${safeConfig} | ${safeGrade}`);
  }

  return Number(item.price);
}

// =====================================================
// SOLVERS
// =====================================================
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => row.slice().concat([b[i]]));

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) {
        pivot = r;
      }
    }

    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error("Underdetermined system");
    }

    if (pivot !== col) {
      [M[pivot], M[col]] = [M[col], M[pivot]];
    }

    const div = M[col][col];
    for (let c = col; c <= n; c++) {
      M[col][c] /= div;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (!factor) continue;

      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map(row => row[n]);
}

function solveLeastSquares(X, y) {
  const m = X.length;
  const n = X[0].length;

  const XtX = Array.from({ length: n }, () => Array(n).fill(0));
  const Xty = Array(n).fill(0);

  for (let i = 0; i < m; i++) {
    for (let a = 0; a < n; a++) {
      const xa = X[i][a];
      Xty[a] += xa * y[i];

      for (let b = 0; b < n; b++) {
        XtX[a][b] += xa * X[i][b];
      }
    }
  }

  // tiny stabilizer
  for (let i = 0; i < n; i++) {
    XtX[i][i] += 1e-8;
  }

  return solveLinearSystem(XtX, Xty);
}

function buildAdditiveModel(results, tolerancePaise = 1) {
  if (!results?.length) return null;

  const model = results[0].model;

  const colourCounts = {};
  const configCounts = {};

  for (const r of results) {
    colourCounts[r.code] = (colourCounts[r.code] || 0) + 1;
    configCounts[r.config] = (configCounts[r.config] || 0) + 1;
  }

  const colours = [...new Set(results.map(r => r.code))].sort((a, b) => {
    const diff = (colourCounts[b] || 0) - (colourCounts[a] || 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const configs = [...new Set(results.map(r => r.config))].sort((a, b) => {
    const diff = (configCounts[b] || 0) - (configCounts[a] || 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const anchorColour = chooseMostCommon(colours);
  const anchorConfig = chooseMostCommon(configs);

  const colourVars = colours.filter(c => c !== anchorColour);
  const configVars = configs.filter(k => k !== anchorConfig);

  const colourIndex = new Map(colourVars.map((c, i) => [c, i]));
  const configIndex = new Map(configVars.map((k, i) => [k, i]));

  const X = [];
  const y = [];

  for (const r of results) {
    const row = new Array(1 + colourVars.length + configVars.length).fill(0);
    row[0] = 1;

    if (r.code !== anchorColour && colourIndex.has(r.code)) {
      row[1 + colourIndex.get(r.code)] = 1;
    }

    if (r.config !== anchorConfig && configIndex.has(r.config)) {
      row[1 + colourVars.length + configIndex.get(r.config)] = 1;
    }

    X.push(row);
    y.push(toPaise(r.price));
  }

  const beta = solveLeastSquares(X, y);
  const basePaise = Math.round(beta[0]);

  const colourExtrasPaise = { [anchorColour]: 0 };
  colourVars.forEach((c, i) => {
    colourExtrasPaise[c] = Math.round(beta[1 + i]);
  });

  const configExtrasPaise = { [anchorConfig]: 0 };
  configVars.forEach((k, i) => {
    configExtrasPaise[k] = Math.round(beta[1 + colourVars.length + i]);
  });

  const validation = results.map(r => {
    const predictedPaise =
      basePaise +
      (colourExtrasPaise[r.code] || 0) +
      (configExtrasPaise[r.config] || 0);

    const actualPaise = toPaise(r.price);
    const diffPaise = predictedPaise - actualPaise;

    return {
      ...r,
      actualPaise,
      predictedPaise,
      diffPaise,
      fits: Math.abs(diffPaise) <= tolerancePaise,
      status: Math.abs(diffPaise) <= tolerancePaise ? "EXACT" : "MISMATCH"
    };
  });

  return {
    type: "additive",
    model,
    grade: results[0].grade,
    anchorColour,
    anchorConfig,
    basePaise,
    basePrice: fromPaise(basePaise),
    colourExtrasPaise,
    configExtrasPaise,
    validation,
    tolerancePaise
  };
}

function buildExceptionalModel(results, additivePlan, tolerancePaise = 1) {
  if (!results?.length) return null;

  const exceptional = [];
  const matrix = new Map();

  for (const r of results) {
    const key = `${normalize(r.code)}||${normalize(r.config)}`;
    const actualPaise = toPaise(r.price);
    const additivePredictedPaise =
      additivePlan.basePaise +
      (additivePlan.colourExtrasPaise[r.code] || 0) +
      (additivePlan.configExtrasPaise[r.config] || 0);

    const residualPaise = actualPaise - additivePredictedPaise;

    if (Math.abs(residualPaise) > tolerancePaise) {
      matrix.set(key, residualPaise);
      exceptional.push({
        code: r.code,
        config: r.config,
        actualPaise,
        additivePredictedPaise,
        residualPaise
      });
    }
  }

  const validation = results.map(r => {
    const key = `${normalize(r.code)}||${normalize(r.config)}`;
    const correctionPaise = matrix.get(key) || 0;
    const predictedPaise =
      additivePlan.basePaise +
      (additivePlan.colourExtrasPaise[r.code] || 0) +
      (additivePlan.configExtrasPaise[r.config] || 0) +
      correctionPaise;

    const actualPaise = toPaise(r.price);
    const diffPaise = predictedPaise - actualPaise;

    return {
      ...r,
      actualPaise,
      predictedPaise,
      diffPaise,
      correctionPaise,
      fits: Math.abs(diffPaise) <= tolerancePaise,
      status: Math.abs(diffPaise) <= tolerancePaise ? "EXACT" : "MISMATCH"
    };
  });

  return {
    type: "exceptional",
    model: additivePlan.model,
    grade: additivePlan.grade,
    anchorColour: additivePlan.anchorColour,
    anchorConfig: additivePlan.anchorConfig,
    basePaise: additivePlan.basePaise,
    basePrice: fromPaise(additivePlan.basePaise),
    colourExtrasPaise: additivePlan.colourExtrasPaise,
    configExtrasPaise: additivePlan.configExtrasPaise,
    exceptionalMatrixPaise: matrix,
    exceptionalRows: exceptional,
    validation,
    tolerancePaise,
    additivePlan
  };
}

function generateUnifiedPlan(results, tolerancePaise = 1) {
  if (!results?.length) return null;

  const additivePlan = buildAdditiveModel(results, tolerancePaise);
  if (!additivePlan) return null;

  const exceptionalPlan = buildExceptionalModel(results, additivePlan, tolerancePaise);

  const mismatchCount = exceptionalPlan.validation.filter(v => !v.fits).length;
  const maxDiffPaise = exceptionalPlan.validation.reduce(
    (m, v) => Math.max(m, Math.abs(v.diffPaise || 0)),
    0
  );

  return {
    ...exceptionalPlan,
    mismatchCount,
    maxDiffPaise,
    pricingMode: exceptionalPlan.exceptionalRows.length > 0
      ? "ADDITIVE + EXCEPTIONAL CORRECTIONS"
      : "SHARED ADDITIVE",
    forcedExact: mismatchCount > 0
  };
}

function generatePlans(results) {
  const grouped = {};

  for (const r of results) {
    const key = normalize(r.model);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const plans = {};

  for (const [key, rows] of Object.entries(grouped)) {
    const plan = generateUnifiedPlan(rows, 1);
    if (plan) {
      plan.model = key;
      plan.groupKey = key;
    }
    plans[key] = plan;
  }

  return plans;
}

// =====================================================
// SAFE LOOKUP HELPERS
// =====================================================
function getFinalPrice(model, config, grade) {
  const safeModel = normalize(model);
  const safeConfig = normalize(config);
  const safeGrade = normalize(grade || "DEFAULT");

  const findRow = (cfg) => {
    const normalizedCfg = normalize(cfg);

    let row = price_sheet.find(p =>
      normalize(p.model) === safeModel &&
      normalize(p.config) === normalizedCfg &&
      normalize(p.grade || "DEFAULT") === safeGrade
    );
    if (row) return row;

    row = price_sheet.find(p =>
      normalize(p.model) === safeModel &&
      normalize(p.config) === normalizedCfg
    );
    if (row) return row;

    return null;
  };

  if (safeConfig.includes("+")) {
    return safeConfig.split("+").reduce((sum, part) => {
      const row = findRow(part);
      if (!row) throw new Error(`Missing config part price: ${part}`);
      return sum + Number(row.price);
    }, 0);
  }

  const item = findRow(safeConfig);
  if (!item) {
    throw new Error(`Price not found: ${safeModel} | ${safeConfig} | ${safeGrade}`);
  }

  return Number(item.price);
}

// =====================================================
// UI HELPERS
// =====================================================
function renderRows(obj = {}, usePaise = false) {
  const entries = Object.entries(obj);

  if (!entries.length) {
    return `<tr><td colspan="2">No data</td></tr>`;
  }

  return entries.map(([k, v]) => {
    const amount = usePaise ? fromPaise(v) : Number(v);
    const signClass = amount > 0 ? "positive" : amount < 0 ? "negative" : "";
    return `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td class="${signClass}">₹ ${usePaise ? formatPrecise(amount) : formatValue(amount)}</td>
      </tr>
    `;
  }).join("");
}

function renderValidationRows(plan) {
  if (!plan || !plan.validation?.length) {
    return `<tr><td colspan="6">No validation data</td></tr>`;
  }

  return plan.validation.map(v => {
    const diffAmount = fromPaise(v.diffPaise || 0);
    return `
      <tr class="${v.fits ? "fit-row" : "mismatch-row"}">
        <td>${escapeHtml(v.model)}</td>
        <td>${escapeHtml(v.code)}</td>
        <td>${escapeHtml(v.config)}</td>
        <td>₹ ${formatPrecise(fromPaise(v.actualPaise))}</td>
        <td>₹ ${formatPrecise(fromPaise(v.predictedPaise))}</td>
        <td class="${v.fits ? "success" : "negative"}">
          ${v.fits ? "EXACT" : `₹ ${formatPrecise(diffAmount)}`}
        </td>
      </tr>
    `;
  }).join("");
}

function renderExceptionalRows(plan) {
  if (!plan?.exceptionalRows?.length) {
    return `<tr><td colspan="4">No exceptional corrections required</td></tr>`;
  }

  return plan.exceptionalRows.map(x => `
    <tr>
      <td>${escapeHtml(x.code)}</td>
      <td>${escapeHtml(x.config)}</td>
      <td>₹ ${formatPrecise(fromPaise(x.actualPaise))}</td>
      <td class="positive">₹ ${formatPrecise(fromPaise(x.residualPaise))}</td>
    </tr>
  `).join("");
}

// =====================================================
// PLAN OUTPUT
// =====================================================
function displayResults(data, plans) {
  const tbody = document.querySelector("#output tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  data.forEach(d => {
    const tr = document.createElement("tr");

    if (d.error) {
      tr.className = "error-row";
      tr.innerHTML = `<td colspan="6">${escapeHtml(d.error)}</td>`;
      tbody.appendChild(tr);
      return;
    }

    const key = normalize(d.model);
    const plan = plans[key];
    const extraPaise = toPaise(d.price) - (plan?.basePaise || 0);

    tr.innerHTML = `
      <td>${escapeHtml(d.model)}</td>
      <td>${escapeHtml(d.code)}</td>
      <td>${escapeHtml(d.grade)}</td>
      <td>${escapeHtml(d.config)}</td>
      
