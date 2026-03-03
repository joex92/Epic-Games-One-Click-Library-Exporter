// ==UserScript==
// @name         One-Click Epic Games Library to CSV
// @namespace    https://github.com/joex92/Epic-Games-One-Click-Library-Exporter
// @version      11.1
// @description  Exports your Epic Games library to a CSV file. Fetches order history, calculates actual prices paid, and retrieves advanced metadata via the RAWG API. Features live ETA and manual log control.
// @author       JoeX92 & Gemini AI Pro
// @match        https://www.epicgames.com/account/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.rawg.io
// ==/UserScript==

(function() {
    'use strict';

    // Global variables to manage the UI elements and script states
    let logContainer = null;
    let progressBar = null;
    let isPaused = false;
    let shouldStop = false;

    // --- API KEY MANAGEMENT ---
    // Adds a convenient button to the Tampermonkey extension menu to update the key anytime
    GM_registerMenuCommand("Update RAWG API Key", function() {
        const currentKey = GM_getValue("rawg_api_key", "");
        const newKey = prompt("Enter your RAWG API Key:", currentKey);
        if (newKey !== null) {
            GM_setValue("rawg_api_key", newKey.trim());
            alert("Key updated!");
        }
    });

    // --- UTILITY / HELPER FUNCTIONS ---

    // Converts JavaScript Date objects or Unix timestamps into a clean YYYY/MM/DD HH:MM:SS format
    function formatDateTime(dateObj) {
        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "Unknown Date";
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const hh = String(dateObj.getHours()).padStart(2, '0');
        const mm = String(dateObj.getMinutes()).padStart(2, '0');
        const ss = String(dateObj.getSeconds()).padStart(2, '0');
        return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    }

    // Fixes formatting issues like "AlanWake" to "Alan Wake" and strips out "Premium Edition" tags
    function smartCleanTitle(rawTitle) {
        if (!rawTitle) return "";
        let cleaned = rawTitle.trim();
        // Only inject spaces if the title is entirely squished together (PascalCase)
        if (!cleaned.includes(" ")) {
            cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        }
        // Remove common edition suffixes to significantly improve RAWG database matching
        return cleaned.replace(/ (Standard|Premium|Deluxe|Ultimate|Gold|GOTY|Director's Cut) Edition/gi, '').trim();
    }

    // Scrapes the user's Display Name directly from the Epic Games account page to customize the filename
    function getFormattedUserName() {
        const nameInput = document.getElementById('displayName');
        if (nameInput && nameInput.value) {
            const rawName = nameInput.value.trim();
            if (rawName.length > 0) {
                return rawName.replace(/\s+/g, '-'); // Replace spaces with hyphens for safe filenames
            }
        }
        return "My"; // Fallback if the element is missing or empty
    }

    // Converts milliseconds into a readable "Xm Ys left" format for the ETA tracker
    function formatETA(millis) {
        if (millis === 0 || isNaN(millis)) return "Calculating ETA...";
        const totalSecs = Math.round(millis / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        if (mins === 0) return `${secs}s left`;
        return `${mins}m ${secs}s left`;
    }

    // --- UI CREATION & MANAGEMENT ---

    // Builds the dark-mode floating console log, progress bar, and control buttons
    function createLogger() {
        if (logContainer) return; // Prevent creating multiple logs
        
        // Main floating container
        logContainer = document.createElement('div');
        logContainer.id = 'epic-logger-container';
        logContainer.style.cssText = 'position: fixed; bottom: 80px; right: 20px; width: 400px; background: rgba(0,0,0,0.95); border-radius: 8px; z-index: 10000; display: none; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;';
        
        // Progress bar container and moving element
        const progressWrapper = document.createElement('div');
        progressWrapper.style.cssText = 'width: 100%; height: 4px; background: #222;';
        progressBar = document.createElement('div');
        progressBar.style.cssText = 'width: 0%; height: 100%; background: #0078f2; transition: width 0.2s ease;';
        progressWrapper.appendChild(progressBar);
        logContainer.appendChild(progressWrapper);

        // Header containing the title, ETA tracker, and Pause/Stop buttons
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1a1a1a; border-bottom: 1px solid #333;';
        header.innerHTML = `
            <div style="display:flex; align-items:baseline;">
                <span style="color:#eee; font-size:11px; font-weight:bold;">Epic Metadata Export</span>
                <span id="epic-eta" style="color:#888; font-size:10px; margin-left:8px; font-style:italic;"></span>
            </div>
            <div>
                <button id="epic-pause" style="background:#555; color:white; border:none; padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer; margin-right:5px;">Pause</button>
                <button id="epic-stop" style="background:#dc3545; color:white; border:none; padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer;">Stop & Save</button>
            </div>`;
        logContainer.appendChild(header);

        // The scrollable text area for the log messages
        const logText = document.createElement('div');
        logText.id = 'epic-log-text';
        logText.style.cssText = 'height: 200px; color: #ccc; font-family: "Consolas", monospace; font-size: 11px; padding: 12px; overflow-y: auto; line-height: 1.6;';
        logContainer.appendChild(logText);
        document.body.appendChild(logContainer);

        // Bind logic to the Pause button (toggles state and updates colors)
        document.getElementById('epic-pause').onclick = function() {
            isPaused = !isPaused;
            this.innerText = isPaused ? "Resume" : "Pause";
            this.style.background = isPaused ? "#0078f2" : "#555";
        };
        // Bind logic to the Stop button (triggers the escape flag in the fetch loop)
        document.getElementById('epic-stop').onclick = () => { shouldStop = true; };
    }

    // Appends a new line of text to the console log, complete with a timestamp, and auto-scrolls down
    function logMessage(msg, color = "#ccc") {
        if (!logContainer) createLogger();
        logContainer.style.display = 'block'; // Ensure it's visible
        const logArea = document.getElementById('epic-log-text');
        const line = document.createElement('div');
        line.style.color = color;
        line.innerHTML = `<span style="color: #666; margin-right: 8px;">[${new Date().toLocaleTimeString([], {hour12: false})}]</span> ${msg}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight; // Auto-scroll to the bottom
    }

    // Hides the log window and resets the main button so the user can run another export if they want
    function closeLog() {
        if (logContainer) logContainer.style.display = 'none';
        const btn = document.getElementById('epic-csv-export-btn');
        if (btn) {
            btn.innerText = 'Export Full Data';
            btn.style.backgroundColor = '#0078f2';
            btn.disabled = false;
            btn.onclick = startExport; // Re-bind the click event to start the process over
        }
    }

    // Injects the primary blue export button into the bottom right corner of the Epic webpage
    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Full Data';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.3);';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    // --- MAIN LOGIC: DATA FETCHING (EPIC GAMES) ---

    // Recursively fetches order history from Epic using their internal pagination token
    async function fetchHistory(nextPageToken = '', allGames = []) {
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const res = await fetch(url);
        
        // Security check: If Epic asks for a login, it sends an HTML page instead of JSON data.
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Epic session expired. Please refresh the page.");
        }

        const data = await res.json();
        if (!data.orders) return allGames;

        // Loop through every order (receipt)
        for (const order of data.orders) {
            const rawDate = order.createdAtMillis || null;
            const dateStr = formatDateTime(new Date(rawDate));
            const orderId = order.orderId || "Unknown";
            
            // --- Price Distribution Logic ---
            // 1. Calculate the raw total of all items in this cart (ignoring discounts)
            let orderItemsTotalCents = 0;
            for (const item of order.items) {
                orderItemsTotalCents += (item.amount || 0);
            }
            
            // 2. Find what the user actually paid at checkout
            let orderActualTotalCents = 0;
            if (order.total && order.total.amount !== undefined) {
                orderActualTotalCents = order.total.amount;
            } else if (order.subtotal && order.subtotal.amount !== undefined) {
                orderActualTotalCents = order.subtotal.amount;
            }

            // 3. Determine the ratio of the discount applied (e.g., paid $5 for a $10 cart = 0.5 ratio)
            let ratio = 0;
            if (orderItemsTotalCents > 0) {
                ratio = orderActualTotalCents / orderItemsTotalCents;
            }

            // Map each item in the order, applying the discount ratio proportionally
            for (const item of order.items) { 
                const originalCents = item.amount || 0;
                let actualPaidCents = 0;
                
                if (originalCents > 0) {
                    actualPaidCents = Math.round(originalCents * ratio);
                }
                
                const originalPriceStr = (originalCents / 100).toFixed(2);
                const actualPaidStr = (actualPaidCents / 100).toFixed(2);
                
                // Store the localized data into our master array
                allGames.push({ 
                    title: item.description, 
                    dateAdded: dateStr,
                    orderId: orderId,
                    originalPrice: originalPriceStr,
                    actualPaid: actualPaidStr,
                    currency: item.currency || "USD",
                    giftRecipient: item.giftRecipient || "",
                    namespace: item.namespace || "N/A",
                    offerId: item.offerId || "N/A"
                }); 
            }
        }
        
        // If there are more pages of history, call this function again recursively
        if (data.nextPageToken) return fetchHistory(data.nextPageToken, allGames);
        
        // Once all pages are loaded, remove any duplicate entries (e.g., buying a game, then later buying its DLC)
        const unique = [];
        const seen = new Set();
        for (const g of allGames) { if (!seen.has(g.title)) { seen.add(g.title); unique.push(g); } }
        return unique;
    }

    // --- MAIN LOGIC: DATA FETCHING (RAWG METADATA) ---

    // Iterates through the cleaned Epic game list and queries RAWG.io for extended metadata
    async function fetchTagsWithControls(games, apiKey) {
        const results = [];
        const total = games.length;
        let totalFetchTime = 0;
        const etaElement = document.getElementById('epic-eta');
        
        for (let i = 0; i < total; i++) {
            // PAUSE LOGIC: Hold execution here as long as isPaused is true
            while (isPaused && !shouldStop) { await new Promise(r => setTimeout(r, 500)); }

            // STOP LOGIC: If triggered, push the remaining titles with "Skipped" values to preserve Epic data
            if (shouldStop) {
                logMessage(`STOPPED: Appending ${total - i} remaining titles without RAWG data...`, "#dc3545");
                if (etaElement) etaElement.innerText = "Stopped";
                for (let j = i; j < total; j++) {
                    const game = games[j];
                    const displayTitle = smartCleanTitle(game.title);
                    results.push({ 
                        ...game, 
                        title: displayTitle, 
                        tags: "Skipped",
                        releaseDate: "Skipped",
                        metacritic: "Skipped",
                        rating: "Skipped",
                        playtime: "Skipped",
                        esrb: "Skipped",
                        platforms: "Skipped"
                    });
                }
                break; // Exit the loop completely
            }

            const iterationStart = Date.now(); // Start Stopwatch for ETA math

            if (progressBar) progressBar.style.width = `${((i + 1) / total) * 100}%`;
            
            const displayTitle = smartCleanTitle(games[i].title);
            const rawgUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(displayTitle)}&page_size=1&key=${apiKey}`;

            try {
                // Use GM_xmlhttpRequest to bypass Epic Games' strict Content Security Policy (CSP) blocking external APIs
                const data = await new Promise((res, rej) => {
                    GM_xmlhttpRequest({
                        method: "GET", url: rawgUrl,
                        onload: (r) => r.status === 200 ? res(JSON.parse(r.responseText)) : rej(new Error("RAWG API Error")),
                        onerror: rej
                    });
                });
                
                // If RAWG found a match, extract and format the data
                if (data.results?.length > 0) {
                    const info = data.results[0];
                    
                    // Combine genres and the top 4 English tags, using a Set to prevent duplicates
                    const meta = [...new Set([...(info.genres?.map(g => g.name) || []), ...(info.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 4) || [])])];
                    
                    const releaseDate = info.released || "N/A";
                    const metacritic = info.metacritic || "N/A";
                    const rating = info.rating ? `${info.rating} / ${info.rating_top}` : "N/A";
                    const playtime = info.playtime ? `${info.playtime} hrs` : "N/A";
                    const esrb = info.esrb_rating ? info.esrb_rating.name : "N/A";
                    const platforms = info.platforms ? info.platforms.map(p => p.platform.name).join(', ') : "N/A";

                    logMessage(`<span style="color:#0078f2;">[${i+1}/${total}]</span> ${displayTitle} <span style="color:#28a745;">✓ Success</span>`);
                    
                    results.push({ 
                        ...games[i], 
                        title: displayTitle, 
                        tags: meta.join(', ') || "No tags",
                        releaseDate: releaseDate,
                        metacritic: metacritic,
                        rating: rating,
                        playtime: playtime,
                        esrb: esrb,
                        platforms: platforms
                    });
                } else {
                    // Title not found in RAWG database
                    logMessage(`<span style="color:#555;">[${i+1}/${total}]</span> ${displayTitle} <span style="color:#ffc107;">⚠ Not Found</span>`);
                    results.push({ ...games[i], title: displayTitle, tags: "N/A", releaseDate: "N/A", metacritic: "N/A", rating: "N/A", playtime: "N/A", esrb: "N/A", platforms: "N/A" });
                }
            } catch (e) { 
                // Handles invalid API keys or network drops
                logMessage(`<span style="color:#dc3545;">[${i+1}/${total}]</span> ${displayTitle} <span style="color:#dc3545;">❌ Error</span>`);
                results.push({ ...games[i], title: displayTitle, tags: "Error", releaseDate: "Error", metacritic: "Error", rating: "Error", playtime: "Error", esrb: "Error", platforms: "Error" }); 
            }
            
            // Wait 250ms before the next request to respect RAWG's API rate limits
            await new Promise(r => setTimeout(r, 250));

            // Stop Stopwatch, calculate the moving average time per fetch, and update the ETA UI
            const iterationTime = Date.now() - iterationStart;
            totalFetchTime += iterationTime;
            const avgTime = totalFetchTime / (i + 1);
            const remainingItems = total - (i + 1);
            
            if (etaElement && !shouldStop) {
                etaElement.innerText = formatETA(avgTime * remainingItems);
            }
        }
        
        const finalEta = document.getElementById('epic-eta');
        if (finalEta && !shouldStop) finalEta.innerText = "Done";
        return results;
    }

    // --- ORCHESTRATOR ---
    // The master function that runs when the user clicks the Export button
    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;
        isPaused = false; shouldStop = false;

        // Ensure we have an API key, or confirm the user wants to skip metadata entirely
        if (!rawgApiKey) {
            let input = prompt("Enter RAWG API Key, or Cancel for Titles & Epic data only.");
            if (input) { 
                rawgApiKey = input.trim(); 
                GM_setValue("rawg_api_key", rawgApiKey); 
            } else { 
                if (confirm("Export WITHOUT RAWG tags? (You will still get Epic Prices/Order IDs)")) skipTags = true; else return; 
            }
        }

        const btn = document.getElementById('epic-csv-export-btn');
        btn.disabled = true;
        if (logContainer) document.getElementById('epic-log-text').innerHTML = '';
        const etaElement = document.getElementById('epic-eta');
        if (etaElement) etaElement.innerText = "";

        try {
            logMessage("Verifying Epic history and calculating price distributions...", "#0078f2");
            const games = await fetchHistory();
            
            let finalData = [];
            if (skipTags) {
                // If skipping RAWG, immediately map the Epic data with empty/NA metadata fields
                finalData = games.map(g => ({ ...g, title: smartCleanTitle(g.title), tags: "N/A", releaseDate: "N/A", metacritic: "N/A", rating: "N/A", playtime: "N/A", esrb: "N/A", platforms: "N/A" }));
            } else {
                logMessage(`Found ${games.length} titles. Syncing with RAWG...`, "#0078f2");
                finalData = await fetchTagsWithControls(games, rawgApiKey);
            }

            // Alphabetize the final array by title
            finalData.sort((a, b) => a.title.localeCompare(b.title));
            
            // Build and download the file
            downloadCSV(finalData);
            
            // Reconfigure the button to let the user manually close the log
            btn.innerText = 'Complete! (Close Log)';
            btn.style.backgroundColor = '#28a745';
            btn.disabled = false;
            btn.onclick = closeLog;

        } catch (e) {
            logMessage(`ERROR: ${e.message}`, "#dc3545");
            
            btn.innerText = 'Failed (Close Log)';
            btn.style.backgroundColor = '#dc3545';
            btn.disabled = false;
            btn.onclick = closeLog;
        }
    }

    // --- FILE GENERATION ---
    // Converts the JSON array into a standard CSV string and triggers a browser download
    function downloadCSV(data) {
        const userName = getFormattedUserName();
        const timestamp = formatDateTime(new Date());
        const fileTime = timestamp.replace(/\//g, '-').replace(/:/g, '.'); // File-safe timestamp
        
        // CSV Column Headers
        const header = [
            'Game Title', 
            'Date Added', 
            'Original Price',
            'Actual Paid',
            'Currency',
            'Gift Recipient',
            'Order ID',
            'Namespace',
            'Offer ID',
            'Tags & Genres', 
            'Release Date', 
            'Metacritic Score', 
            'User Rating', 
            'Avg Playtime', 
            'ESRB Rating', 
            'Platforms'
        ];
        
        // Map data rows, wrapping all fields in double quotes to prevent internal commas from breaking the CSV columns
        const rows = data.map(r => [
            `"${r.title.replace(/"/g, '""')}"`,
            `"${r.dateAdded}"`,
            `"${r.originalPrice}"`,
            `"${r.actualPaid}"`,
            `"${r.currency}"`,
            `"${r.giftRecipient}"`,
            `"${r.orderId}"`,
            `"${r.namespace}"`,
            `"${r.offerId}"`,
            `"${(r.tags || 'N/A').replace(/"/g, '""')}"`,
            `"${r.releaseDate || 'N/A'}"`,
            `"${r.metacritic || 'N/A'}"`,
            `"${r.rating || 'N/A'}"`,
            `"${r.playtime || 'N/A'}"`,
            `"${r.esrb || 'N/A'}"`,
            `"${(r.platforms || 'N/A').replace(/"/g, '""')}"`
        ]);
        
        // Join the header and rows with linebreaks
        const content = [header, ...rows].map(e => e.join(",")).join("\n");
        
        // Create an invisible hyperlink, attach the Blob data, and virtually "click" it
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = `EpicGames_${userName}_Library_${fileTime}.csv`;
        link.click();
    }

    // Epic's site is a Single Page Application (SPA), so we check every 2 seconds to see if the button needs to be injected
    setInterval(createButton, 2000);
})();
