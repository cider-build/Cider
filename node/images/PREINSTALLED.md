# Base image contents

This file contains what is installed for the current base image.

Rule: base images never contain credentials. Secrets are injected at boot.

## macos-base (current default)

The stock macOS VM image. Verified contents:

- macOS 26.5
- git
- Python 3
- Xcode Command Line Tools (`xcodebuild` stub; not the Xcode app)
- Homebrew, with a number of packages already present (docker, colima,
  and others) — but NOT on the non-login shell PATH; commands must use a
  login shell or the full `/opt/homebrew/bin` path
- No Node.js on the PATH until installed

## macos-dev (planned batteries-included default)

Modeled on what sandbox platforms preinstall — E2B ships Python, Node,
Yarn, git, curl, build-essential, and the GitHub CLI in its default image;
Daytona and Vercel Sandbox ship the same shape. For Cider:

- Everything in macos-base
- Homebrew
- Node.js (latest LTS) and npm
- GitHub CLI (`gh`)
- Common tools: `jq`, `wget`

Until this image is built and distributed, the backend installs the
equivalent at provision time when a server's software needs it.

## macos-xcode (planned)

macos-dev plus the full Xcode app. Ships as its own image with a larger
virtual disk — Xcode does not fit the default image's disk, so it is
never installed at provision time.
