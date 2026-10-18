# Photo Tools — PRD

Frontend-only web app (React 19 + TypeScript + Vite 5 + Tailwind 3). Three client-side photo tools: background remover, photo editor, QR generator. No backend, no accounts. This PRD captures the current product as shipped plus the fixes delivered in this build (worker pool repair, reset persistence fix, a11y announcement fix, e2e smoke tests, repo hygiene).

## Goals

1. **Client-side privacy**: all processing runs in the browser; photos never leave the device.
2. **Working parallel filters**: photo filters execute in a real Web Worker pool (4 workers) with correct convolution kernels, not silently on the main thread.
3. **Honest UI state**: worker status badge, progress logs, and a11y announcements reflect actual state (no false "active" claims, no spurious announcements).
4. **Reliable deliverables**: transparent PNG / adjusted image / QR code are downloadable and copyable, and reset restores exactly the saved defaults.
5. **Verifiable build**: `pnpm typecheck`, `pnpm lint`, `pnpx playwright test`, and `pnpx tsc && pnpx vite build` all pass (gates G3/G4).

## User Stories

### Background Remover (/)

- As a content creator, I want to paste or drop a photo and get a transparent PNG, so that I can use cut-out subjects without external tools. Acceptance: after drop, processing progress is shown and a downloadable transparent PNG (alpha channel present on cut-out pixels) is offered.
- As a first-time user, I want to see model download progress (~115 MB on first use), so that I know the app is working, not frozen. Acceptance: progress percentage is visible during the initial ModNet download via @huggingface/transformers.
- As a user, I want to copy the result to the clipboard, so that I can paste it directly into another app. Acceptance: copy action triggers a clipboard write and a success/error notice.

### Photo Editor (/photo-editor)

- As a user, I want live slider adjustments for brightness, contrast, saturation, and exposure on a canvas preview, so that I can see the effect before saving. Acceptance: moving any slider updates the canvas preview without reload; values render as labeled controls.
- As a user, I want filters (grayscale, sepia, invert, blur, sharpen, emboss) to run in a worker pool, so that the UI stays responsive on large images. Acceptance: worker status badge reads "active" and remains accurate (workers answer the init handshake); filters produce correct convolution output (e.g., grayscale reduces per-pixel color variance).
- As a user, I want reset to restore and persist the saved default settings, so that "reset" means what it says. Acceptance: after changing sliders/filters then resetting, UI controls show defaults AND persisted settings equal the defaults (not the pre-reset values).

### QR Generator (/qr-generator)

- As a user, I want to type text and get a QR code with size, error-correction level, and fg/bg colors, so that I can brand the code. Acceptance: changing size/ECC/colors re-renders the QR (debounced); controls are labeled.
- As a user, I want to download or copy the QR, so that I can share it. Acceptance: download yields a QR image file; copy places image on clipboard with feedback.
- As a returning user, I want my QR settings to persist, so that I do not reconfigure every visit. Acceptance: settings are stored in localStorage and restored on reload.

## Acceptance Criteria

| Story | Verifiable criterion (Playwright e2e) |
|---|---|
| BG: drop photo → PNG | Drop image on dropzone → progress announced → download link appears; downloaded PNG has transparent pixels in cut-out region |
| BG: model download progress | On first use, progress % text updates during ~115 MB ModNet download |
| BG: copy result | Click copy → clipboard contains image data, success notice shown |
| Editor: live sliders | Change brightness slider → canvas pixel values change; no page reload |
| Editor: worker pool real | Worker status badge = "active"; init handshake answered (no timeout); grayscale/sharpen output differs from input and matches expected kernel behavior |
| Editor: reset persists | Change settings → reset → controls show defaults; reload → defaults still persisted (pre-reset values NOT restored) |
| QR: text → canvas | Enter text → canvas contains both dark and light modules; changing size/ECC recolors/re-renders |
| QR: download/copy | Download yields QR file; copy succeeds with feedback |
| QR: persistence | Set size/color → reload → same values restored |
| A11y: no spurious announcement | Page load → aria-live region does NOT announce "Processing complete" |
| A11y: base support | Skip link reachable by keyboard; focus lands on main content after route change |
| Build health | `tsc --noEmit` clean, eslint clean, e2e smoke suite green, `vite build` succeeds |

## Out of Scope

- Background removal model quality tuning (thresholds, new models)
- i18n / localization
- Auth, accounts, or any backend service
- Mobile/native app
- Batch processing, video processing
- Cloud model hosting (model must stay browser-local)
