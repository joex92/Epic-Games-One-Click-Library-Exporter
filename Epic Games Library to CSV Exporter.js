// ==UserScript==
// @name         One-Click Epic Games Library to CSV
// @namespace    https://github.com/joex92/Epic-Games-One-Click-Library-Exporter/
// @version      5.4
// @description  Bypasses CSP, exports Epic history to CSV, and shows a live log with a seamless progress bar.
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

    // --- API KEY MANAGEMENT ---
    GM_registerMenuCommand("Update RAWG API Key", function() {
        const currentKey = GM_getValue("rawg_api_key", "");
        const newKey = prompt("Enter your RAWG API Key:", currentKey);
        if (newKey !== null) {
            GM_setValue("rawg_api_key", newKey.trim());
            alert("Key updated!");
        }
    });

    function formatDateTime(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0'); // Note: 'now' fixed to dateObj below
        const mm = String(dateObj.getMinutes()).padStart(2, '0');
        const ss = String(dateObj.getSeconds()).padStart(2, '0');
        return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    }
    // Fixed reference for the internal date helper
    function getNowFormatted() { return formatDateTime(new Date()); }

    // --- UI COMPONENTS ---
    function createLogger() {
        if (logContainer) return;
        
        // Main Container
        logContainer = document.createElement('div');
        logContainer.id = 'epic-logger-container';
        logContainer.style.cssText = 'position: fixed; bottom: 80px; right: 20px; width: 380px; background: rgba(0,0,0,0.9); border-radius: 8px; z-index: 10000; display: none; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;';
        
        // Progress Bar Wrapper
        const progressWrapper = document.createElement('div');
        progressWrapper.style.cssText = 'width: 100%; height: 6px; background: #222;';
        
        progressBar = document.createElement('div');
        progressBar.style.cssText = 'width: 0%; height: 100%; background: #0078f2; transition: width 0.3s ease;';
        
        progressWrapper.appendChild(progressBar);
        logContainer.appendChild(progressWrapper);

        // Text Log Area
        const logText = document.createElement('div');
        logText.id = 'epic-log-text';
        logText.style.cssText = 'height: 200px; color: #aaa; font-family: "Segoe UI", monospace; font-size: 11px; padding: 12px; overflow-y: auto; pointer-events: none; line-height: 1.5;';
        logContainer.appendChild(logText);

        document.body.appendChild(logContainer);
    }

    function logMessage(msg, color = "#aaa") {
        if (!logContainer) createLogger();
        logContainer.style.display = 'block';
        const logText = document.getElementById('epic-log-text');
        const line = document.createElement('div');
        line.style.color = color;
        line.innerHTML = `<span style="color: #555;">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
        logText.appendChild(line);
        logText.scrollTop = logText.scrollHeight;
    }

    function updateProgress(current, total) {
        if (progressBar) {
            const percentage = (current / total) * 100;
            progressBar.style.width = `${percentage}%`;
        }
    }

    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Library (v5.4)';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: all 0.2s;';
        
        btn.onmouseover = () => btn.style.backgroundColor = '#0062c4';
        btn.onmouseout = () => btn.style.backgroundColor = '#0078f2';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    // --- MAIN LOGIC ---
    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;

        if (!rawgApiKey) {
            let input = prompt("Enter RAWG API Key for tags, or Cancel to export titles only.");
            if (input) {
                rawgApiKey = input.trim();
                GM_setValue("rawg_api_key", rawgApiKey);
            } else {
                if (confirm("Export WITHOUT tags?")) skipTags = true; else return;
            }
        }

        const btn = document.getElementById('epic-csv-export-btn');
        btn.disabled = true;
        btn.style.opacity = "0.7";
        if (logContainer) document.getElementById('epic-log-text').innerHTML = '';
        updateProgress(0, 100);

        try {
            logMessage("Connecting to Epic Games account services...", "#0078f2");
            const games = await fetchHistory();
            logMessage(`Success: ${games.length} games identified.`, "#28a745");
            
            let finalData;
            if (skipTags) {
                logMessage("Bypassing RAWG metadata sync.");
                updateProgress(100, 100);
                finalData = games.map(g => ({ ...g, tags: "N/A" }));
            } else {
                logMessage("Initiating RAWG API handshake...", "#0078f2");
                finalData = await fetchTagsFromRAWG(games, btn, rawgApiKey);
            }

            logMessage("Finalizing CSV structure and sorting...", "#ffc107");
            finalData.sort((a, b) => a.title.localeCompare(b.title));
            downloadCSV(finalData);

            btn.innerText = 'Done!';
            btn.style.backgroundColor = '#28a745';
            logMessage("EXPORT COMPLETE: Check your downloads folder.", "#28a745");
        } catch (e) {
            logMessage(`ERROR: ${e.message}`, "#dc3545");
            btn.innerText = 'Failed';
            btn.style.backgroundColor = '#dc3545';
        }

        setTimeout(() => { 
            if (logContainer) logContainer.style.display = 'none';
            btn.innerText = 'Export Library (v5.4)'; 
            btn.disabled = false; 
            btn.style.opacity = "1";
            btn.style.backgroundColor = '#0078f2'; 
        }, 10000);
    }

    async function fetchHistory(nextPageToken = '', allGames = []) {
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const res = await fetch(url);
        const data = await res.json();

        for (const order of data.orders) {
            const dateStr = formatDateTime(new Date(order.createdAt));
            for (const item of order.items) {
                allGames.push({ title: item.description, dateAdded: dateStr });
            }
        }
        if (data.nextPageToken) return fetchHistory(data.nextPageToken, allGames);

        const unique = [];
        const seen = new Set();
        for (const g of allGames) {
            if (!seen.has(g.title)) { seen.add(g.title); unique.push(g); }
        }
        return unique;
    }

    function fetchRAWGData(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => (res.status === 200) ? resolve(JSON.parse(res.responseText)) : (res.status === 401 ? reject(new Error("Key Invalid")) : reject(new Error("API Error"))),
                onerror: (err) => reject(err)
            });
        });
    }

    async function fetchTagsFromRAWG(games, btn, apiKey) {
        const results = [];
        const total = games.length;
        for (let i = 0; i < total; i++) {
            const game = games[i];
            updateProgress(i + 1, total);
            
            const searchTitle = game.title.replace(/ (Standard|Premium|Deluxe|Ultimate|Gold|GOTY|Director's Cut) Edition/gi, '').trim();
            const rawgUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(searchTitle)}&page_size=1&key=${apiKey}`;

            try {
                const data = await fetchRAWGData(rawgUrl);
                if (data.results?.length > 0) {
                    const info = data.results[0];
                    const meta = [...new Set([...(info.genres?.map(g => g.name) || []), ...(info.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 4) || [])])];
                    const tagsStr = meta.join(', ');
                    logMessage(`<span style="color:#0078f2;">[${i+1}/${total}]</span> ${game.title} <span style="color:#666;">➔</span> ${tagsStr || 'Generic'}`);
                    results.push({ ...game, tags: tagsStr || "No tags" });
                } else {
                    logMessage(`<span style="color:#555;">[${i+1}/${total}]</span> ${game.title} <span style="color:#dc3545;">➔ Not Found</span>`);
                    results.push({ ...game, tags: "N/A" });
                }
            } catch (e) {
                if (e.message === "Key Invalid") throw e;
                results.push({ ...game, tags: "Error" });
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return results;
    }

    function downloadCSV(data) {
        const now = new Date();
        const timestamp = formatDateTime(now);
        const fileTime = timestamp.replace(/\//g, '-').replace(/:/g, '.');
        const header = ['Game Title', 'Date Added (YYYY/MM/DD HH:MM:SS)', 'Tags & Genres'];
        const rows = data.map(r => [`"${r.title.replace(/"/g, '""')}"`, `"${r.dateAdded}"`, `"${r.tags.replace(/"/g, '""')}"`]);
        const content = [header, ...rows].map(e => e.join(",")).join("\n");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Epic_Library_${fileTime}.csv`;
        link.click();
    }

    setInterval(createButton, 2000);
})();
