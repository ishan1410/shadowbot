// content.js
console.log("ShadowBot: Content script loaded.");

// Check if we are on a supported ATS
let jobData = null;

function detectAndScrape(isManual = false) {
    jobData = null; // Clear stale data
    const currentUrl = window.location.href;
    if (currentUrl.includes("greenhouse.io")) {
        scrapeGreenhouse();
    } else if (currentUrl.includes("lever.co")) {
        scrapeLever();
    } else if (currentUrl.includes("myworkdayjobs.com")) {
        scrapeWorkday();
    } else if (currentUrl.includes("ashbyhq.com")) {
        scrapeAshby();
    } else if (currentUrl.includes("linkedin.com")) {
        scrapeLinkedIn();
    } else {
        // Generic Fallback Logic
        if (isManual) {
            console.log("ShadowBot: Manual generic scrape triggered.");
            scrapeGeneric();
        } else {
            // Auto-mode: Only scrape if high confidence
            if (hasHighConfidenceSignals()) {
                console.log("ShadowBot: High confidence job signals detected. Auto-scraping...");
                scrapeGeneric();
            } else {
                console.log("ShadowBot: No high confidence signals. Waiting for manual trigger.");
            }
        }
    }
}

function hasHighConfidenceSignals() {
    const currentUrl = window.location.href;

    // 1. Explicit ATS Domain Check (High Confidence)
    // We already have specific scrapers for these, so we should always attempt to scrape them.
    const knownAtsDomains = [
        "greenhouse.io",
        "lever.co",
        "workday.com",
        "ashbyhq.com",
        "linkedin.com",
        "breezy.hr",
        "smartrecruiters.com",
        "workable.com",
        "successfactors.com", // SAP
        "oraclecloud.com",    // Oracle HCM
        "taleo.net",          // Oracle Taleo
        "icims.com",          // iCIMS
        "jobvite.com"         // Jobvite
    ];

    if (knownAtsDomains.some(domain => currentUrl.includes(domain))) {
        return true;
    }

    // 2. Check for Schema.org JobPosting (Gold Standard)
    const schemas = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of schemas) {
        try {
            const json = JSON.parse(script.innerText);
            if (json['@type'] === 'JobPosting' || (Array.isArray(json) && json.some(item => item['@type'] === 'JobPosting'))) {
                return true;
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    // 3. Check for common URL patterns (Generic Fallback)
    // Updated to include singular 'job', 'career' as well
    if (/\/job\/|\/jobs\/|\/career\/|\/careers\/|\/role\/|\/position\/|\/posting\/|\/openings\//i.test(currentUrl)) {
        return true;
    }

    // 4. Checking for "Apply" button presence (Heuristic)
    // If we find a button that says "Apply", "Apply Now", "Apply for this job", it's a strong signal.
    const applyButton = Array.from(document.querySelectorAll('a, button, input[type="submit"]'))
        .find(el => {
            const text = el.innerText || el.value || "";
            return /^\s*(Apply|Apply Now|Apply for this job|Submit Application)\s*$/i.test(text);
        });

    if (applyButton) {
        return true;
    }

    return false;
}

function getCanonicalUrl() {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href) return canonical.href;

    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && ogUrl.content) return ogUrl.content;

    return window.location.href;
}

function scrapeGeneric() {
    const currentUrl = getCanonicalUrl();
    // Generic fallback: Look for common job description containers
    const titleEl = document.querySelector('h1');
    const companyEl = document.querySelector('meta[property="og:site_name"]')?.content || window.location.hostname;

    // Try to find the biggest block of text that might be a description
    const potentialContainers = [
        '.job-description', '#job-description',
        '.description', '#description',
        '.role-content', '.job-detail',
        'main', 'article',
        '[class*="job"]', '[id*="job"]',
        '[class*="description"]', '[id*="description"]'
    ];

    let descriptionEl = null;
    // First pass: Exact matches
    for (const selector of potentialContainers) {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 200) {
            descriptionEl = el;
            break;
        }
    }

    // Second pass: Heuristic (longest text block)
    if (!descriptionEl) {
        const divs = document.querySelectorAll('div, section, article');
        let maxLen = 0;
        divs.forEach(div => {
            if (div.innerText.length > 500 && div.innerText.length < 10000) {
                if (div.innerText.length > maxLen) {
                    maxLen = div.innerText.length;
                    descriptionEl = div;
                }
            }
        });
    }

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: companyEl,
            location: "Unknown",
            description: descriptionEl ? htmlToMarkdown(descriptionEl.innerHTML) : "",
            url: currentUrl,
            date: new Date().toISOString(),
            ats: "Generic",
            status: "Applied"
        };
        console.log("ShadowBot: Generic Scrape Data:", jobData);
        notifyExtension(jobData);
    } else {
        console.log("ShadowBot: Generic scrape failed. Could not find title.");
    }
}

function scrapeLinkedIn() {
    console.log("ShadowBot: Detecting LinkedIn...");

    // LinkedIn URL Strategy:
    // 1. Try to extract 'currentJobId' from URL params (most reliable for search pages)
    // 2. Try to find canonical URL
    // 3. Fallback to current window location

    let jobUrl = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    const currentJobId = urlParams.get('currentJobId');

    if (currentJobId) {
        jobUrl = `https://www.linkedin.com/jobs/view/${currentJobId}/`;
    } else {
        // Fallback to canonical if available, but LinkedIn canonicals on search pages might be generic
        // So we prefer the constructed ID url if possible.
        // If we are on a direct view page (linkedin.com/jobs/view/123...), the ID is in the path.
        const viewMatch = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
        if (viewMatch && viewMatch[1]) {
            jobUrl = `https://www.linkedin.com/jobs/view/${viewMatch[1]}/`;
        }
    }

    // LinkedIn has different views (search vs direct job view)
    // Strategy: Try multiple common selectors

    const titleEl = document.querySelector('h1') ||
        document.querySelector('.job-details-jobs-unified-top-card__job-title') ||
        document.querySelector('.top-card-layout__title');

    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
        document.querySelector('.topcard__org-name-link') ||
        document.querySelector('.top-card-layout__first-subline .topcard__flavor');

    const locationEl = document.querySelector('.job-details-jobs-unified-top-card__bullet') ||
        document.querySelector('.top-card-layout__first-subline .topcard__flavor--bullet');

    const descriptionEl = document.querySelector('#job-details') ||
        document.querySelector('.description__text') ||
        document.querySelector('.jobs-description-content__text');

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: companyEl ? companyEl.innerText.trim() : "Unknown Company",
            location: locationEl ? locationEl.innerText.trim() : "Unknown Location",
            description: descriptionEl ? descriptionEl.innerText.trim().substring(0, 5000) : "", // Cap at 5000 chars
            url: jobUrl,
            date: new Date().toISOString(),
            ats: "LinkedIn",
            status: "Applied"
        };
        console.log("ShadowBot: Scraped Data:", jobData);
        notifyExtension(jobData);
    }
}

function scrapeGreenhouse() {
    console.log("ShadowBot: Detecting Greenhouse...");
    const currentUrl = window.location.href;
    const titleEl = document.querySelector('.app-title') || document.querySelector('h1');
    const companyEl = document.querySelector('.company-name') || document.querySelector('.logo-container img')?.alt;
    const locationEl = document.querySelector('.location');
    const descriptionEl = document.querySelector('#content');

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: companyEl ? (typeof companyEl === 'string' ? companyEl.trim() : "Unknown Company") : "Unknown Company",
            location: locationEl ? locationEl.innerText.trim() : "Remote/Unknown",
            description: descriptionEl ? descriptionEl.innerText.trim().substring(0, 5000) : "",
            url: currentUrl,
            date: new Date().toISOString(),
            ats: "Greenhouse",
            status: "Applied" // Initial status
        };
        console.log("ShadowBot: Scraped Data:", jobData);
        notifyExtension(jobData);
    }
}

function scrapeLever() {
    console.log("ShadowBot: Detecting Lever...");
    const currentUrl = window.location.href;
    const titleEl = document.querySelector('.posting-headline h2');
    const companyEl = document.title.split('-')[0].trim(); // Often "Company Name - Job Title"
    const locationEl = document.querySelector('.posting-categories .location');

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: companyEl || "Unknown Company",
            location: locationEl ? locationEl.innerText.trim() : "Remote/Unknown",
            url: currentUrl,
            date: new Date().toISOString(),
            ats: "Lever",
            status: "Applied"
        };
        console.log("ShadowBot: Scraped Data:", jobData);
        notifyExtension(jobData);
    }
}

function scrapeAshby() {
    console.log("ShadowBot: Detecting Ashby...");
    const currentUrl = window.location.href;
    const titleEl = document.querySelector('h1');
    // Ashby structure varies, but h1 is usually the role

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: "Unknown (Ashby)", // Ashby often embeds in iframes or complex layouts
            location: "Unknown",
            url: currentUrl,
            date: new Date().toISOString(),
            ats: "Ashby",
            status: "Applied"
        };
        console.log("ShadowBot: Scraped Data:", jobData);
        notifyExtension(jobData);
    }
}

function scrapeWorkday() {
    console.log("ShadowBot: Detecting Workday...");
    const currentUrl = window.location.href;

    // Workday often uses data-automation-id attributes
    const titleEl = document.querySelector('[data-automation-id="jobPostingHeader"]') || document.querySelector('h2');
    const locationEl = document.querySelector('[data-automation-id="jobPostingLocation"]');
    // Workday keeps description in a specific container usually
    const descriptionEl = document.querySelector('[data-automation-id="jobPostingDescription"]');

    if (titleEl) {
        jobData = {
            role: titleEl.innerText.trim(),
            company: "Workday Job", // Often hard to get company name from generic Workday pages without specific selectors
            location: locationEl ? locationEl.innerText.trim() : "Unknown",
            url: currentUrl,
            date: new Date().toISOString(),
            ats: "Workday",
            status: "Applied",
            description: descriptionEl ? htmlToMarkdown(descriptionEl.innerHTML) : ""
        };
        console.log("ShadowBot: Scraped Data:", jobData);
        notifyExtension(jobData);
    } else {
        // Fallback to generic if simplified scraping fails
        console.log("ShadowBot: Workday specific scrape failed, falling back to generic.");
        scrapeGeneric();
    }
}


// Helper to extract specific sections using simple heuristics
function extractJobDetails(description) {
    if (!description) return { min: null, pref: null, tech: null };

    const lowerDesc = description.toLowerCase();

    // 1. Extract Minimum Qualifications
    // Look for headers like "Basic Qualifications", "Minimum Qualifications", "What you bring"
    let minQual = extractSection(description, /(?:Basic|Minimum|Required)\s*(?:Qualifications|Requirements|Skills)|(?:What\s*you\s*bring)|(?:What\s*you\s*need)/i);

    // 2. Extract Preferred Qualifications
    // Look for headers like "Preferred Qualifications", "Bonus Points", "Nice to have"
    let prefQual = extractSection(description, /(?:Preferred|Desired|Bonus)\s*(?:Qualifications|Requirements|Skills)|(?:Nice\s*to\s*have)/i);

    // 3. Extract Technologies (Simple Keyword Matching)
    const techKeywords = [
        "Python", "Java", "C++", "JavaScript", "TypeScript", "React", "Angular", "Vue", "Node.js",
        "AWS", "Azure", "GCP", "Docker", "Kubernetes", "SQL", "NoSQL", "MongoDB", "PostgreSQL",
        "Git", "CI/CD", "Machine Learning", "AI", "TensorFlow", "PyTorch"
    ];

    const foundTech = techKeywords.filter(tech => description.includes(tech));

    return {
        min: minQual,
        pref: prefQual,
        tech: foundTech.length > 0 ? foundTech.join(", ") : null
    };
}

function extractSection(text, regex) {
    const match = text.match(regex);
    if (match && match.index !== undefined) {
        // Start from the match
        const start = match.index + match[0].length;
        // Try to find the next section header to end the capture
        // This is a naive approach: just take the next 500 chars or until a double newline
        const remainder = text.substring(start);
        const endMatch = remainder.search(/\n\s*\n/); // Double newline often implies new section

        if (endMatch !== -1) {
            return remainder.substring(0, endMatch).trim();
        }
        return remainder.substring(0, 500).trim() + "...";
    }
    return null;
}

function notifyExtension(data) {
    // Enrich data with extracted details before sending
    if (data.description) {
        const extracted = extractJobDetails(data.description);
        data.minQualifications = extracted.min;
        data.prefQualifications = extracted.pref;
        data.technologies = extracted.tech;
    }

    // Send data to popup/background
    chrome.runtime.sendMessage({ action: "jobDetected", data: data });

    // Check Auto-Track setting before saving
    chrome.storage.local.get(['autoTrack'], (result) => {
        const autoTrackEnabled = result.autoTrack !== false; // Default to true

        if (autoTrackEnabled) {
            console.log("ShadowBot: Auto-save enabled. Saving...");
            chrome.runtime.sendMessage({ action: "saveApplication", data: data }, (response) => {
                if (response && response.status === "success") {
                    showToast(`ShadowBot: Tracked ${data.role} at ${data.company}`);
                } else if (response && response.status === "duplicate") {
                    console.log("ShadowBot: Already tracked.");
                }
            });
        } else {
            console.log("ShadowBot: Auto-save disabled. Waiting for manual save.");
            // Optional: Show a different toast or just update the icon badge (handled by background usually)
        }
    });
}

// Toast Notification Logic
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = '#1e293b'; // Dark slate
    toast.style.color = '#fff';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '999999';
    toast.style.fontFamily = "'Inter', sans-serif";
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';
    toast.style.fontSize = '13px';
    toast.style.fontWeight = '500';
    toast.style.transition = 'all 0.3s ease';
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';

    toast.innerHTML = `<span>⚡️</span> ${message}`;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// Helper to convert HTML to Markdown (Basic version)
function htmlToMarkdown(html) {
    if (!html) return "";
    let temp = document.createElement('div');
    temp.innerHTML = html;

    // Replace breaks with newlines
    temp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    temp.querySelectorAll('p, div, li').forEach(block => block.append('\n'));

    return temp.innerText.trim();
}

// Run detection on load
// Use a slight delay to ensure DOM is ready for SPAs
setTimeout(() => detectAndScrape(false), 2000);

// Listen for requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        detectAndScrape(true); // Manual trigger
        sendResponse({ data: jobData });
    }
});
