## Your brief

You have **24 hours from the moment you pressed Start** to audit **ezyourlife.com** as if you had just joined the team, and to show us how you find problems, fix them and make the product better.

EZYOURLIFE presents itself as an AI app store for small businesses in India: 445+ AI apps, websites and digital cards, 100 free credits, and pay only for results. Act as developer, tester and UX reviewer for the real product.

The work should take **6 to 8 focused hours**, not 24. The window is there so you can fit it around your day. We would rather read a sharp, honest report than an exhausted one.

We are not looking for a long list of cosmetic nitpicks. We are looking for:

- real bugs, each reproducible and ranked by impact
- UX problems backed by evidence from a first-time user's point of view
- a testing mindset: what to test first, what to automate, what to leave
- one real fix or improvement that you actually build
- a prioritized roadmap that shows business judgment

You may use any tools you like, including AI assistants. You must be able to explain every finding and every line of code in a follow-up call. Findings you cannot explain will count against you.

## Rules of engagement

This is a live product with real users. Test it the way a careful new employee would.

**Allowed**

- Using the site as a normal user on your own test account, with test data only
- Using free credits to try apps; browser dev tools, Lighthouse, axe, WAVE and screen readers
- Testing on different devices, screen sizes, browsers and slow-network throttling
- Reading the page source and the network requests your own browser makes

**Not allowed**

- Load, stress or denial-of-service testing, or automated scanning and crawling at high rates
- Trying to access any other user's data, accounts, files or admin areas
- Exploiting a security weakness beyond proving it exists. If you find one, stop, write down the minimum steps, and report it. Do not demonstrate it further.
- Making real payments with someone else's card, spamming forms, or sending messages to real people
- Sharing screenshots, findings or credentials publicly, or posting this assignment online

If you find something that looks like a **security issue or exposed personal data**, tell us immediately by message, in addition to your report. Good judgment here is a strong positive signal. Anything that breaks these rules ends the assignment.

## Tasks

| Part | Task | Points |
| --- | --- | --- |
| 0 | Map the product | no score |
| A | Bug hunt | 30 |
| B | UX audit | 25 |
| C | Testing plan and automation | 15 |
| D | Fix or build one improvement | 20 |
| E | Prioritized roadmap | 10 |

**Part 0: Map the product (30 min).** Before you test, sketch the flows you can find: first visit, sign-up and login, browsing and searching the app catalogue, running an app, spending credits, buying more, building a website or digital card, contacting support. Say which flows you could not reach and why. A short list or diagram is enough.

**Part A: Bug hunt.** Find at least **8 real issues** across functionality, data, performance, responsiveness, browser support and content. Cover at least three different flows. For each, give the steps to reproduce, expected vs actual result, device and browser, evidence, severity and likely root cause. Include at least one issue you think has **a deeper cause** (for example state, caching, validation or API behaviour), not only what is visible on screen. If you find fewer than eight real ones, report what you found; padding with weak items costs points.

**Part B: UX audit.** Pretend you are a shopkeeper in a small Indian town who has never used an AI tool, on a mid-range phone and a patchy 4G connection. Walk through first-time use and complete one real task, such as making a bill or a digital card. Report:

- the first five minutes: what was confusing, what made you hesitate or leave
- five specific UX problems, each with evidence, who it hurts, and a concrete redesign shown as a sketch, annotated screenshot or short Figma or HTML mock
- accessibility: keyboard use, contrast, labels, touch target size, screen-reader behaviour on one key page
- clarity of the promise: do "pay only for results" and "100 free credits" make sense, and when and how are credits used

**Part C: Testing.** Write a short test strategy for this product: the top risks, what you would test manually, what you would automate and why, and what you would monitor in production. Then deliver **at least 10 written test cases** for one critical flow (for example sign-up through first successful app run), including edge cases. Bonus: add three automated tests (Playwright, Cypress or similar) that run against a page you are allowed to test as a normal user, kept light enough not to harm the site.

**Part D: Fix or build one improvement.** You cannot touch our production code. Choose one finding and show how you would fix it: a working prototype or patch in **your own public or private repo**, a small component, a Lighthouse before-and-after on a clone of a static page, or a documented code-level proposal. Include what you changed, why, how you tested it, and what could go wrong. If you did not have access to our code, say what you would check in it first.

**Part E: Roadmap.** From everything you found, list your **top 10 recommendations** in a table ranked by impact and effort, with the reason for the order, a metric that will show success, and which 3 you would do in the first two weeks. Include one thing you would deliberately **not** do.

## What to submit

Use the boxes on this page before your 24 hours end. Once the clock ends, everything is locked.

1. **Answer box:** paste your executive summary (half a page on your three most important findings) and **one link** (Google Drive, Notion or GitHub) to your full report. Make sure the link opens for anyone who has it.
2. **Upload your files** on this page: the report (PDF or doc, 6 pages max plus appendix), the bug log (spreadsheet or table), the evidence (screenshots, short screen recordings under 90 seconds each, Lighthouse or network exports), and the Part D README or patch. Files must be 5 MB or smaller each, up to 10 files. If something is bigger, put it in your linked folder.
3. **A short note** in the answer box on which tools you used, including AI tools, and where you disagreed with them.

Bug log columns: ID, Title, Flow, Severity, Steps to reproduce, Expected, Actual, Device and browser, Evidence, Likely cause, Suggested fix.

Severity scale: **Critical** (money, data loss, security, cannot sign up), **High** (core flow broken for many users), **Medium** (workaround exists), **Low** (cosmetic or rare).

Be ready for a **30-minute follow-up call** within 48 hours of submission to walk through your findings and your code.

## Suggested time plan

Plan about 7 hours of work across the window. Sleep and breaks are expected.

| Block | Time |
| --- | --- |
| Part 0: map the product | 0:30 |
| Part A: bug hunt | 2:00 |
| Part B: UX audit | 1:30 |
| Part C: testing | 1:00 |
| Part D: one fix | 1:30 |
| Part E: roadmap | 0:30 |
| Review and write the summary | 0:30 |
