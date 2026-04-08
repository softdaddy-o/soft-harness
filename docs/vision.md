# Vision

## Problem

Claude and Codex environments accumulate configuration across many places:

- instruction files
- skills
- agents
- plugins
- MCP definitions
- local account settings
- project settings

That state drifts over time and becomes hard to audit, share, or clean up.

## Goal

Build a governance-first harness that gives a single source of truth while preserving host-native behavior.

## Non-Goals

- replacing vendor-native plugin installers
- handling secrets beyond local references
- building a generic multi-LLM runtime from day one

## Initial Supported Hosts

- Claude
- Codex

## Core Product Ideas

- discovery-first onboarding
- registry-driven generation
- doctor-style governance checks
- migration from unstructured local state
- clear support for account-wide and project-wide scope
