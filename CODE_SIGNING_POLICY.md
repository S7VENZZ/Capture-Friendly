# Code signing policy

> **Status:** The installer is **not signed yet** (Windows shows "Unknown publisher" for it). Free code signing from SignPath Foundation is planned; this policy describes how signing will work once it is granted.

**Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).**

This page describes how the Windows installer of **Capture Friendly** is signed.

## What is signed

- Only the Windows installer `Capture-Friendly-Setup-<version>.exe` of the [releases](https://github.com/S7VENZZ/capture-friendly/releases) is signed.
- It is built from the public source code in this repository by GitHub Actions (workflow `.github/workflows/release.yml`) when a release tag `v<version>` is pushed. Nothing is signed that was not built there.
- The product name ("Capture Friendly") and the version are set in `package.json` and are the same in the installer.
- The program and everything in it is open source: this project is under the [MIT license](LICENSE); it includes Electron (MIT) and Chromium (BSD and other open licenses).

## Roles

| Role | Member |
|---|---|
| Authors and committers | [S7VENZZ](https://github.com/S7VENZZ) |
| Reviewers | [S7VENZZ](https://github.com/S7VENZZ) |
| Approvers (approve every signing request) | [S7VENZZ](https://github.com/S7VENZZ) |

Every signing request is approved by hand in SignPath before the signed installer is published. All members use multi-factor authentication for GitHub and for SignPath.

## Privacy policy

This program does not send your picture, your sound, the name of your capture card or any other information about you or your computer to other networked systems.

It only contacts GitHub (`api.github.com` and `github.com`) to ask for the newest release when it starts and when you click "Check", and to download the installer after you click "Update". The installer is only started when its size and SHA-256 checksum match what GitHub reports for that file.

On your PC the program reads, but never changes, one Windows setting: whether "Listen to this device" is switched on for the card's sound input (a registry value, read with `reg query`). The answer is a yes or no that only stays in the window. Nothing leaves your PC.

If you switch on the optional Discord display (off by default), the program talks to the Discord program on your own PC (a local connection, not over the internet) and sends only a fixed text: a timer, the logo and a link to the download page.

## What this program is not

Capture Friendly is a viewer for a capture card: it shows the picture and sound of the card in a window. It has no hacking, scanning or exploit functionality and no feature that hides itself.

## Questions or complaints about a signed file

Please open an [issue](https://github.com/S7VENZZ/capture-friendly/issues/new/choose). If a signed file turns out to break this policy, the maintainer reports it to SignPath and helps to investigate.
