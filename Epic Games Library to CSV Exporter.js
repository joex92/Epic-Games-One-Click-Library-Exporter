// ==UserScript==
// @name         One-Click Epic Games Library to CSV
// @namespace    https://github.com/joex92/Epic-Games-One-Click-Library-Exporter
// @version      11.0
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

    let logContainer = null;
    let progressBar = null;
    let isPaused = false;
    let shouldStop = false;

    // --- API KEY MANAGEMENT ---
    GM_registerMenuCommand("Update RAWG API Key", function() {
        const currentKey = GM_getValue("rawg_api_key", "");
        const newKey = prompt("Enter your RAWG API Key:", currentKey);
        if (newKey !== null) {
            GM_setValue("rawg_api_key", newKey.trim());
            alert("Key updated!");
        }
    });

    // --- HELPER FUNCTIONS ---
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

    function smartCleanTitle(rawTitle) {
        if (!rawTitle) return "";
        let cleaned = rawTitle.trim();
        if (!cleaned.includes(" ")) {
            cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        }
        return cleaned.replace(/ (Standard|Premium|Deluxe|Ultimate|Gold|GOTY|Director's Cut) Edition/gi, '').trim();
    }

    function getFormattedUserName() {
        const nameInput = document.getElementById('displayName');
        if (nameInput && nameInput.value) {
            const rawName = nameInput.value.trim();
            if (rawName.length > 0) {
                return rawName.replace(/\s+/g, '-');
            }
        }
        return "My";
    }

    function formatETA(millis) {
        if (millis === 0 || isNaN(millis)) return "Calculating ETA...";
        const totalSecs = Math.round(millis / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        if (mins === 0) return `${secs}s left`;
        return `${mins}m ${secs}s left`;
    }

    // --- UI COMPONENTS ---
    function createLogger() {
        if (logContainer) return;
        logContainer = document.createElement('div');
        logContainer.id = 'epic-logger-container';
        logContainer.style.cssText = 'position: fixed; bottom: 80px; right: 20px; width: 400px; background: rgba(0,0,0,0.95); border-radius: 8px; z-index: 10000; display: none; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;';
        
        const progressWrapper = document.createElement('div');
        progressWrapper.style.cssText = 'width: 100%; height: 4px; background: #222;';
        progressBar = document.createElement('div');
        progressBar.style.cssText = 'width: 0%; height: 100%; background: #0078f2; transition: width 0.2s ease;';
        progressWrapper.appendChild(progressBar);
        logContainer.appendChild(progressWrapper);

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

        const logText = document.createElement('div');
        logText.id = 'epic-log-text';
        logText.style.cssText = 'height: 200px; color: #ccc; font-family: "Consolas", monospace; font-size: 11px; padding: 12px; overflow-y: auto; line-height: 1.6;';
        logContainer.appendChild(logText);
        document.body.appendChild(logContainer);

        document.getElementById('epic-pause').onclick = function() {
            isPaused = !isPaused;
            this.innerText = isPaused ? "Resume" : "Pause";
            this.style.background = isPaused ? "#0078f2" : "#555";
        };
        document.getElementById('epic-stop').onclick = () => { shouldStop = true; };
    }

    function logMessage(msg, color = "#ccc") {
        if (!logContainer) createLogger();
        logContainer.style.display = 'block';
        const logArea = document.getElementById('epic-log-text');
        const line = document.createElement('div');
        line.style.color = color;
        line.innerHTML = `<span style="color: #666; margin-right: 8px;">[${new Date().toLocaleTimeString([], {hour12: false})}]</span> ${msg}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }

    // --- BUTTON BEHAVIORS ---
    function closeLog() {
        if (logContainer) logContainer.style.display = 'none';
        const btn = document.getElementById('epic-csv-export-btn');
        if (btn) {
            btn.innerText = 'Export Full Data';
            btn.style.backgroundColor = '#0078f2';
            btn.disabled = false;
            btn.onclick = startExport;
        }
    }

    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Full Data';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.3);';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    // --- DATA FETCHING (EPIC) ---
    async function fetchHistory(nextPageToken = '', allGames = []) {
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const res = await fetch(url);
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Epic session expired. Please refresh the page.");
        }

        const data = await res.json();
        if (!data.orders) return allGames;

        for (const order of data.orders) {
            const rawDate = order.createdAtMillis || null;
            const dateStr = formatDateTime(new Date(rawDate));
            const orderId = order.orderId || "Unknown";
            
            let orderItemsTotalCents = 0;
            for (const item of order.items) {
                orderItemsTotalCents += (item.amount || 0);
            }
            
            let orderActualTotalCents = 0;
            if (order.total && order.total.amount !== undefined) {
                orderActualTotalCents = order.total.amount;
            } else if (order.subtotal && order.subtotal.amount !== undefined) {
                orderActualTotalCents = order.subtotal.amount;
            }

            let ratio = 0;
            if (orderItemsTotalCents > 0) {
                ratio = orderActualTotalCents / orderItemsTotalCents;
            }

            for (const item of order.items) { 
                const originalCents = item.amount || 0;
                let actualPaidCents = 0;
                
                if (originalCents > 0) {
                    actualPaidCents = Math.round(originalCents * ratio);
                }
                
                const originalPriceStr = (originalCents / 100).toFixed(2);
                const actualPaidStr = (actualPaidCents / 100).toFixed(2);
                
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
        
        if (data.nextPageToken) return fetchHistory(data.nextPageToken, allGames);
        
        const unique = [];
        const seen = new Set();
        for (const g of allGames) { if (!seen.has(g.title)) { seen.add(g.title); unique.push(g); } }
        return unique;
    }

    // --- DATA FETCHING (RAWG) ---
    async function fetchTagsWithControls(games, apiKey) {
        const results = [];
        const total = games.length;
        let totalFetchTime = 0;
        const etaElement = document.getElementById('epic-eta');
        
        for (let i = 0; i < total; i++) {
            // Pausing logic happens BEFORE starting the stopwatch
            while (isPaused && !shouldStop) { await new Promise(r => setTimeout(r, 500)); }

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
                break; 
            }

            const iterationStart = Date.now(); // ⏱️ Start Stopwatch

            if (progressBar) progressBar.style.width = `${((i + 1) / total) * 100}%`;
            const displayTitle = smartCleanTitle(games[i].title);
            const rawgUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(displayTitle)}&page_size=1&key=${apiKey}`;

            try {
                const data = await new Promise((res, rej) => {
                    GM_xmlhttpRequest({
                        method: "GET", url: rawgUrl,
                        onload: (r) => r.status === 200 ? res(JSON.parse(r.responseText)) : rej(new Error("RAWG API Error")),
                        onerror: rej
                    });
                });
                
                if (data.results?.length > 0) {
                    const info = data.results[0];
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
                    logMessage(`<span style="color:#555;">[${i+1}/${total}]</span> ${displayTitle} <span style="color:#ffc107;">⚠ Not Found</span>`);
                    results.push({ ...games[i], title: displayTitle, tags: "N/A", releaseDate: "N/A", metacritic: "N/A", rating: "N/A", playtime: "N/A", esrb: "N/A", platforms: "N/A" });
                }
            } catch (e) { 
                logMessage(`<span style="color:#dc3545;">[${i+1}/${total}]</span> ${displayTitle} <span style="color:#dc3545;">❌ Error</span>`);
                results.push({ ...games[i], title: displayTitle, tags: "Error", releaseDate: "Error", metacritic: "Error", rating: "Error", playtime: "Error", esrb: "Error", platforms: "Error" }); 
            }
            
            await new Promise(r => setTimeout(r, 250));

            // ⏱️ Stop Stopwatch and update ETA
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

    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;
        isPaused = false; shouldStop = false;

        if (!rawgApiKey) {
            let input = prompt("Enter RAWG API Key, or Cancel for Titles & Epic data only.");
            if (input) { rawgApiKey = input.trim(); GM_setValue("rawg_api_key", rawgApiKey); }
            else { if (confirm("Export WITHOUT RAWG tags? (You will still get Epic Prices/Order IDs)")) skipTags = true; else return; }
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
                finalData = games.map(g => ({ ...g, title: smartCleanTitle(g.title), tags: "N/A", releaseDate: "N/A", metacritic: "N/A", rating: "N/A", playtime: "N/A", esrb: "N/A", platforms: "N/A" }));
            } else {
                logMessage(`Found ${games.length} titles. Syncing with RAWG...`, "#0078f2");
                finalData = await fetchTagsWithControls(games, rawgApiKey);
            }

            finalData.sort((a, b) => a.title.localeCompare(b.title));
            downloadCSV(finalData);
            
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

    function downloadCSV(data) {
        const userName = getFormattedUserName();
        const timestamp = formatDateTime(new Date());
        const fileTime = timestamp.replace(/\//g, '-').replace(/:/g, '.');
        
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
        
        const content = [header, ...rows].map(e => e.join(",")).join("\n");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = `EpicGames_${userName}_Library_${fileTime}.csv`;
        link.click();
    }

    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Full Data';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.3);';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    setInterval(createButton, 2000);
})();
