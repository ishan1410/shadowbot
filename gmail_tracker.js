// ShadowBot - Gmail Tracker
// Spies on Mailsuite/Mailtrack indicators to update job application statuses.



// 1. SELECTORS (Verified from Screenshot)
const SELECTORS = {
    THREAD_ROW: 'tr.zA', // Standard Gmail row
    SUBJECT: 'span.bog', // Gmail Subject
    MAILSUITE_ICON: '.mt-icon', // Base Mailsuite icon class
    MAILSUITE_OPENED: '.mt-status-opened', // Class when email is opened
};

// 2. LISTEN FOR MESSAGES
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "CHECK_EMAIL_STATUS") {
        // Support multiple search terms (Company, Role, Custom Subject)
        const terms = request.searchTerms || [request.subject].filter(Boolean);
        const status = checkEmailStatus(terms);
        sendResponse({ status: status });
    }
});

// 3. CHECK STATUS LOGIC
function checkEmailStatus(searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return null;

    // A. DETAIL VIEW SEARCH (Single Email - HIGHEST PRIORITY)
    // If the user is looking at the email, this is the most accurate status.
    const detailSubject = document.querySelector('h2.hP'); // Standard Gmail Subject Header
    let detailSubjectText = detailSubject ? detailSubject.innerText : document.title; // Fallback to Title
    detailSubjectText = detailSubjectText.toLowerCase();

    // Check match against Title/Header
    const detailMatch = searchTerms.some(term => term && detailSubjectText.includes(term.toLowerCase()));

    if (detailMatch) {


        // 1. Check for the Mailsuite "Toast/Bubble" (The white box saying "X opened your email")
        const bodyText = document.body.innerText;
        if (bodyText.includes("opened your email") || bodyText.includes("First opened")) {
            return 'opened';
        }

        // 2. Check for Icons (Iterate ALL icons to avoid false negatives)
        const icons = document.querySelectorAll('.mt-icon, .mt-check');
        let isSent = false;

        for (const icon of icons) {
            // Check for Opened Status
            if (icon.classList.contains('mt-status-opened') ||
                icon.getAttribute('data-mt-status') === '2' ||
                icon.querySelector('.mt-status-opened')) {
                return 'opened';
            }
            // If we find any icon, we know it's at least tracked/sent
            isSent = true;
        }

        if (isSent) return 'sent';

        // 3. Fallback: If matched subject but found no icon, assume sent
        return 'sent';
    }

    // B. LIST VIEW SEARCH (Batch)
    const rows = document.querySelectorAll(SELECTORS.THREAD_ROW);

    for (let row of rows) {
        const subjectEl = row.querySelector(SELECTORS.SUBJECT);
        if (subjectEl) {
            const subjectText = subjectEl.innerText.toLowerCase();
            const match = searchTerms.some(term => term && subjectText.includes(term.toLowerCase()));

            if (match) {
                // Found in List!
                const icon = row.querySelector(SELECTORS.MAILSUITE_ICON);
                if (icon) {
                    if (icon.classList.contains('mt-status-opened') || icon.getAttribute('data-mt-status') === '2') {
                        return 'opened';
                    }
                    return 'sent';
                }
                return 'sent'; // Found row but no icon? Assume sent.
            }
        }
    }

    return null; // Not found
}

// 4. OBSERVER (Optional: Watch for new emails sending)
const observer = new MutationObserver((mutations) => {
    // Detect if user sends a new email and log it
});
// observer.observe(document.body, { childList: true, subtree: true });
