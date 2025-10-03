# CPU Profiling Guide

This guide explains how to profile the ActivityPub server to diagnose CPU spikes and performance issues.

## Quick Start

**Start profiling mode:**
```bash
yarn dev:profile
```

## Profile Files Location

CPU profiles are saved to the `./profiles/` directory with timestamps:
```
profiles/
├── CPU.20240123.142547.001.0.001.cpuprofile
├── CPU.20240123.142612.002.0.001.cpuprofile
└── ...
```

## Analyzing Profiles

### Chrome DevTools

1. Open Chrome and go to `chrome://inspect`
2. Click "Open dedicated DevTools for Node"
3. Go to the **"Performance"** tab (not Profiler tab)
4. Click the "Load profile" button (folder icon)
5. Select your `.cpuprofile` file
6. Analyze the flame graph and call tree
