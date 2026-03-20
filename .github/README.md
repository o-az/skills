# Skills

Hand-crafted [agent skills](https://skills.sh) I built for my own workflows. Each one solves a real problem I kept running into.

## What's in here

| Skill                                            | What it does                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [screencast](/skills/screencast)                 | Live-stream browser screencasts over WebSocket so others can watch in real time.                                                                            |
| [terminal-recording](/skills/terminal-recording) | Record, upload, and GIF-convert terminal sessions with [`asciinema`](https://github.com/asciinema/asciinema) and [`agg`](https://github.com/asciinema/agg). |
| [upload-image](/skills/upload-image)             | Uploads images to [imgbb](https://ibb.co) — local files, URLs, SVGs, base64, whatever. No more manual hosting.                                              |

## Use them

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

## Make your own

1. Drop a folder in `skills/`
2. Add a `SKILL.md` with `name` and `description` frontmatter
3. That's it. No build step, no config, no ceremony.
