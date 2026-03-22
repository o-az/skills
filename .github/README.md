# Skills

> [!INFO] What are "Skills"?
> Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively. Skills can include code generation patterns, domain expertise, tool integrations, and more. [skills.sh](https://skills.sh/docs/faq)

Hand-crafted Skills I built for my workflows. Each one solves a real problem I kept running into.

## What's in here

| Skill                                            | What it does                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [manipulating-video](/skills/manipulating-video) | Manipulate video files with [`ffmpeg`](https://github.com/ffmpeg/ffmpeg) — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. |
| [screencast](/skills/screencast)                 | Live-stream browser screencasts over WebSocket so others can watch in real time.                                                                                                        |
| [terminal-recording](/skills/terminal-recording) | Record, upload, and GIF-convert terminal sessions with [`asciinema`](https://github.com/asciinema/asciinema) and [`agg`](https://github.com/asciinema/agg).                             |
| [upload-image](/skills/upload-image)             | Uploads images to [imgbb](https://ibb.co) — local files, URLs, SVGs, base64, whatever. No more manual hosting.                                                                          |

## How do I use <skill-name>?

Install a single skill:

```bash
npx skills@latest add o-az/skills --skill <skill-name>
```

Install all skills:

```bashbash
npx skills@latest add o-az/skills --all
```

## Contributing a new Skill

0. Copy skill template

```sh
cp -R skills/template skills/<new-skill-name>
```

1. Edit `skills/<new-skill-name>/SKILL.md` with the new Skill's name and description
2. Add Skill dependencies to `skills/<new-skill-name>/scripts`
   > See scripts in [`skills/screencast`](/skills/screencast) for a skill dependency example
   > Most Skills won't have dependencies.

## Eval Results

Iteration 1 evals were run for every skill in this repo. Benchmarks compare `with_skill` against a baseline run.

| Skill                                              | With Skill | Baseline |   Delta |
| -------------------------------------------------- | ---------: | -------: | ------: |
| [`manipulating-video`](/skills/manipulating-video) |     1.0000 |   0.3611 | +0.6389 |
| [`screencast`](/skills/screencast)                 |     1.0000 |   0.5000 | +0.5000 |
| [`template`](/skills/template)                     |     1.0000 |   0.0000 | +1.0000 |
| [`terminal-recording`](/skills/terminal-recording) |     1.0000 |   0.4167 | +0.5833 |
| [`upload-image`](/skills/upload-image)             |     1.0000 |   0.2222 | +0.7778 |

Benchmarks:

- [`skills/manipulating-video/evals/workspace/iteration-1/benchmark.json`](/skills/manipulating-video/evals/workspace/iteration-1/benchmark.json)
- [`skills/screencast/evals/workspace/iteration-1/benchmark.json`](/skills/screencast/evals/workspace/iteration-1/benchmark.json)
- [`skills/template/evals/workspace/iteration-1/benchmark.json`](/skills/template/evals/workspace/iteration-1/benchmark.json)
- [`skills/terminal-recording/evals/workspace/iteration-1/benchmark.json`](/skills/terminal-recording/evals/workspace/iteration-1/benchmark.json)
- [`skills/upload-image/evals/workspace/iteration-1/benchmark.json`](/skills/upload-image/evals/workspace/iteration-1/benchmark.json)

<details>

<summary>more on Skills</summary>

- Specification: https://agentskills.io/specification
- `skills` CLI: https://skills.sh/docs/cli

</details>
