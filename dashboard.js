// dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
    setupEventListeners();
    setupNavigation();
});

// Global ESC Key Listener to Close Drawers
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const openDrawers = document.querySelectorAll('.drawer.show, .modal.show');
        const overlay = document.querySelector('.drawer-overlay.show');

        openDrawers.forEach(el => el.classList.remove('show'));
        if (overlay) overlay.classList.remove('show');
    }
});

let allApplications = [];
let currentFilter = {
    search: '',
    status: 'All',
    importance: 'All'
};

function loadApplications() {
    chrome.storage.local.get(['applications'], (result) => {
        allApplications = result.applications || [];

        // Migration check
        let modified = false;
        allApplications = allApplications.map(app => {
            if (!app.id) {
                app.id = crypto.randomUUID();
                modified = true;
            }
            return app;
        });
        if (modified) {
            chrome.storage.local.set({ applications: allApplications });
        }

        updateStats();
        renderTable(getFilteredApplications());
        renderAnalytics();

        // Auto-Check Email Status (Limit to recent, active jobs to avoid spamming)
        // Initial Check
        syncWithGmail(allApplications);

        // Periodic Check (Every 10 minutes) to keep dashboard fresh
        // 10 * 60 * 1000 = 600000ms
        setInterval(() => {
            console.log("ShadowBot: Running periodic Email Spy sync...");
            syncWithGmail(allApplications);
        }, 600000);
    });
}

function syncWithGmail(apps) {
    // Filter: 'Applied' or 'Emailed' from last 14 days
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const candidates = apps.filter(app => {
        const isRecent = new Date(app.date) > twoWeeksAgo;
        const isActive = ['Applied', 'Emailed'].includes(app.status);
        // Only check if we have a linked email OR we can deduce domain from company/url
        const hasContact = app.linkedEmail || app.url || app.company;
        return isRecent && isActive && hasContact;
    });

    if (candidates.length === 0) return;

    console.log(`ShadowBot: Syncing ${candidates.length} candidates with Gmail...`);

    candidates.forEach(app => {
        // Determine search terms (Array of possible matches)
        let searchTerms = [];
        let recipient = '';

        // 1. Linked Email: High Priority
        if (app.linkedEmail) {
            if (!app.linkedEmail.includes('@')) {
                // If it's not an email address, treat it as a strict subject match
                searchTerms.push(app.linkedEmail);
            } else {
                recipient = app.linkedEmail;
            }
        }

        // 2. Auto-Deduce from Notes (Look for email)
        if (!recipient && app.notes) {
            const emailMatch = app.notes.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
            if (emailMatch) {
                recipient = emailMatch[0];
            }
        }

        // 3. Fallback: Company Name & Role Name
        // We add both because sometimes subject is "Applying to Vercel" (Company)
        // and sometimes it is "Software Engineer Application" (Role)
        if (app.company) searchTerms.push(app.company);
        if (app.role) {
            searchTerms.push(app.role);
            // Add a "Cleaned" role (e.g. "Software Engineer | Remote" -> "Software Engineer")
            // Split by common separators: |, -, (, [, ,
            const cleanRole = app.role.split(/[|\-\(\[\,]/)[0].trim();
            if (cleanRole && cleanRole.length > 3 && cleanRole !== app.role) {
                searchTerms.push(cleanRole);
            }
        }

        // Dedupe
        searchTerms = [...new Set(searchTerms)].filter(s => s && s.length > 2); // Filter out short garbage

        chrome.runtime.sendMessage({
            action: "queryGmailStatus",
            searchTerms: searchTerms,
            recipient: recipient
        }, (response) => {
            if (response && response.status && response.status !== 'unknown') {
                // Determine new status
                const newOpenStatus = response.status; // 'sent' or 'opened'

                // Only update if changed
                if (app.emailStatus !== newOpenStatus) {
                    console.log(`ShadowBot: Email for ${app.company} is ${newOpenStatus}`);
                    updateApplicationField(app.id, 'emailStatus', newOpenStatus);
                }
            }
        });
    });
}

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update Nav State
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Switch View
            const targetId = item.getAttribute('data-target');
            views.forEach(view => {
                view.classList.remove('active');
                if (view.id === targetId) {
                    view.classList.add('active');
                }
            });

            // If switching to Home, re-render to ensure filters apply
            if (targetId === 'view-home') {
                renderTable(getFilteredApplications());
            }
            // If switching to Analytics, re-render charts
            if (targetId === 'view-analytics') {
                renderAnalytics();
            }
        });
    });
}

function setupEventListeners() {
    // Search Input
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    const performSearch = () => {
        currentFilter.search = searchInput.value.toLowerCase();
        renderTable(getFilteredApplications());

        // Switch to Home view to see results
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById('view-home').classList.add('active');

        // Update Nav State
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.querySelector('[data-target="view-home"]').classList.add('active');
    };

    if (searchInput) {
        // Live search (optional, can remove if user only wants button/enter)
        // searchInput.addEventListener('input', performSearch); 

        // Enter key
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    }

    // Status Filter
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            currentFilter.status = e.target.value;
            renderTable(getFilteredApplications());
        });
    }

    // Importance Filter
    const importanceFilter = document.getElementById('importance-filter');
    if (importanceFilter) {
        importanceFilter.addEventListener('change', (e) => {
            currentFilter.importance = e.target.value;
            renderTable(getFilteredApplications());
        });
    }

    // Clear Filters
    const clearFiltersBtn = document.getElementById('clear-filters-btn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            // Reset state
            currentFilter = {
                search: '',
                status: 'All',
                importance: 'All'
            };

            // Reset UI inputs
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'All';
            if (importanceFilter) importanceFilter.value = 'All';

            // Re-render
            renderTable(getFilteredApplications());
        });
    }

    // Clear All Data
    const clearAllBtn = document.getElementById('clear-btn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to delete ALL applications?")) {
                chrome.storage.local.set({ applications: [] }, () => {
                    loadApplications();
                });
            }
        });
    }

    // Export CSV
    const exportBtn = document.getElementById('export-csv-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCSV);
    }

    // Backup Data (JSON)
    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) {
        backupBtn.addEventListener('click', backupData);
    }

    // Restore Data Logic
    const restoreBtn = document.getElementById('restore-btn');
    const restoreInput = document.getElementById('restore-file-input');

    if (restoreBtn && restoreInput) {
        restoreBtn.addEventListener('click', () => {
            restoreInput.click(); // Trigger hidden file input
        });

        restoreInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (Array.isArray(data)) {
                        if (confirm(`Replace current data with ${data.length} records from backup?`)) {
                            chrome.storage.local.set({ applications: data }, () => {
                                loadApplications();
                                syncToCloud(data); // Sync restored data
                                alert("Data successfully restored from backup!");
                            });
                        }
                    } else {
                        alert("Invalid backup file: Data is not an array.");
                    }
                } catch (err) {
                    alert("Error parsing backup file: " + err.message);
                }
                // Reset input so same file can be selected again if needed
                restoreInput.value = '';
            };
            reader.readAsText(file);
        });
    }

    // Auto-update dashboard when storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.applications) {
            loadApplications();
        }
    });

    // Cloud Sync Restore
    const cloudSyncBtn = document.getElementById('cloud-sync-btn');
    if (cloudSyncBtn) {
        cloudSyncBtn.addEventListener('click', () => {
            if (confirm("Check for data in your Google Cloud Storage and restore it? This will overwrite local data if cloud data is found.")) {
                chrome.storage.sync.get(['applications'], (result) => {
                    const cloudApps = result.applications;
                    if (cloudApps && Array.isArray(cloudApps) && cloudApps.length > 0) {
                        if (confirm(`Found ${cloudApps.length} applications in Cloud Storage. Restore them?`)) {
                            chrome.storage.local.set({ applications: cloudApps }, () => {
                                loadApplications();
                                alert("Data successfully restored from Cloud!");
                            });
                        }
                    } else {
                        alert("No data found in Cloud Storage.");
                    }
                });
            }
        });
    }

    // Auto-update dashboard when storage changes (e.g., from sidepanel/popup)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.applications) {
            loadApplications();
        }
    });

    // Setup Add Application Modal Logic
    setupAddApplicationModal();
}

function setupAddApplicationModal() {
    const addBtn = document.getElementById('add-application-btn');
    const modal = document.getElementById('add-app-modal');
    const closeBtn = document.getElementById('close-add-modal');
    const submitBtn = document.getElementById('submit-new-app');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            // Reset Form
            document.getElementById('add-role').value = '';
            document.getElementById('add-company').value = '';
            document.getElementById('add-link').value = '';
            document.getElementById('add-status').value = 'Applied';
            document.getElementById('add-notes').value = '';
            document.getElementById('add-desc').value = '';

            modal.classList.remove('hidden');
            modal.classList.add('show');
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
            modal.classList.add('hidden');
        });
    }

    // Close on click outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.classList.remove('show');
            modal.classList.add('hidden');
        }
    });

    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            const role = document.getElementById('add-role').value;
            const company = document.getElementById('add-company').value;
            const link = document.getElementById('add-link').value;
            const status = document.getElementById('add-status').value;
            const notes = document.getElementById('add-notes').value;
            const desc = document.getElementById('add-desc').value;

            if (!role || !company) {
                alert("Role and Company are required.");
                return;
            }

            const newApp = {
                id: crypto.randomUUID(),
                role: role,
                company: company,
                url: link || "Manual Entry",
                status: status,
                notes: notes,
                description: desc,
                date: new Date().toISOString(),
                source: "Dashboard Manual",
                importance: "Medium",
                tags: [status]
            };

            // Add to list and save
            allApplications.push(newApp);
            chrome.storage.local.set({ applications: allApplications }, () => {
                loadApplications(); // Reloads table and stats
                syncToCloud(allApplications); // Sync new app
                modal.classList.remove('show');
                modal.classList.add('hidden');

                // Show Success Toast
                const toast = document.createElement('div');
                toast.className = 'job-toast';
                toast.innerText = `Added ${role} Application`;
                document.body.appendChild(toast);
                setTimeout(() => {
                    toast.style.transform = 'translateX(100%)';
                    toast.style.transition = 'transform 0.4s ease';
                    setTimeout(() => toast.remove(), 400);
                }, 3000);
            });
        });
    }
}

function backupData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allApplications, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    const date = new Date().toISOString().split('T')[0];
    downloadAnchorNode.setAttribute("download", `shadowbot_backup_${date}.json`);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function getFilteredApplications() {
    return allApplications.filter(app => {
        const matchesSearch = app.role.toLowerCase().includes(currentFilter.search) ||
            app.company.toLowerCase().includes(currentFilter.search) ||
            (app.notes && app.notes.toLowerCase().includes(currentFilter.search));

        const matchesStatus = currentFilter.status === 'All' || app.status === currentFilter.status;
        const matchesImportance = currentFilter.importance === 'All' || (app.importance || 'Medium') === currentFilter.importance;

        return matchesSearch && matchesStatus && matchesImportance;
    });
}

function renderTable(applications) {
    const tbody = document.getElementById('app-list');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Sort by date desc
    applications.sort((a, b) => new Date(b.date) - new Date(a.date));

    applications.forEach(app => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', app.id); // Add ID to row for click handler

        const dateObj = new Date(app.date);
        // Format: "Dec 01"
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        const timeAgo = getTimeAgo(dateObj);
        const importance = app.importance || 'Medium';

        tr.innerHTML = `
            <td class="date-cell">
                <div class="date-main">${dateStr}</div>
                <div class="date-sub">${timeAgo}</div>
            </td>
            <td class="role-cell">
                ${app.role}
                ${app.emailStatus === 'opened' ? '<span class="email-status email-opened" title="Opened">✓✓</span>' : ''}
                ${app.emailStatus === 'sent' ? '<span class="email-status email-sent" title="Sent">✓✓</span>' : ''}
                ${(!app.emailStatus && (new Date() - new Date(app.date)) > (7 * 24 * 60 * 60 * 1000) && app.status === 'Applied')
                ? '<span class="email-status email-ghosted" title="Ghosted (>7 Days)">⑃</span>' : ''}
            </td>
            <td class="company-cell">${app.company}</td>
            <td class="priority-cell">
                <span class="imp-badge imp-${importance}">${importance}</span>
            </td>
            <td class="notes-cell" title="${app.notes || ''}">
                ${app.notes ? (app.notes.length > 30 ? app.notes.substring(0, 30) + '...' : app.notes) : '-'}
            </td>
            <td>
                <span class="status-tag status-${app.status || 'Applied'}">${app.status || 'Applied'}</span>
            </td>
        `;

        // Row Click Handler -> Open Drawer
        tr.addEventListener('click', () => openDrawer(app));

        tbody.appendChild(tr);
    });

    // Attach Listeners (only for delete, as status is handled by drawer now)
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            deleteApplication(id);
        });
    });
}

// Drawer Logic
let currentDrawerAppId = null;

function openDrawer(app) {
    currentDrawerAppId = app.id;

    // Populate Data
    document.getElementById('drawer-role').innerText = app.role;
    document.getElementById('drawer-company').innerText = app.company;
    document.getElementById('drawer-link').href = app.url;
    document.getElementById('drawer-status').value = app.status || 'Applied';

    // Set Priority Pills
    const currentImp = app.importance || 'Medium';
    document.querySelectorAll('.pill').forEach(pill => {
        pill.classList.remove('selected');
        if (pill.dataset.value === currentImp) {
            pill.classList.add('selected');
        }
    });

    document.getElementById('drawer-notes').value = app.notes || '';
    document.getElementById('drawer-email').value = app.linkedEmail || '';
    document.getElementById('drawer-description').innerText = app.description || 'No description available.';

    // Email Status Icon in Drawer
    const statusIconContainer = document.getElementById('drawer-email-status-icon');
    let statusHtml = '';
    if (app.emailStatus === 'opened') {
        statusHtml = '<span class="email-status email-opened" title="Opened" style="margin-left:8px;">✓✓</span>';
    } else if (app.emailStatus === 'sent') {
        statusHtml = '<span class="email-status email-sent" title="Sent" style="margin-left:8px;">✓✓</span>';
    } else if (!app.emailStatus && (new Date() - new Date(app.date)) > (7 * 24 * 60 * 60 * 1000) && app.status === 'Applied') {
        statusHtml = '<span class="email-status email-ghosted" title="Ghosted (>7 Days)" style="margin-left:8px;">⑃</span>';
    }
    statusIconContainer.innerHTML = statusHtml;

    // Show Drawer
    document.getElementById('drawer-overlay').classList.add('show');
    document.getElementById('job-drawer').classList.add('show');
    document.body.classList.add('no-scroll');
}

function closeDrawer() {
    document.getElementById('drawer-overlay').classList.remove('show');
    document.getElementById('job-drawer').classList.remove('show');
    document.body.classList.remove('no-scroll');
    currentDrawerAppId = null;
}

function renderAnalytics() {
    // New Funnel Logic
    renderFunnelChart(allApplications);

    // New Heatmap Logic
    renderHeatmapChart(allApplications);

    // --- New Metrics Bar Logic ---

    // 1. Emails Tracked
    // Robust check: Look for linkedEmail OR if emailStats is already active
    const trackedApps = allApplications.filter(app =>
        (app.linkedEmail && app.linkedEmail.trim().length > 0) ||
        (app.emailStatus && app.emailStatus.length > 0)
    );
    const trackedCount = trackedApps.length;
    document.getElementById('analytics-tracked').textContent = trackedCount;

    // 2. Open Rate
    let openRate = 0;
    if (trackedCount > 0) {
        // Count anything with 'opened' status, or maybe 'replied' if that implies opened? 
        // For now, strictly 'opened' status which comes from pixel.
        const openedCount = trackedApps.filter(app => app.emailStatus === 'opened').length;
        openRate = Math.round((openedCount / trackedCount) * 100);
    }
    const openRateEl = document.getElementById('analytics-open-rate');
    openRateEl.textContent = openRate + '%';

    // Color coding for Open Rate
    openRateEl.className = '';
    if (openRate >= 50) openRateEl.classList.add('rate-high');
    else if (openRate >= 20) openRateEl.classList.add('rate-med');
    else openRateEl.classList.add('rate-low');

    // 3. Ghosted
    // Logic: 'Applied' or 'Emailed' status AND > 7 days ago AND not 'Replied'/'Interviewing'/'Offer'/'Rejected'
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const ghostedApps = allApplications.filter(app => {
        // Status must be one of the "pending" ones
        const isPending = ['Applied', 'Emailed'].includes(app.status);

        // Date check
        const appDate = new Date(app.date);
        const isOldEnough = appDate < sevenDaysAgo;

        // If emailStatus indicates a reply (somehow?) NO, emailStatus is usually 'sent', 'opened'.
        // If status is 'Replied', it would be filtered out by isPending.

        // Console log for debugging
        // if (isOldEnough && isPending) console.log(`Potential Ghost: ${app.company} (${app.status}) - ${appDate.toLocaleDateString()}`);

        return isPending && isOldEnough;
    });

    console.log(`Debug Ghosted: Total Apps: ${allApplications.length}, Ghosted Count: ${ghostedApps.length}`);
    document.getElementById('analytics-ghosted').textContent = ghostedApps.length;

    // 4. Apps Today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // Format date for display: "Jan 05"
    const dateOptions = { month: 'short', day: '2-digit' };
    const displayDate = today.toLocaleDateString('en-US', dateOptions);

    const appsTodayCount = allApplications.filter(app => app.date.startsWith(todayStr)).length;

    const appsTodayEl = document.getElementById('analytics-apps-today');
    if (appsTodayEl) appsTodayEl.textContent = appsTodayCount;

    const dateLabelEl = document.getElementById('analytics-today-date');
    if (dateLabelEl) dateLabelEl.textContent = displayDate.toUpperCase();
}

function renderFunnelChart(apps) {
    const container = document.getElementById('funnel-chart');
    if (!container) return;

    // 1. Calculate Counts
    const applied = apps.length; // Total apps
    const replied = apps.filter(a => ['Replied', 'Interviewing', 'Offer'].includes(a.status)).length;
    const interview = apps.filter(a => ['Interviewing', 'Offer'].includes(a.status)).length;
    const offer = apps.filter(a => a.status === 'Offer').length;

    // 2. Calculate percentages relative to Applied (or previous step)
    const getWidth = (val) => applied > 0 ? Math.max((val / applied) * 100, 1) + '%' : '0%';

    const steps = [
        { label: 'Applied', count: applied, class: 'bar-applied' },
        { label: 'Replied', count: replied, class: 'bar-replied' },
        { label: 'Interview', count: interview, class: 'bar-interviewing' },
        { label: 'Offer', count: offer, class: 'bar-offer' }
    ];

    let html = `<div class="funnel-container">`;

    steps.forEach(step => {
        html += `
            <div class="funnel-step">
                <div class="funnel-label">${step.label}</div>
                <div class="funnel-bar-container">
                    <div class="funnel-bar ${step.class}" style="width: ${getWidth(step.count)}"></div>
                    <div class="funnel-value">${step.count}</div>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function renderHeatmapChart(apps) {
    const container = document.getElementById('heatmap-chart');
    if (!container) return;

    // Generate last 24 weeks (approx 6 months)
    const weeks = 24;
    const days = weeks * 7;
    const gridDiv = document.createElement('div');
    gridDiv.className = 'heatmap-grid';

    // Map dates to counts
    const activity = {};
    apps.forEach(app => {
        const date = new Date(app.date).toISOString().split('T')[0];
        activity[date] = (activity[date] || 0) + 1;
    });

    // Create array of dates for the grid
    const today = new Date();
    const dateList = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(today.getDate() - (days - 1 - i));
        dateList.push(d.toISOString().split('T')[0]);
    }

    let html = '';
    dateList.forEach(date => {
        const count = activity[date] || 0;
        let intensity = 0;
        if (count > 4) intensity = 4;
        else if (count > 2) intensity = 3;
        else if (count > 1) intensity = 2;
        else if (count > 0) intensity = 1;

        html += `<div class="heatmap-day intensity-${intensity}" title="${date}: ${count} apps"></div>`;
    });

    gridDiv.innerHTML = html;
    container.innerHTML = '';
    container.appendChild(gridDiv);
}

function deleteApplication(id) {
    if (confirm("Delete this application?")) {
        const updatedApps = allApplications.filter(app => app.id !== id);
        chrome.storage.local.set({ applications: updatedApps }, () => {
            loadApplications();
            syncToCloud(updatedApps); // Sync deletion
        });
    }
}

function updateApplicationField(id, field, value) {
    const appIndex = allApplications.findIndex(app => app.id === id);
    if (appIndex !== -1) {
        allApplications[appIndex][field] = value;
        chrome.storage.local.set({ applications: allApplications }, () => {
            // Only re-render if it affects the table visual (like status or linkedEmail affecting icons)
            if (field === 'status' || field === 'linkedEmail' || field === 'emailStatus') {
                updateStats();
                renderAnalytics();
                renderTable(allApplications); // Refresh table for icons
            }
            syncToCloud(allApplications); // Sync update
        });
    }
}

// Keep updateStatus as a wrapper for backward compatibility or ease
function updateStatus(id, newStatus) {
    updateApplicationField(id, 'status', newStatus);
}

function calculateStreak(apps) {
    if (!apps.length) return 0;

    // Get unique dates applied, sorted descending
    const dates = [...new Set(apps.map(app => {
        return new Date(app.date).toISOString().split('T')[0];
    }))].sort((a, b) => new Date(b) - new Date(a));

    if (!dates.length) return 0;

    // Check if applied today
    const today = new Date().toISOString().split('T')[0];
    const lastApplied = dates[0];

    // If last applied was not today or yesterday, streak is broken (unless we want to be lenient)
    // Strict streak: Must have applied today or yesterday to keep it alive.
    const diffDays = (new Date(today) - new Date(lastApplied)) / (1000 * 60 * 60 * 24);

    if (diffDays > 1) return 0; // Streak broken

    let streak = 1;
    for (let i = 0; i < dates.length - 1; i++) {
        const current = new Date(dates[i]);
        const next = new Date(dates[i + 1]);
        const diff = (current - next) / (1000 * 60 * 60 * 24);

        if (diff === 1) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}
function updateStats() {
    const total = allApplications.length;
    document.getElementById('total-jobs').textContent = total;

    // 1. Calculate Streak
    const streak = calculateStreak(allApplications);
    const streakEl = document.getElementById('streak-count');
    streakEl.textContent = streak;

    // Streak Progress Bar Logic
    const today = new Date().toISOString().split('T')[0];
    const appsToday = allApplications.filter(app => app.date.startsWith(today)).length;

    // Target is 5 applications per day
    const progress = Math.min((appsToday / 5) * 100, 100);

    const streakBar = document.getElementById('streak-bar');
    if (streakBar) {
        streakBar.style.width = `${progress}%`;

        // Add active class to parent container if progress > 0
        const container = streakBar.parentElement;
        if (progress > 0) {
            container.classList.add('streak-active');
        } else {
            container.classList.remove('streak-active');
        }
    }

    // 2. Calculate Active Pipeline (Replied, Interviewing, Offer)
    const activeCount = allApplications.filter(app =>
        app.status === 'Replied' || app.status === 'Interviewing' || app.status === 'Offer'
    ).length;
    document.getElementById('active-count').textContent = activeCount;

    // 3. Calculate Response Rate
    // Let's use: (Interviewing + Offer) / Total. If you get rejected, it's a response but "red is bad" implies success rate.
    // Let's go with Success/Response Rate = (Interviewing + Offer) / Total.

    let rate = 0;
    if (total > 0) {
        rate = Math.round((activeCount / total) * 100);
    }

    const rateEl = document.getElementById('response-rate');
    rateEl.textContent = rate + '%';

    // Color Coding
    rateEl.className = ''; // Reset
    if (rate >= 10) {
        rateEl.classList.add('rate-high');
    } else if (rate >= 5) {
        rateEl.classList.add('rate-med');
    } else {
        rateEl.classList.add('rate-low');
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    return "now";
}

function exportCSV() {
    const headers = ["Date", "Role", "Company", "Status", "Importance", "URL", "Notes"];
    const rows = allApplications.map(app => [
        new Date(app.date).toLocaleDateString(),
        `"${app.role}"`,
        `"${app.company}"`,
        app.status,
        app.importance,
        app.url,
        `"${(app.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "job_applications.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showDetailsModal(id) {
    const app = allApplications.find(a => a.id === id);
    if (!app) return;

    const modal = document.getElementById('details-modal');
    const closeBtn = document.querySelector('.close-modal');
    const notesArea = document.getElementById('modal-notes');
    const saveBtn = document.getElementById('save-notes-btn');
    const descArea = document.getElementById('modal-full-desc');

    notesArea.value = app.notes || '';
    descArea.innerHTML = app.description || 'No description available.';

    modal.classList.remove('hidden');
    modal.classList.add('show');

    closeBtn.onclick = () => {
        modal.classList.remove('show');
        modal.classList.add('hidden');
    };

    saveBtn.onclick = () => {
        app.notes = notesArea.value;
        chrome.storage.local.set({ applications: allApplications }, () => {
            saveBtn.innerText = "Saved!";
            setTimeout(() => saveBtn.innerText = "Save Notes", 2000);
            renderTable(getFilteredApplications()); // Update table view
        });
    };
}

// Drawer Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Close Drawer Buttons
    const closeBtn = document.getElementById('close-drawer');
    const overlay = document.getElementById('drawer-overlay');

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    // Save Notes & Email Logic (Auto-save on blur)
    const drawerNotes = document.getElementById('drawer-notes');
    const drawerEmail = document.getElementById('drawer-email');
    const saveNotesBtn = document.getElementById('drawer-save-notes'); // Still needed for visual feedback

    // Auto-save Notes on Blur
    if (drawerNotes) {
        drawerNotes.addEventListener('blur', () => {
            if (currentDrawerAppId) {
                updateApplicationField(currentDrawerAppId, 'notes', drawerNotes.value);
            }
        });
    }

    // Auto-save Email on Blur
    if (drawerEmail) {
        drawerEmail.addEventListener('blur', () => {
            if (currentDrawerAppId) {
                updateApplicationField(currentDrawerAppId, 'linkedEmail', drawerEmail.value);
                // Temporary Mock: If they link an email, assume "Sent" if not present
                // In reality, background script would update this.
                // But for Immediate Feedback:
                // updateApplicationField(currentDrawerAppId, 'emailStatus', 'sent'); 
            }
        });
    }

    // The original saveNotesBtn click listener is now redundant if using blur for auto-save.
    // If it's meant for explicit save, it needs to be re-evaluated.
    // For now, I'll remove the old click listener as the blur event handles saving.
    // If saveNotesBtn is still desired for visual feedback, its logic needs adjustment.
    // Keeping the button for visual feedback on explicit save, but the blur handles auto-save.
    if (saveNotesBtn) {
        saveNotesBtn.addEventListener('click', () => {
            if (!currentDrawerAppId) return;
            saveNotesBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`; // Tick
            setTimeout(() => saveNotesBtn.innerHTML = originalContent, 2000);

            renderTable(getFilteredApplications()); // Refresh table to show updated notes snippet
        });
    }


    // Change Status
    const statusSelect = document.getElementById('drawer-status');
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            if (!currentDrawerAppId) return;
            const newStatus = e.target.value;
            updateStatus(currentDrawerAppId, newStatus);
        });
    }

    // Change Priority (Pills)
    const pills = document.querySelectorAll('.pill');
    pills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            if (!currentDrawerAppId) return;

            // Visual update
            pills.forEach(p => p.classList.remove('selected'));
            e.target.classList.add('selected');

            const newPriority = e.target.dataset.value;
            updatePriority(currentDrawerAppId, newPriority);
        });
    });

    // Delete Application
    const deleteBtn = document.getElementById('drawer-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!currentDrawerAppId) return;
            if (confirm("Are you sure you want to delete this application?")) {
                deleteApplication(currentDrawerAppId);
                closeDrawer();
            }
        });
    }
});

function updatePriority(id, newPriority) {
    const appIndex = allApplications.findIndex(app => app.id === id);
    if (appIndex !== -1) {
        allApplications[appIndex].importance = newPriority;
        chrome.storage.local.set({ applications: allApplications }, () => {
            renderTable(getFilteredApplications());
        });
    }
}
// Data Recovery / Seeding (Temporary)
window.seedData = function () {
    const rawData = [
        { id: crypto.randomUUID(), role: 'Frontend Engineer', company: 'Google', date: new Date().toISOString(), status: 'Applied', importance: 'High', source: 'LinkedIn', notes: 'Referral from Sarah', tags: ['Applied', 'Referral'] },
        { id: crypto.randomUUID(), role: 'Product Designer', company: 'Airbnb', date: new Date(Date.now() - 86400000).toISOString(), status: 'Interviewing', importance: 'High', source: 'Website', notes: 'Portfolio review on Monday', tags: ['Interviewing', 'Design'] },
        { id: crypto.randomUUID(), role: 'Software Engineer', company: 'Linear', date: new Date(Date.now() - 172800000).toISOString(), status: 'Replied', importance: 'Medium', source: 'Twitter', notes: 'Found via founder tweet', tags: ['Replied', 'Startup'] },
        { id: crypto.randomUUID(), role: 'Full Stack Dev', company: 'Netflix', date: new Date(Date.now() - 259200000).toISOString(), status: 'Rejected', importance: 'Medium', source: 'LinkedIn', notes: 'Standard rejection email', tags: ['Rejected'] },
        { id: crypto.randomUUID(), role: 'UI Engineer', company: 'Apple', date: new Date(Date.now() - 345600000).toISOString(), status: 'Applied', importance: 'High', source: 'Careers Page', notes: 'Applied for the Design Systems team', tags: ['Applied'] },
        { id: crypto.randomUUID(), role: 'Developer Advocate', company: 'Vercel', date: new Date(Date.now() - 432000000).toISOString(), status: 'Offer', importance: 'High', source: 'Recruiter', notes: 'Offer received! $180k', tags: ['Offer', 'Remote'] }
    ];

    chrome.storage.local.set({ applications: rawData }, () => {
        console.log("Seeded data restored.");
        loadApplications();
        alert("Sample data restored!");
    });
}

// ============================================
// AI AGENT LOGIC
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupAIEventListeners();
    loadAISettings();
});

let aiState = {
    apiKey: '',
    resumeBase64: '', // Store PDF as Base64
    resumeFileName: '',
    customPrompt: `Write a cover letter for the role of [Role] at [Company]. Use a professional but bold tone. Emphasize my experience in...`,
    resumeFileName: '',
    customPrompt: `Write a cover letter for the role of [Role] at [Company]. Use a professional but bold tone. Emphasize my experience in...`,
    profile: { name: '', email: '', phone: '', link: '' },
    history: []
};

function loadAISettings() {
    chrome.storage.local.get(['geminiApiKey', 'resumeBase64', 'resumeFileName', 'customPrompt', 'profileData'], (result) => {
        if (result.geminiApiKey) {
            aiState.apiKey = result.geminiApiKey;
            document.getElementById('gemini-api-key').value = result.geminiApiKey;
        }
        if (result.profileData) {
            aiState.profile = result.profileData;
            document.getElementById('profile-name').value = result.profileData.name || '';
            document.getElementById('profile-email').value = result.profileData.email || '';
            document.getElementById('profile-phone').value = result.profileData.phone || '';
            document.getElementById('profile-link').value = result.profileData.link || '';
        }
        if (result.resumeBase64) {
            aiState.resumeBase64 = result.resumeBase64;
            aiState.resumeFileName = result.resumeFileName || "Saved Resume.pdf";
            document.getElementById('resume-file-name').textContent = aiState.resumeFileName;
        }
        if (result.customPrompt) {
            aiState.customPrompt = result.customPrompt;
            document.getElementById('ai-custom-prompt').value = result.customPrompt;
        }

        // Check if resume file exists in input visual (Moved inside callback)
        if (!aiState.resumeFileName) {
            document.getElementById('resume-file-name').textContent = "No file saved";
            document.getElementById('resume-file-name').style.color = "var(--text-secondary)";
        } else {
            document.getElementById('resume-file-name').textContent = aiState.resumeFileName;
            document.getElementById('resume-file-name').style.color = "#4ade80"; // Green for active
        }
    });
}

function setupAIEventListeners() {

    // --- DRAWER LOGIC ---
    const openSettingsBtn = document.getElementById('open-ai-settings-btn');
    const closeSettingsBtn = document.getElementById('close-ai-settings');
    const settingsDrawer = document.getElementById('ai-settings-drawer');
    const settingsOverlay = document.getElementById('ai-settings-overlay');
    const saveSettingsBtn = document.getElementById('save-ai-settings-btn');

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => {
            console.log("Opening AI Settings Drawer");
            settingsDrawer.classList.add('show'); // Changed from 'active' to 'show' to match existing drawer CSS if any, or I need to add CSS
            settingsOverlay.classList.add('show');
        });
    }

    const closeSettings = () => {
        settingsDrawer.classList.remove('show');
        settingsOverlay.classList.remove('show');
    };

    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', closeSettings);

    // --- SETTINGS SAVE LOGIC ---
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            const apiKey = document.getElementById('gemini-api-key').value.trim();
            const prompt = document.getElementById('ai-custom-prompt').value.trim();

            // Profile Data
            const profileData = {
                name: document.getElementById('profile-name').value.trim(),
                email: document.getElementById('profile-email').value.trim(),
                phone: document.getElementById('profile-phone').value.trim(),
                link: document.getElementById('profile-link').value.trim()
            };

            // File handling
            const fileInput = document.getElementById('resume-upload');
            const file = fileInput.files[0];

            let updates = {
                geminiApiKey: apiKey,
                customPrompt: prompt,
                profileData: profileData
            };

            aiState.apiKey = apiKey;
            aiState.customPrompt = prompt;
            aiState.profile = profileData;

            // Handle File (Async if new file)
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const base64String = event.target.result.split(',')[1]; // Remove "data:application/pdf;base64," prefix for API

                    aiState.resumeBase64 = base64String;
                    aiState.resumeFileName = file.name;

                    updates.resumeBase64 = base64String;
                    updates.resumeFileName = file.name;

                    commitSave(updates);
                };
                reader.readAsDataURL(file); // Read as Base64
            } else {
                commitSave(updates);
            }
        });
    }

    function commitSave(updates) {
        chrome.storage.local.set(updates, () => {
            loadAISettings(); // Refresh Visuals

            // Animation Feedback
            const btn = document.getElementById('save-ai-settings-btn');
            const ogText = btn.innerText;
            btn.innerText = "Saved!";
            btn.style.background = "#4ade80";
            btn.style.color = "#000";

            setTimeout(() => {
                btn.innerText = ogText;
                btn.style.background = "";
                btn.style.color = "";
                closeSettings();
            }, 1000);
        });
    }


    // --- QUILL EDITOR INIT ---
    let quill;
    try {
        if (document.getElementById('ai-output-editor')) {
            // Check if Quill is defined
            if (typeof Quill !== 'undefined') {
                quill = new Quill('#ai-output-editor', {
                    theme: 'snow',
                    placeholder: 'Output will appear here...',
                    modules: {
                        toolbar: [
                            [{ 'font': [] }, { 'size': [] }],
                            ['bold', 'italic', 'underline'],
                            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                            [{ 'header': [1, 2, 3, false] }],
                            [{ 'align': [] }],
                            ['clean']
                        ],
                        history: {
                            delay: 2000,
                            maxStack: 500,
                            userOnly: true
                        }
                    }
                });

                // --- NEW: Restore Autosave ---
                chrome.storage.local.get(['ai_draft_content'], (result) => {
                    if (result.ai_draft_content) {
                        quill.root.innerHTML = result.ai_draft_content;
                    }
                });

                // --- NEW: Word Count & Autosave Listener ---
                let saveTimeout;
                quill.on('text-change', () => {
                    // Update Word Count
                    const text = quill.getText().trim();
                    const words = text.length > 0 ? text.split(/\s+/).length : 0;
                    const wordCountEl = document.getElementById('ai-word-count');
                    if (wordCountEl) wordCountEl.innerText = `${words} words`;

                    // Autosave (Debounce 1s)
                    clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(() => {
                        chrome.storage.local.set({ ai_draft_content: quill.root.innerHTML });
                    }, 1000);
                });
            } else {
                console.error("Quill library not loaded.");
                document.getElementById('ai-output-editor').innerHTML = "<p style='color:red;'>Error: Rich text editor failed to load.</p>";
            }
        }
    } catch (e) {
        console.error("Quill Init Error:", e);
    }

    // --- GENERATE LOGIC ---
    const generateBtn = document.getElementById('ai-generate-btn');

    if (generateBtn) {
        console.log("Generate button found, attaching listener.");
        generateBtn.addEventListener('click', async () => {
            console.log("Generate button clicked.");
            const jobDescription = document.getElementById('ai-job-desc').value;

            if (!jobDescription) {
                alert("Please paste a Job Description first.");
                return;
            }

            if (!aiState.apiKey) {
                alert("Please configure your Gemini API Key first.");
                document.getElementById('ai-settings-drawer').classList.add('show');
                document.getElementById('ai-settings-overlay').classList.add('show');
                return;
            }
            if (!aiState.resumeBase64) {
                alert("Please upload your Resume (PDF) in settings.");
                document.getElementById('ai-settings-drawer').classList.add('show');
                document.getElementById('ai-settings-overlay').classList.add('show');
                return;
            }

            // Set loading state
            generateBtn.innerHTML = `<span class="spinner"></span> GENERATING...`;
            generateBtn.disabled = true;
            if (quill) quill.setText(''); // Clear previous

            try {
                // Prepare Prompt
                const promptParts = [
                    "You are an expert career coach.",
                    "Generate a professional, tailored cover letter based on the following:",
                    `JOB DESCRIPTION: ${jobDescription}`,
                    aiState.customPrompt ? `CUSTOM INSTRUCTIONS: ${aiState.customPrompt}` : "",
                    "The cover letter should be formatted in clean HTML (using <p>, <ul>, <li>, <strong> tags) suitable for a rich text editor. Do not include markdown code blocks like ```html. Just raw HTML content."
                ];

                const finalPrompt = promptParts.filter(p => p).join("\n\n");

                console.log("Sending prompt to Gemini...", finalPrompt);

                // Call API
                const resultText = await callGeminiAPI(finalPrompt, aiState.resumeBase64);

                // Set Output
                if (quill) {
                    // Handle if Gemini wraps in markdown block
                    let cleanHtml = resultText.replace(/```html/g, '').replace(/```/g, '').trim();
                    quill.clipboard.dangerouslyPasteHTML(cleanHtml);
                }

            } catch (err) {
                console.error("Generation Error:", err);
                if (quill) quill.setText("Error: " + err.message);
            } finally {
                generateBtn.innerHTML = `<span>✨</span> GENERATE`;
                generateBtn.disabled = false;
            }
        });
    }

    // --- DOWNLOAD PDF LOGIC ---
    const downloadBtn = document.getElementById('ai-download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (!quill) return;
            const content = quill.root.innerHTML; // Get HTML content

            // Check if empty (Quill default empty is <p><br></p>)
            if (!content || content === '<p><br></p>') return;

            // Create Header HTML
            let headerHTML = '';
            if (aiState.profile && aiState.profile.name) {
                headerHTML = `
                    <div style="text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
                        <h1 style="margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; font-family: 'Times New Roman', serif;">${aiState.profile.name}</h1>
                        <p style="margin: 8px 0 0 0; font-size: 11px; color: #555; font-family: 'Arial', sans-serif;">
                            ${aiState.profile.email ? aiState.profile.email + '  |  ' : ''} 
                            ${aiState.profile.phone ? aiState.profile.phone + '  |  ' : ''} 
                            ${aiState.profile.link || ''}
                        </p>
                    </div>
                `;
            }

            // We create a temporary print window
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>Cover Letter</title>
                    <style>
                        body { font-family: 'Times New Roman', serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 40px; color: #000; }
                        p { margin-bottom: 15px; }
                        ul, ol { margin-bottom: 15px; padding-left: 20px; }
                        li { margin-bottom: 5px; }
                        @media print {
                            body { margin: 0; padding: 20px; }
                        }
                    </style>
                </head>
                <body>
                    ${headerHTML}
                    ${content}
                    <script>
                        window.onload = function() { window.print(); window.close(); }
                    </script>
                </body>
                </html>
            `);
            printWindow.document.close();
        });
    }
}

async function callGeminiAPI(textPrompt, pdfBase64) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${aiState.apiKey}`;

    const payload = {
        contents: [{
            parts: [
                { text: textPrompt },
                {
                    inline_data: {
                        mime_type: "application/pdf",
                        data: pdfBase64
                    }
                }
            ]
        }]
    };

    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json();
        console.error("Gemini API Error:", err);
        throw new Error(JSON.stringify(err, null, 2));
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}
