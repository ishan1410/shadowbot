// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("ShadowBot installed.");
  // Initialize and Migrate Data
  chrome.storage.local.get(['applications'], (result) => {
    let applications = result.applications || [];
    let modified = false;

    // Migration: Ensure all apps have an ID
    applications = applications.map(app => {
      if (!app.id) {
        app.id = crypto.randomUUID();
        modified = true;
      }
      return app;
    });

    if (modified) {
      chrome.storage.local.set({ applications: applications }, () => {
        console.log("ShadowBot: Migrated applications to include IDs.");
      });
    } else if (!result.applications) {
      chrome.storage.local.set({ applications: [] });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "saveApplication") {
    saveApplication(request.data, sendResponse);
    return true;
  }

  if (request.action === "queryGmailStatus") {
    // 1. Find the Gmail tab
    chrome.tabs.query({ url: "https://mail.google.com/*" }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ status: 'unknown', error: 'No Gmail tab open' });
        return;
      }

      // 2. Message the first Gmail tab found
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "CHECK_EMAIL_STATUS",
        searchTerms: request.searchTerms, // Forward the array
        subject: request.subject, // Keep for fallback
        recipient: request.recipient
      }, (response) => {
        // Relay response back to Dashboard
        if (chrome.runtime.lastError) {
          sendResponse({ status: 'unknown', error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response || { status: 'unknown' });
        }
      });
    });
    return true; // Async response
  }
});

function saveApplication(data, sendResponse) {
  chrome.storage.local.get(['applications'], (result) => {
    const applications = result.applications || [];

    let index = -1;

    // If an ID is provided, try to find the existing application to update
    if (data.id) {
      index = applications.findIndex(app => app.id === data.id);
    }

    if (index === -1) {
      // New application (or ID not found/not provided)
      // Generate a new ID
      const newId = crypto.randomUUID();
      const newApp = { ...data, id: newId };

      applications.push(newApp);
      chrome.storage.local.set({ applications: applications }, () => {
        console.log("Application saved:", newApp);
        // Attempt Cloud Sync (Mirror)
        syncToCloud(applications);
        sendResponse({ status: "success", message: "Application saved!", id: newId });
      });
    } else {
      // Update existing application
      const existingApp = applications[index];

      // Merge data: overwrite with new data but preserve date and handle optional fields
      const updatedApp = {
        ...existingApp,
        ...data,
        id: existingApp.id, // Ensure ID persists
        date: existingApp.date, // Preserve original date
        notes: data.notes !== undefined ? data.notes : existingApp.notes,
        tags: data.tags !== undefined ? data.tags : existingApp.tags,
        importance: data.importance !== undefined ? data.importance : existingApp.importance
      };

      applications[index] = updatedApp;
      chrome.storage.local.set({ applications: applications }, () => {
        console.log("Application updated:", updatedApp);
        // Attempt Cloud Sync (Mirror)
        syncToCloud(applications);
        sendResponse({ status: "updated", message: "Application updated!", id: existingApp.id });
      });
    }
  });
}

function syncToCloud(applications) {
  // Best-effort mirroring to chrome.storage.sync
  // Note: sync has smaller quotas (100KB). If data exceeds this, it will fail silently or log error.
  chrome.storage.sync.set({ applications: applications }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Cloud Sync failed (likely quota exceeded):", chrome.runtime.lastError.message);
    } else {
      console.log("Cloud Sync successful.");
    }
  });
}
