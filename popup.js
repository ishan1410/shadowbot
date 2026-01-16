// popup.js
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
        // Notify content script of change (optional, but good for immediate effect)
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "updateSettings", autoTrack: isEnabled });
            }
        });
    });

    function updateUI(data) {
        if (data) {
            currentJobData = data;
            // Reset ID on new scan
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

    function scanPage(isManual = false) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            // Safety check for tab
            if (!tabs[0] || !tabs[0].url) {
                statusText.innerText = "No active page";
                statusIndicator.classList.remove('active');
                statusIndicator.classList.remove('pulse');
                document.getElementById('success-view').classList.add('hidden'); // Ensure success is hidden
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { action: "scrape" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("ShadowBot: Connection failed:", chrome.runtime.lastError.message);

                    if (isManual) {
                        statusText.innerText = "Reloading...";
                        chrome.tabs.reload(tabs[0].id);
                        return;
                    }

                    statusText.innerText = "No active page";
                    statusIndicator.classList.remove('active');
                    statusIndicator.classList.remove('pulse');
                    document.getElementById('success-view').classList.add('hidden');
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

    // ... (saveBtn logic remains same) ...
    // Note: I will only replace the scanPage and updateUI wrapper to avoid huge diffs if possible, 
    // but the regex replace handles blocks well.

    // ... (saveBtn event listener) ...

    // ... (manualScanBtn) ...

    // ... (Pin logic) ...

    // ...

    // Initial scan
    scanPage();



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

            console.log("Saving job data:", currentJobData);

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

    manualScanBtn.addEventListener('click', () => scanPage(true));

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
                source: "Manual",
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
    const pinBtn = document.getElementById('pin-sidepanel');
    if (pinBtn) {
        pinBtn.addEventListener('click', () => {
            // Open side panel
            // Note: chrome.sidePanel.open requires Chrome 116+ and user gesture
            if (chrome.sidePanel && chrome.sidePanel.open) {
                chrome.windows.getCurrent({ populate: false }, (window) => {
                    chrome.sidePanel.open({ windowId: window.id });
                    window.close(); // Optional: close popup
                });
            } else {
                // Fallback or older Chrome
                alert("To pin, please open the Side Panel from the Chrome toolbar.");
            }
        });
    }
    // Initial scan
    scanPage();

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
});
