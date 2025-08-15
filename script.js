

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
function displayResorts() {
    return renderSection({
        tableName: AIRTABLE_TABLE_RESORT,
        loadingId: "loading-resorts",
        errorId: "error-resorts",
        listId: "resorts-list",
        emptyMessage: "No resorts found.",
        renderRecord: (r) => {
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
                <div class="card">
                    <h3>${name}</h3>
                    <p><strong>Origin:</strong> ${origin}</p>
                    <p><strong>Price:</strong> ${price} ${currency}</p>
                    <p><strong>Converted:</strong> ${priceUSD} USD / ${priceEUR} EUR</p>
                    <p><strong>Perks:</strong> ${perks}</p>
                    <p><strong>Families Included:</strong> ${familiesIncluded}</p>
                </div>
            `;
        }
    });
}

// Run after DOM is ready so the elements exist
document.addEventListener("DOMContentLoaded", () => {
    displayFamilies();
    displayResorts();
});
 