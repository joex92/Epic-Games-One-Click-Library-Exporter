// ==UserScript==
// @name         One-Click Epic Games Library to CSV Exporter
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Fetches Epic Games library via transaction history, filters out add-ons, retrieves tags, and exports to CSV.
// @author       JoeX92 & Gemini AI Pro
// @match        https://www.epicgames.com/account/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. Create a floating button on the page
    function createButton() {
        if (document.getElementById('epic-csv-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'epic-csv-export-btn';
        btn.innerText = 'Export Clean Library to CSV';
        btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 12px 24px; background-color: #0078f2; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';

        btn.onclick = startExport;
        document.body.appendChild(btn);
    }

    // 2. Main execution logic
    async function startExport() {
        const btn = document.getElementById('epic-csv-export-btn');
        btn.innerText = 'Fetching History...';
        btn.disabled = true;
        btn.style.backgroundColor = '#555';

        try {
            const games = await fetchHistory();
            btn.innerText = `Fetching Tags for ${games.length} base games...`;

            const dataWithTags = await fetchTagsForGames(games, btn);

            downloadCSV(dataWithTags);
            btn.innerText = 'Export Complete!';
            btn.style.backgroundColor = '#28a745';
        } catch (error) {
            console.error(error);
            btn.innerText = 'Error! Check Console.';
            btn.style.backgroundColor = '#dc3545';
        }

        // Reset button after 5 seconds
        setTimeout(() => {
            btn.innerText = 'Export Clean Library to CSV';
            btn.disabled = false;
            btn.style.backgroundColor = '#0078f2';
        }, 5000);
    }

    // 3. Fetch all transactions, filter junk, and deduplicate
    async function fetchHistory(nextPageToken = '', allGames = []) {
        const url = `https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory?nextPageToken=${nextPageToken}&locale=en-US`;
        const response = await fetch(url);
        const data = await response.json();

        // Keywords that usually indicate an add-on or currency, not a base game
        const ignoreKeywords = ['v-bucks', 'credits', 'pack', 'dlc', 'addon', 'add-on', 'upgrade', 'soundtrack', 'kudos', 'platinum', 'coins'];

        for (const order of data.orders) {
            for (const item of order.items) {
                const titleLower = item.description.toLowerCase();
                
                // Check if the title contains any of our ignore keywords
                const isAddon = ignoreKeywords.some(keyword => titleLower.includes(keyword));

                if (!isAddon) {
                    allGames.push({
                        title: item.description,
                        namespace: item.namespace
                    });
                }
            }
        }

        if (data.nextPageToken) {
            return fetchHistory(data.nextPageToken, allGames);
        }

        // Remove duplicates (in case you somehow bought the same game twice)
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

    // 4. Fetch tags from the Catalog API
    async function fetchTagsForGames(games, btn) {
        const results = [];
        let count = 0;

        for (const game of games) {
            count++;
            // Update UI every 5 items so the browser doesn't freeze
            if (count % 5 === 0) {
                btn.innerText = `Fetching Tags: ${count} / ${games.length}...`;
            }

            if (!game.namespace) {
                results.push({ title: game.title, tags: "No namespace" });
                continue;
            }

            const catalogUrl = `https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/${game.namespace}`;

            try {
                const res = await fetch(catalogUrl);
                if (!res.ok) throw new Error('Not found');
                const catData = await res.json();

                // Extract and combine Genre and Feature tags
                const tags = catData.pages[0]?.data?.metaData?.attributes
                    ?.filter(attr => attr.key === 'genre' || attr.key === 'feature')
                    .map(attr => attr.value) || ["No tags found"];

                results.push({ title: game.title, tags: [...new Set(tags)].join(', ') });
            } catch (e) {
                // If it still 404s (e.g. a delisted game), it gracefully marks it and moves on
                results.push({ title: game.title, tags: "Metadata unavailable" });
            }

            // IMPORTANT: Add a 100ms delay to prevent Epic from rate-limiting your IP
            await new Promise(r => setTimeout(r, 100));
        }
        return results;
    }

    // 5. Build and download the CSV
    function downloadCSV(data) {
        const header = ['Game Title', 'Tags'];
        
        // Escape quotes and wrap fields in quotes to handle commas inside titles/tags
        const rows = data.map(row => [
            `"${row.title.replace(/"/g, '""')}"`,
            `"${row.tags.replace(/"/g, '""')}"`
        ]);

        const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "Epic_Games_Clean_Library_With_Tags.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Continuously check and re-add the button if the user navigates tabs on the page
    setInterval(createButton, 2000);

})();
