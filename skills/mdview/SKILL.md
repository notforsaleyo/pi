---
name: mdview
description: Show the user rendered Markdown in a viewer pane beside the agent's terminal in the Herdr app. Use when an answer is easier to read rendered than in the terminal (long explanations, tables, comparisons, documents, local images), or when the user asks to see something in the viewer or a Markdown pane (e.g. "md로 보여줘", "뷰어에 띄워줘", "마크다운으로 정리해서 보여줘"). Only usable when running inside a Herdr app terminal (the `HC_TERMINAL_ID` environment variable is set); otherwise do not use it and answer in the terminal.
---

# mdview: Markdown viewer pane in Herdr

Works only inside a Herdr app terminal. If `HC_TERMINAL_ID` is not set, do not use this skill; answer in the terminal instead. Inside Herdr it works from any space and tab.

## Show

```powershell
# Markdown you write for the answer: pipe it (a single-quoted here-string needs no escaping)
@'
# Title

Body
'@ | pwsh -NoProfile -File ~/.config/herdr-app/mods/mdview/show.ps1

# A document that already exists
pwsh -NoProfile -File ~/.config/herdr-app/mods/mdview/show.ps1 -Path <file.md>
```

- Content written for the answer: pipe it. Do not create temporary .md files just for viewing.
- An existing document (project docs, notes): `-Path`. Relative image paths then resolve against that file's folder.
- `-Text "<markdown>"` also works, but only for a line or two (quoting and command-line length).
- Every call opens a new viewer to the right of this terminal; the tab's previous viewer closes itself. Just call it again to update. Do not try to detect, reuse, or close viewers. The user closes the pane with the mouse.
- Keyboard focus returns to this terminal by itself.
- The script prints the viewer's document path. On failure it throws; report the error instead of retrying blindly.
- Still give a short summary in the terminal reply; the viewer complements the answer, it does not replace it.

## What renders

- Headings, emphasis, inline code, links, lists (nested), numbered lists, quotes, tables, fenced code blocks.
- Images: `![alt](path)` on local files, relative to the .md file (`-Path`) or to the current folder (pipe, `-Text`), or absolute. They are copied into the viewer's folder automatically.
- Not supported: web images (`http...`, shown as a note), Mermaid or other diagrams (shown as code), HTML.

## Files

- The document is written to `~/.config/herdr-app/.mdview/<tabId>.md`, one per tab, overwritten on every call; images go to `.mdview/<tabId>/` and are replaced on every call. Files of closed tabs are deleted on the next call. Nothing else to clean up.
- Details: `~/.config/herdr-app/mods/mdview/README.md`.
