// ==UserScript==
// @name         Epic Games Library to CSV (Public - Timestamped)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Exports Epic history to CSV with RAWG tags, alphabetical sorting, and a YYYY/MM/DD HH:MM:SS timestamped filename.
// @author       JoeX92 & Gemini AI Pro
// @match        https://www.epicgames.com/account/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // API KEY MANAGEMENT
    // ==========================================

    GM_registerMenuCommand("Update RAWG API Key", function() {
        const currentKey = GM_getValue("rawg_api_key", "");
        const newKey = prompt("Enter your new RAWG API Key (leave blank to clear it):", currentKey);
        if (newKey !== null) {
            GM_setValue("rawg_api_key", newKey.trim());
            alert("RAWG API Key updated successfully!");
        }
    });

    // Helper to get formatted date string for the filename and rows
    function getTimestamp() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    }

    // ==========================================
    // UI AND EXPORT LOGIC
    // ==========================================

    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Library with Timestamp';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';

        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    async function startExport() {
        let rawgApiKey = GM_getValue("rawg_api_key", "");
        let skipTags = false;

        // Check for key/permission
        if (!rawgApiKey) {
            let userInput = prompt("Enter RAWG.io API Key for tags, or click Cancel to export titles only.");
            if (userInput !== null && userInput.trim() !== "") {
                rawgApiKey = userInput.trim();
                GM_setValue("rawg_api_key", rawgApiKey);
            } else {
                if (confirm("Export WITHOUT tags?")) { skipTags = true; } else { return; }
            }
        }

        const btn = document.getElementById('epic-csv-export-btn');
        btn.innerText = 'Fetching History...';
        btn.disabled = true;

        try {
            const games = await fetchHistory();
            let finalData;

            if (skipTags) {
                finalData = games.map(g => ({ ...g, tags: "No tags requested" }));
            } else {
                btn.innerText = `Tagging ${games.length} items...`;
                finalData = await fetchTagsFromRAWG(games, btn, rawgApiKey);
            }

            // Sort alphabetical
            finalData.sort((a, b) => a.title.localeCompare(b.title));

            downloadCSV(finalData);
            
            btn.innerText = 'Export Complete!';
            btn.style.backgroundColor = '#28a745';
        } catch (error) {
            console.error(error);
            btn.innerText = 'Error! Check Console.';
            btn.style.backgroundColor = '#dc3545';
        }

        setTimeout(() => {
            btn.innerText = 'Export Library with Timestamp';
            btn.disabled = false;
            btn.style.backgroundColor = '#0078f2';
        }, 5000);
    }

    async function fetchHistory(nextPageToken = '', allGames = []) {
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const response = await fetch(url);
        const data = await response.json();

        for (const order of data.orders) {
            // Capture the date from the order metadata
            const orderDate = new Date(order.createdAt).toLocaleDateString();
            for (const item of order.items) {
                allGames.push({ title: item.description, date: orderDate });
            }
        }

        if (data.nextPageToken) return fetchHistory(data.nextPageToken, allGames);

        const uniqueGames = [];
        const titles = new Set();
        for (const game of allGames) {
            if (!titles.has(game.title)) {
                titles.add(game.title);
                uniqueGames.push(game);
            }
        }
        return uniqueGames;
    }

    async function fetchTagsFromRAWG(games, btn, apiKey) {
        const results = [];
        for (let i = 0; i < games.length; i++) {
            const game = games[i];
            if (i % 5 === 0) btn.innerText = `Tagging: ${i+1} / ${games.length}...`;

            const searchTitle = game.title.replace(/ (Standard|Premium|Deluxe|Ultimate|Gold|GOTY|Director's Cut) Edition/gi, '').trim();
            const rawgUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(searchTitle)}&page_size=1&key=${apiKey}`;

            try {
                const res = await fetch(rawgUrl);
                if (res.status === 401) throw new Error("Invalid API Key");
                const rawgData = await res.json();

                if (rawgData?.results?.length > 0) {
                    const info = rawgData.results[0];
                    const genres = info.genres?.map(g => g.name) || [];
                    const tags = info.tags?.filter(t => t.language === 'eng').map(t => t.name) || [];
                    const combined = [...new Set([...genres, ...tags.slice(0, 4)])]; 
                    results.push({ ...game, tags: combined.join(', ') });
                } else {
                    results.push({ ...game, tags: "Not found" });
                }
            } catch (e) {
                if (e.message === "Invalid API Key") { alert("Bad API Key."); break; }
                results.push({ ...game, tags: "Error" });
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return results;
    }

    function downloadCSV(data) {
        const timestamp = getTimestamp();
        // Clean timestamp for filename (remove slashes/colons for OS compatibility)
        const fileSafeTime = timestamp.replace(/\//g, '-').replace(/:/g, '.');
        
        const header = ['Game Title', 'Date Added', 'RAWG Genres & Tags'];
        const rows = data.map(row => [
            `"${row.title.replace(/"/g, '""')}"`,
            `"${row.date}"`,
            `"${row.tags.replace(/"/g, '""')}"`
        ]);

        const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        // Filename format: Epic_Library_YYYY-MM-DD HH.MM.SS.csv
        link.setAttribute("download", `Epic_Library_${fileSafeTime}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    setInterval(createButton, 2000);

})();
