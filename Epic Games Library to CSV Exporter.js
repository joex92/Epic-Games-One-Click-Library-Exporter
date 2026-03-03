// ==UserScript==
// @name         One-Click Epic Games Library to CSV
// @namespace    https://github.com/joex92/Epic-Games-One-Click-Library-Exporter
// @version      5.8
// @description  Bypasses CSP, fixes 'Unexpected Token' error with better session detection.
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

    // --- HELPER FUNCTIONS ---
    function formatDateTime(dateObj) {
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

    // --- UI COMPONENTS ---
    function createLogger() {
        if (logContainer) return;
        logContainer = document.createElement('div');
        logContainer.id = 'epic-logger-container';
        logContainer.style.cssText = 'position: fixed; bottom: 80px; right: 20px; width: 380px; background: rgba(0,0,0,0.95); border-radius: 8px; z-index: 10000; display: none; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;';
        
        const progressWrapper = document.createElement('div');
        progressWrapper.style.cssText = 'width: 100%; height: 4px; background: #222;';
        progressBar = document.createElement('div');
        progressBar.style.cssText = 'width: 0%; height: 100%; background: #0078f2; transition: width 0.2s ease;';
        progressWrapper.appendChild(progressBar);
        logContainer.appendChild(progressWrapper);

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #1a1a1a; border-bottom: 1px solid #333;';
        header.innerHTML = `<span style="color:#eee; font-size:11px; font-weight:bold;">Epic Metadata Export</span>
            <div>
                <button id="epic-pause" style="background:#555; color:white; border:none; padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer; margin-right:5px;">Pause</button>
                <button id="epic-stop" style="background:#dc3545; color:white; border:none; padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer;">Stop & Save</button>
            </div>`;
        logContainer.appendChild(header);

        const logText = document.createElement('div');
        logText.id = 'epic-log-text';
        logText.style.cssText = 'height: 180px; color: #ccc; font-family: "Consolas", monospace; font-size: 11px; padding: 12px; overflow-y: auto; line-height: 1.6;';
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

    // --- DATA FETCHING (Now with Error Check) ---
    async function fetchHistory(nextPageToken = '', allGames = []) {
        // Updated Endpoint
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const res = await fetch(url);
        
        // CHECK: If the response isn't JSON, Epic redirected to a login/error page
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Epic session expired or blocked. Please refresh the page and try again.");
        }

        const data = await res.json();
        if (!data.orders) return allGames;

        for (const order of data.orders) {
            const dateStr = formatDateTime(new Date(order.createdAt));
            for (const item of order.items) { allGames.push({ title: item.description, dateAdded: dateStr }); }
        }
        if (data.nextPageToken) return fetchHistory(data.nextPageToken, allGames);
        
        const unique = [];
        const seen = new Set();
        for (const g of allGames) { if (!seen.has(g.title)) { seen.add(g.title); unique.push(g); } }
        return unique;
    }

    async function fetchTagsWithControls(games, apiKey) {
        const results = [];
        const total = games.length;
        for (let i = 0; i < total; i++) {
            if (shouldStop) { logMessage("STOPPED: Saving partial data...", "#dc3545"); break; }
            while (isPaused && !shouldStop) { await new Promise(r => setTimeout(r, 500)); }

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
                    logMessage(`<span style="color:#0078f2;">#${i+1}</span> ${displayTitle}`);
                    results.push({ ...games[i], title: displayTitle, tags: meta.join(', ') || "No tags" });
                } else {
                    logMessage(`<span style="color:#555;">#${i+1}</span> ${displayTitle} (No match)`);
                    results.push({ ...games[i], title: displayTitle, tags: "N/A" });
                }
            } catch (e) { results.push({ ...games[i], title: displayTitle, tags: "Error" }); }
            await new Promise(r => setTimeout(r, 250)); // Slight delay to avoid RAWG rate limit
        }
        return results;
    }

    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;
        isPaused = false; shouldStop = false;

        if (!rawgApiKey) {
            let input = prompt("Enter RAWG API Key, or Cancel for Titles only.");
            if (input) { rawgApiKey = input.trim(); GM_setValue("rawg_api_key", rawgApiKey); }
            else { if (confirm("Export WITHOUT tags?")) skipTags = true; else return; }
        }

        const btn = document.getElementById('epic-csv-export-btn');
        btn.disabled = true;
        if (logContainer) document.getElementById('epic-log-text').innerHTML = '';

        try {
            logMessage("Verifying Epic Session...", "#0078f2");
            const games = await fetchHistory();
            
            let finalData = [];
            if (skipTags) {
                finalData = games.map(g => ({ ...g, title: smartCleanTitle(g.title), tags: "N/A" }));
            } else {
                logMessage(`Found ${games.length} titles. Starting sync...`, "#0078f2");
                finalData = await fetchTagsWithControls(games, rawgApiKey);
            }

            finalData.sort((a, b) => a.title.localeCompare(b.title));
            downloadCSV(finalData);
            btn.innerText = 'Complete!';
            btn.style.backgroundColor = '#28a745';
        } catch (e) {
            logMessage(`ERROR: ${e.message}`, "#dc3545");
            btn.innerText = 'Failed (Check Log)';
            btn.style.backgroundColor = '#dc3545';
        }

        setTimeout(() => { 
            if (logContainer) logContainer.style.display = 'none';
            btn.innerText = 'Export Library (v5.8)'; 
            btn.disabled = false; 
            btn.style.backgroundColor = '#0078f2'; 
        }, 12000);
    }

    function downloadCSV(data) {
        const timestamp = formatDateTime(new Date());
        const fileTime = timestamp.replace(/\//g, '-').replace(/:/g, '.');
        const header = ['Game Title', 'Date Added', 'Tags & Genres'];
        const rows = data.map(r => [`"${r.title.replace(/"/g, '""')}"`, `"${r.dateAdded}"`, `"${r.tags.replace(/"/g, '""')}"`]);
        const content = [header, ...rows].map(e => e.join(",")).join("\n");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Epic_Library_${fileTime}.csv`;
        link.click();
    }

    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Library (v5.8)';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.3);';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    setInterval(createButton, 2000);
})();
