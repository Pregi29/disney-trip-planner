// === Selection state: persist checked items across re-renders ===
const selectedItems = new Set(); // stores Airtable record.id strings

function onToggleItemCheckbox(cb) {
  const id = cb.getAttribute("data-id");
  if (!id) return;
  if (cb.checked) selectedItems.add(id);
  else selectedItems.delete(id);
}

// Delegate checkbox changes (works for all tables)
document.addEventListener("change", (e) => {
  if (e.target && e.target.matches(".item-checkbox")) {
    onToggleItemCheckbox(e.target);
    updateTripTotal();
  }
});


// --- Currency Helpers ---
function convert(amount, fromCurrency, toCurrency) {
    if (!amount || !fromCurrency || !toCurrency) return null;

    if (fromCurrency === toCurrency) return amount;

    if (fromCurrency === "USD" && toCurrency === "EUR") {
        return amount * USD_TO_EUR;
    } else if (fromCurrency === "EUR" && toCurrency === "USD") {
        return amount / USD_TO_EUR;
    }

    return null;
}

function formatMoney(amount, currency) {
    if (amount == null || isNaN(amount)) return "—";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency
    }).format(amount);
}


// Generic fetch function for any table
async function fetchTable(tableName) {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;

    try {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${AIRTABLE_API_KEY}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`Error fetching ${tableName}: HTTP ${response.status} ${response.statusText} ${errorText}`);
        }

        const data = await response.json();
        return data.records || [];
    } catch (error) {
        console.error(`fetchTable(${tableName}) failed:`, error);
        throw error;
    }
}

// Reusable renderer for sections
async function renderSection({
    tableName,
    loadingId,
    errorId,
    listId,
    renderRecord,
    emptyMessage = "No records found."
}) {
    const loadingEl = document.getElementById(loadingId);
    const errorEl = document.getElementById(errorId);
    const container = document.getElementById(listId);

    if (!container) {
        console.error(`Container #${listId} not found`);
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";

    try {
        const records = await fetchTable(tableName);

        if (records.length === 0) {
            container.innerHTML = `<p>${emptyMessage}</p>`;
            return;
        }

        container.innerHTML = records.map(renderRecord).join("");
    } catch (error) {
        if (errorEl) {
            errorEl.style.display = "block";
            errorEl.textContent = `Failed to load ${tableName}: ${error.message}`;
        }
        container.innerHTML = "";
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
    }
}

// --- Helper to shorten Family name ---
function shortFamilyName(name) {
    if (!name) return "";
    if (Array.isArray(name)) {
        name = name[0]; // take the first linked family
    }
    if (typeof name !== "string") return "";
    return name.split("+")[0];
}

// --- Helper to format dates (day + short month) ---
function shortDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

// Families display
function displayFamilies() {
    return renderSection({
        tableName: AIRTABLE_TABLE_FAMILIES,
        loadingId: "loading-families",
        errorId: "error-families",
        listId: "families-list",
        emptyMessage: "No families found.",
        renderRecord: (record) => {
            const name = record.fields.Name || "Unnamed";
            return `
                <div class="card">
                    <h3>${name}</h3>
                </div>
            `;
        }
    });
}

// Resorts display
// Robust helper: pick first matching field name from a list
function getField(record, names) {
    for (const n of names) {
        if (record.fields && record.fields[n] !== undefined) return record.fields[n];
    }
    return undefined;
}

// Helper: normalize families lookup => string of names (comma separated)
function familiesFromLookup(val) {
    if (!val) return "";
    // Airtable lookup often gives array of strings, or array of record ids, or a single string
    if (Array.isArray(val)) {
        return val.map(v => {
            if (typeof v === "string") return v;
            return String(v);
        }).join(", ");
    }
    if (typeof val === "string") return val;
    return String(val);
}

// --- displayResorts: builds a full table into #resorts-list
// === Resorts display (with checkbox + numeric data-price) ===
async function displayResorts() {
    const container = document.getElementById("resorts-list");
    const loadingEl = document.getElementById("loading-resorts");
    const errorEl = document.getElementById("error-resorts");

    if (!container) {
        console.error("displayResorts: #resorts-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

    // field picker (respects any global getField you may have)
    const pick = (record, names) => {
        if (typeof getField === "function") return getField(record, names);
        for (const n of names) {
            if (record.fields && record.fields[n] !== undefined) return record.fields[n];
        }
        return undefined;
    };

    try {
        const records = await fetchTable(AIRTABLE_TABLE_RESORT);
        if (!records || records.length === 0) {
            container.innerHTML = `<p>No resorts found.</p>`;
            return;
        }

        let html = `
          <div class="table-container">
            <table class="table-view">
              <thead>
                <tr>
                  <th></th> <!-- checkbox -->
                  <th>Resort</th>
                  <th>Origin</th>
                  <th>Original</th>
                  <th>Price (${displayCurrency})</th>
                  <th>Perks</th>
                  <th>Families</th>
                </tr>
              </thead>
              <tbody>
        `;

        html += records.map(r => {
            const name = pick(r, ["Resort Name","Name","Resort"]) || "Unnamed Resort";
            const origin = pick(r, ["Booking Origin","Origin"]) || "";
            const priceRaw = pick(r, ["Price input","Price (input)","Price"]) ?? "";
            const currency = pick(r, ["Currency","currency"]) || "";
            const perks = pick(r, ["Perks","Notes"]) || "";
            const fams = pick(r, ["Name (from Families included)","Families included","Families"]) || [];
            const familiesIncluded = Array.isArray(fams) ? fams.join(", ") : String(fams || "");

            // numeric conversion + display
            let convertedVal = 0;
            let originalStr = "—";
            let convertedStr = "—";
            if (priceRaw !== "" && currency) {
                const num = Number(priceRaw);
                if (!isNaN(num)) {
                    convertedVal = convert(num, String(currency), displayCurrency) || 0;
                    originalStr = `${num} ${currency}`;
                    convertedStr = formatMoney(convertedVal, displayCurrency);
                }
            }

            return `
              <tr>
                <td>
                    <input 
                        type="checkbox" 
                        class="item-checkbox" 
                        data-id="${r.id}"
                        data-amount="${!isNaN(Number(priceRaw)) ? Number(priceRaw) : 0}"
                        data-currency="${currency || 'USD'}"
                        ${selectedItems.has(r.id) ? "checked" : ""}
                    />
                </td>
                <td>${name}</td>
                <td>${origin}</td>
                <td>${originalStr}</td>
                <td>${convertedStr}</td>
                <td>${perks}</td>
                <td>${familiesIncluded}</td>
              </tr>
            `;
        }).join("");

        html += `
              </tbody>
            </table>
          </div>
        `;

        container.innerHTML = html;
    } catch (err) {
        console.error("displayResorts error:", err);
        if (errorEl) { errorEl.style.display = "block"; errorEl.textContent = `Failed to load Resorts: ${err.message || err}`; }
        container.innerHTML = "";
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
    }
}
// Helper function to render one row
function renderResortRow(r) {
    const name = r.fields["Resort Name"] || "Unnamed Resort";
    const origin = r.fields["Booking Origin"] || "";
    const currency = r.fields.Currency || "";
    const price = r.fields["Price (input)"] || "";
    const priceUSD = r.fields["Price USD"] || "";
    const priceEUR = r.fields["Price EUR"] || "";
    const perks = r.fields["Perks"] || "";
    const familiesIncluded = Array.isArray(r.fields["Name (from Families included)"])
        ? r.fields["Name (from Families included)"].join(", ")
        : "";

    return `
        <tr>
            <td>${name}</td>
            <td>${origin}</td>
            <td>${price} ${currency}</td>
            <td>${priceUSD} USD / ${priceEUR} EUR</td>
            <td>${perks}</td>
            <td>${familiesIncluded}</td>
        </tr>
    `;
}



// === Flights display (with checkbox + numeric data-price) ===
async function displayFlights() {
    const container = document.getElementById("flights-list");
    const loadingEl = document.getElementById("loading-flights");
    const errorEl = document.getElementById("error-flights");

    if (!container) {
        console.error("displayFlights: #flights-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

    const pick = (record, names) => {
        if (typeof getField === "function") return getField(record, names);
        for (const n of names) {
            if (record.fields && record.fields[n] !== undefined) return record.fields[n];
        }
        return undefined;
    };

    // small helpers (non-breaking)
    const trimFamily = (name) => {
        if (!name) return "";
        const s = String(name);
        const idx = s.indexOf("+");
        return idx > 0 ? s.slice(0, idx).trim() : s.trim();
    };
    const shortDate = (dstr) => {
        if (!dstr) return "";
        // Airtable often returns ISO strings; keep it simple: show DD Mon
        const d = new Date(dstr);
        if (isNaN(d.getTime())) return String(dstr);
        const day = d.getDate();
        const mon = d.toLocaleString(undefined, { month: "short" });
        return `${day} ${mon}`;
    };
    const domainLabel = (url) => {
        if (!url) return "";
        try { return new URL(url).hostname.replace(/^www\./, ""); }
        catch { return "Link"; }
    };

    try {
        const records = await fetchTable(AIRTABLE_TABLE_FLIGHTS);
        if (!records || records.length === 0) {
            container.innerHTML = `<p>No flights found.</p>`;
            return;
        }

        let html = `
          <div class="table-container">
            <table class="table-view wide">
              <thead>
                <tr>
                  <th></th> <!-- checkbox -->
                  <th>Family</th>
                  <th>Airline</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Departure</th>
                  <th>Return</th>
                  <th>Price (${displayCurrency})</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
        `;

        html += records.map(r => {
            const familyName = pick(r, ["Name (from Family)","Family","Family Name"]) || "";
            const familyShort = trimFamily(familyName);
            const airline = pick(r, ["Airline"]) || "";
            const origin = pick(r, ["Origin","From"]) || "";
            const destination = pick(r, ["Destination","To"]) || "";
            const dep = shortDate(pick(r, ["Departure Date","Departure"])) || "";
            const ret = shortDate(pick(r, ["Return Date","Return"])) || "";

            const priceRaw = pick(r, ["Price input","Price (input)","Price"]) ?? "";
            const currency = pick(r, ["Currency","currency"]) || "";

            const link = pick(r, ["Booking Link","Link"]) || "";
            const platform = link ? domainLabel(link) : "";

            let convertedVal = 0;
            let convertedStr = "—";
            if (priceRaw !== "" && currency) {
                const num = Number(priceRaw);
                if (!isNaN(num)) {
                    convertedVal = convert(num, String(currency), displayCurrency) || 0;
                    convertedStr = formatMoney(convertedVal, displayCurrency);
                }
            }

            const linkHtml = link
                ? `<a href="${link}" target="_blank" rel="noopener" class="link-icon" aria-label="Open booking link">${platform || "link"}</a>`
                : "";

            return `
              <tr>
                <td>
                    <input 
                        type="checkbox" 
                        class="item-checkbox" 
                        data-id="${r.id}"
                        data-amount="${!isNaN(Number(priceRaw)) ? Number(priceRaw) : 0}"
                        data-currency="${currency || 'USD'}"
                        ${selectedItems.has(r.id) ? "checked" : ""}
                    />
                 </td>
                <td>${familyShort}</td>
                <td>${airline}</td>
                <td>${origin}</td>
                <td>${destination}</td>
                <td>${dep}</td>
                <td>${ret}</td>
                <td>${convertedStr}</td>
                <td>${linkHtml}</td>
              </tr>
            `;
        }).join("");

        html += `
              </tbody>
            </table>
          </div>
        `;

        container.innerHTML = html;
    } catch (err) {
        console.error("displayFlights error:", err);
        if (errorEl) { errorEl.style.display = "block"; errorEl.textContent = `Failed to load Flights: ${err.message || err}`; }
        container.innerHTML = "";
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
    }
}

// --- displayExtras: builds a full table into #extras-list (uses existing convert/formatMoney/displayCurrency)
// === Extras display (with checkbox + numeric data-price) ===
async function displayExtras() {
    const container = document.getElementById("extras-list");
    const loadingEl = document.getElementById("loading-extras");
    const errorEl = document.getElementById("error-extras");

    if (!container) {
        console.error("displayExtras: #extras-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

    const pick = (record, names) => {
        if (typeof getField === "function") return getField(record, names);
        for (const n of names) {
            if (record.fields && record.fields[n] !== undefined) return record.fields[n];
        }
        return undefined;
    };
    const domainLabel = (url) => {
        if (!url) return "";
        try { return new URL(url).hostname.replace(/^www\./, ""); }
        catch { return "Link"; }
    };

    try {
        const records = await fetchTable(AIRTABLE_TABLE_EXTRAS);
        if (!records || records.length === 0) {
            container.innerHTML = `<p>No extras found.</p>`;
            return;
        }

        let html = `
          <div class="table-container">
            <table class="table-view">
              <thead>
                <tr>
                  <th></th> <!-- checkbox -->
                  <th>Name</th>
                  <th>Original</th>
                  <th>Price (${displayCurrency})</th>
                  <th>Notes</th>
                  <th>Booking</th>
                </tr>
              </thead>
              <tbody>
        `;

        html += records.map(r => {
            const name = pick(r, ["Name","Extra","Title"]) || "Unnamed Extra";
            const priceRaw = pick(r, ["Price input","Cost","Price"]) ?? "";
            const currency = pick(r, ["Currency","currency"]) || "";
            const notes = pick(r, ["Notes","notes"]) || "";
            const link = pick(r, ["Booking Link","Link"]) || "";

            let originalStr = "—";
            let convertedVal = 0;
            let convertedStr = "—";
            if (priceRaw !== "" && currency) {
                const num = Number(priceRaw);
                if (!isNaN(num)) {
                    convertedVal = convert(num, String(currency), displayCurrency) || 0;
                    originalStr = `${num} ${currency}`;
                    convertedStr = formatMoney(convertedVal, displayCurrency);
                }
            }

            const linkHtml = link
                ? `<a href="${link}" target="_blank" rel="noopener" class="link-icon">${domainLabel(link)}</a>`
                : "";

            return `
              <tr>
                <td>
                    <input 
                        type="checkbox" 
                        class="item-checkbox" 
                        data-id="${r.id}"
                        data-amount="${!isNaN(Number(priceRaw)) ? Number(priceRaw) : 0}"
                        data-currency="${currency || 'USD'}"
                        ${selectedItems.has(r.id) ? "checked" : ""}
                    />
                </td>
                <td>${name}</td>
                <td>${originalStr}</td>
                <td>${convertedStr}</td>
                <td>${notes}</td>
                <td>${linkHtml}</td>
              </tr>
            `;
        }).join("");

        html += `
              </tbody>
            </table>
          </div>
        `;

        container.innerHTML = html;
    } catch (err) {
        console.error("displayExtras error:", err);
        if (errorEl) { errorEl.style.display = "block"; errorEl.textContent = `Failed to load Extras: ${err.message || err}`; }
        container.innerHTML = "";
    } finally {
        if (loadingEl) loadingEl.style.display = "none";
    }
}
// Run after DOM is ready so the elements exist
document.addEventListener("DOMContentLoaded", () => {
    displayFamilies();
    displayResorts();
    displayFlights();
    displayExtras();
});
 
// --- Currency Toggle ---
let displayCurrency = localStorage.getItem("displayCurrency") || DEFAULT_DISPLAY_CURRENCY;

function renderCurrencyToggle() {
    const header = document.querySelector(".container"); // insert at top
    if (!header) return;

    // prevent duplicates
    if (document.getElementById("currency-toggle")) return;

    const toggle = document.createElement("div");
    toggle.id = "currency-toggle";
    toggle.innerHTML = `
        <label>
            <input type="radio" name="currency" value="USD" ${displayCurrency === "USD" ? "checked" : ""}>
            USD
        </label>
        <label>
            <input type="radio" name="currency" value="EUR" ${displayCurrency === "EUR" ? "checked" : ""}>
            EUR
        </label>
    `;

    header.prepend(toggle);

    toggle.addEventListener("change", (e) => {
        if (e.target.name === "currency") {
            displayCurrency = e.target.value;
            localStorage.setItem("displayCurrency", displayCurrency);
            // re-render everything
            displayFamilies();
            displayResorts();
            displayFlights();
            // extras will be added later
        }
    });
}

// --- Trip Total ---
// === Trip Total: always compute from raw amounts in USD baseline, then derive EUR ===
function updateTripTotal() {
    let totalUSD = 0;
  
    document.querySelectorAll(".item-checkbox:checked").forEach(cb => {
      const amt = parseFloat(cb.getAttribute("data-amount")) || 0;
      const cur = cb.getAttribute("data-currency") || "USD";
      const valUSD = convert(amt, cur, "USD");
      if (valUSD != null && !isNaN(valUSD)) totalUSD += valUSD;
    });
  
    const totalEUR = convert(totalUSD, "USD", "EUR") || 0;
  
    const totalEl = document.querySelector("#trip-total p strong");
    if (totalEl) {
      totalEl.textContent = `${formatMoney(totalUSD, "USD")} | ${formatMoney(totalEUR, "EUR")}`;
    }
  }
// Event delegation: recalc whenever checkbox changes or currency changes
document.addEventListener("change", (e) => {
    if (e.target.matches(".item-checkbox") || e.target.name === "currency") {
        updateTripTotal();
    }
    if (e.target.name === "currency") {
        displayCurrency = e.target.value;
        localStorage.setItem("displayCurrency", displayCurrency);
      
        // Re-render sections so visible prices change
        displayFamilies();
        displayResorts();
        displayFlights();
        displayExtras();
      
        // Then recompute totals from raw amounts
        updateTripTotal();
      }
});

document.addEventListener("DOMContentLoaded", () => {
    renderCurrencyToggle();
});