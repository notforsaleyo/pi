# nofs-hc-subagent

The `subagent` tool. Agents defined in `<cwd>/.pi/agents/*.md` run as
interactive pi children in herdr terminals under the current pi terminal,
named `<agent>-<family>` (`reviewer-claude`, `reviewer-gpt`; `-2`, `-3`... when
the name is taken). You can watch or steer them in herdr while they work. The
tool waits for each child's final reply, returns only that reply, and removes
the terminal. Entries in one call run in parallel.

The tool exists only when pi runs inside herdr (`HC_TERMINAL_ID`) and
`<cwd>/.pi/agents` exists. Children never get it.

## Agent definition

Frontmatter only; the body is not sent to the child. Other keys are ignored.

```yaml
---
description: Reviews a diff
model: opus                    # default; exact or loose; a call may override it
thinking: high                 # default; a call may override it
tools: read, grep, find, ls    # pi --tools; omitted = pi's default tools
docs: docs/a.md, docs/b.md     # attached as @file
doc-paths: docs/big.md         # listed in the task; the child reads them itself
---
```

The file name is the agent name. Lists are `a, b` or `[a, b]`.

## Models

A model may be named loosely. For "opus high" the parent passes model `opus`
and thinking `high`. The name is matched against the models pi can run right
now (`provider/id`): an exact id wins, otherwise every word must start a part
of the id. The newest match is used (`anthropic/claude-opus-5-5`); different
variants of the newest version (`gpt-6.2-sol`, `gpt-6.2-astra`) are reported as
ambiguous. The thinking level must be one the model supports. The family in the
terminal name is the first word of the id.

## Children

A child is pi started with:

- the `args` in `config.json` (`--no-session`, no skills, prompt templates,
  themes, or context files, project files ignored);
- `--no-extensions` plus only the `extensions` in `config.json` and `child.ts`;
- `PI_SUBAGENT_DEPTH=1`.

Its first message is the `doc-paths` list, the task, and `taskNote`. The
parent is told to write tasks in `promptLanguage`.

When the child settles, `child.ts` writes its last assistant message to a
result file; that file marks completion. A child waiting on a dialog is shown
as blocked in the tool's progress and waited on.

## Files

| File | Role |
| --- | --- |
| `config.json` | language, task note, child args, extension allowlist |
| `index.ts` | tool registration, description, resolving each call |
| `agents.ts` | reads agent definitions |
| `models.ts` | loose model name -> newest exact id |
| `command.ts` | the child's pi command line and first message |
| `run.ts` | starts the child terminal, waits for the result, cleans up |
| `hc.ts` | herdr-core CLI calls |
| `launcher.mjs` | runs in the child terminal; starts pi with the job's argv and env |
| `child.ts` | loaded into children; writes the final reply |

Tests: `node --test models.test.ts command.test.ts`.
