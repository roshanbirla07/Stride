---
version: alpha
name: Stride
description: Private step standings with visible refresh times.
colors:
  background: '#101726'
  panel: '#1d2737'
  text: '#f5f6fc'
  muted: '#8997af'
  border: '#324054'
  action: '#baff57'
  hero: '#6f45ff'
  older-total: '#ffcf95'
typography:
  sans:
    fontFamily: 'system-ui, sans-serif'
rounded:
  button: '12px'
  hero: '20px'
spacing:
  native-page: '23px'
components:
  refresh-button: {}
  leaderboard: {}
---

## Overview

Stride is a private walking challenge for small groups, used on phones. Preserve the existing sports-scoreboard identity: bold step totals, purple hero and lime selected controls. Product clarity takes precedence over decoration. English copy and IST challenge ranges come from README.md; health refresh times are explicitly labelled in IST. Runtime owners are `mobile/src/App.tsx` (C and s) and `server/web/style.css`; this file documents their established native palette and creates no separate token runtime. No visual rebrand is part of the refresh change.

## Colors

Use background/panel for layers, text/muted for hierarchy, border for separation, action for the primary refresh and selected tabs, and hero for personal standings. Preserve existing dark mode.

## Typography

Native system fonts keep device readability. Existing bold totals carry hierarchy; names and counts remain readable, refresh timestamps are subordinate and can wrap.

## Layout

Keep native safe-area scrolling, 23px content padding, group controls, period tabs, range caption, hero, health status, refresh action and standings in their established order. The profile initials sit beside the wordmark, and the compact greeting uses real JSX expressions instead of literal backslash-newline text. Refresh timestamps must wrap within the name column rather than displacing step counts.

## Elevation & Depth

Use existing tonal surfaces and borders. Add no shadows or overlay layers for refresh.

## Shapes

Preserve existing 12px action radius and 20px hero radius. The selected group chips keep their existing pill shape.

## Components

Refresh behavior is owned by App.tsx and the authenticated methods in api.ts; IST ranges and group access validation are owned by server/app.py. Joining is immediate; full-period user totals are reused in every joined group, and joining dates never shorten the range. Reuse the existing status message and primary button. The button remains present and disabled while refreshing; the hero uses an ellipsis during loading and a dash when no total is available. Failed reads show the error and allow retry. Request generations prevent outdated screen responses replacing the selected period. Each entry exposes its last refresh time; retained offline totals must never be described as live measurements. The web group Select/Listbox is native: server/web/index.html owns the standard select and delegates popup geometry and keyboard behavior to the browser; server/web/app.js handles selection. The amber older-total colour marks totals recorded before the current IST day. Ranks describe the returned entries (Rank #2 of 5), not all group memberships. Previous rewards are collapsed on web and within group management on native. Period selection is exposed to assistive technology, and web controls retain visible keyboard focus. Existing web controls are retained; Safari's Shortcut limitation is stated beside its Today Shortcut action. A separate Refresh standings button fetches the selected leaderboard without claiming a new health read. No new motion or icon system is introduced.

## Do's and Don'ts

- Do replace the latest aggregate and recalculate ranks, including equal totals.
- Do explain empty, pending and failed reads without presenting missing data as zero.
- Don't sum Stride's past uploads to represent current week/month health totals.
- Don't describe offline members' totals as live, or promise vendor-app parity without device verification.
