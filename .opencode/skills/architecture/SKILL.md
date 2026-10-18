---
name: architecture
description: How to define tech stack, directory structure, data model, and API contracts.
---
# Architecture Playbook

## Architecture Template
```
## Overview
- Single-sentence project description

## Tech Stack
- Framework, UI, state, storage, build

## Directory Tree
src/
  components/
  hooks/
  lib/
  types/
  db/

## Components
- Component list + responsibilities

## State
- State management strategy

## Data/Storage
- Data layer approach (IndexedDB, localStorage, etc.)

## A11y
- Accessibility considerations

## Performance
- Performance considerations

## Data flow
- How data moves through the app

## Open questions
- Unresolved items
```

## Frontend-only detection
- Check `package.json` for server dependencies (express, fastify, etc.)
- If none found, skip API_CONTRACT and note "client-only, no API"
