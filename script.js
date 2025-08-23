
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
async function displayResorts() {
    const container = document.getElementById("resorts-list");
    const loadingEl = document.getElementById("loading-resorts");
    const errorEl = document.getElementById("error-resorts");

    if (!container) {
        console.error("displayResorts: #resorts-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }

    try {
        const records = await fetchTable(AIRTABLE_TABLE_RESORT);

        if (!records || records.length === 0) {
            container.innerHTML = `<p>No resorts found.</p>`;
            return;
        }

        // Table header + wrapper (horizontal scroll if needed)
        const headerHtml = `
            <div class="table-container">
              <table class="table-view">
                <thead>
                  <tr>
                    <th>Resort</th>
                    <th>Origin</th>
                    <th>Original Price</th>
                    <th>Price (${displayCurrency})</th>
                    <th>Perks</th>
                    <th>Families Included</th>
                  </tr>
                </thead>
                <tbody>
        `;

        // Build rows
        const rowsHtml = records.map(r => {
            // Try multiple possible field name variants to avoid brittle breaks
            const name = getField(r, ["Resort Name", "Name", "Resort"]) || "Unnamed Resort";
            const origin = getField(r, ["Booking Origin", "Booking origin", "Origin"]) || "";
            const inputPriceRaw = getField(r, ["Price input", "Price (input)", "Price"]) ;
            const currency = getField(r, ["Currency", "currency"]) || "";
            const perks = getField(r, ["Perks", "Perks Notes", "Perks notes"]) || "";
            const familiesLookup = getField(r, [
                "Name (from Families Included)",
                "Name (from Families included)",
                "Name (from Family)",
                "Families Included",
                "Families"
            ]) || "";

            // Parse numeric price safely
            const inputPrice = (inputPriceRaw === 0 || inputPriceRaw) ? Number(inputPriceRaw) : null;

            // Compute converted value if possible
            let convertedStr = "—";
            if (inputPrice != null && currency) {
                const convertedVal = convert(Number(inputPrice), String(currency), displayCurrency);
                if (convertedVal != null) convertedStr = formatMoney(convertedVal, displayCurrency);
            }

            // Original price display (keep raw currency for reference)
            const originalStr = (inputPrice != null && currency) ? `${inputPrice} ${currency}` : "—";

            // Families included: handle lookup arrays or strings
            const familiesIncluded = familiesFromLookup(familiesLookup);

            return `
                <tr>
                    <td>${name}</td>
                    <td>${origin}</td>
                    <td>${originalStr}</td>
                    <td>${convertedStr}</td>
                    <td>${perks}</td>
                    <td>${familiesIncluded}</td>
                </tr>
            `;
        }).join("");

        const footerHtml = `
                </tbody>
              </table>
            </div>
        `;

        container.innerHTML = headerHtml + rowsHtml + footerHtml;

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



// --- displayFlights: builds a full table into #flights-list ---
async function displayFlights() {
    const container = document.getElementById("flights-list");
    const loadingEl = document.getElementById("loading-flights");
    const errorEl = document.getElementById("error-flights");

    if (!container) {
        console.error("displayFlights: #flights-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }

    // Local short-date helper (use existing shortDate if available)
    const formatShortDate = (d) => {
        if (!d) return "";
        if (typeof shortDate === "function") return shortDate(d);
        const date = new Date(d);
        if (isNaN(date)) return d;
        return date.toLocaleDateString("en-US", { day: "2-digit", month: "short" }); // e.g. 05 Jan
    };

    // Helper to get a nice short family name from lookup/string
    const shortFamily = (val) => {
        if (!val) return "";
        // If it's an array (lookup), take first item
        let s = Array.isArray(val) ? val[0] : val;
        if (typeof s !== "string") s = String(s);
        // If name uses + as separator, take the part before +
        const first = s.split(",")[0].split("+")[0].trim();
        return first;
    };

    try {
        const records = await fetchTable(AIRTABLE_TABLE_FLIGHTS);

        if (!records || records.length === 0) {
            container.innerHTML = `<p>No flights found.</p>`;
            return;
        }

        // Table wrapper + header
        const headerHtml = `
            <div class="table-container">
              <table class="table-view">
                <thead>
                  <tr>
                    <th>Family</th>
                    <th>Airline</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Departure</th>
                    <th>Return</th>
                    <th>Original</th>
                    <th>Price (${displayCurrency})</th>
                    <th>Booking</th>
                  </tr>
                </thead>
                <tbody>
        `;

        // Rows
        const rowsHtml = records.map(r => {
            // robust field extraction (uses getField if available)
            const get = (names) => {
                if (typeof getField === "function") {
                    return getField(r, names);
                }
                // fallback: try first name
                return r.fields && r.fields[names[0]] !== undefined ? r.fields[names[0]] : undefined;
            };

            const famLookup = get([
                "Name (from Family)",
                "Name (from Families Included)",
                "Name (from Family)",
                "Name (From Family)",
                "Family"
            ]);
            const family = shortFamily(famLookup);

            const airline = get(["Airline", "airline"]) || "";
            const origin = get(["Origin", "origin", "From"]) || "";
            const destination = get(["Destination", "destination", "To"]) || "";
            const depRaw = get(["Departure Date", "Departure", "departure"]) || "";
            const retRaw = get(["Return Date", "Return", "return"]) || "";
            const depDate = formatShortDate(depRaw);
            const retDate = formatShortDate(retRaw);

            const inputPriceRaw = get(["Price input", "Price (input)", "Price"]) ;
            const currency = get(["Currency", "currency"]) || "";

            const inputPrice = (inputPriceRaw === 0 || inputPriceRaw) ? Number(inputPriceRaw) : null;

            // converted price
            let convertedStr = "—";
            if (inputPrice != null && currency) {
                const convertedVal = (typeof convert === "function")
                    ? convert(Number(inputPrice), String(currency), displayCurrency)
                    : null;
                if (convertedVal !== null && convertedVal !== undefined && !isNaN(convertedVal)) {
                    convertedStr = (typeof formatMoney === "function")
                        ? formatMoney(convertedVal, displayCurrency)
                        : `${convertedVal.toFixed(2)} ${displayCurrency}`;
                }
            }

            const originalStr = (inputPrice != null && currency) ? `${inputPrice} ${currency}` : "—";

            const rawLink = get(["Booking Link", "Link", "booking link", "booking"]) || "";
            // extract domain for nicer label
            let linkLabel = "";
            if (rawLink) {
                try {
                    const u = new URL(rawLink);
                    linkLabel = u.hostname.replace(/^www\./, "");
                } catch {
                    linkLabel = "Booking";
                }
            }

            const linkHtml = rawLink
                ? `<a href="${rawLink}" target="_blank" rel="noopener" class="link-icon">${linkLabel}</a>`
                : "";

            return `
                <tr>
                    <td>${family}</td>
                    <td>${airline}</td>
                    <td>${origin}</td>
                    <td>${destination}</td>
                    <td>${depDate}</td>
                    <td>${retDate}</td>
                    <td>${originalStr}</td>
                    <td>${convertedStr}</td>
                    <td>${linkHtml}</td>
                </tr>
            `;
        }).join("");

        const footerHtml = `
                </tbody>
              </table>
            </div>
        `;

        container.innerHTML = headerHtml + rowsHtml + footerHtml;
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

// --- displayExtras: builds a full table into #extras-list (uses existing convert/formatMoney/displayCurrency)
async function displayExtras() {
    const container = document.getElementById("extras-list");
    const loadingEl = document.getElementById("loading-extras");
    const errorEl = document.getElementById("error-extras");

    if (!container) {
        console.error("displayExtras: #extras-list not found");
        return;
    }

    if (loadingEl) loadingEl.style.display = "block";
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }

    // local helper to get fields (uses your global getField if present)
    const pick = (record, names) => {
        if (typeof getField === "function") return getField(record, names);
        for (const n of names) {
            if (record.fields && record.fields[n] !== undefined) return record.fields[n];
        }
        return undefined;
    };

    // pretty domain label (like Flights)
    const domainLabel = (url) => {
        if (!url) return "";
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "Link";
        }
    };

    try {
        const records = await fetchTable(AIRTABLE_TABLE_EXTRAS);

        if (!records || records.length === 0) {
            container.innerHTML = `<p>No extras found.</p>`;
            return;
        }

        // header
        let html = `
          <div class="table-container">
            <table class="table-view">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Original</th>
                  <th>Price (${displayCurrency})</th>
                  <th>Notes</th>
                  <th>Booking</th>
                </tr>
              </thead>
              <tbody>
        `;

        // rows
        html += records.map(r => {
            const name = pick(r, ["Name", "Extra", "Title"]) || "Unnamed Extra";
            const priceRaw = pick(r, ["Price input", "Cost", "Price"]);
            const currency = pick(r, ["Currency", "currency"]) || "";
            const notes = pick(r, ["Notes", "notes"]) || "";
            const link = pick(r, ["Booking Link", "Link"]) || "";

            const originalStr = (priceRaw !== undefined && priceRaw !== null && currency)
                ? `${priceRaw} ${currency}` : "—";

            let convertedStr = "—";
            if (priceRaw !== undefined && priceRaw !== null && currency) {
                const val = Number(priceRaw);
                if (!isNaN(val)) {
                    const conv = convert(val, String(currency), displayCurrency);
                    if (conv !== null && conv !== undefined && !isNaN(conv)) {
                        convertedStr = formatMoney(conv, displayCurrency);
                    }
                }
            }

            const linkHtml = link
                ? `<a href="${link}" target="_blank" rel="noopener" class="link-icon">${domainLabel(link)}</a>`
                : "";

            return `
              <tr>
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
        if (errorEl) {
            errorEl.style.display = "block";
            errorEl.textContent = `Failed to load Extras: ${err.message || err}`;
        }
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

document.addEventListener("DOMContentLoaded", () => {
    renderCurrencyToggle();
});