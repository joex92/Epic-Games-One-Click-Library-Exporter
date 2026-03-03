// ==UserScript==
// @name         One-Click Epic Games Library to CSV
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Bypasses Content Security Policy (CSP) errors to fetch RAWG tags.
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
        const hh = String(dateObj.getHours()).padStart(2, '0');
        const mm = String(dateObj.getMinutes()).padStart(2, '0');
        const ss = String(dateObj.getSeconds()).padStart(2, '0');
        return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    }

    // --- UI ---
    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Library (Fixed CSP)';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;

        if (!rawgApiKey) {
            let input = prompt("Enter RAWG API Key for tags, or Cancel to export without tags.");
            if (input) {
                rawgApiKey = input.trim();
                GM_setValue("rawg_api_key", rawgApiKey);
            } else {
                if (confirm("Export WITHOUT tags?")) skipTags = true; else return;
            }
        }

        const btn = document.getElementById('epic-csv-export-btn');
        btn.innerText = 'Loading Epic Data...';
        btn.disabled = true;

        try {
            const games = await fetchHistory();
            let finalData;

            if (skipTags) {
                finalData = games.map(g => ({ ...g, tags: "N/A" }));
            } else {
                btn.innerText = `Tagging ${games.length} items...`;
                finalData = await fetchTagsFromRAWG(games, btn, rawgApiKey);
            }

            finalData.sort((a, b) => a.title.localeCompare(b.title));
            downloadCSV(finalData);

            btn.innerText = 'Export Complete!';
            btn.style.backgroundColor = '#28a745';
        } catch (e) {
            console.error(e);
            btn.innerText = 'Error! Check Console.';
            btn.style.backgroundColor = '#dc3545';
        }
        setTimeout(() => { btn.innerText = 'Export Library (Fixed CSP)'; btn.disabled = false; btn.style.backgroundColor = '#0078f2'; }, 5000);
    }

    // --- DATA FETCHING (Internal Epic API is okay with standard fetch) ---
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

    // --- RAWG FETCHING (Requires GM_xmlhttpRequest to bypass CSP) ---
    function fetchRAWGData(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(JSON.parse(response.responseText));
                    } else if (response.status === 401) {
                        reject(new Error("Key Invalid"));
                    } else {
                        reject(new Error("API Error"));
                    }
                },
                onerror: function(err) {
                    reject(err);
                }
            });
        });
    }

    async function fetchTagsFromRAWG(games, btn, apiKey) {
        const results = [];
        for (let i = 0; i < games.length; i++) {
            if (i % 5 === 0) btn.innerText = `Tagging: ${i+1}/${games.length}...`;
            const searchTitle = games[i].title.replace(/ (Standard|Premium|Deluxe|Ultimate|Gold|GOTY|Director's Cut) Edition/gi, '').trim();
            const rawgUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(searchTitle)}&page_size=1&key=${apiKey}`;

            try {
                const data = await fetchRAWGData(rawgUrl);
                if (data.results?.length > 0) {
                    const info = data.results[0];
                    const meta = [...new Set([...(info.genres?.map(g => g.name) || []), ...(info.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 4) || [])])];
                    results.push({ ...games[i], tags: meta.join(', ') });
                } else {
                    results.push({ ...games[i], tags: "Not found" });
                }
            } catch (e) {
                if (e.message === "Key Invalid") { alert("Invalid API Key."); break; }
                results.push({ ...games[i], tags: "Error" });
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return results;
    }

    // --- EXPORT ---
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
