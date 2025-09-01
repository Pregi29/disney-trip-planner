/* ===========================
   Disney Trip Planner - script.js
   Full replacement: explicit table renderers, stable checkbox state,
   robust currency conversion helper, totals (USD/EUR).
   Paste this entire file over your current script.js
   =========================== */

/* ========== Globals & config helpers ========== */

// displayCurrency persists in localStorage
let displayCurrency = localStorage.getItem("displayCurrency") || "USD";
// selectedItems holds Airtable record ids of checked rows
const selectedItems = new Set();

// tolerant read of exchange rate constant from config.js (support multiple names)
function getUsdToEurRate() {
  // try multiple common names so we don't depend on exact config var name
  return (
    (typeof USD_TO_EUR !== "undefined" && USD_TO_EUR) ||
    (typeof EXCHANGE_RATE_USD_TO_EUR !== "undefined" &&
      EXCHANGE_RATE_USD_TO_EUR) ||
    (typeof EXCHANGE_RATE !== "undefined" && EXCHANGE_RATE) ||
    (typeof USD_TO_EUR_RATE !== "undefined" && USD_TO_EUR_RATE) ||
    0.92 // fallback
  );
}

// convert amount between USD <-> EUR using the rate above
function convert(amount, fromCurrency, toCurrency) {
  if (amount == null || isNaN(Number(amount))) return null;
  const a = Number(amount);
  const rate = Number(getUsdToEurRate());
  if (!rate || isNaN(rate)) return a;
  if (fromCurrency === toCurrency) return a;
  if (fromCurrency === "USD" && toCurrency === "EUR") return a * rate;
  if (fromCurrency === "EUR" && toCurrency === "USD") return a / rate;
  // if unknown currencies, return original
  return a;
}

function formatMoney(amount, currency) {
  if (amount == null || isNaN(Number(amount))) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

/* ========== Airtable fetch helper (keeps existing behavior) ========== */
async function fetchTable(tableName) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    tableName
  )}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Error fetching ${tableName}: HTTP ${response.status} ${response.statusText} ${errorText}`
      );
    }

    const data = await response.json();
    return data.records || [];
  } catch (error) {
    console.error(`fetchTable(${tableName}) failed:`, error);
    throw error;
  }
}



/* ========== Utility helpers used in renderers ========== */

// Generic sorting helper
function sortRecords(records, tableName) {
    return records.sort((a, b) => {
        const nameA = (a.fields["Resort Name"] || "").toLowerCase();
        const nameB = (b.fields["Resort Name"] || "").toLowerCase();

        // Primary sort: by name
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;

        // Secondary sort: by price (if available)
        const priceA = parseFloat(a.fields["Price (input)"]) || 0;
        const priceB = parseFloat(b.fields["Price (input)"]) || 0;
        return priceA - priceB;
    });
}

function pickField(record, names) {
  for (const n of names) {
    if (record.fields && record.fields[n] !== undefined) return record.fields[n];
  }
  return undefined;
}

/*function shortFamilyFromLookup(val) {
  if (!val) return "";
  let s = Array.isArray(val) ? val[0] : val;
  if (typeof s !== "string") s = String(s);
  // prefer the part before '+' or before ',' as short name
  if (s.includes("+")) return s.split("+")[0].trim();
  if (s.includes(",")) return s.split(",")[0].trim();
  return s.trim();
}*/

function shortFamilyNames(val) {
    if (!val) return "";
    const arr = Array.isArray(val) ? val : [val];
    return arr
      .map((s) => {
        if (typeof s !== "string") s = String(s);
        if (s.includes("+")) return s.split("+")[0].trim();
        if (s.includes(",")) return s.split(",")[0].trim();
        return s.trim();
      })
      .join(", ");
  }

function domainLabel(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

// keep radios synced to displayCurrency
function syncCurrencyRadios() {
  const radios = document.querySelectorAll('input[name="currency"]');
  radios.forEach((r) => {
    r.checked = r.value === displayCurrency;
  });
}

/* ========== RENDERERS (full table builders) ========== */

/* Families (simple card list) */
async function displayFamilies() {
  const container = document.getElementById("families-list");
  const loadingEl = document.getElementById("loading-families");
  const errorEl = document.getElementById("error-families");
  if (!container) return;
  if (loadingEl) loadingEl.style.display = "block";
  if (errorEl) errorEl.style.display = "none";

  try {
    const records = await fetchTable(AIRTABLE_TABLE_FAMILIES);
    if (!records || records.length === 0) {
      container.innerHTML = "<p>No families found.</p>";
      return;
    }
    container.innerHTML = records
      .map((r) => {
        const name = pickField(r, ["Name", "Family", "Family Name"]) || "Unnamed";
        return `<div class="card"><h3>${name}</h3></div>`;
      })
      .join("");
  } catch (err) {
    console.error("displayFamilies error:", err);
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load Families: ${err.message || err}`;
    }
    container.innerHTML = "";
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}

/* Resorts: full table with header + rows */
async function displayResorts() {
    const container = document.getElementById("resorts-list");
    const loadingEl = document.getElementById("loading-resorts");
    const errorEl = document.getElementById("error-resorts");
    if (!container) return;
    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";
  
    try {
      let records = await fetchTable(AIRTABLE_TABLE_RESORT);
      records = sortRecords(records, AIRTABLE_TABLE_RESORT);
      if (!records || records.length === 0) {
        container.innerHTML = "<p>No resorts found.</p>";
        return;
      }
  
      const header = `
        <div class="table-container">
          <table class="table-view">
            <thead>
              <tr>
                <th></th>
                <th>Resort</th>
                <th>Origin</th>
                <th>Price (${displayCurrency})</th>
                <th>Perks</th>
                <th>Families</th>
                <th>Booking</th>
              </tr>
            </thead>
            <tbody>
      `;
  
      const rows = records
        .map((r) => {
          const id = r.id;
          const name =
            pickField(r, ["Resort Name", "Name", "Resort"]) || "Unnamed Resort";
          const origin = pickField(r, ["Booking Origin", "Origin"]) || "";
          const priceRaw =
            pickField(r, ["Price input", "Price (input)", "Price", "Cost"]) ?? "";
          const currency = pickField(r, ["Currency", "currency"]) || "";
          const perks = pickField(r, ["Perks", "Notes", "Perks Notes"]) || "";
          const fams =
            pickField(r, [
              "Name (from Families included)",
              "Name (from Family)",
              "Families Included",
              "Families",
            ]) || [];
            const familiesIncluded = shortFamilyNames(fams);
  
          // compute numeric converted value using front-end convert
          let convertedNum = 0;
          let convertedStr = "—";
          if (priceRaw !== "" && currency) {
            const num = Number(priceRaw);
            if (!isNaN(num)) {
              convertedNum = convert(num, String(currency), displayCurrency) || 0;
              convertedStr = formatMoney(convertedNum, displayCurrency);
            }
          }
  
          const link = pickField(r, ["Link", "Booking Link"]) || "";
          let linkDisplay = "";
          if (link) {
            try {
              const url = new URL(link);
              linkDisplay = url.hostname.replace("www.", "");
            } catch {
              linkDisplay = link;
            }
          }
  
          return `
            <tr>
              <td>
                <input type="checkbox"
                       class="item-checkbox"
                       data-id="${id}"
                       data-amount="${priceRaw !== "" ? Number(priceRaw) : 0}"
                       data-currency="${currency || "USD"}"
                       ${selectedItems.has(id) ? "checked" : ""}>
              </td>
              <td>${name}</td>
              <td>${origin}</td>
              <td>${convertedStr}</td>
              <td>${perks}</td>
              <td>${familiesIncluded}</td>
              <td>
                ${
                  link
                    ? `<a href="${link}" target="_blank" class="btn-link">${linkDisplay}</a>`
                    : ""
                }
              </td>
            </tr>
          `;
        })
        .join("");
  
      const footer = `
            </tbody>
          </table>
        </div>
      `;
  
      container.innerHTML = header + rows + footer;
    } catch (err) {
      console.error("displayResorts error:", err);
      if (errorEl) {
        errorEl.style.display = "block";
        errorEl.textContent = `Failed to load Resorts: ${err.message || err}`;
      }
      container.innerHTML = "";
    } finally {
      if (loadingEl) loadingEl.style.display = "none";
    }
  }
/* Flights: full table with header + rows */
async function displayFlights() {
    const container = document.getElementById("flights-list");
    const loadingEl = document.getElementById("loading-flights");
    const errorEl = document.getElementById("error-flights");
    if (!container) return;
    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";
  
    try {
      let records = await fetchTable(AIRTABLE_TABLE_FLIGHTS);
      records = sortRecords(records, AIRTABLE_TABLE_FLIGHTS);
      if (!records || records.length === 0) {
        container.innerHTML = "<p>No flights found.</p>";
        return;
      }
  
      const header = `
        <div class="table-container">
          <table class="table-view">
            <thead>
              <tr>
                <th></th>
                <th>Family</th>
                <th>Airline</th>
                <th>From</th>
                <th>To</th>
                <th>Departure</th>
                <th>Return</th>
                <th>Price (${displayCurrency})</th>
                <th>Booking</th>
              </tr>
            </thead>
            <tbody>
      `;
  
      const rows = records
        .map((f) => {
          const id = f.id;
          const fams =
            pickField(f, ["Name (from Family)", "Family", "Families"]) || "";
            const family = shortFamilyNames(fams);
  
          const airline = pickField(f, ["Airline"]) || "";
          const origin = pickField(f, ["Origin", "From"]) || "";
          const dest = pickField(f, ["Destination", "To"]) || "";
  
          const dep = pickField(f, ["Departure Date"]) || "";
          const ret = pickField(f, ["Return Date"]) || "";
  
          const depShort = dep
            ? new Date(dep).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
              })
            : "";
          const retShort = ret
            ? new Date(ret).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
              })
            : "";
  
          const priceRaw = pickField(f, ["Price input", "Price"]) ?? "";
          const currency = pickField(f, ["Currency", "currency"]) || "";
  
          let convertedNum = 0;
          let convertedStr = "—";
          if (priceRaw !== "" && currency) {
            const num = Number(priceRaw);
            if (!isNaN(num)) {
              convertedNum =
                convert(num, String(currency), displayCurrency) || 0;
              convertedStr = formatMoney(convertedNum, displayCurrency);
            }
          }
  
          const link = pickField(f, ["Booking Link", "Link"]) || "";
          let linkDisplay = "";
          if (link) {
            try {
              const url = new URL(link);
              linkDisplay = url.hostname.replace("www.", "");
            } catch {
              linkDisplay = link;
            }
          }
  
          return `
            <tr>
              <td>
                <input type="checkbox"
                       class="item-checkbox"
                       data-id="${id}"
                       data-amount="${priceRaw !== "" ? Number(priceRaw) : 0}"
                       data-currency="${currency || "USD"}"
                       ${selectedItems.has(id) ? "checked" : ""}>
              </td>
              <td>${family}</td>
              <td>${airline}</td>
              <td>${origin}</td>
              <td>${dest}</td>
              <td>${depShort}</td>
              <td>${retShort}</td>
              <td>${convertedStr}</td>
              <td>
                ${
                  link
                    ? `<a href="${link}" target="_blank" class="btn-link">${linkDisplay}</a>`
                    : ""
                }
              </td>
            </tr>
          `;
        })
        .join("");
  
      const footer = `
            </tbody>
          </table>
        </div>
      `;
  
      container.innerHTML = header + rows + footer;
    } catch (err) {
      console.error("displayFlights error:", err);
      if (errorEl) {
        errorEl.style.display = "block";
        errorEl.textContent = `Failed to load Flights: ${err.message || err}`;
      }
      container.innerHTML = "";
    } finally {
      if (loadingEl) loadingEl.style.display = "none";
    }
  }

/* Extras: full table with header + rows */
async function displayExtras() {
    const container = document.getElementById("extras-list");
    const loadingEl = document.getElementById("loading-extras");
    const errorEl = document.getElementById("error-extras");
    if (!container) return;
    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";
  
    try {
      let records = await fetchTable(AIRTABLE_TABLE_EXTRAS);
      records = sortRecords(records, AIRTABLE_TABLE_EXTRAS);
      if (!records || records.length === 0) {
        container.innerHTML = "<p>No extras found.</p>";
        return;
      }
  
      const header = `
        <div class="table-container">
          <table class="table-view">
            <thead>
              <tr>
                <th></th>
                <th>Extra</th>
                <th>Notes</th>
                <th>Price (${displayCurrency})</th>
                <th>Booking</th>
              </tr>
            </thead>
            <tbody>
      `;
  
      const rows = records
        .map((e) => {
          const id = e.id;
          const name = pickField(e, ["Name"]) || "Unnamed Extra";
          const notes = pickField(e, ["Notes"]) || "";
  
          const priceRaw = pickField(e, ["Cost", "Price", "Price input"]) ?? "";
          const currency = pickField(e, ["Currency", "currency"]) || "";
  
          let convertedNum = 0;
          let convertedStr = "—";
          if (priceRaw !== "" && currency) {
            const num = Number(priceRaw);
            if (!isNaN(num)) {
              convertedNum = convert(num, String(currency), displayCurrency) || 0;
              convertedStr = formatMoney(convertedNum, displayCurrency);
            }
          }
  
          const link = pickField(e, ["Link", "Booking Link"]) || "";
          let linkDisplay = "";
          if (link) {
            try {
              const url = new URL(link);
              linkDisplay = url.hostname.replace("www.", "");
            } catch {
              linkDisplay = link;
            }
          }
  
          return `
            <tr>
              <td>
                <input type="checkbox"
                       class="item-checkbox"
                       data-id="${id}"
                       data-amount="${priceRaw !== "" ? Number(priceRaw) : 0}"
                       data-currency="${currency || "USD"}"
                       ${selectedItems.has(id) ? "checked" : ""}>
              </td>
              <td>${name}</td>
              <td>${notes}</td>
              <td>${convertedStr}</td>
              <td>
                ${
                  link
                    ? `<a href="${link}" target="_blank" class="btn-link">${linkDisplay}</a>`
                    : ""
                }
              </td>
            </tr>
          `;
        })
        .join("");
  
      const footer = `
            </tbody>
          </table>
        </div>
      `;
  
      container.innerHTML = header + rows + footer;
    } catch (err) {
      console.error("displayExtras error:", err);
      if (errorEl) {
        errorEl.style.display = "block";
        errorEl.textContent = `Failed to load Extras: ${err.message || err}`;
      }
      container.innerHTML = "";
    } finally {
      if (loadingEl) loadingEl.style.display = "none";
    }
  }

/* ========== Trip Total logic ========== */
/* Totals computed from raw amounts and currencies stored on checkboxes.
   We compute a USD baseline, then derive EUR, and display both.
*/
function updateTripTotal() {
  let totalUSD = 0;

  // Sum over currently checked boxes
  document.querySelectorAll(".item-checkbox:checked").forEach((cb) => {
    const amt = parseFloat(cb.getAttribute("data-amount")) || 0;
    const cur = cb.getAttribute("data-currency") || "USD";
    const usdVal = convert(amt, cur, "USD") || 0;
    totalUSD += usdVal;
  });

  const usdToEur = getUsdToEurRate();
  const totalEUR = totalUSD * Number(usdToEur || 0);

  const totalEl = document.getElementById("trip-total");
  if (totalEl) {
    totalEl.innerHTML = `<p>Total: <strong>${formatMoney(totalUSD, "USD")} | ${formatMoney(totalEUR, "EUR")}</strong></p>`;
  }
}

/* ========== Checkbox selection persistence ========== */
function onToggleItemCheckbox(cb) {
  const id = cb.getAttribute("data-id");
  if (!id) return;
  if (cb.checked) selectedItems.add(id);
  else selectedItems.delete(id);
}

/* ========== Event handling ========== */
document.addEventListener("change", (e) => {
  // checkbox toggled
  if (e.target && e.target.matches(".item-checkbox")) {
    onToggleItemCheckbox(e.target);
    updateTripTotal();
  }

  // currency changed (static radios in HTML)
  if (e.target && e.target.name === "currency") {
    displayCurrency = e.target.value;
    localStorage.setItem("displayCurrency", displayCurrency);

    // Re-render tables with new visible currency
    displayResorts();
    displayFlights();
    displayExtras();

    // restore checkboxes (renderers will mark those that are in selectedItems)
    // then recalc totals
    updateTripTotal();
  }
});

/* ========== DOMContentLoaded startup ========== */
document.addEventListener("DOMContentLoaded", () => {
  syncCurrencyRadios();
  displayFamilies();
  displayResorts();
  displayFlights();
  displayExtras();
  updateTripTotal();
});