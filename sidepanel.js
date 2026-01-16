// sidepanel.js
document.addEventListener('DOMContentLoaded', () => {
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.querySelector('.status-indicator');
    const jobDetails = document.getElementById('job-details');
    const noJob = document.getElementById('no-job');
    const roleInput = document.getElementById('role');
    const companyInput = document.getElementById('company');
    const importanceInput = document.getElementById('importance');
    const notesInput = document.getElementById('notes');
    const saveBtn = document.getElementById('save-btn');
    const manualScanBtn = document.getElementById('manual-scan');
    const autoTrackToggle = document.getElementById('auto-track-toggle');
    const tagChips = document.querySelectorAll('.tag-chip');
    let selectedTags = [];

    // Tag Selection Logic
    tagChips.forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
            const value = chip.getAttribute('data-value');
            if (chip.classList.contains('selected')) {
                selectedTags.push(value);
            } else {
                selectedTags = selectedTags.filter(t => t !== value);
            }
        });
    });

    let currentJobData = null;
    let currentJobId = null; // Track ID for session updates

    // Load Auto-Track setting
    chrome.storage.local.get(['autoTrack'], (result) => {
        autoTrackToggle.checked = result.autoTrack !== false; // Default to true if not set
    });

    // Save Auto-Track setting
    autoTrackToggle.addEventListener('change', () => {
        const isEnabled = autoTrackToggle.checked;
        chrome.storage.local.set({ autoTrack: isEnabled });
        // Notify content script of change
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "updateSettings", autoTrack: isEnabled });
            }
        });
    });

    function updateUI(data) {
        if (data) {
            currentJobData = data;
            // Reset ID on new scan unless it's the same URL/session (but we want strict "new scan = new job" logic mostly)
            // Actually, if we re-scan the same page, we might want to keep the ID if we already saved it?
            // For now, let's reset ID on scan to ensure "fresh" state, 
            // BUT if the user just saved, they are in the same session.
            // The scan happens on load.

            // If the URL is different from what we last saved, definitely reset.
            // If it's the same, maybe we should check if we have a saved ID for this URL? 
            // Complexity: The user wants "Always New" on fresh track.
            // So, reset ID on scan is correct.
            currentJobId = null;

            statusText.innerText = "Job Detected";
            statusText.style.color = "#1e293b";
            statusIndicator.classList.add('active');
            statusIndicator.classList.remove('pulse');

            roleInput.value = data.role;
            companyInput.value = data.company;

            jobDetails.classList.remove('hidden');
            noJob.classList.add('hidden');

            // Reset save button state
            saveBtn.innerText = "Track Application";
            saveBtn.disabled = false;
            saveBtn.style.background = "";
        } else {
            statusText.innerText = "Scanning...";
            statusIndicator.classList.remove('active');
            statusIndicator.classList.add('pulse');

            jobDetails.classList.add('hidden');
            noJob.classList.remove('hidden');
        }
    }

    function scanPage() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0] || !tabs[0].id) return;

            // Only scan if URL is valid (http/https)
            if (!tabs[0].url.startsWith('http')) {
                updateUI(null);
                statusText.innerText = "Idle";
                statusIndicator.classList.remove('pulse');
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { action: "scrape" }, (response) => {
                if (chrome.runtime.lastError) {
                    // console.log(chrome.runtime.lastError.message);
                    statusText.innerText = "No active page";
                    statusIndicator.classList.remove('active');
                    statusIndicator.classList.remove('pulse');
                    return;
                }

                if (response && response.data) {
                    updateUI(response.data);
                } else {
                    updateUI(null);
                    statusText.innerText = "Idle";
                    statusIndicator.classList.remove('pulse');
                }
            });
        });
    }

    saveBtn.addEventListener('click', () => {
        if (currentJobData) {
            saveBtn.innerText = "Saving...";
            // Derive status from tags or default to 'Applied'
            let status = "Applied";
            if (selectedTags.length > 0) {
                status = selectedTags[0];
            } else {
                // Determine if we should add "Applied" to tags if empty
                selectedTags.push("Applied");
            }

            // Update all fields from input
            currentJobData.importance = importanceInput.value;
            currentJobData.notes = notesInput.value;
            currentJobData.tags = selectedTags;
            currentJobData.status = status; // EXPLICITLY SET STATUS

            // Attach the session ID if it exists
            if (currentJobId) {
                currentJobData.id = currentJobId;
            }

            console.log("Saving job data from Sidepanel:", currentJobData);

            chrome.runtime.sendMessage({ action: "saveApplication", data: currentJobData }, (response) => {
                if (response.status === "success" || response.status === "updated") {

                    // --- SUCCESS STATE LOGIC ---
                    // 1. Save URL to storage to persist success state
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.storage.local.set({ lastTrackedUrl: tabs[0].url });
                        }
                    });

                    // 2. Hide Form, Show Success
                    jobDetails.classList.add('hidden');
                    document.getElementById('status-card').classList.add('hidden'); // Hide status card too
                    document.getElementById('success-view').classList.remove('hidden');

                    // Capture the returned ID for this session
                    if (response.id) {
                        currentJobId = response.id;
                    }

                    // Reset button (in case they navigate back)
                    saveBtn.innerText = "Track Application";
                    saveBtn.style.background = "";

                } else if (response.status === "duplicate") {
                    saveBtn.innerText = "Already Tracked";
                    saveBtn.disabled = true;
                }
            });
        }
    });

    manualScanBtn.addEventListener('click', scanPage);

    // Manual Entry Logic
    const manualAddBtn = document.getElementById('manual-add-btn');
    const manualEntryView = document.getElementById('manual-entry-view');
    const cancelManualBtn = document.getElementById('cancel-manual-btn');
    const saveManualBtn = document.getElementById('save-manual-btn');

    if (manualAddBtn) {
        manualAddBtn.addEventListener('click', () => {
            noJob.classList.add('hidden');
            manualEntryView.classList.remove('hidden');

            // Pre-fill URL if possible
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].url) {
                    document.getElementById('manual-link').value = tabs[0].url;
                }
            });
        });
    }

    if (cancelManualBtn) {
        cancelManualBtn.addEventListener('click', () => {
            manualEntryView.classList.add('hidden');
            noJob.classList.remove('hidden');
        });
    }

    if (saveManualBtn) {
        saveManualBtn.addEventListener('click', () => {
            const role = document.getElementById('manual-role').value;
            const company = document.getElementById('manual-company').value;
            const link = document.getElementById('manual-link').value;
            const status = document.getElementById('manual-status').value;
            const notes = document.getElementById('manual-notes').value;
            const description = document.getElementById('manual-desc').value;

            if (!role || !company) {
                alert("Role and Company are required.");
                return;
            }

            const manualData = {
                id: crypto.randomUUID(),
                role: role,
                company: company,
                url: link,
                status: status,
                notes: notes,
                description: description,
                date: new Date().toISOString(),
                source: "Manual (Sidepanel)",
                importance: "Medium", // Default
                tags: [status]
            };

            saveManualBtn.innerText = "Saving...";

            chrome.runtime.sendMessage({ action: "saveApplication", data: manualData }, (response) => {
                if (response && response.status === "success" || response.status === "updated") {
                    // Show success view
                    manualEntryView.classList.add('hidden');
                    document.getElementById('success-view').classList.remove('hidden');
                    document.getElementById('status-card').classList.add('hidden');
                } else {
                    alert("Error saving: " + (response ? response.status : "Unknown error"));
                    saveManualBtn.innerText = "Save Job";
                }
            });
        });
    }

    // Initial scan
    scanPage();

    // --- Side Panel Specific: Tab Listeners ---

    // Re-scan when switching tabs
    chrome.tabs.onActivated.addListener((activeInfo) => {
        scanPage();
    });

    // Re-scan when tab is updated (e.g. navigation)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.active) {
            scanPage();
        }
    });

    // Modified updateUI to check for success state
    const originalUpdateUI = updateUI;
    updateUI = function (data) {
        // Check if we should show success state instead
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0] || !tabs[0].url) {
                originalUpdateUI(data);
                return;
            }
            const currentUrl = tabs[0].url;

            chrome.storage.local.get(['lastTrackedUrl'], (result) => {
                // STRICT CHECK: Ensure lastTrackedUrl exists (truthy) and matches
                if (result.lastTrackedUrl && result.lastTrackedUrl === currentUrl) {
                    // We are still on the tracked page!
                    jobDetails.classList.add('hidden');
                    noJob.classList.add('hidden');
                    document.getElementById('status-card').classList.add('hidden');
                    document.getElementById('success-view').classList.remove('hidden');
                } else {
                    // New page, show normal UI
                    originalUpdateUI(data);
                    document.getElementById('success-view').classList.add('hidden');
                    document.getElementById('status-card').classList.remove('hidden');
                }
            });
        });
    };

    // --- NEW: LISTEN FOR STORAGE CHANGES (SYNC WITH POPUP) ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            // If lastTrackedUrl changes, it means a job was just saved (potentially from popup)
            if (changes.lastTrackedUrl) {
                // Re-run updateUI to check if we should show success
                // We pass null or currentJobData, but scanPage is better
                scanPage();
            }
        }
    });
});
