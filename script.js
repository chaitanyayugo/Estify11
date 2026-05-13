// =====================================================
// ESTIFY EXCEPTIONAL ATTRIBUTE ENGINE
// =====================================================

let material_master = [];
let price_sheet = [];

async function loadData() {

  if (material_master.length && price_sheet.length) {
    return;
  }

  const [mRes, pRes] = await Promise.all([
    fetch("./material_master.json"),
    fetch("./price_sheet.json")
  ]);

  material_master = await mRes.json();
  price_sheet = await pRes.json();

}

// =====================================================
// HELPERS
// =====================================================

function normalize(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function format(v) {

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(v));

}

function escapeHtml(v) {

  return String(v || "").replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));

}

// =====================================================
// PARSER
// =====================================================

function extractCode(text) {

  text = normalize(text);

  const codes = material_master
    .map(m => normalize(m.code))
    .sort((a, b) => b.length - a.length);

  for (const code of codes) {

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

  const brackets = input.match(/\(([^()]*)\)/g);

  if (!brackets || brackets.length < 2) {
    throw new Error(`Invalid format: ${input}`);
  }

  const prefix = brackets[0]
    .replace(/[()]/g, "")
    .trim();

  const afterPrefix = input.split(")")[1].trim();

  const modelName = afterPrefix.split(" ")[0];

  const model = normalize(`${prefix}-${modelName}`);

  const last = brackets[brackets.length - 1]
    .replace(/[()]/g, "")
    .trim();

  let fabric = "";
  let config = "";

  if (last.includes(",")) {

    const parts = last.split(",");

    fabric = parts[0].trim();
    config = parts[1].trim();

  } else {

    const parts = last.split(" ");

    fabric = parts[0].trim();
    config = parts.slice(1).join(" ").trim();

  }

  return {
    model,
    code: extractCode(fabric),
    config: normalize(config)
  };

}

// =====================================================
// GRADE
// =====================================================

function getGrade(code) {

  code = normalize(code);

  const row = material_master.find(
    m => normalize(m.code) === code
  );

  if (!row) {
    return "DEFAULT";
  }

  return normalize(row.grade || "DEFAULT");

}

// =====================================================
// PRICE LOOKUP
// =====================================================

function getFinalPrice(model, config, grade) {

  model = normalize(model);
  config = normalize(config);
  grade = normalize(grade);

  const row = price_sheet.find(p => {

    return (
      normalize(p.model) === model &&
      normalize(p.config) === config &&
      normalize(p.grade || "DEFAULT") === grade
    );

  });

  if (!row) {

    throw new Error(
      `Price not found: ${model} | ${config} | ${grade}`
    );

  }

  return Number(row.price);

}

// =====================================================
// MATRIX SOLVER
// =====================================================

function generatePlans(results) {

  const grouped = {};

  for (const r of results) {

    if (!grouped[r.model]) {
      grouped[r.model] = [];
    }

    grouped[r.model].push(r);

  }

  const plans = {};

  for (const [model, rows] of Object.entries(grouped)) {

    plans[model] = generatePlan(rows);

  }

  return plans;

}

function generatePlan(rows) {

  const colours = [...new Set(rows.map(r => r.code))];
  const configs = [...new Set(rows.map(r => r.config))];

  const anchorColour = colours[0];
  const anchorConfig = configs[0];

  const colourExtras = {};
  const configExtras = {};

  colourExtras[anchorColour] = 0;
  configExtras[anchorConfig] = 0;

  const baseRow = rows[0];

  const basePrice = Number(baseRow.price);

  // =========================================
  // SIMPLE DISTRIBUTION
  // =========================================

  for (const row of rows) {

    if (!(row.code in colourExtras)) {

      colourExtras[row.code] =
        Number(row.price) - basePrice;

    }

    if (!(row.config in configExtras)) {

      configExtras[row.config] =
        Number(row.price) - basePrice;

    }

  }

  // =========================================
  // VALIDATION
  // =========================================

  const exceptional = {};

  const validation = rows.map(r => {

    let predicted =
      basePrice +
      (colourExtras[r.code] || 0) +
      (configExtras[r.config] || 0);

    let diff = Number(r.price) - predicted;

    // =====================================
    // EXCEPTIONAL FIX
    // =====================================

    if (Math.abs(diff) > 1) {

      const key = `${r.code}|${r.config}`;

      exceptional[key] = diff;

      predicted += diff;

    }

    return {
      ...r,
      predicted,
      diff,
      status: Math.abs(diff) <= 1
        ? "EXACT"
        : "EXCEPTION"
    };

  });

  return {
    basePrice,
    anchorColour,
    anchorConfig,
    colourExtras,
    configExtras,
    exceptional,
    validation
  };

}

// =====================================================
// UI
// =====================================================

function displayResults(results, plans) {

  const body =
    document.getElementById("output");

  body.innerHTML = "";

  results.forEach(r => {

    const plan = plans[r.model];

    const extra =
      Number(r.price) - Number(plan.basePrice);

    body.innerHTML += `
      <tr>
        <td>${escapeHtml(r.model)}</td>
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.grade)}</td>
        <td>${escapeHtml(r.config)}</td>
        <td>₹ ${format(r.price)}</td>
        <td class="${extra >= 0 ? "positive" : "negative"}">
          ₹ ${format(extra)}
        </td>
      </tr>
    `;

  });

}

function renderRows(obj) {

  return Object.entries(obj)
    .map(([k, v]) => {

      return `
        <tr>
          <td>${escapeHtml(k)}</td>
          <td class="${v >= 0 ? "positive" : "negative"}">
            ₹ ${format(v)}
          </td>
        </tr>
      `;

    })
    .join("");

}

function displayOdoo(plans) {

  const firstKey = Object.keys(plans)[0];

  if (!firstKey) return;

  const plan = plans[firstKey];

  document.getElementById(
    "colourOutputBody"
  ).innerHTML = renderRows(plan.colourExtras);

  document.getElementById(
    "configOutputBody"
  ).innerHTML = renderRows(plan.configExtras);

  // =========================================
  // EXCEPTION TABLE
  // =========================================

  const exceptionBody =
    document.getElementById(
      "exceptionOutputBody"
    );

  exceptionBody.innerHTML = "";

  const entries =
    Object.entries(plan.exceptional);

  if (!entries.length) {

    exceptionBody.innerHTML = `
      <tr>
        <td colspan="3">
          No exceptional corrections
        </td>
      </tr>
    `;

  } else {

    entries.forEach(([key, val]) => {

      const [code, config] = key.split("|");

      exceptionBody.innerHTML += `
        <tr>
          <td>${escapeHtml(code)}</td>
          <td>${escapeHtml(config)}</td>
          <td class="${
            val >= 0
              ? "positive"
              : "negative"
          }">
            ₹ ${format(val)}
          </td>
        </tr>
      `;

    });

  }

  // =========================================
  // VALIDATION TABLE
  // =========================================

  const validationBody =
    document.getElementById(
      "validationOutputBody"
    );

  validationBody.innerHTML = "";

  plan.validation.forEach(v => {

    validationBody.innerHTML += `
      <tr class="${
        v.status === "EXACT"
          ? "fit-row"
          : "mismatch-row"
      }">

        <td>${escapeHtml(v.model)}</td>

        <td>${escapeHtml(v.code)}</td>

        <td>${escapeHtml(v.config)}</td>

        <td>₹ ${format(v.price)}</td>

        <td>₹ ${format(v.predicted)}</td>

        <td class="${
          v.status === "EXACT"
            ? "success"
            : "negative"
        }">
          ${v.status}
        </td>

      </tr>
    `;

  });

}
