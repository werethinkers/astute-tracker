## Your brief

You have **24 hours from the moment you pressed Start** to audit **ezyourlife.com** as if you had just joined the team, and to show us how you find problems, fix them and make the product better.

EZYOURLIFE presents itself as an AI app store for small businesses in India: 445+ AI apps, websites and digital cards, 100 free credits, and pay only for results. You act as developer, tester and UX reviewer for the real product.

The work should take **7 to 9 focused hours**, not 24. The window is there so you can fit it around your day. We would rather read a sharp, honest report than an exhausted one.

We are not looking for a long list of cosmetic nitpicks. We are looking for:

- real bugs, each reproducible and ranked by impact
- UX problems backed by evidence from a first-time user's point of view
- a testing mindset: what to test first, what to automate, what to leave
- one real fix or improvement that you actually build
- a prioritized roadmap that shows business judgment

You may use any tools you like, including AI assistants. You must be able to explain every finding and every line of code in a follow-up call. Findings you cannot explain will count against you.

## How you submit

**Everything is done on this page.** Each part below has its own section. Type your work into the boxes, add **screenshots and files straight to the bug or finding they belong to** (use Choose files, or paste an image with Ctrl+V / Cmd+V while the cursor is in that item), and it all saves automatically. Nothing needs to be emailed. When the clock ends, or when you press Submit final, everything is locked.

Use a dedicated test account on the site with test data only. If you find something that looks like a **security issue or exposed personal data**, tell us immediately by message, in addition to your report. Good judgment here is a strong positive signal.

## Tasks

| Part | Task | Points |
| --- | --- | --- |
| 0 | Map the product | no score |
| A | Bug hunt | 30 |
| B | UX audit | 25 |
| C | Testing plan and automation | 15 |
| D | Fix or build one improvement | 20 |
| E | Prioritized roadmap | 10 |
| F | Coding questions (run the tests on this page) | scored separately |

**Part 0: Map the product (30 min).** Before you test, sketch the flows you can find: first visit, sign-up and login, browsing and searching the app catalogue, running an app, spending credits, buying more, building a website or digital card, contacting support. Say which flows you could not reach and why. A short list is enough. You can attach a diagram or sketch.

**Part A: Bug hunt.** Find at least **8 real issues** across functionality, data, performance, responsiveness, browser support and content. Cover at least three different flows. For each, log the steps to reproduce, expected vs actual result, device and browser, severity and likely root cause, and **attach a screenshot or short screen recording** (under 90 seconds) as evidence. Include at least one issue you think has **a deeper cause** (for example state, caching, validation or API behaviour), not only what is visible on screen. If you find fewer than eight real ones, report what you found; padding with weak items costs points.

Severity scale: **Critical** (money, data loss, security, cannot sign up), **High** (core flow broken for many users), **Medium** (workaround exists), **Low** (cosmetic or rare).

**Part B: UX audit.** Pretend you are a shopkeeper in a small Indian town who has never used an AI tool, on a mid-range phone and a patchy 4G connection. Walk through first-time use and complete one real task, such as making a bill or a digital card. Report:

- the first five minutes: what was confusing, what made you hesitate or leave
- five specific UX problems, each with evidence (screenshot), who it hurts, and a concrete redesign shown as a sketch, annotated screenshot or short mock
- accessibility: keyboard use, contrast, labels, touch target size, screen-reader behaviour on one key page
- clarity of the promise: do "pay only for results" and "100 free credits" make sense, and when and how are credits used

**Part C: Testing.** Write a short test strategy for this product: the top risks, what you would test manually, what you would automate and why, and what you would monitor in production. Then write **at least 10 test cases** for one critical flow (for example sign-up through first successful app run), including edge cases. Bonus: three automated tests (Playwright, Cypress or similar) against a page you are allowed to test as a normal user. Paste them in, or attach the files.

**Part D: Fix or build one improvement.** You cannot touch our production code. Choose one finding and show how you would fix it: a working prototype or patch in **your own public or private repo**, a small component, a Lighthouse before-and-after on a clone of a static page, or a documented code-level proposal. Say what you changed, why, how you tested it, and what could go wrong. Give the link to your repo or attach the files. If you did not have access to our code, say what you would check in it first.

**Part E: Roadmap.** From everything you found, list your **top 10 recommendations** ranked by impact and effort, with the reason for the order and a metric that will show success, and mark which 3 you would do in the first two weeks. Include one thing you would deliberately **not** do.

**Part F: Coding questions (about 45 min).** Below you will find four short JavaScript questions. Each has a code box and sample tests. Press **Run tests** to see which pass. Your code is saved automatically. We run extra tests you cannot see, so handle edge cases, not just the samples. You may use any tools you like, but you must be able to explain your code.

**Finally**, write a half-page executive summary of your three most important findings, and a short note on the tools you used, including AI tools, and where you disagreed with them.

Be ready for a **30-minute follow-up call** within 48 hours of submission to walk through your findings and your code.

## Suggested time plan

Plan about 8 hours of work across the window. Sleep and breaks are expected.

| Block | Time |
| --- | --- |
| Part 0: map the product | 0:30 |
| Part A: bug hunt | 2:00 |
| Part B: UX audit | 1:30 |
| Part C: testing | 1:00 |
| Part D: one fix | 1:30 |
| Part E: roadmap | 0:30 |
| Part F: coding questions | 0:45 |
| Review and write the summary | 0:30 |
