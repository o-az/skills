# Skills

Hand-crafted [agent skills](https://skills.sh) I built for my own workflows. Each one solves a real problem I kept running into.

> Skills SPEC: https://agentskills.io/specification

## What's in here

| Skill                                            | What it does                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [manipulating-video](/skills/manipulating-video) | Manipulate video files with `ffmpeg` — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more.         |
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

<details>
<summary>Eval Results</summary>

Iteration 1 evals were run for every skill in this repo. Benchmarks compare `with_skill` against a baseline run.

| Skill                | With Skill | Baseline |   Delta |
| -------------------- | ---------: | -------: | ------: |
| `manipulating-video` |     1.0000 |   0.3611 | +0.6389 |
| `screencast`         |     1.0000 |   0.5000 | +0.5000 |
| `template`           |     1.0000 |   0.0000 | +1.0000 |
| `terminal-recording` |     1.0000 |   0.4167 | +0.5833 |
| `upload-image`       |     1.0000 |   0.2222 | +0.7778 |

Benchmarks:

- [`skills/manipulating-video/evals/workspace/iteration-1/benchmark.json`](/skills/manipulating-video/evals/workspace/iteration-1/benchmark.json)
- [`skills/screencast/evals/workspace/iteration-1/benchmark.json`](/skills/screencast/evals/workspace/iteration-1/benchmark.json)
- [`skills/template/evals/workspace/iteration-1/benchmark.json`](/skills/template/evals/workspace/iteration-1/benchmark.json)
- [`skills/terminal-recording/evals/workspace/iteration-1/benchmark.json`](/skills/terminal-recording/evals/workspace/iteration-1/benchmark.json)
- [`skills/upload-image/evals/workspace/iteration-1/benchmark.json`](/skills/upload-image/evals/workspace/iteration-1/benchmark.json)

</details>
